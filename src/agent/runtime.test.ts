import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Journal, resultsFolder} from '../device/evidence.ts';
import {HarnessError} from '../harness/lib/errors.ts';
import {encodePng} from '../harness/lib/png.ts';
import {done, FakeDevice, hostOf, signIn} from './__fixtures__/device.ts';
import type {Reply} from './__fixtures__/model.ts';
import {callsTool, says, scriptedModel, usage} from './__fixtures__/model.ts';
import type {HarnessAgents} from './config.ts';
import {tainted} from './policy.ts';
import type {AgentHost, TestOf} from './runtime.ts';
import {AgentRuntime, debugLine, traceRequest, withRedactedOutput} from './runtime.ts';
import {secret, unique} from './secrets.ts';
import {defineTool} from './tools.ts';
import {AgentError} from './types.ts';
import type {Model} from './types.ts';

const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;
const passed = {status: 'passed', summary: 'Signed in.', errorCode: null};
const complete = (summary = 'Signed in.') => callsTool('complete_step', {...passed, summary});
const verdict = (value: string, explanation: string) => callsTool('verdict', {verdict: value, explanation});
const none = {type: 'object', properties: {}, required: [], additionalProperties: false};
const rejection = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as AgentError);

/** A PNG the driver writes: the screen at its own size, all white. */
const writer = (file: string) => {
  fs.writeFileSync(file, encodePng({width: 400, height: 800, pixels: Buffer.alloc(400 * 800 * 4, 255)}));
  return Promise.resolve(done());
};

/** A device whose Sign in press signs in. */
function signingIn(overrides: ConstructorParameters<typeof FakeDevice>[0] = {}): FakeDevice {
  const device = new FakeDevice(overrides);
  device.onPress = target => (JSON.stringify(target) === '{"ref":"@e14"}' ? signIn({signedIn: true}) : undefined);
  return device;
}

interface SetUp {
  replies?: Reply[];
  judge?: Reply[];
  harness?: HarnessAgents;
  environment?: Record<string, string>;
  device?: FakeDevice;
  test?: Partial<TestOf>;
  root?: string;
  route?: () => Promise<string | undefined>;
  capabilities?: string[];
  /** The app's url, or null for an app with none; its scheme. */
  url?: string | null;
  scheme?: string;
}

/** A runtime over a fake device, its models answering from scripts, its project a folder of its own. */
function runtimeOf(options: SetUp = {}) {
  const device = options.device ?? signingIn();
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-runtime-'));
  const model = scriptedModel(options.replies ?? []);
  const judging = scriptedModel(options.judge ?? []);
  const journal = new Journal();
  journal.begin();
  const host: AgentHost = {
    ...hostOf(device, {journal, ...(options.route ? {route: options.route} : {}), ...(options.capabilities ? {capabilities: new Set(options.capabilities)} : {})}),
    journal,
    identity: 'http://localhost:8090',
    ...(options.url === null ? {} : {url: options.url ?? 'http://localhost:8090'}),
    ...(options.scheme ? {scheme: options.scheme} : {}),
    root,
  };
  const written: string[] = [];
  const harness = options.harness ?? {agents: {default: {model: {...model, judge: judging} as Model}}, secrets: {ADA_PASSWORD: 'correct horse battery'}};
  const runtime = new AgentRuntime({host, harness, environment: env(options.environment), test: () => ({file: 'device/sign-in.test.ts', titlePath: ['signs in'], retry: 0, ...options.test}), write: text => void written.push(text)});
  runtime.begin();
  return {runtime, device, model, judging, journal, root, written, host};
}

const cacheDir = (root: string) => path.join(root, '.harness', 'cache');
/** The journal a runtime acts through. */
const journalOf = (runtime: AgentRuntime) => (runtime as unknown as {host: AgentHost}).host.journal;
const entries = (root: string) => (fs.existsSync(cacheDir(root)) ? fs.readdirSync(cacheDir(root)) : []);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('an act', () => {
  it('runs the built-in loop, notes the act after the steps it took, and says what it cost', async () => {
    const {runtime, journal} = runtimeOf({replies: [callsTool('tap', {ref: '@e5'}), complete()]});
    const result = await runtime.act('sign in');
    expect(result).toEqual({summary: 'Signed in.', cache: {mode: 'missed', reason: 'no-entry', replayedActions: 0, totalActions: 1}, modelCalls: 2, actions: 1, costUsd: 0.0012});
    expect(journal.steps.map(step => [step.event, step.what, step.result])).toEqual([
      ['press', 'agent: tap @e5', 'ok'],
      ['agent', 'act "sign in"', 'ok'],
    ]);
    expect(journal.agents).toEqual([{kind: 'act', instruction: 'sign in', agent: 'default', outcome: 'passed: Signed in. · 2 calls · 1 action · $0.0012 · missed', turns: expect.arrayContaining(['complete_step passed: Signed in.'])}]);
  });

  it("tells the next act what the test's steps before it did", async () => {
    const {runtime, model} = runtimeOf({replies: [complete('Opened it.'), complete()]});
    await runtime.act('open the app');
    await runtime.act('sign in');
    expect(JSON.stringify(model.requests[1]?.messages[0])).toContain('1. act \\"open the app\\": passed. Opened it.');
  });

  it("is the step's own error where the model did not pass it, with the ledger and the journal told", async () => {
    const failing = runtimeOf({replies: [callsTool('complete_step', {status: 'failed', summary: 'There is no sign-in.', errorCode: 'ASSERTION_FAILED'})]});
    const failed = await rejection(failing.runtime.act('sign in'));
    expect([failed?.code, failed?.message]).toEqual(['ASSERTION_FAILED', 'agent.act("sign in"): There is no sign-in.']);
    expect(failing.journal.steps.at(-1)?.result).toBe('failed');
    const blocking = runtimeOf({replies: [callsTool('complete_step', {status: 'blocked', summary: 'It wants a code.', errorCode: 'AUTHENTICATION_FAILED'})]});
    expect(await rejection(blocking.runtime.act('sign in'))).toMatchObject({code: 'AUTHENTICATION_FAILED', blocked: true});
    expect(blocking.journal.agents[0]?.outcome).toMatch(/^blocked: It wants a code\./);
  });

  it('is an AgentError whatever the executor threw', async () => {
    const thrower = (error: unknown) => ({agents: {default: {executor: {name: 'mine', version: '1', runStep: () => Promise.reject(error)}}}});
    expect(await rejection(runtimeOf({harness: thrower(new Error('boom'))}).runtime.act('sign in'))).toMatchObject({code: 'ACTION_FAILED', explanation: 'boom'});
    expect(await rejection(runtimeOf({harness: thrower('a string')}).runtime.act('sign in'))).toMatchObject({code: 'ACTION_FAILED', explanation: 'a string'});
    const gone = await rejection(runtimeOf({harness: thrower(new HarnessError('DRIVER_UNAVAILABLE', 'the browser closed'))}).runtime.act('sign in'));
    expect([gone?.code, (gone?.cause as HarnessError | undefined)?.code]).toEqual(['ACTION_FAILED', 'DRIVER_UNAVAILABLE']);
    expect((await rejection(runtimeOf({harness: thrower(new HarnessError('CONTEXT_OVERFLOW', 'too long'))}).runtime.act('sign in')))?.code).toBe('CONTEXT_OVERFLOW');
  });

  it('is MODEL_UNAVAILABLE where the agent has no model', async () => {
    expect((await rejection(runtimeOf({harness: {}}).runtime.act('sign in')))?.code).toBe('MODEL_UNAVAILABLE');
  });

  it('refuses words that are not an instruction, limits that are not whole, a time that is not one, and an agent the config has not got', async () => {
    const {runtime} = runtimeOf();
    expect(await rejection(runtime.act(' '))).toMatchObject({code: 'INVALID_ARGUMENT', explanation: 'act takes an instruction: what to do, in words'});
    expect(await rejection(runtime.act('sign in', {maxSteps: 0}))).toMatchObject({code: 'INVALID_ARGUMENT', explanation: 'maxSteps is 0; it takes a whole number, 1 or more'});
    expect(await rejection(runtime.act('sign in', {maxModelCalls: 1.5}))).toMatchObject({explanation: 'maxModelCalls is 1.5; it takes a whole number, 1 or more'});
    expect(await rejection(runtime.act('sign in', {timeout: -1}))).toMatchObject({explanation: 'timeout is -1; it takes a number of ms, more than 0'});
    expect(await rejection(runtime.act('sign in', {agent: 'admin'}))).toMatchObject({code: 'INVALID_ARGUMENT', explanation: "there is no agent called admin; the harness config's agents are default"});
  });

  it('is blocked where a secret it fills turns out to have no value', async () => {
    const {runtime, journal} = runtimeOf({
      harness: {agents: {default: {model: scriptedModel([callsTool('type_secret', {ref: '@e3', secret: 'API_PASSWORD'})])}}, secrets: {API_PASSWORD: () => ''}},
    });
    const error = await rejection(runtime.act('sign in with {password}', {params: {password: secret('API_PASSWORD')}}));
    expect([error?.code, error?.blocked]).toEqual(['SECRET_UNAVAILABLE', true]);
    expect(journal.agents[0]?.outcome).toMatch(/^blocked: the secret API_PASSWORD's function answered no value/);
  });

  it('tells a project tool the app it runs against, where it has a url, and its scheme', async () => {
    const seen: unknown[] = [];
    const where = defineTool({name: 'where', description: 'Where.', schema: none, execute: (_input, context) => void seen.push(context.app)});
    const model = scriptedModel([callsTool('where', {}), complete()]);
    const {runtime} = runtimeOf({url: null, scheme: 'entz', harness: {agents: {default: {model, tools: [where]}}}});
    await runtime.act('sign in');
    expect(seen).toEqual([{scheme: 'entz'}]);
  });

  it("is blocked before any call where a secret param has no value", async () => {
    const {runtime, model} = runtimeOf();
    const error = await rejection(runtime.act('sign in with {password}', {params: {password: secret('OTHER_PASSWORD')}}));
    expect([error?.code, error?.blocked, model.requests.length]).toEqual(['SECRET_UNAVAILABLE', true, 0]);
  });

  it("lets an option lower the agent's limits but never raise them", async () => {
    const {runtime} = runtimeOf({device: new FakeDevice(), replies: [callsTool('tap', {ref: '@e5'}), callsTool('tap', {ref: '@e5'})]});
    const error = await rejection(runtime.act('sign in', {maxSteps: 1}));
    expect([error?.code, error?.explanation]).toEqual(['STEP_BUDGET_EXHAUSTED', 'it took 1 actions, its budget']);
  });

  it("runs an agent's own executor, which can keep its steps out of the cache", async () => {
    const executor = {name: 'mine', version: '2', cache: 'off' as const, runStep: () => Promise.resolve({status: 'passed' as const, summary: 'Done my way.'})};
    const {runtime, journal, root} = runtimeOf({harness: {agents: {default: {executor}}}});
    expect(await runtime.act('sign in')).toEqual({summary: 'Done my way.', modelCalls: 0, actions: 0, costUsd: 0});
    journal.verified('it held');
    expect(entries(root)).toEqual([]);
  });

  it("offers an agent's project tools on the platform, and its own instructions", async () => {
    const seed = defineTool({name: 'seed_cart', description: 'Seed.', schema: none, execute: () => 'seeded'});
    const other = defineTool({name: 'other_place', description: 'Elsewhere.', schema: none, platforms: ['android'], execute: () => 'x'});
    const model = scriptedModel([complete()]);
    const {runtime} = runtimeOf({harness: {agents: {default: {model, system: 'Dismiss banners first.', tools: [seed, other]}}}});
    await runtime.act('sign in');
    expect(model.requests[0]?.tools.map(tool => tool.name)).toContain('seed_cart');
    expect(model.requests[0]?.tools.map(tool => tool.name)).not.toContain('other_place');
    expect(model.requests[0]?.system[1]?.text).toContain('Dismiss banners first.');
  });

  it('costs nothing it can name where a model that answered is not priced', async () => {
    const {runtime} = runtimeOf({replies: [complete()].map(each => ({...each, model: 'my-model'}))});
    expect('costUsd' in (await runtime.act('sign in'))).toBe(false);
  });
});

describe("an agent's files", () => {
  it('are offered to the model on web as upload, by their paths, and a path outside the project fails the act', async () => {
    const model = scriptedModel([complete()]);
    const {runtime} = runtimeOf({capabilities: ['press', 'web'], harness: {agents: {default: {model, uploads: ['fixtures/avatar.png']}}}});
    await runtime.act('sign in');
    expect(model.requests[0]?.tools.find(tool => tool.name === 'upload')?.inputSchema.properties).toMatchObject({file: {enum: ['fixtures/avatar.png']}});
    const outside = runtimeOf({capabilities: ['press', 'web'], harness: {agents: {default: {model: scriptedModel([]), uploads: ['../elsewhere.png']}}}});
    expect((await rejection(outside.runtime.act('sign in')))?.message).toContain('../elsewhere.png is outside the project, and a file input is given files from inside it');
  });
});

describe("an agent's model options", () => {
  it("send the agent's provider options with every call, its judge's too", async () => {
    const model = scriptedModel([callsTool('tap', {ref: '@e5'}), complete()]);
    const judging = scriptedModel([verdict('pass', 'The welcome shows.')]);
    const providerOptions = {anthropic: {metadata: {user_id: 'ci'}}};
    const {runtime} = runtimeOf({harness: {agents: {default: {model: {...model, judge: judging} as Model, providerOptions}}}});
    await runtime.act('sign in');
    await runtime.assert('the welcome shows', {screenshot: false});
    expect([...model.requests, ...judging.requests].map(request => request.providerOptions)).toEqual([providerOptions, providerOptions, providerOptions]);
    const plain = runtimeOf({replies: [complete()]});
    await plain.runtime.act('sign in');
    expect(plain.model.requests[0]).not.toHaveProperty('providerOptions');
  });

  it('make no call once one has read maxInputTokens, what was cached included', async () => {
    const model = scriptedModel([callsTool('tap', {ref: '@e5'}, {usage: usage(400, 10, 500, 100)}), complete()]);
    const {runtime} = runtimeOf({harness: {agents: {default: {model, maxInputTokens: 1000}}}});
    const error = await rejection(runtime.act('sign in'));
    expect([error?.code, error?.explanation]).toEqual(['STEP_BUDGET_EXHAUSTED', "its last model call read 1 000 input tokens, at or past the agent's maxInputTokens of 1 000, and the next would read more"]);
    expect(model.requests).toHaveLength(1);
    const roomy = scriptedModel([callsTool('tap', {ref: '@e5'}, {usage: usage(400, 10, 500, 99)}), complete()]);
    const below = runtimeOf({harness: {agents: {default: {model: roomy, maxInputTokens: 1000}}}});
    await below.runtime.act('sign in');
    expect(roomy.requests).toHaveLength(2);
  });
});

describe('the cache', () => {
  it('records a passing act at the first check after it that holds, and replays it with no model call', async () => {
    const first = runtimeOf({replies: [callsTool('tap', {ref: '@e5'}), complete()]});
    await first.runtime.act('sign in');
    expect(entries(first.root)).toEqual([]);
    first.journal.verified('the welcome shows');
    expect(entries(first.root)).toHaveLength(1);
    const entry = JSON.parse(fs.readFileSync(path.join(cacheDir(first.root), entries(first.root)[0] as string), 'utf8')) as Record<string, unknown>;
    expect(entry).toMatchObject({
      v: 1,
      test: {file: 'device/sign-in.test.ts', title: 'signs in'},
      platform: 'web',
      instruction: 'sign in',
      actions: [{tool: 'tap', target: {kind: 'button', name: 'Sign in', testId: null, parent: ['form', 'Sign in']}, input: {}}],
      end: {route: null, appeared: [], disappeared: expect.arrayContaining([{kind: 'button', name: 'Sign in'}])},
      summary: 'Signed in.',
      viewport: {width: 400, height: 800},
    });
    const second = runtimeOf({root: first.root});
    expect(await second.runtime.act('sign in')).toEqual({summary: 'Signed in.', cache: {mode: 'self-finalized', replayedActions: 1, totalActions: 1}, modelCalls: 0, actions: 1, costUsd: 0});
    expect(second.device.calls).toEqual(['press {"ref":"@e14"}']);
    second.journal.verified('again');
    expect(entries(first.root)).toHaveLength(1);
  });

  it("records a drag's second node as it records the first, and replays the drag between both, found again", async () => {
    const dragging = () => {
      const device: FakeDevice = signingIn({drag: (from, to) => (device.calls.push(`drag ${JSON.stringify(from)} ${JSON.stringify(to)}`), Promise.resolve(done()))});
      return device;
    };
    const capabilities = ['press', 'fill', 'drag', 'screenshot'];
    const first = runtimeOf({device: dragging(), capabilities, replies: [callsTool('drag', {ref: '@e5', to: '@e2'}), complete('Moved it.')]});
    await first.runtime.act('drag the button onto the email field');
    first.journal.verified('it moved');
    const entry = JSON.parse(fs.readFileSync(path.join(cacheDir(first.root), entries(first.root)[0] as string), 'utf8')) as {actions: unknown};
    expect(entry.actions).toEqual([{tool: 'drag', target: {kind: 'button', name: 'Sign in', testId: null, parent: ['form', 'Sign in']}, input: {to: {kind: 'textbox', name: 'Email', testId: null, parent: ['form', 'Sign in']}}}]);
    const second = runtimeOf({root: first.root, device: dragging(), capabilities});
    expect((await second.runtime.act('drag the button onto the email field')).cache?.mode).toBe('self-finalized');
    expect(second.device.calls).toEqual(['drag {"ref":"@e14"} {"ref":"@e11"}']);
    const gone = dragging();
    gone.screen = {...gone.screen, nodes: gone.screen.nodes.filter(node => node.name !== 'Email')};
    const third = runtimeOf({root: first.root, device: gone, capabilities, replies: [complete('There is no email field.')]});
    expect((await third.runtime.act('drag the button onto the email field')).cache).toMatchObject({mode: 'agent-concluded', reason: 'target-not-found', replayedActions: 0});
    expect(gone.calls).toEqual([]);
  });

  it('leaves an act no check vouched for unrecorded, and says so in its result', async () => {
    const {runtime, root} = runtimeOf({replies: [complete()]});
    const result = await runtime.act('sign in');
    runtime.end();
    expect(result.cache?.notRecorded).toBe('no-verification');
    expect(entries(root)).toEqual([]);
  });

  it('records no act whose params share a value, nor one whose first action changed the app through a tool', async () => {
    const collide = runtimeOf({replies: [complete()]});
    expect((await collide.runtime.act('sign in as {a}', {params: {a: 'ada', b: 'ada'}})).cache?.notRecorded).toBe('param-collision');
    const seed = defineTool({name: 'seed_cart', description: 'Seed.', schema: none, mutates: true, execute: () => 'seeded'});
    const model = scriptedModel([callsTool('seed_cart', {}), complete()]);
    const mutating = runtimeOf({harness: {agents: {default: {model, tools: [seed]}}}});
    expect((await mutating.runtime.act('sign in')).cache?.notRecorded).toBe('mutating-tool');
    collide.journal.verified('x');
    mutating.journal.verified('x');
    expect([...entries(collide.root), ...entries(mutating.root)]).toEqual([]);
  });

  it('only reads in read-only mode, does nothing when off, and misses on a retry', async () => {
    const reading = runtimeOf({replies: [complete()], environment: {HARNESS_CACHE: 'read-only'}});
    expect((await reading.runtime.act('sign in')).cache).toEqual({mode: 'missed', reason: 'no-entry', replayedActions: 0, totalActions: 0});
    reading.journal.verified('x');
    expect(entries(reading.root)).toEqual([]);
    expect('cache' in (await runtimeOf({replies: [complete()], environment: {HARNESS_CACHE: 'off'}}).runtime.act('sign in'))).toBe(false);
    expect((await runtimeOf({replies: [complete()], test: {retry: 1}}).runtime.act('sign in')).cache?.reason).toBe('retry');
  });

  it('says it could not write an entry, rather than failing the check that vouched for it', async () => {
    const {runtime, journal, root, written} = runtimeOf({replies: [complete()]});
    await runtime.act('sign in');
    fs.mkdirSync(path.join(root, '.harness'), {recursive: true});
    fs.writeFileSync(cacheDir(root), 'a file where the folder goes');
    journal.verified('x');
    expect(written[0]).toMatch(/^expo-vitest: the cache entry for "sign in" could not be written: /);
  });

  /** An entry recorded by a first run: type the email, then tap Sign in. */
  async function recorded(route?: () => Promise<string | undefined>) {
    const first = runtimeOf({replies: [callsTool('type', {ref: '@e2', text: 'ada@example.com', replace: true}), callsTool('tap', {ref: '@e5'}), complete()], ...(route ? {route} : {})});
    await first.runtime.act('sign in');
    first.journal.verified('x');
    return first.root;
  }

  it("hands the step to the model where a target is gone, telling it what the replay did, and records the whole again", async () => {
    const root = await recorded();
    const device = new FakeDevice();
    device.screen = {...signIn(), nodes: signIn().nodes.map(each => (each.ref === '@e14' ? {...each, name: 'Log in'} : each))};
    const {runtime, model, journal} = runtimeOf({root, device, replies: [callsTool('tap', {ref: '@e5'}), complete()]});
    const result = await runtime.act('sign in');
    expect(result.cache).toEqual({mode: 'agent-concluded', reason: 'target-not-found', replayedActions: 1, totalActions: 2});
    expect(JSON.stringify(model.requests[0]?.messages[0])).toContain('- type textbox \\"Email\\" {\\"replace\\":true,\\"text\\":\\"ada@example.com\\"}');
    expect(device.calls).toEqual(['fill {"ref":"@e11"} "ada@example.com"', 'press {"ref":"@e14"}']);
    journal.verified('x');
    const entry = JSON.parse(fs.readFileSync(path.join(cacheDir(root), entries(root)[0] as string), 'utf8')) as {actions: {target: {name: string}}[]};
    expect(entry.actions.map(action => action.target.name)).toEqual(['Email', 'Log in']);
  });

  it('is REPLAY_STALE in strict mode where the replay stops, with no model call', async () => {
    const root = await recorded();
    const device = new FakeDevice();
    device.screen = {...signIn(), nodes: signIn().nodes.filter(each => each.ref !== '@e14')};
    const model = scriptedModel([]);
    const {runtime} = runtimeOf({root, device, harness: {agents: {default: {model}}, cache: {strict: true}}});
    const error = await rejection(runtime.act('sign in'));
    expect([error?.code, error?.explanation, model.requests.length]).toEqual(['REPLAY_STALE', 'its replay from the cache stopped after 1 of 2 actions (target-not-found), and a strict cache hands no step to the model', 0]);
  });

  it('hands off where the step starts on another route, or ends unlike the recording', async () => {
    const root = await recorded(() => Promise.resolve('/sign-in'));
    const elsewhere = runtimeOf({root, route: () => Promise.resolve('/home'), replies: [complete()]});
    expect((await elsewhere.runtime.act('sign in')).cache).toMatchObject({mode: 'agent-concluded', reason: 'end-mismatch', replayedActions: 0});
    const stuck = runtimeOf({root, device: new FakeDevice(), route: () => Promise.resolve('/sign-in'), replies: [complete()]});
    expect((await stuck.runtime.act('sign in')).cache).toMatchObject({mode: 'agent-concluded', reason: 'end-mismatch', replayedActions: 2});
  });

  it('hands off where an action fails, and ends the step where the replay spends its last action', async () => {
    const root = await recorded();
    const failing = new FakeDevice({fill: () => Promise.resolve({ok: false, message: 'read only'})});
    const handed = runtimeOf({root, device: failing, replies: [complete()]});
    expect((await handed.runtime.act('sign in')).cache).toMatchObject({mode: 'agent-concluded', reason: 'action-failed', replayedActions: 0});
    const spent = runtimeOf({root});
    expect((await rejection(spent.runtime.act('sign in', {maxSteps: 1})))?.code).toBe('STEP_BUDGET_EXHAUSTED');
  });

  it('replays up to a tool that changed the app, and hands on the rest as a gap', async () => {
    const seed = defineTool({name: 'seed_cart', description: 'Seed.', schema: none, mutates: true, execute: () => 'seeded'});
    const first = scriptedModel([callsTool('type', {ref: '@e2', text: 'ada@example.com', replace: true}), callsTool('seed_cart', {}), complete()]);
    const recording = runtimeOf({harness: {agents: {default: {model: first, tools: [seed]}}}});
    await recording.runtime.act('sign in');
    recording.journal.verified('x');
    const second = scriptedModel([callsTool('seed_cart', {}), complete()]);
    const {runtime} = runtimeOf({root: recording.root, harness: {agents: {default: {model: second, tools: [seed]}}}});
    expect((await runtime.act('sign in')).cache).toMatchObject({mode: 'agent-concluded', reason: 'gap', replayedActions: 1});
  });

  it("replays a press at a point on a screen the size it was, and hands it off on one that is not", async () => {
    const pictured = signingIn({screenshot: writer});
    const recording = runtimeOf({device: pictured, replies: [callsTool('screenshot', {}), callsTool('tap_at', {x: 10, y: 10}), complete()]});
    await recording.runtime.act('sign in');
    recording.journal.verified('x');
    const same = runtimeOf({root: recording.root, device: new FakeDevice(), replies: [complete()]});
    expect((await same.runtime.act('sign in')).cache).toEqual({mode: 'self-finalized', replayedActions: 1, totalActions: 1});
    expect(same.device.calls).toEqual(['press {"x":10,"y":10}']);
    const unsized = new FakeDevice();
    unsized.screen = {platform: 'web', nodes: signIn().nodes};
    const {runtime} = runtimeOf({root: recording.root, device: unsized, replies: [complete()]});
    expect((await runtime.act('sign in')).cache).toMatchObject({reason: 'viewport-changed', replayedActions: 0});
  });

  it('records a screen with no viewport as having none', async () => {
    const device = new FakeDevice();
    device.screen = {platform: 'android', nodes: signIn().nodes};
    const {runtime, journal, root} = runtimeOf({device, replies: [complete()]});
    await runtime.act('sign in');
    journal.verified('x');
    expect(JSON.parse(fs.readFileSync(path.join(cacheDir(root), entries(root)[0] as string), 'utf8'))).toMatchObject({viewport: null});
  });

  it('keeps a unique value as its slot, and types this run\'s value on replay', async () => {
    const first = runtimeOf({replies: [callsTool('type', {ref: '@e2', text: 'ada+1@example.com', replace: true}), callsTool('tap', {ref: '@e5'}), complete()]});
    await first.runtime.act('sign in as {email}', {params: {email: unique('ada+1@example.com')}});
    first.journal.verified('x');
    const second = runtimeOf({root: first.root});
    await second.runtime.act('sign in as {email}', {params: {email: unique('ada+2@example.com')}});
    expect(second.device.calls[0]).toBe('fill {"ref":"@e11"} "ada+2@example.com"');
  });
});

describe('an assertion', () => {
  it('passes on the judge\'s pass, as a step of the journal, and is a check that records the act before it', async () => {
    const {runtime, journal, root, judging} = runtimeOf({replies: [complete()], judge: [verdict('pass', 'The welcome shows.')]});
    await runtime.act('sign in');
    await runtime.assert('the welcome shows', {screenshot: false});
    expect(journal.steps.slice(-2).map(step => [step.event, step.what, step.result])).toEqual([
      ['assert', 'agent: assert "the welcome shows"', 'ok'],
      ['verified', 'agent.assert("the welcome shows")', 'ok'],
    ]);
    expect(entries(root)).toHaveLength(1);
    expect(judging.requests[0]?.effort).toBe('low');
    expect(journal.agents[1]?.outcome).toMatch(/^passed: pass: The welcome shows\. · 1 call · \$0\.\d{4}$/);
  });

  it('fails as the judge says, with a picture kept beside the trace where one may be taken', async () => {
    const {runtime, journal, root} = runtimeOf({device: signingIn({screenshot: writer}), judge: [verdict('fail', 'It still shows the form.'), verdict('inconclusive', 'It is cut off.')]});
    const failed = await rejection(runtime.assert('the welcome shows'));
    const folder = resultsFolder(root, 'web', 'device/sign-in.test.ts', ['signs in']);
    expect([failed?.code, failed?.explanation, failed?.screenshot]).toEqual(['ASSERTION_FAILED', 'It still shows the form.', path.join(folder, 'agent-1.png')]);
    expect(journal.agents[0]?.picture?.name).toBe('agent-1.png');
    expect(journal.steps.map(step => step.event)).toEqual(['assert']);
    expect((await rejection(runtime.assert('the welcome shows')))?.code).toBe('ASSERTION_INCONCLUSIVE');
  });

  it('keeps no picture where none may leave', async () => {
    const {runtime, journal} = runtimeOf({capabilities: ['press', 'fill'], judge: [verdict('fail', 'No.')]});
    const failed = await rejection(runtime.assert('the welcome shows'));
    expect([failed?.code, 'screenshot' in (failed as object), 'picture' in (journal.agents[0] as object)]).toEqual(['ASSERTION_FAILED', false, false]);
  });

  it('is blocked where its judge said the step could not go on, and reads the route where there is one', async () => {
    const closed = new AgentError('APP_NOT_OPEN', 'the app closed', {step: 'assert', instruction: 'the form shows', blocked: true});
    const {runtime, journal, judging} = runtimeOf({route: () => Promise.resolve('/sign-in'), judge: [closed, verdict('pass', 'Yes.')]});
    expect(await rejection(runtime.assert('the form shows'))).toBe(closed);
    expect(journal.agents[0]?.outcome).toMatch(/^blocked: the app closed/);
    await runtime.assert('the form shows', {screenshot: false});
    expect(JSON.stringify(judging.requests[0]?.messages[0])).toContain('route: /sign-in');
  });

  it("sends a picture with vision, the picture alone with vision 'only', and refuses 'only' where none may leave", async () => {
    const {runtime, judging} = runtimeOf({device: signingIn({screenshot: writer}), judge: [verdict('pass', 'Yes.'), verdict('pass', 'Yes.')]});
    await runtime.assert('the form shows', {vision: true, screenshot: false});
    await runtime.assert('the form shows', {vision: 'only', screenshot: false});
    const types = (model: typeof judging, request: number) => (model.requests[request]?.messages[0]?.content ?? []) as unknown as {type: string}[];
    expect(types(judging, 0).map(part => part.type)).toEqual(['text', 'text', 'image']);
    expect(types(judging, 1).map(part => part.type)).toEqual(['text', 'image']);
    const blind = runtimeOf({capabilities: ['press', 'fill'], judge: [verdict('pass', 'Yes.')]});
    await blind.runtime.assert('the form shows', {vision: true, screenshot: false});
    expect(types(blind.judging, 0).map(part => part.type)).toEqual(['text', 'text']);
    expect(await rejection(blind.runtime.assert('the form shows', {vision: 'only'}))).toMatchObject({code: 'POLICY_DENIED', explanation: "vision 'only' sends a picture of the screen alone, and none may leave: the platform takes no screenshot"});
  });

  it('needs words, and a model to judge with', async () => {
    const {runtime} = runtimeOf();
    expect(await rejection(runtime.assert(''))).toMatchObject({code: 'INVALID_ARGUMENT', explanation: 'assert takes an assertion: what the screen should show, in words'});
    expect(await rejection(runtimeOf({harness: {}}).runtime.assert('the form shows'))).toMatchObject({code: 'MODEL_UNAVAILABLE', explanation: 'the agent default has no model to judge with; give it a model, or a judge, under agents in the harness config'});
  });
});

describe('a wait', () => {
  it('judges the screen each time it changed until the condition holds, and is a check that held', async () => {
    const device = signingIn();
    const fail: Reply = () => {
      device.screen = signIn({signedIn: true});
      return verdict('fail', 'The form shows.');
    };
    const {runtime, journal, judging} = runtimeOf({device, replies: [complete()], judge: [fail, verdict('pass', 'The welcome shows.')]});
    await runtime.act('open the sign-in');
    await runtime.waitFor('the welcome shows', {interval: 100, timeout: 5000});
    expect(journal.steps.map(step => [step.event, step.result])).toEqual([
      ['agent', 'ok'],
      ['wait', 'ok'],
      ['verified', 'ok'],
    ]);
    expect(judging.requests).toHaveLength(2);
  });

  it('refuses an interval outside 100 ms to a minute, and a budget that is not one', async () => {
    const {runtime, journal} = runtimeOf();
    expect(await rejection(runtime.waitFor('the welcome shows', {interval: 50}))).toMatchObject({code: 'INVALID_ARGUMENT', explanation: 'interval is 50; it takes a number of ms from 100 to 60 000'});
    expect(await rejection(runtime.waitFor('the welcome shows', {maxModelCalls: 0}))).toMatchObject({explanation: 'maxModelCalls is 0; it takes a whole number, 1 or more'});
    expect(journal.steps.map(step => step.result)).toEqual(['failed', 'failed']);
    expect(journal.agents.map(note => note.outcome)).toEqual([expect.stringMatching(/^failed: interval is 50/), expect.stringMatching(/^failed: maxModelCalls is 0/)]);
  });
});

describe('an extraction', () => {
  it('reads a value off the screen, and is no check of the act before it', async () => {
    const answer = says(JSON.stringify({found: true, value: 'ada@example.com', explanation: 'The email field.'}));
    const {runtime, journal, root} = runtimeOf({replies: [complete()], judge: [answer]});
    await runtime.act('sign in');
    expect(await runtime.extract('the email', {schema: {type: 'string'}})).toBe('ada@example.com');
    expect(entries(root)).toEqual([]);
    expect(journal.agents[1]?.outcome).toMatch(/^passed: read: "ada@example\.com"/);
  });
});

describe('what a step says', () => {
  it('prints the debug line after each step under HARNESS_DEBUG', async () => {
    const {runtime, written} = runtimeOf({replies: [complete()], judge: [verdict('pass', 'Yes.')], environment: {HARNESS_DEBUG: '1'}});
    await runtime.act('sign in');
    await runtime.assert('the form shows', {screenshot: false});
    expect(written).toEqual([
      expect.stringMatching(/^agent {2}act {2}"sign in" {2}web {2}\d+\.\d s {2}1 call {2}0 actions {2}in 100 \(cache 0%\) {2}out 10 {2}\$0\.0006 {2}missed\n$/),
      expect.stringMatching(/^agent {2}assert {2}"the form shows" {2}web {2}\d+\.\d s {2}1 call {2}in 100 \(cache 0%\) {2}out 10 {2}\$0\.0006\n$/),
    ]);
  });

  it('is a line of what the step was and what it cost', () => {
    expect(debugLine({kind: 'act', instruction: 'upgrade', platform: 'web', ms: 4800, calls: 3, actions: 2, usage: {input: 1000, output: 211, cacheRead: 8412, cacheWrite: 0}, costUsd: 0.0119, mode: 'self-finalized'})).toBe(
      'agent  act  "upgrade"  web  4.8 s  3 calls  2 actions  in 9 412 (cache 89%)  out 211  $0.0119  self-finalized',
    );
    expect(debugLine({kind: 'assert', instruction: 'x', platform: 'ios', ms: 1200, calls: 1, usage: usage(), costUsd: undefined})).toBe('agent  assert  "x"  ios  1.2 s  1 call  in 100 (cache 0%)  out 10  cost n/a');
  });

  it('keeps each call in the AI trace under HARNESS_AI_TRACE, every secret hidden and every image a size', async () => {
    const pictured = signingIn({screenshot: writer});
    pictured.screen = signIn({email: 'correct horse battery'});
    const odd = {...callsTool('observe', undefined), model: 'my-model'};
    const {runtime, root} = runtimeOf({device: pictured, replies: [callsTool('screenshot', {}), odd, complete()], environment: {HARNESS_AI_TRACE: '1'}});
    await runtime.act('sign in');
    const lines = fs.readFileSync(path.join(root, '.harness', 'ai-trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatchObject({model: 'my-model', response: {toolCalls: [{name: 'observe', input: null}]}});
    expect('costUsd' in (lines[1] as object)).toBe(false);
    expect(lines[0]).toMatchObject({test: 'device/sign-in.test.ts > signs in', step: {kind: 'act', index: 0, turn: 1}, model: 'claude-opus-5-5', response: {stopReason: 'tool_use', toolCalls: [{name: 'screenshot', input: {}}]}, costUsd: 0.0006});
    const text = JSON.stringify(lines);
    expect(text).not.toContain('correct horse battery');
    expect(text).toContain('<secret:ADA_PASSWORD>');
    expect(JSON.stringify(lines[1])).toMatch(/"type":"image","bytes":\d+,"width":384,"height":768/);
  });

  it('hides every secret value in what the console and the streams are given while a step runs, and only then', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.join(' ')));
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const executor = {
      name: 'chatty',
      version: '1',
      runStep: async () => {
        console.log('typing', 'correct horse battery');
        process.stdout.write('typed correct horse battery\n');
        process.stdout.write(Buffer.from('bytes'));
        return {status: 'passed' as const, summary: 'Done.'};
      },
    };
    const {runtime} = runtimeOf({harness: {agents: {default: {executor}}, secrets: {ADA_PASSWORD: 'correct horse battery'}}});
    await runtime.act('sign in');
    console.log('after correct horse battery');
    expect(logged).toEqual(['typing <secret:ADA_PASSWORD>', 'after correct horse battery']);
    expect(out.mock.calls.map(call => String(call[0]))).toEqual(['typed <secret:ADA_PASSWORD>\n', 'bytes']);
  });

  it('leaves the console as it is where no secret is configured', async () => {
    const before = console.log;
    let during: unknown;
    const executor = {name: 'x', version: '1', runStep: async () => ((during = console.log), {status: 'passed' as const, summary: 'Done.'})};
    await runtimeOf({harness: {agents: {default: {executor}}}}).runtime.act('sign in');
    expect(during).toBe(before);
  });
});

describe('a test', () => {
  it('begins with nothing tainted and nothing pending, and ends with what is still pending unrecorded', async () => {
    const {runtime} = runtimeOf({replies: [callsTool('type_secret', {ref: '@e3', secret: 'ADA_PASSWORD'}), complete()]});
    await runtime.act('sign in with {password}', {params: {password: secret('ADA_PASSWORD')}});
    expect(tainted()).toBe(true);
    expect([journalOf(runtime).privacy?.withheld(), journalOf(runtime).privacy?.redact('typed correct horse battery')]).toEqual(['a secret was filled in this test, so no picture of the screen is kept', 'typed <secret:ADA_PASSWORD>']);
    runtime.begin();
    expect([tainted(), journalOf(runtime).privacy?.withheld()]).toEqual([false, undefined]);
  });
});

describe('the AI trace of a request', () => {
  it('is its text redacted, its images sizes, its tool calls redacted, and its tools by name', () => {
    const redact = (text: string) => text.replaceAll('hunter22', '<secret:PW>');
    const image = {type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', width: 1, height: 2};
    const shaped = traceRequest(
      {
        system: [{text: 'core hunter22'}],
        messages: [
          {role: 'user', content: [{type: 'text', text: 'hi hunter22'}, image, {type: 'tool_result', toolUseId: 't', content: [{type: 'text', text: 'hunter22'}, image]}]},
          {role: 'assistant', content: [{type: 'tool_use', id: 't', name: 'type', input: {text: 'hunter22'}}, {type: 'tool_use', id: 'u', name: 'back', input: undefined}]},
          {role: 'system', content: 'no hunter22'},
        ],
        tools: [{name: 'tap', description: '', inputSchema: {}}],
        signal: new AbortController().signal,
      },
      redact,
    );
    expect(shaped).toEqual({
      system: ['core <secret:PW>'],
      messages: [
        {role: 'user', content: [{type: 'text', text: 'hi <secret:PW>'}, {type: 'image', bytes: 3, width: 1, height: 2}, {type: 'tool_result', toolUseId: 't', content: [{type: 'text', text: '<secret:PW>'}, {type: 'image', bytes: 3, width: 1, height: 2}]}]},
        {role: 'assistant', content: [{type: 'tool_use', id: 't', name: 'type', input: {text: '<secret:PW>'}}, {type: 'tool_use', id: 'u', name: 'back', input: null}]},
        {role: 'system', content: 'no <secret:PW>'},
      ],
      tools: ['tap'],
    });
  });
});

describe('a runtime with nothing configured', () => {
  it('has no agents, reads the process environment, and says what went wrong on stderr', async () => {
    const device = new FakeDevice();
    const journal = new Journal();
    journal.begin();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-runtime-'));
    const host: AgentHost = {...hostOf(device, {journal}), journal, identity: 'web', root};
    const runtime = new AgentRuntime({host, harness: null, test: () => ({file: 'a.test.ts', titlePath: ['a'], retry: 0})});
    expect((await rejection(runtime.act('sign in')))?.code).toBe('MODEL_UNAVAILABLE');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const executor = {name: 'x', version: '1', runStep: () => Promise.resolve({status: 'passed' as const, summary: 'Done.'})};
    const quiet = new AgentRuntime({host, harness: {agents: {default: {executor}}, cache: 'read-write'}, test: () => ({file: 'a.test.ts', titlePath: ['a'], retry: 0})});
    await quiet.act('sign in');
    fs.mkdirSync(path.join(root, '.harness'), {recursive: true});
    fs.writeFileSync(cacheDir(root), 'not a folder');
    journal.verified('x');
    expect(String(stderr.mock.calls.at(-1)?.[0])).toMatch(/could not be written/);
  });
});

describe('the output a step hides its secrets from', () => {
  it('is patched once however many steps nest, and put back as the last ends', async () => {
    const redact = () => (text: string) => text.replaceAll('hunter22', '<secret:PW>');
    const plain = console.log;
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.join(' ')));
    const spied = console.log;
    await withRedactedOutput(redact, async () => {
      const outer = console.log;
      await withRedactedOutput(redact, async () => {
        expect(console.log).toBe(outer);
        console.log('inner hunter22');
      });
      expect(console.log).toBe(outer);
      console.log('outer hunter22');
    });
    expect(console.log).toBe(spied);
    expect(logged).toEqual(['inner <secret:PW>', 'outer <secret:PW>']);
    expect(plain).toBeDefined();
  });
});

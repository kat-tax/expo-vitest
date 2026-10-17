import fs from 'node:fs';
import {describe, expect, it} from 'vitest';
import {encodePng} from '../harness/lib/png.ts';
import {done, FakeDevice, hostOf, signIn} from './__fixtures__/device.ts';
import {says, scriptedModel, usage} from './__fixtures__/model.ts';
import {createStepContext} from './context.ts';
import type {ContextOptions} from './context.ts';
import {SecretStore, secret} from './secrets.ts';
import type {Message, Model} from './types.ts';

const at = {step: 'act' as const, instruction: 'sign in as Ada'};
const env = {} as NodeJS.ProcessEnv;

function contextOf(extra: Partial<ContextOptions> & {device?: FakeDevice} = {}) {
  const {device = new FakeDevice(), ...rest} = extra;
  const made = createStepContext({
    step: {kind: 'act', instruction: 'sign in as Ada', params: {password: secret('ADA_PASSWORD')}, index: 0},
    target: {platform: 'web', verbs: ['press', 'fill'], pixels: true, app: {url: 'http://localhost:8090'}},
    hands: {host: hostOf(device), at, signal: new AbortController().signal, secrets: new SecretStore({ADA_PASSWORD: 'correct horse battery'}, env), stepSecrets: [secret('ADA_PASSWORD')], taintStore: {}},
    limits: {modelCalls: 25, actions: 25},
    deadline: Date.now() + 120_000,
    ...rest,
  });
  return {...made, device};
}

const request = (messages: readonly Message[]) => ({system: [{text: 'core'}, {text: 'The password is correct horse battery.', cache: true}], messages, tools: [], signal: new AbortController().signal});

describe("the step's model", () => {
  it('counts each call, adds up the usage and what it cost, and keeps who answered', async () => {
    const model = scriptedModel([says('one', {usage: usage(1000, 100)}), says('two', {usage: usage(2000, 0, 1000), model: 'claude-sonnet-5-5'})]);
    const {context, record} = contextOf({model});
    await context.model?.complete(request([]));
    await context.model?.complete(request([]));
    const done = record();
    expect([done.modelCalls, done.usage, done.models, context.budgets.modelCalls.used]).toEqual([2, {input: 3000, output: 100, cacheRead: 1000, cacheWrite: 0}, ['claude-opus-5-5', 'claude-sonnet-5-5'], 2]);
    expect(done.costUsd).toBeCloseTo((1000 * 4 + 100 * 20 + 2000 * 2 + 1000 * 0.2) / 1e6, 12);
    expect(context.model?.id).toBe('claude-opus-5-5');
  });

  it('costs nothing it can name once a model that answered is not in the price table', async () => {
    const {context, record} = contextOf({model: scriptedModel([says('one', {model: 'my-provider/model'}), says('two')])});
    await context.model?.complete(request([]));
    await context.model?.complete(request([]));
    expect(record().costUsd).toBeUndefined();
  });

  it('is STEP_BUDGET_EXHAUSTED once its calls are spent', async () => {
    const {context} = contextOf({model: scriptedModel([says('one')]), limits: {modelCalls: 1, actions: 25}});
    await context.model?.complete(request([]));
    await expect(context.model?.complete(request([]))).rejects.toMatchObject({code: 'STEP_BUDGET_EXHAUSTED', explanation: 'it made 1 model calls, its budget'});
  });

  it('is absent where the agent has none', () => {
    expect('model' in contextOf().context).toBe(false);
  });

  it('hides every secret value in what leaves for it, once a message, and sends the provider its own turn as it came', async () => {
    const model = scriptedModel([says('one'), says('two')]);
    const {context} = contextOf({model});
    const raw = [{type: 'thinking', thinking: '', signature: 'sig'}];
    const history: Message[] = [
      {role: 'user', content: [{type: 'text', text: 'typed correct horse battery'}, {type: 'image', mediaType: 'image/png', data: 'correct horse battery', width: 1, height: 1}]},
      {role: 'assistant', content: [{type: 'tool_use', id: 'toolu_1', name: 'observe', input: {}}], raw},
      {role: 'user', content: [{type: 'tool_result', toolUseId: 'toolu_1', content: [{type: 'text', text: 'value="correct horse battery"'}]}]},
      {role: 'system', content: 'Do not type correct horse battery again.'},
    ];
    await context.model?.complete(request(history));
    await context.model?.complete(request(history));
    const [first, second] = model.requests;
    expect(first?.system[1]?.text).toBe('The password is <secret:ADA_PASSWORD>.');
    expect(first?.messages).toEqual([
      {role: 'user', content: [{type: 'text', text: 'typed <secret:ADA_PASSWORD>'}, {type: 'image', mediaType: 'image/png', data: 'correct horse battery', width: 1, height: 1}]},
      history[1],
      {role: 'user', content: [{type: 'tool_result', toolUseId: 'toolu_1', content: [{type: 'text', text: 'value="<secret:ADA_PASSWORD>"'}]}]},
      {role: 'system', content: 'Do not type <secret:ADA_PASSWORD> again.'},
    ]);
    expect(first?.messages[1]).toBe(history[1]);
    expect(second?.messages[0]).toBe(first?.messages[0]);
  });
});

describe("the step's view of the screen", () => {
  it('is the view and the tree, and a picture where one is asked for', async () => {
    const device = new FakeDevice({
      screenshot: file => {
        fs.writeFileSync(file, encodePng({width: 400, height: 800, pixels: Buffer.alloc(400 * 800 * 4, 255)}));
        return Promise.resolve(done());
      },
    });
    const {context} = contextOf({device});
    const plain = await context.observe();
    expect([plain.text.split('\n')[0], plain.tree.nodes.length, 'pixels' in plain]).toEqual(['window: 400x800', 5, false]);
    const pictured = await context.observe({pixels: true});
    expect(pictured.pixels).toMatchObject({type: 'image', width: 384, height: 768});
  });
});

describe("a project's tool", () => {
  it('runs as it is where it changes nothing', async () => {
    const {context, record} = contextOf();
    expect(await context.budgets.runTool({name: 'read_cart', mutates: false}, async () => 'two items')).toBe('two items');
    expect([context.budgets.actions.used, 'truncatedAt' in record()]).toEqual([0, false]);
  });

  it('spends an action where it changes the app, ends what a replay can repeat, and may not look at the screen meanwhile', async () => {
    const {context, record} = contextOf();
    await context.actions.tap('@e5');
    await context.budgets.runTool({name: 'seed_cart', mutates: true}, async () => {
      await expect(context.observe()).rejects.toMatchObject({code: 'POLICY_DENIED', explanation: 'a tool that changes the app may not look at the screen: look in a call of its own'});
      return 'seeded';
    });
    await context.budgets.runTool({name: 'seed_cart', mutates: true}, async () => 'seeded');
    expect([context.budgets.actions.used, record().truncatedAt]).toEqual([3, 1]);
    expect((await context.observe()).text).toContain('Sign in');
  });

  it('is STEP_BUDGET_EXHAUSTED where it would take an action the step has not got', async () => {
    const {context} = contextOf({limits: {modelCalls: 25, actions: 0}});
    await expect(context.budgets.runTool({name: 'seed_cart', mutates: true}, async () => 'seeded')).rejects.toMatchObject({code: 'STEP_BUDGET_EXHAUSTED', explanation: 'it took 0 actions, its budget'});
  });
});

describe("the step's actions", () => {
  it("are the hands', each counted", async () => {
    const device = new FakeDevice({
      screenshot: file => {
        fs.writeFileSync(file, encodePng({width: 400, height: 800, pixels: Buffer.alloc(400 * 800 * 4, 255)}));
        return Promise.resolve(done());
      },
    });
    const {context} = contextOf({device, hands: {host: hostOf(device, {scheme: 'entz'}), at, signal: new AbortController().signal, secrets: new SecretStore({ADA_PASSWORD: 'correct horse battery'}, env), stepSecrets: [secret('ADA_PASSWORD')], taintStore: {}}});
    const {actions} = context;
    await actions.tap('@e5');
    await actions.longPress('@e5', null);
    await actions.type('@e2', 'ada@example.com', true);
    await actions.press('Tab');
    await actions.check('@e4', false);
    await actions.scroll('down', null);
    await actions.scrollTo({text: 'Terms'});
    await actions.navigate('/help');
    await actions.back();
    await actions.dismissKeyboard();
    await context.observe({pixels: true});
    await actions.tapAt(10, 10);
    await actions.typeSecret('@e3', 'ADA_PASSWORD');
    expect(device.calls).toEqual([
      'press {"ref":"@e14"}',
      'longPress {"ref":"@e14"} 800',
      'fill {"ref":"@e11"} "ada@example.com"',
      'key Tab',
      'swipe 200,600 200,200',
      'scrollIntoView {"label":"Terms"} down',
      'open /help',
      'control back',
      'control dismissKeyboard',
      'press {"x":10,"y":10}',
      'fill {"ref":"@e12"} "correct horse battery"',
    ]);
    expect(context.budgets.actions.used).toBe(11);
  });
});

describe('what a step did', () => {
  it('keeps the transcript with its secrets hidden, the turns, the screenshots, and the replay it took over from', () => {
    const replayedPrefix = {actions: [{tool: 'tap', input: {}}], reason: 'target-not-found' as const};
    const {context, record, handOff, hands} = contextOf({agentContext: 'A sign-in screen.', ledger: [{kind: 'act', instruction: 'open the app', status: 'passed', summary: 'Opened.'}]});
    expect([context.replayedPrefix, hands.seen]).toEqual([undefined, null]);
    handOff(replayedPrefix);
    context.attachTranscript('typed correct horse battery');
    const turns: Message[] = [{role: 'user', content: [{type: 'text', text: 'go'}]}];
    context.attachTurns(turns);
    const image = {type: 'image' as const, mediaType: 'image/png' as const, data: 'AA==', width: 1, height: 1};
    context.attachScreenshot('screenshot', image);
    expect(record()).toEqual({modelCalls: 0, actions: 0, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, costUsd: 0, models: [], recorded: [], transcript: ['typed <secret:ADA_PASSWORD>'], turns, screenshots: [{label: 'screenshot', image}]});
    expect([context.replayedPrefix, context.agentContext, context.ledger.length, context.signal.aborted]).toEqual([replayedPrefix, 'A sign-in screen.', 1, false]);
    expect([contextOf().context.agentContext, contextOf().context.ledger]).toEqual(['', []]);
  });

  it('counts what the model failed to answer as a call', async () => {
    const broken: Model = {id: 'broken', complete: () => Promise.reject(new Error('down'))};
    const {context, record} = contextOf({model: broken});
    await expect(context.model?.complete(request([]))).rejects.toThrow('down');
    expect(record().modelCalls).toBe(1);
  });
});

describe('a screen that changed', () => {
  it('is what the actions answer', async () => {
    const device = new FakeDevice();
    device.onPress = () => signIn({signedIn: true});
    const {context} = contextOf({device});
    await context.observe();
    expect(await context.actions.tap('@e5')).toContain('Welcome back');
  });
});

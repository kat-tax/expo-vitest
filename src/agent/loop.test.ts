import fs from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {HarnessError} from '../harness/lib/errors.ts';
import {encodePng} from '../harness/lib/png.ts';
import type {ActingHost} from './hands.ts';
import {done, FakeDevice, hostOf, signIn} from './__fixtures__/device.ts';
import type {Reply} from './__fixtures__/model.ts';
import {callsTool, says, scriptedModel, usage} from './__fixtures__/model.ts';
import type {CompletedStep, StepContext} from './context.ts';
import {createStepContext} from './context.ts';
import type {LoopSpec, LoopTool} from './loop.ts';
import {COMPLETE_STEP, CORE_PROMPT, DEFAULT_MAX_TOKENS, fillHoles, firstTurn, grammarLoopTools, projectTool, runLoop} from './loop.ts';
import {isSecret, SecretStore, secret, unique} from './secrets.ts';
import {defineTool} from './tools.ts';
import type {Completion, ImagePart, StandardSchemaV1} from './types.ts';
import {AgentError} from './types.ts';

const env = {} as NodeJS.ProcessEnv;
const VERBS = ['press', 'fill', 'key', 'swipe', 'open', 'back', 'dismissKeyboard', 'longPress', 'screenshot'];
const passed = {status: 'passed', summary: 'Signed in.', errorCode: null};
const NO_TOOL = 'You called no tool. Call complete_step to end the step, or another tool to go on.';

/** A turn that calls several tools at once. */
let ids = 0;
const turn = (...calls: [string, unknown][]): Completion => ({
  text: '',
  toolCalls: calls.map(([name, input]) => ({id: `toolu_t${(ids += 1)}`, name, input})),
  stopReason: 'tool_use',
  usage: usage(),
  model: 'claude-opus-5-5',
});

interface StepSetUp {
  params?: Record<string, unknown>;
  limits?: {modelCalls: number; actions: number};
  deadline?: number;
  signal?: AbortSignal;
  device?: FakeDevice;
  host?: Partial<ActingHost>;
  ledger?: CompletedStep[];
  replayedPrefix?: StepContext['replayedPrefix'];
  secrets?: SecretStore;
  verbs?: string[];
  pixels?: boolean;
  model?: null;
}

/** A step of `sign in as {user}` on the sign-in form, its model answering from a script. */
function stepOf(replies: Reply[], options: StepSetUp = {}) {
  const device = options.device ?? new FakeDevice();
  const model = scriptedModel(replies);
  const params = options.params ?? {user: 'Ada'};
  const instruction = 'sign in as {user}';
  const made = createStepContext({
    step: {kind: 'act', instruction, params, index: 0},
    target: {platform: 'web', verbs: options.verbs ?? VERBS, pixels: options.pixels ?? false, app: {url: 'http://localhost:8090'}},
    hands: {
      host: hostOf(device, options.host),
      at: {step: 'act', instruction},
      signal: options.signal ?? new AbortController().signal,
      secrets: options.secrets ?? new SecretStore({ADA_PASSWORD: 'correct horse battery'}, env),
      stepSecrets: Object.values(params).filter(isSecret),
      taintStore: {},
    },
    ...(options.model === null ? {} : {model}),
    limits: options.limits ?? {modelCalls: 25, actions: 25},
    deadline: options.deadline ?? Date.now() + 120_000,
    ...(options.ledger ? {ledger: options.ledger} : {}),
    ...(options.replayedPrefix ? {replayedPrefix: options.replayedPrefix} : {}),
  });
  return {...made, model, device};
}

/** The step run by the loop over the grammar's tools, from its first turn. */
async function run(made: ReturnType<typeof stepOf>, spec: Partial<LoopSpec> = {}) {
  const first = await made.context.observe();
  return runLoop(made.context, {system: [{text: 'core'}], prompt: [firstTurn(made.context, first.text)], tools: grammarLoopTools(made.context), ...spec});
}

const rejection = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as AgentError);

/** A PNG the driver writes: the screen at its own size, all white. */
const writer = (file: string) => {
  fs.writeFileSync(file, encodePng({width: 400, height: 800, pixels: Buffer.alloc(400 * 800 * 4, 255)}));
  return Promise.resolve(done());
};

describe('the first turn', () => {
  it('fills the holes: a secret by its name, a unique value as itself, and a hole with no param as it was', () => {
    expect(fillHoles('sign in as {user} with {password} on {email}, then {missing}', {user: 'Ada', password: secret('ADA_PASSWORD'), email: unique('ada+81@example.com')})).toBe(
      'sign in as Ada with <secret:ADA_PASSWORD> on ada+81@example.com, then {missing}',
    );
  });

  it('is the instruction, the params, the steps before, what a replay did already, then the screen', () => {
    const made = stepOf([], {
      params: {user: 'Ada', count: 2, password: secret('ADA_PASSWORD'), token: secret('API_TOKEN'), email: unique('ada+81@example.com')},
      ledger: [{kind: 'act', instruction: 'open the app', status: 'passed', summary: 'Opened it.'}],
      replayedPrefix: {
        actions: [
          {tool: 'tap', target: {kind: 'button', name: 'Sign in', testId: null, parent: []}, input: {}},
          {tool: 'press', input: {key: 'Tab'}},
        ],
        reason: 'target-not-found',
      },
    });
    expect(firstTurn(made.context, 'VIEW')).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'Instruction: sign in as Ada',
            '',
            'Params:',
            '- user: Ada',
            '- count: 2',
            '- password: <secret:ADA_PASSWORD>, a password: fill it with type_secret',
            '- token: <secret:API_TOKEN>, a secret: fill it with type_secret',
            '- email: ada+81@example.com',
            '',
            'The steps of this test before this one:',
            '1. act "open the app": passed. Opened it.',
            '',
            'A replay of this step from the cache did these already:',
            '- tap button "Sign in"',
            '- press {"key":"Tab"}',
            'It stopped there (target-not-found). Go on from the screen as it is now, without doing them again.',
          ].join('\n'),
        },
        {type: 'text', text: 'The screen now:\nVIEW'},
      ],
    });
  });

  it('is the instruction and the screen alone where there is nothing more to say', () => {
    expect(firstTurn(stepOf([], {params: {}}).context, 'VIEW').content[0]).toEqual({type: 'text', text: 'Instruction: sign in as {user}'});
  });
});

describe('a step', () => {
  it('passes: the model acts, reads what changed, and concludes, each request the one before and more', async () => {
    const device = new FakeDevice();
    device.onPress = () => signIn({signedIn: true});
    const tap = callsTool('tap', {ref: '@e5'}, {raw: [{type: 'tool_use', id: 'x'}]});
    const made = stepOf([tap, callsTool('complete_step', passed)], {device});
    expect(await run(made)).toEqual({status: 'passed', summary: 'Signed in.'});
    const [first, second] = made.model.requests;
    expect(first?.tools.map(tool => tool.name)).toEqual(['back', 'check', 'complete_step', 'dismiss_keyboard', 'long_press', 'navigate', 'observe', 'press', 'scroll', 'scroll_to', 'tap', 'type']);
    expect([first?.system, first?.effort, first?.maxTokens]).toEqual([[{text: 'core'}], 'medium', DEFAULT_MAX_TOKENS]);
    expect(second?.messages.slice(0, 1)).toEqual(first?.messages);
    expect(second?.messages[1]).toEqual({role: 'assistant', content: [{type: 'tool_use', id: tap.toolCalls[0]?.id, name: 'tap', input: {ref: '@e5'}}], raw: [{type: 'tool_use', id: 'x'}]});
    expect(second?.messages[2]).toEqual({role: 'user', content: [{type: 'tool_result', toolUseId: tap.toolCalls[0]?.id, content: [{type: 'text', text: 'window: 400x800\n\n@e6  heading  "Welcome back"  h1'}]}]});
    const record = made.record();
    expect(record.transcript).toEqual(['tap {"ref":"@e5"} -> window: 400x800', 'complete_step passed: Signed in.']);
    expect([record.turns.length, record.modelCalls, record.actions]).toEqual([4, 2, 1]);
  });

  it('fails or is blocked as the model says, with the code where it gave one', async () => {
    expect(await run(stepOf([callsTool('complete_step', {status: 'failed', summary: 'There is no sign-in button.', errorCode: 'ASSERTION_FAILED'})]))).toEqual({
      status: 'failed',
      summary: 'There is no sign-in button.',
      errorCode: 'ASSERTION_FAILED',
    });
    expect(await run(stepOf([callsTool('complete_step', {status: 'blocked', summary: 'It wants a code by text.', errorCode: null})]))).toEqual({status: 'blocked', summary: 'It wants a code by text.'});
  });

  it('answers a complete_step it cannot read, and a pass called before the model saw what its other calls did', async () => {
    const early = turn(['tap', {ref: '@e5'}], ['complete_step', passed]);
    const made = stepOf([callsTool('complete_step', {status: 'done', summary: 'x', errorCode: null}), early, callsTool('complete_step', passed)]);
    expect((await run(made)).status).toBe('passed');
    expect(made.model.requests[1]?.messages[2]?.content).toEqual([
      {type: 'tool_result', toolUseId: expect.any(String), content: [{type: 'text', text: 'INVALID_ARGUMENT: $.status is "done", not one of "passed", "failed", "blocked"'}], isError: true},
    ]);
    expect(made.model.requests[2]?.messages[4]?.content[1]).toEqual({
      type: 'tool_result',
      toolUseId: early.toolCalls[1]?.id,
      content: [{type: 'text', text: 'complete_step passed is called on its own, once you have seen what your other calls did'}],
      isError: true,
    });
  });

  it('asks for a tool after a turn that called none, and ends with STEP_NO_CONCLUSION after two in a row', async () => {
    const made = stepOf([says('Looking.'), callsTool('observe', {}), says('Hmm.'), says('')]);
    const error = await rejection(run(made));
    expect([error?.code, error?.explanation]).toEqual(['STEP_NO_CONCLUSION', 'the model ended two turns in a row without calling a tool, and never called complete_step']);
    expect(made.model.requests[1]?.messages.slice(1)).toEqual([
      {role: 'assistant', content: [{type: 'text', text: 'Looking.'}]},
      {role: 'user', content: [{type: 'text', text: NO_TOOL}]},
    ]);
    expect(made.record().transcript.filter(line => line.startsWith('model: '))).toEqual(['model: Looking.', 'model: Hmm.']);
  });

  it('is MODEL_UNAVAILABLE without a model, and MODEL_PROVIDER_FAILED where the model declined', async () => {
    expect((await rejection(run(stepOf([], {model: null}))))?.code).toBe('MODEL_UNAVAILABLE');
    const declined = await rejection(run(stepOf([says('', {stopReason: 'refusal', detail: 'cyber'})])));
    expect([declined?.code, declined?.explanation]).toEqual(['MODEL_PROVIDER_FAILED', 'the model declined to answer (cyber)']);
  });
});

describe('a call that went wrong', () => {
  it('goes back to the model as an error it reads: a tool there is not, an input its schema refuses, an action that failed', async () => {
    const wrong = turn(['wave', {}], ['tap', {}], ['tap', {ref: '@e40'}]);
    const made = stepOf([wrong, callsTool('complete_step', passed)]);
    await run(made);
    const [wave, tap, missing] = wrong.toolCalls.map(call => call.id);
    expect(made.model.requests[1]?.messages[2]?.content).toEqual([
      {type: 'tool_result', toolUseId: wave, content: [{type: 'text', text: 'INVALID_ARGUMENT: there is no tool called wave'}], isError: true},
      {type: 'tool_result', toolUseId: tap, content: [{type: 'text', text: 'INVALID_ARGUMENT: $.ref is missing'}], isError: true},
      {type: 'tool_result', toolUseId: missing, content: [{type: 'text', text: 'LOCATOR_NOT_FOUND: @e40 is not on the screen now; observe to see what is'}], isError: true},
    ]);
  });

  it('ends the step where an action spends the last of the budget', async () => {
    const made = stepOf([callsTool('tap', {ref: '@e5'}), callsTool('tap', {ref: '@e5'})], {limits: {modelCalls: 25, actions: 1}});
    const error = await rejection(run(made));
    expect([error?.code, error?.message]).toEqual(['STEP_BUDGET_EXHAUSTED', 'agent.act("sign in as {user}"): it took 1 actions, its budget']);
  });

  it('is blocked where a secret has no value, and ends as the driver said where the device is gone', async () => {
    const params = {password: secret('ADA_PASSWORD')};
    const blocked = await rejection(run(stepOf([callsTool('type_secret', {ref: '@e3', secret: 'ADA_PASSWORD'})], {params, secrets: new SecretStore({}, env)})));
    expect([blocked?.code, blocked?.blocked, blocked?.explanation]).toEqual(['SECRET_UNAVAILABLE', true, 'the secret ADA_PASSWORD has no value: set HARNESS_SECRET_ADA_PASSWORD, or give it under secrets in the harness config']);
    const gone = new FakeDevice({press: () => Promise.resolve({ok: false, code: 'DRIVER_UNAVAILABLE', message: 'the browser closed'})});
    const lost = await rejection(run(stepOf([callsTool('tap', {ref: '@e5'})], {device: gone})));
    expect([lost?.code, lost?.message, 'explanation' in (lost as object)]).toEqual(['DRIVER_UNAVAILABLE', 'the browser closed', false]);
  });

  it('ends the step once the model calls are spent, the step\'s or the executor\'s', async () => {
    const step = await rejection(run(stepOf([callsTool('observe', {}), callsTool('observe', {}), callsTool('observe', {})], {limits: {modelCalls: 2, actions: 25}})));
    expect([step?.code, step?.message]).toEqual(['STEP_BUDGET_EXHAUSTED', 'agent.act("sign in as {user}"): it made 2 model calls, its budget']);
    const executor = await rejection(run(stepOf([callsTool('observe', {}), callsTool('observe', {})]), {maxModelCalls: 1}));
    expect(executor?.explanation).toBe("it made 1 model calls, the executor's budget");
  });

  it("ends with the step's own end where its signal aborted between turns", async () => {
    const controller = new AbortController();
    const instruction = {step: 'act' as const, instruction: 'sign in as {user}'};
    const abort: Reply = () => {
      controller.abort(new AgentError('STEP_TIMEOUT', 'it ran past its timeout of 100 ms', instruction));
      return callsTool('observe', {});
    };
    const error = await rejection(run(stepOf([abort], {signal: controller.signal})));
    expect([error?.code, error?.explanation]).toEqual(['STEP_TIMEOUT', 'it ran past its timeout of 100 ms']);
  });
});

describe('a tool input cut off', () => {
  const cut = () => callsTool('type', {ref: '@e2', text: 'ada@exa', replace: true}, {stopReason: 'max_tokens'});

  it('is asked for once more with twice the room, and the cut turn is never in the history', async () => {
    const made = stepOf([cut(), callsTool('complete_step', passed)]);
    await run(made, {maxTokens: 1000});
    expect(made.model.requests.map(request => request.maxTokens)).toEqual([1000, 2000]);
    expect(made.model.requests[1]?.messages).toEqual(made.model.requests[0]?.messages);
    expect(made.device.calls).toEqual([]);
  });

  it('is MODEL_OUTPUT_INVALID cut off twice, and a reply cut off with no tool in it is a turn that called none', async () => {
    const twice = await rejection(run(stepOf([cut(), cut()])));
    expect([twice?.code, twice?.explanation]).toEqual(['MODEL_OUTPUT_INVALID', "the model's tool input was cut off at the token limit twice, the second time at 32000"]);
    const words = stepOf([says('I will tap', {stopReason: 'max_tokens'}), callsTool('complete_step', passed)]);
    await run(words);
    expect(words.model.requests[1]?.messages[2]).toEqual({role: 'user', content: [{type: 'text', text: NO_TOOL}]});
  });
});

describe("the loop's own word", () => {
  afterEach(() => void vi.useRealTimers());

  it('comes after the results: change the approach after three failed actions in a row, conclude after five', async () => {
    const miss = (ref: string) => callsTool('tap', {ref});
    const made = stepOf([miss('@e40'), miss('@e41'), miss('@e42'), miss('@e43'), miss('@e44'), callsTool('complete_step', {status: 'failed', summary: 'Nothing to press.', errorCode: null})]);
    await run(made);
    const last = (request: number) => made.model.requests[request]?.messages.at(-1);
    expect(last(3)).toEqual({role: 'system', content: 'Your last 3 actions failed. Change your approach: observe the screen again, or try another way to the same end.'});
    expect(last(4)?.role).toBe('user');
    expect(last(5)).toEqual({role: 'system', content: 'Your last 5 actions failed. Call complete_step now, failed or blocked, with what you found.'});
  });

  it('counts the failures afresh after an action that worked, and not those of a look', async () => {
    const made = stepOf([callsTool('tap', {ref: '@e40'}), callsTool('tap', {ref: '@e41'}), callsTool('tap', {ref: '@e5'}), callsTool('tap', {ref: '@e42'}), callsTool('tap', {ref: '@e43'}), callsTool('complete_step', passed)]);
    await run(made);
    expect(made.model.requests.flatMap(request => request.messages).filter(message => message.role === 'system')).toEqual([]);
    const looks = stepOf([callsTool('screenshot', {}), callsTool('tap', {ref: '@e40'}), callsTool('screenshot', {}), callsTool('complete_step', passed)], {pixels: true, host: {capabilities: new Set(['press'])}});
    await run(looks);
    expect(looks.model.requests[1]?.messages[2]?.content[0]).toMatchObject({content: [{type: 'text', text: 'POLICY_DENIED: the platform takes no screenshot'}], isError: true});
    expect(looks.model.requests.flatMap(request => request.messages).filter(message => message.role === 'system')).toEqual([]);
  });

  it('names a call repeated on a screen the call before it did not change', async () => {
    const made = stepOf([callsTool('press', {key: 'Enter'}), callsTool('press', {key: 'Enter'}), callsTool('observe', {}), callsTool('observe', {}), callsTool('complete_step', passed)]);
    await run(made);
    expect(made.model.requests[1]?.messages.at(-1)?.role).toBe('user');
    expect(made.model.requests[2]?.messages.at(-1)).toEqual({role: 'system', content: 'You called press with the same input as the call before, and that call changed nothing on the screen. Do something else, or call complete_step.'});
    expect(made.model.requests[4]?.messages.at(-1)?.role).toBe('user');
  });

  it('asks for a conclusion once, near the end of a budget or of the time', async () => {
    vi.useFakeTimers();
    const made = stepOf([callsTool('observe', {}), callsTool('observe', {}), callsTool('complete_step', passed)], {limits: {modelCalls: 25, actions: 3}, deadline: Date.now() + 10_000});
    await run(made, {maxModelCalls: 4});
    expect(made.model.requests[1]?.messages.at(-1)).toEqual({
      role: 'system',
      content: 'The step is nearly out of time or budget: 3 model calls left, 3 actions left, 10 s left. Call complete_step now, with what the screen shows.',
    });
    expect(made.model.requests[2]?.messages.at(-1)?.role).toBe('user');
    const late = stepOf([callsTool('observe', {}), callsTool('complete_step', passed)], {deadline: Date.now() - 1000});
    await run(late);
    expect(late.model.requests[1]?.messages.at(-1)).toEqual({role: 'system', content: 'The step is nearly out of time or budget: 0 s left. Call complete_step now, with what the screen shows.'});
  });
});

describe("the grammar's tools", () => {
  it("are what the platform can do, type_secret where the step has a secret, and the pixel tools where a picture may leave", () => {
    const names = (made: ReturnType<typeof stepOf>) => grammarLoopTools(made.context).map(tool => tool.spec.name);
    expect(names(stepOf([], {verbs: ['press']}))).toEqual(['check', 'observe', 'tap']);
    expect(names(stepOf([], {verbs: ['press', 'fill'], pixels: true, params: {password: secret('ADA_PASSWORD')}}))).toEqual(['check', 'observe', 'screenshot', 'tap', 'tap_at', 'type', 'type_secret']);
  });

  it("each run the step's own action, a look the whole screen and a picture of it", async () => {
    const device = new FakeDevice({screenshot: writer});
    const calls = turn(
      ['observe', {}],
      ['screenshot', {}],
      ['tap_at', {x: 10, y: 10}],
      ['check', {ref: '@e4', checked: true}],
      ['long_press', {ref: '@e5', durationMs: null}],
      ['type', {ref: '@e2', text: 'ada@example.com', replace: true}],
      ['press', {key: 'Tab'}],
      ['scroll', {direction: 'down', ref: null}],
      ['scroll_to', {ref: null, text: 'Terms'}],
      ['navigate', {url: '/help'}],
      ['back', {}],
      ['dismiss_keyboard', {}],
      ['type_secret', {ref: '@e3', secret: 'ADA_PASSWORD'}],
    );
    const made = stepOf([calls, callsTool('complete_step', passed)], {device, pixels: true, params: {password: secret('ADA_PASSWORD')}});
    await run(made);
    const results = made.model.requests[1]?.messages[2]?.content as unknown as {content: {type: string; text?: string}[]; isError?: boolean}[];
    expect(results.filter(result => result.isError)).toEqual([expect.objectContaining({content: [{type: 'text', text: 'ACTION_FAILED: pressed @e4 to check it, and it is still unchecked'}]})]);
    expect(results[0]?.content[0]?.text).toContain('@e5  button  "Sign in"');
    expect(results[1]?.content.map(part => part.type)).toEqual(['text', 'image']);
    expect(results[1]?.content[0]?.text).toBe('The screen, 384 by 768 pixels.');
    expect(device.calls).toEqual([
      'press {"x":10,"y":10}',
      'press {"ref":"@e13"}',
      'longPress {"ref":"@e14"} 800',
      'fill {"ref":"@e11"} "ada@example.com"',
      'key Tab',
      'swipe 200,600 200,200',
      'scrollIntoView {"label":"Terms"} down',
      'open /help',
      'control back',
      'control dismissKeyboard',
      'fill {"ref":"@e12"} "correct horse battery"',
    ]);
    expect(made.record().screenshots).toHaveLength(1);
  });
});

describe("a project's tool", () => {
  const sku: StandardSchemaV1<{sku: string}> = {
    '~standard': {
      version: 1,
      vendor: 'zod',
      validate: value => (typeof (value as {sku?: unknown}).sku === 'string' ? {value: {sku: (value as {sku: string}).sku.toUpperCase()}} : {issues: [{message: 'Expected a sku'}, {message: 'Required'}]}),
      jsonSchema: {output: () => ({type: 'object', properties: {sku: {type: 'string'}}, required: ['sku'], additionalProperties: false})},
    },
  };
  const none = {type: 'object', properties: {}, required: [], additionalProperties: false};

  it("is offered with its schema, gets its input as its own schema makes it, and answers the model in text", async () => {
    const given: unknown[] = [];
    const seed = defineTool({
      name: 'seed_cart',
      description: 'Put a SKU in the cart.',
      schema: sku,
      mutates: true,
      execute(input, context) {
        given.push(input, context.platform, context.app, context.signal.aborted);
        return {seeded: input.sku};
      },
    });
    const read = defineTool({name: 'read_cart', description: 'Read the cart.', schema: none, execute: (_input, context) => context.observe()});
    const reset = defineTool({name: 'reset', description: 'Reset.', schema: none, execute: () => undefined});
    const made = stepOf([]);
    const tools = [projectTool(made.context, seed), projectTool(made.context, read), projectTool(made.context, reset)];
    expect(tools[0]?.spec).toEqual({name: 'seed_cart', description: 'Put a SKU in the cart.', inputSchema: {type: 'object', properties: {sku: {type: 'string'}}, required: ['sku'], additionalProperties: false}, strict: true});
    expect(await tools[0]?.run({sku: 'tee-blue'})).toBe('{"seeded":"TEE-BLUE"}');
    expect(given).toEqual([{sku: 'TEE-BLUE'}, 'web', {url: 'http://localhost:8090'}, false]);
    expect(await tools[1]?.run({})).toContain('button  "Sign in"');
    expect(await tools[2]?.run({})).toBe('done');
    expect(made.context.budgets.actions.used).toBe(1);
    await expect(tools[0]?.run({})).rejects.toMatchObject({code: 'INVALID_ARGUMENT', message: 'Expected a sku; Required'});
  });

  it('goes back to the model as the error it threw, whatever it threw', async () => {
    const broken = defineTool({name: 'broken', description: 'Break.', schema: none, execute: () => Promise.reject(new Error('the test API is down'))});
    const odd = defineTool({name: 'odd', description: 'Odd.', schema: none, execute: () => Promise.reject('a string')});
    const peek = defineTool({name: 'peek', description: 'Peek.', schema: none, mutates: true, execute: (_input, context) => context.observe()});
    const made = stepOf([turn(['broken', {}], ['odd', {}], ['peek', {}]), callsTool('complete_step', passed)]);
    await run(made, {tools: [...grammarLoopTools(made.context), projectTool(made.context, broken), projectTool(made.context, odd), projectTool(made.context, peek)]});
    const results = made.model.requests[1]?.messages[2]?.content as unknown as {content: {text: string}[]}[];
    expect(results.map(result => result.content[0]?.text)).toEqual([
      'the tool failed: the test API is down',
      'the tool failed: a string',
      'POLICY_DENIED: a tool that changes the app may not look at the screen: look in a call of its own',
    ]);
  });
});

describe('a loop of its own', () => {
  it('sends what prepareMessages makes of the history, keeps the history its own, and leaves a complete_step of the spec for its own', async () => {
    const image: ImagePart = {type: 'image', mediaType: 'image/png', data: 'AA==', width: 1, height: 1};
    const picture: LoopTool = {spec: {name: 'picture', description: 'A picture.', inputSchema: {type: 'object', properties: {}, required: [], additionalProperties: false}}, run: async () => [image]};
    const theirs: LoopTool = {spec: {...COMPLETE_STEP, description: 'Theirs.'}, run: () => Promise.reject(new HarnessError('ACTION_FAILED', 'not called'))};
    const made = stepOf([callsTool('picture', {}), callsTool('complete_step', passed)]);
    await run(made, {tools: [picture, theirs], prepareMessages: messages => messages.slice(-2)});
    expect(made.model.requests[0]?.tools.map(tool => [tool.name, tool.description])).toEqual([
      ['complete_step', COMPLETE_STEP.description],
      ['picture', 'A picture.'],
    ]);
    expect(made.model.requests[1]?.messages).toHaveLength(2);
    expect(made.model.requests[1]?.messages[1]?.content).toEqual([{type: 'tool_result', toolUseId: expect.any(String), content: [image]}]);
    expect(made.record().turns).toHaveLength(4);
    expect(made.record().transcript[0]).toBe('picture {} -> ');
  });

  it('starts from the frozen prompt the built-in executor sends', () => {
    expect(CORE_PROMPT).toContain('End the step with complete_step');
  });
});

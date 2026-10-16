import {describe, expect, it} from 'vitest';
import {HarnessError} from '../harness/lib/errors.ts';
import {FakeDevice, hostOf, signIn} from './__fixtures__/device.ts';
import type {Reply} from './__fixtures__/model.ts';
import {callsTool, scriptedModel} from './__fixtures__/model.ts';
import type {StepContext} from './context.ts';
import {createStepContext} from './context.ts';
import type {StepExecutor} from './executors.ts';
import {actingSystem, BUILTIN_VERSION, builtinExecutor, outcomeError, toolLoopExecutor} from './executors.ts';
import {CORE_PROMPT} from './loop.ts';
import {SecretStore} from './secrets.ts';
import {defineTool} from './tools.ts';
import type {Message} from './types.ts';

const env = {} as NodeJS.ProcessEnv;
const passed = {status: 'passed', summary: 'Signed in.', errorCode: null};
const none = {type: 'object', properties: {}, required: [], additionalProperties: false};

function stepOf(replies: Reply[] | null, instruction = 'sign in as Ada', device = new FakeDevice()) {
  const model = scriptedModel(replies ?? []);
  const made = createStepContext({
    step: {kind: 'act', instruction, params: {}, index: 0},
    target: {platform: 'web', verbs: ['press', 'fill'], pixels: false, app: {}},
    hands: {host: hostOf(device), at: {step: 'act', instruction}, signal: new AbortController().signal, secrets: new SecretStore({}, env), taintStore: {}},
    ...(replies ? {model} : {}),
    agentContext: 'A sign-in screen.',
    limits: {modelCalls: 25, actions: 25},
    deadline: Date.now() + 120_000,
  });
  return {...made, model, device};
}

describe("an act's system blocks", () => {
  it("are the frozen prompt, then the agent's context and instructions, where the cache's breakpoint goes", () => {
    expect(actingSystem('core', 'A shop.', 'Dismiss the cookie banner first.')).toEqual([{text: 'core'}, {text: 'About the app:\nA shop.\n\nInstructions for this agent:\nDismiss the cookie banner first.', cache: true}]);
    expect(actingSystem('core', 'A shop.')[1]?.text).toBe('About the app:\nA shop.');
    expect(actingSystem('core', '', 'Be brief.')[1]?.text).toBe('Instructions for this agent:\nBe brief.');
    expect(actingSystem('core', '')[1]).toEqual({text: 'About the app: nothing more is known.', cache: true});
  });
});

describe('the built-in executor', () => {
  it('looks, then runs the loop with the core prompt, the grammar and the project tools', async () => {
    const device = new FakeDevice();
    device.onPress = () => signIn({signedIn: true});
    const made = stepOf([callsTool('tap', {ref: '@e5'}), callsTool('complete_step', passed)], 'sign in as Ada', device);
    const seed = defineTool({name: 'seed_cart', description: 'Seed the cart.', schema: none, execute: () => 'seeded'});
    const builtin = builtinExecutor({system: 'Verify every outcome.', tools: [seed], effort: 'high', maxTokens: 8000});
    expect([builtin.name, builtin.version]).toEqual(['builtin', BUILTIN_VERSION]);
    expect(await builtin.runStep(made.context)).toEqual({status: 'passed', summary: 'Signed in.'});
    const [first] = made.model.requests;
    expect(first?.system).toEqual([{text: CORE_PROMPT}, {text: 'About the app:\nA sign-in screen.\n\nInstructions for this agent:\nVerify every outcome.', cache: true}]);
    expect(first?.tools.map(tool => tool.name)).toEqual(['check', 'complete_step', 'double_tap', 'observe', 'seed_cart', 'tap', 'type']);
    expect([first?.effort, first?.maxTokens]).toEqual(['high', 8000]);
    expect(first?.messages[0]?.content[0]).toEqual({type: 'text', text: 'Instruction: sign in as Ada'});
  });

  it('runs on what the loop takes by default', async () => {
    const made = stepOf([callsTool('complete_step', passed)]);
    await builtinExecutor().runStep(made.context);
    expect([made.model.requests[0]?.effort, made.model.requests[0]?.tools.length]).toEqual(['medium', 6]);
  });
});

describe('an executor of its own', () => {
  it('runs the loop with its own prompt and tools, and a first turn it builds', async () => {
    const made = stepOf([callsTool('press_sign_in', {}), callsTool('complete_step', passed)]);
    const seen: StepContext[] = [];
    const executor = toolLoopExecutor({
      name: 'sign-in-only',
      system: 'You sign people in.',
      buildPrompt: ctx => `Do this: ${ctx.step.instruction}`,
      tools: (ctx, {guard}) => ({
        press: defineTool({name: 'press_sign_in', description: 'Press Sign in.', schema: none, execute: () => guard(() => ctx.actions.tap('@e5'))}),
      }),
      prepareMessages: (messages, ctx) => {
        seen.push(ctx);
        return messages;
      },
      maxModelCalls: 5,
      effort: 'low',
    });
    expect(executor.version).toBe('1');
    expect(await executor.runStep(made.context)).toEqual({status: 'passed', summary: 'Signed in.'});
    const [first] = made.model.requests;
    expect(first?.system).toEqual([{text: 'You sign people in.'}, {text: 'About the app:\nA sign-in screen.', cache: true}]);
    expect(first?.messages).toEqual([{role: 'user', content: [{type: 'text', text: 'Do this: sign in as Ada'}]}]);
    expect([first?.tools.map(tool => tool.name), first?.effort, seen.length, seen[0]]).toEqual([['complete_step', 'press_sign_in'], 'low', 2, made.context]);
    expect(made.device.calls).toEqual(['press {"ref":"@e14"}']);
  });

  it("takes its first turns as given, and its tools' harness failures as their answers through guard", async () => {
    const made = stepOf([callsTool('press_missing', {}), callsTool('complete_step', passed)]);
    const opening: Message[] = [{role: 'user', content: [{type: 'text', text: 'Sign in.'}]}];
    const executor = toolLoopExecutor({
      name: 'guarded',
      version: '3',
      system: 'core',
      buildPrompt: async () => opening,
      tools: (ctx, {guard}) => ({press: defineTool({name: 'press_missing', description: 'Press what is not there.', schema: none, execute: () => guard(() => ctx.actions.tap('@e40'))})}),
    });
    await executor.runStep(made.context);
    expect(made.model.requests[0]?.messages).toEqual(opening);
    expect(made.model.requests[1]?.messages[2]?.content[0]).toMatchObject({content: [{type: 'text', text: 'LOCATOR_NOT_FOUND: @e40 is not on the screen now; observe to see what is'}]});
    const answer = made.model.requests[1]?.messages[2]?.content[0] as object;
    expect('isError' in answer).toBe(false);
    const thrown = new Error('not a harness failure');
    await expect(toolLoopExecutor({name: 'x', system: 'core', buildPrompt: () => 'go', tools: () => ({})}).runStep(stepOf([callsTool('complete_step', passed)]).context)).resolves.toMatchObject({status: 'passed'});
    const rethrows = toolLoopExecutor({
      name: 'rethrows',
      system: 'core',
      buildPrompt: () => 'go',
      tools: (_ctx, {guard}) => ({boom: defineTool({name: 'boom', description: 'Boom.', schema: none, execute: () => guard(() => Promise.reject(thrown))})}),
    });
    const boom = stepOf([callsTool('boom', {}), callsTool('complete_step', passed)]);
    await rethrows.runStep(boom.context);
    expect(boom.model.requests[1]?.messages[2]?.content[0]).toMatchObject({content: [{type: 'text', text: 'the tool failed: not a harness failure'}], isError: true});
  });

  it('denies a look from inside a tool that changes the app', async () => {
    const made = stepOf([callsTool('seed_and_look', {}), callsTool('complete_step', passed)]);
    const executor = toolLoopExecutor({
      name: 'seeding',
      system: 'core',
      buildPrompt: () => 'Seed the cart.',
      tools: () => ({seed: defineTool({name: 'seed_and_look', description: 'Seed, then look.', schema: none, mutates: true, execute: (_input, context) => context.observe()})}),
    });
    await executor.runStep(made.context);
    expect(made.model.requests[1]?.messages[2]?.content[0]).toMatchObject({content: [{type: 'text', text: 'POLICY_DENIED: a tool that changes the app may not look at the screen: look in a call of its own'}], isError: true});
  });

  it('may need no model: one that passes what it can check itself and blocks the rest', async () => {
    const checker: StepExecutor = {
      name: 'checker',
      version: '1',
      async runStep(ctx) {
        if (ctx.step.instruction !== 'the sign-in form shows') return {status: 'blocked', summary: 'This executor only checks that the sign-in form shows.', errorCode: 'AUTOMATION_UNSUPPORTED'};
        const {tree} = await ctx.observe();
        return tree.nodes.some(node => node.role === 'form' && node.name === 'Sign in') ? {status: 'passed', summary: 'The sign-in form shows.'} : {status: 'failed', summary: 'No sign-in form.', errorCode: 'ASSERTION_FAILED'};
      },
    };
    expect(await checker.runStep(stepOf(null, 'the sign-in form shows').context)).toEqual({status: 'passed', summary: 'The sign-in form shows.'});
    const blocked = await checker.runStep(stepOf(null, 'buy a shirt').context);
    expect(outcomeError(blocked, {step: 'act', instruction: 'buy a shirt'})).toMatchObject({code: 'AUTOMATION_UNSUPPORTED', blocked: true, explanation: 'This executor only checks that the sign-in form shows.'});
  });
});

describe('the error a step ends with', () => {
  const at = {step: 'act' as const, instruction: 'sign in as Ada'};

  it('is none for a pass, the code or ACTION_FAILED for a failure, and a blocked code or AUTOMATION_UNSUPPORTED for a block', () => {
    expect(outcomeError({status: 'passed', summary: 'Done.'}, at)).toBeUndefined();
    expect(outcomeError({status: 'failed', summary: 'No such plan.', errorCode: 'ASSERTION_FAILED'}, at)).toMatchObject({code: 'ASSERTION_FAILED', blocked: false, message: 'agent.act("sign in as Ada"): No such plan.'});
    expect(outcomeError({status: 'failed', summary: 'It broke.'}, at)?.code).toBe('ACTION_FAILED');
    expect(outcomeError({status: 'blocked', summary: 'It wants a login.', errorCode: 'AUTHENTICATION_FAILED'}, at)).toMatchObject({code: 'AUTHENTICATION_FAILED', blocked: true});
    expect(outcomeError({status: 'blocked', summary: 'Stuck.', errorCode: 'ASSERTION_FAILED'}, at)).toMatchObject({code: 'AUTOMATION_UNSUPPORTED', blocked: true});
    expect(outcomeError({status: 'blocked', summary: 'Stuck.'}, at)?.code).toBe('AUTOMATION_UNSUPPORTED');
  });

  it('is a HarnessError, as every agent failure is', () => {
    expect(outcomeError({status: 'failed', summary: 'x'}, at)).toBeInstanceOf(HarnessError);
  });
});

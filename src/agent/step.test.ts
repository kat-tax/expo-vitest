import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {HarnessError} from '../harness/lib/errors.ts';
import {says, scriptedModel, usage} from './__fixtures__/model.ts';
import {assistantTurn, callModel, endedBy, sleep, stepSignal, withAgentOptions} from './step.ts';
import type {StepOf} from './step.ts';
import {AgentError} from './types.ts';
import type {CompletionRequest} from './types.ts';

const at: StepOf = {step: 'assert', instruction: 'the cart is empty'};
const request = (signal = new AbortController().signal): CompletionRequest => ({system: [], messages: [], tools: [], signal});

/** What a promise rejected with, as its code and message. */
async function rejection(promise: Promise<unknown>): Promise<[string, string]> {
  const error = (await promise.then(() => undefined, (thrown: unknown) => thrown)) as HarnessError;
  return [error.code, error.message];
}

describe("a step's signal", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('aborts at the timeout, its reason the step timing out', () => {
    const {signal, dispose} = stepSignal(at, 30_000);
    vi.advanceTimersByTime(29_999);
    expect(endedBy(signal, at)).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(endedBy(signal, at)?.code).toBe('STEP_TIMEOUT');
    expect(endedBy(signal, at)?.message).toBe('agent.assert("the cart is empty"): it ran past its timeout of 30000 ms');
    dispose();
  });

  it("aborts when the test's signal does, its reason a cancel, and at once where the test's has", () => {
    const test = new AbortController();
    const step = stepSignal(at, 30_000, test.signal);
    test.abort();
    expect(endedBy(step.signal, at)?.code).toBe('CANCELLED');
    expect(endedBy(stepSignal(at, 30_000, test.signal).signal, at)?.explanation).toBe('the test was cancelled');
  });

  it('stops listening once disposed', () => {
    const test = new AbortController();
    const {signal, dispose} = stepSignal(at, 1000, test.signal);
    dispose();
    vi.advanceTimersByTime(5000);
    test.abort();
    expect(signal.aborted).toBe(false);
  });

  it('is a cancel where it was aborted for a reason of its own', () => {
    expect(endedBy(AbortSignal.abort('gone'), at)?.code).toBe('CANCELLED');
  });
});

describe('a wait', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('ends after its time, or as soon as the signal aborts', async () => {
    const done = vi.fn();
    void sleep(3000, new AbortController().signal).then(done);
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();

    const controller = new AbortController();
    const early = vi.fn();
    void sleep(60_000, controller.signal).then(early);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(early).toHaveBeenCalled();
    await expect(sleep(60_000, AbortSignal.abort())).resolves.toBeUndefined();
  });
});

describe('a model call', () => {
  it('answers what the model said', async () => {
    const reply = says('hello');
    expect(await callModel(scriptedModel([reply]), request(), at)).toBe(reply);
  });

  it("is the step's MODEL_PROVIDER_FAILED where the model declined, with the category where it gave one", async () => {
    expect(await rejection(callModel(scriptedModel([says('', {stopReason: 'refusal', detail: 'cyber'})]), request(), at))).toEqual([
      'MODEL_PROVIDER_FAILED',
      'agent.assert("the cart is empty"): the model declined to answer (cyber)',
    ]);
    expect((await rejection(callModel(scriptedModel([says('', {stopReason: 'refusal'})]), request(), at)))[1]).toBe('agent.assert("the cart is empty"): the model declined to answer');
  });

  it("keeps a provider's code that is one of the agent's, and makes anything else MODEL_PROVIDER_FAILED", async () => {
    expect(await rejection(callModel(scriptedModel([new HarnessError('CONTEXT_OVERFLOW', 'the prompt is too long')]), request(), at))).toEqual([
      'CONTEXT_OVERFLOW',
      'agent.assert("the cart is empty"): the prompt is too long',
    ]);
    expect((await rejection(callModel(scriptedModel([new HarnessError('DRIVER_UNAVAILABLE', 'no')]), request(), at)))[0]).toBe('MODEL_PROVIDER_FAILED');
    const overloaded = new Error('529 overloaded');
    const thrown = (await callModel(scriptedModel([overloaded]), request(), at).catch((error: unknown) => error)) as AgentError;
    expect([thrown.code, thrown.explanation, thrown.cause]).toEqual(['MODEL_PROVIDER_FAILED', '529 overloaded', overloaded]);
    const odd = {id: 'odd', complete: () => Promise.reject('a string')};
    expect((await rejection(callModel(odd, request(), at)))[1]).toBe('agent.assert("the cart is empty"): a string');
  });

  it("passes on the step's own error as it is, as the step's model throws when its budget is spent", async () => {
    const spent = new AgentError('STEP_BUDGET_EXHAUSTED', 'it made 25 model calls, its budget', at);
    expect(await callModel(scriptedModel([spent]), request(), at).catch((error: unknown) => error)).toBe(spent);
  });

  it("is the step's own end where its signal aborted the call", async () => {
    const controller = new AbortController();
    const timeout = new AgentError('STEP_TIMEOUT', 'it ran past its timeout of 10 ms', at);
    const model = {
      id: 'slow',
      complete: () => {
        controller.abort(timeout);
        return Promise.reject(new Error('Request was aborted.'));
      },
    };
    expect(await callModel(model, request(controller.signal), at).catch((error: unknown) => error)).toBe(timeout);
  });
});

describe("a step's model with its agent's options", () => {
  it('is the model as it is where the agent sets neither', () => {
    const model = scriptedModel([]);
    expect(withAgentOptions(model, {}, at)).toBe(model);
  });

  it('carries the provider options on every call', async () => {
    const model = scriptedModel([says('one'), says('two')]);
    const optioned = withAgentOptions(model, {providerOptions: {anthropic: {metadata: {user_id: 'ci'}}}}, at);
    expect(optioned.id).toBe('claude-opus-5-5');
    await optioned.complete(request());
    await optioned.complete(request());
    expect(model.requests.map(each => each.providerOptions)).toEqual([{anthropic: {metadata: {user_id: 'ci'}}}, {anthropic: {metadata: {user_id: 'ci'}}}]);
  });

  it('makes no call once one has read maxInputTokens, the cached part included', async () => {
    const model = scriptedModel([says('under', {usage: usage(10_000, 5, 989_000, 999)}), says('at', {usage: usage(10_000, 5, 990_000, 0)}), says('never')]);
    const optioned = withAgentOptions(model, {maxInputTokens: 1_000_000}, at);
    await optioned.complete(request());
    await optioned.complete(request());
    expect(await rejection(optioned.complete(request()))).toEqual([
      'STEP_BUDGET_EXHAUSTED',
      `agent.assert("the cart is empty"): its last model call read 1 000 000 input tokens, at or past the agent's maxInputTokens of 1 000 000, and the next would read more`,
    ]);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]).not.toHaveProperty('providerOptions');
  });
});

describe("the assistant's turn", () => {
  it('is what it said, then what it called, with the provider\'s own turn where there is one', () => {
    const toolCalls = [{id: 'toolu_1', name: 'tap', input: {ref: '@e3'}}];
    expect(assistantTurn(says('Tapping it.', {toolCalls, raw: [{type: 'thinking'}]}))).toEqual({
      role: 'assistant',
      content: [
        {type: 'text', text: 'Tapping it.'},
        {type: 'tool_use', id: 'toolu_1', name: 'tap', input: {ref: '@e3'}},
      ],
      raw: [{type: 'thinking'}],
    });
    expect(assistantTurn(says('', {toolCalls}))).toEqual({role: 'assistant', content: [{type: 'tool_use', id: 'toolu_1', name: 'tap', input: {ref: '@e3'}}]});
  });
});

/**
 * What every step shares: a signal that says why the step ended, the model
 * call, whose failure is the step's, and the assistant's turn as the history
 * keeps it.
 */
import {isHarnessError} from '../harness/lib/errors.ts';
import type {ResolvedAgent} from './config.ts';
import type {AgentErrorCode, AgentStepKind, Completion, CompletionRequest, Message, Model} from './types.ts';
import {AgentError, isAgentCode, isAgentError} from './types.ts';

/** The step an error names: its kind and the words the test gave it. */
export interface StepOf {
  step: AgentStepKind;
  instruction: string;
}

export interface StepSignal {
  readonly signal: AbortSignal;
  /** Stops the step's timer. Called once the step is over, however it ended. */
  dispose(): void;
}

/**
 * A step's signal. It aborts at the step's timeout, or when the test's own
 * signal aborts, and its reason is the step's error either way, so whatever
 * stops on it can say which.
 */
export function stepSignal(at: StepOf, timeout: number, test?: AbortSignal): StepSignal {
  const controller = new AbortController();
  const cancel = () => controller.abort(new AgentError('CANCELLED', 'the test was cancelled', at));
  const timer = setTimeout(() => controller.abort(new AgentError('STEP_TIMEOUT', `it ran past its timeout of ${timeout} ms`, at)), timeout);
  if (test?.aborted) cancel();
  else test?.addEventListener('abort', cancel, {once: true});
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      test?.removeEventListener('abort', cancel);
    },
  };
}

/** Why a step's signal ended it, or undefined while it runs. A signal aborted for another reason is a cancel. */
export function endedBy(signal: AbortSignal, at: StepOf): AgentError | undefined {
  if (!signal.aborted) return undefined;
  return isAgentError(signal.reason) ? signal.reason : new AgentError('CANCELLED', 'the test was cancelled', at);
}

/** Waits, and stops waiting early when the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (signal.aborted) done();
    else signal.addEventListener('abort', done, {once: true});
  });
}

/**
 * One model call in a step. A provider's failure is the step's: an abort is
 * the step's timeout or the test's cancel, a code the provider gave that is
 * one of the agent's is kept, and anything else is MODEL_PROVIDER_FAILED. A
 * refusal is MODEL_PROVIDER_FAILED too, with the category the provider gave.
 */
export async function callModel(model: Model, request: CompletionRequest, at: StepOf): Promise<Completion> {
  let completion: Completion;
  try {
    completion = await model.complete(request);
  } catch (error) {
    const ended = endedBy(request.signal, at);
    if (ended) throw ended;
    // The step's own model throws the step's own errors, as when its budget is spent.
    if (isAgentError(error)) throw error;
    const code: AgentErrorCode = isHarnessError(error) && isAgentCode(error.code) ? error.code : 'MODEL_PROVIDER_FAILED';
    throw new AgentError(code, error instanceof Error ? error.message : String(error), {...at, cause: error});
  }
  if (completion.stopReason === 'refusal') throw new AgentError('MODEL_PROVIDER_FAILED', `the model declined to answer${completion.detail ? ` (${completion.detail})` : ''}`, at);
  return completion;
}

const spaced = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * A step's model with its agent's options on it: the provider options on
 * every call, and no call once one has read the agent's `maxInputTokens`,
 * the cached part included, since what the next reads only grows. Made for
 * each step, as it keeps what the step's last call read.
 */
export function withAgentOptions(model: Model, agent: Pick<ResolvedAgent, 'maxInputTokens' | 'providerOptions'>, at: StepOf): Model {
  const {maxInputTokens: limit, providerOptions} = agent;
  if (limit === undefined && providerOptions === undefined) return model;
  let last: number | undefined;
  return {
    id: model.id,
    async complete(request) {
      if (limit !== undefined && last !== undefined && last >= limit) {
        throw new AgentError('STEP_BUDGET_EXHAUSTED', `its last model call read ${spaced(last)} input tokens, at or past the agent's maxInputTokens of ${spaced(limit)}, and the next would read more`, at);
      }
      const completion = await model.complete(providerOptions ? {...request, providerOptions} : request);
      last = completion.usage.input + completion.usage.cacheRead + completion.usage.cacheWrite;
      return completion;
    },
  };
}

/** The assistant's turn as the history keeps it: what it said and called, and the provider's own turn, which goes back as it came. */
export function assistantTurn(completion: Completion): Message {
  return {
    role: 'assistant',
    content: [...(completion.text ? [{type: 'text' as const, text: completion.text}] : []), ...completion.toolCalls.map(call => ({type: 'tool_use' as const, id: call.id, name: call.name, input: call.input}))],
    ...(completion.raw === undefined ? {} : {raw: completion.raw}),
  };
}

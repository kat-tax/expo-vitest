/**
 * A model that answers from a script, for the unit tests: each call takes
 * the next reply, or a function of the request that makes one, and every
 * request is kept, so a test can say what each turn was sent.
 */
import type {Completion, CompletionRequest, Model, Usage} from '../types.ts';

export type Reply = Completion | Error | ((request: CompletionRequest) => Completion | Promise<Completion>);

export interface ScriptedModel extends Model {
  readonly requests: CompletionRequest[];
}

export function scriptedModel(replies: readonly Reply[], id = 'claude-opus-5-5'): ScriptedModel {
  const queue = [...replies];
  const requests: CompletionRequest[] = [];
  return {
    id,
    requests,
    async complete(request) {
      // A copy, as the request was when sent: the loop appends to its history after.
      requests.push({...request, messages: [...request.messages]});
      const next = queue.shift();
      if (next === undefined) throw new Error(`the scripted model has no reply left for call ${requests.length}`);
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(request) : next;
    },
  };
}

export const usage = (input = 100, output = 10, cacheRead = 0, cacheWrite = 0): Usage => ({input, output, cacheRead, cacheWrite});

let calls = 0;

/** A reply that calls one tool. */
export function callsTool(name: string, input: unknown, extra: Partial<Completion> = {}): Completion {
  calls += 1;
  return {text: '', toolCalls: [{id: `toolu_${calls}`, name, input}], stopReason: 'tool_use', usage: usage(), model: 'claude-opus-5-5', ...extra};
}

/** A reply in text alone. */
export function says(text: string, extra: Partial<Completion> = {}): Completion {
  return {text, toolCalls: [], stopReason: 'end', usage: usage(), model: 'claude-opus-5-5', ...extra};
}

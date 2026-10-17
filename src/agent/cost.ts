/**
 * What a model call cost, from a table of prices that is the only place a
 * price lives. The rows are the models the Claude adapter names, and those a
 * refusal's fallback can hand a step to, each in dollars a million tokens. A
 * cache write is the 5-minute one, 1.25 times input, which the adapter uses.
 */
import type {Usage} from './types.ts';

/** When the prices were checked against Anthropic's model catalog. */
export const PRICES_CHECKED = '2026-10-15';

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const row = (input: number, output: number, cacheRead: number): Price => ({input, output, cacheRead, cacheWrite: input * 1.25});

export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-5-5': row(4, 20, 0.2),
  'claude-fable-5-1': row(10, 50, 0.25),
  'claude-sonnet-5-5': row(2, 10, 0.2),
  'claude-haiku-5-5': row(0.1, 0.5, 0.01),
  // Where a refusal's fallback can send a step.
  'claude-opus-5': row(5, 25, 0.5),
  'claude-opus-4-8': row(5, 25, 0.5),
  'claude-sonnet-5': row(2, 10, 0.2),
};

/** Haiku 5.5 costs five times as much for a prompt over 100 000 tokens. */
const HAIKU_LONG = {model: 'claude-haiku-5-5', above: 100_000, price: row(0.5, 2.5, 0.05)};

/** The price of a call: the model's row, the long-prompt one for Haiku where the prompt is over its line. Undefined for a model not in the table. */
export function priceOf(model: string, usage: Usage): Price | undefined {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
  if (model === HAIKU_LONG.model && prompt > HAIKU_LONG.above) return HAIKU_LONG.price;
  return PRICES[model];
}

/** What a call cost, in dollars, or undefined where its model has no row. */
export function costOf(model: string, usage: Usage): number | undefined {
  const price = priceOf(model, usage);
  if (!price) return undefined;
  return (usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite) / 1_000_000;
}

/** Usage added up, for a step or a test. */
export function addUsage(a: Usage, b: Usage): Usage {
  return {input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite};
}

export const NO_USAGE: Usage = Object.freeze({input: 0, output: 0, cacheRead: 0, cacheWrite: 0});

/** The share of a prompt read from the cache, 0 to 1, or 0 where there was no prompt. */
export function cacheShare(usage: Usage): number {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
  return prompt === 0 ? 0 : usage.cacheRead / prompt;
}

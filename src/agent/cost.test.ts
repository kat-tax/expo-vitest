import {describe, expect, it} from 'vitest';
import {NO_USAGE, PRICES, PRICES_CHECKED, addUsage, cacheShare, costOf, priceOf} from './cost.ts';

const million = {input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0};

describe('the price table', () => {
  it("has each model the adapter names, and those a fallback can hand a step to, checked on a date", () => {
    expect(Object.keys(PRICES)).toEqual(['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5']);
    expect(PRICES_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is each row as Anthropic prices it, a cache write 1.25 times input', () => {
    expect(PRICES['claude-opus-5-5']).toEqual({input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5});
    expect(PRICES['claude-fable-5-1']).toEqual({input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5});
    expect(PRICES['claude-sonnet-5-5']).toEqual({input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5});
    expect(PRICES['claude-haiku-5-5']).toEqual({input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125});
  });
});

describe('what a call cost', () => {
  it('is each kind of token at its price', () => {
    expect(costOf('claude-opus-5-5', {input: 3120, output: 64, cacheRead: 2890, cacheWrite: 0})).toBeCloseTo((3120 * 4 + 64 * 20 + 2890 * 0.2) / 1e6, 12);
    expect(costOf('claude-opus-5-5', million)).toBe(4);
    expect(costOf('claude-sonnet-5-5', {input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0})).toBe(10);
    expect(costOf('claude-fable-5-1', {input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000})).toBe(12.75);
  });

  it("is Haiku's long-prompt price over 100 000 tokens", () => {
    expect(costOf('claude-haiku-5-5', {input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0})).toBeCloseTo(0.01, 12);
    expect(priceOf('claude-haiku-5-5', {input: 60_000, output: 0, cacheRead: 40_001, cacheWrite: 0})?.input).toBe(0.5);
    expect(costOf('claude-haiku-5-5', {input: 200_000, output: 1000, cacheRead: 0, cacheWrite: 0})).toBeCloseTo((200_000 * 0.5 + 1000 * 2.5) / 1e6, 12);
  });

  it('is unknown for a model not in the table, and nothing for no tokens', () => {
    expect(costOf('my-provider/model', million)).toBeUndefined();
    expect(costOf('claude-opus-5-5', NO_USAGE)).toBe(0);
  });
});

describe('usage', () => {
  it('adds up, and says what share of the prompt the cache gave', () => {
    const total = addUsage({input: 100, output: 10, cacheRead: 300, cacheWrite: 0}, {input: 50, output: 5, cacheRead: 450, cacheWrite: 100});
    expect(total).toEqual({input: 150, output: 15, cacheRead: 750, cacheWrite: 100});
    expect(cacheShare(total)).toBeCloseTo(0.75, 12);
    expect(cacheShare(NO_USAGE)).toBe(0);
  });
});

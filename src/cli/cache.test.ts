import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {writeEntry} from '../agent/cache.ts';
import type {CacheEntry} from '../agent/cache.ts';
import {ageOf, cache, cacheText} from './cache.ts';

const entry = (key: string, instruction: string, recordedAt: string): CacheEntry => ({
  v: 1,
  key,
  test: {file: 'device/billing.test.ts', title: 'a member upgrades'},
  platform: 'web',
  instruction,
  params: {},
  agent: {name: 'default', contextHash: 'abc'},
  app: {identity: 'http://localhost:8081'},
  executor: {name: 'builtin', version: '1'},
  start: {route: '/'},
  actions: [],
  end: {route: '/', appeared: [], disappeared: []},
  summary: 'Done.',
  recordedAt,
  viewport: null,
});

afterEach(() => void vi.restoreAllMocks());

describe('the cache, from the command line', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');

  it('lists the entries newest first: the key, the age, the platform, the test and the instruction', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-cli-'));
    writeEntry(dir, entry('a'.repeat(64), 'open the plan', '2026-10-15T11:58:00Z'));
    writeEntry(dir, entry('b'.repeat(64), 'upgrade to {plan}', '2026-10-15T11:59:30Z'));
    expect(cacheText([], dir, now)).toEqual({
      code: 0,
      text: [`${'b'.repeat(12)}      30 s  web      device/billing.test.ts > a member upgrades  "upgrade to {plan}"`, `${'a'.repeat(12)}     2 min  web      device/billing.test.ts > a member upgrades  "open the plan"`].join('\n'),
    });
    expect(cacheText(['stats'], dir, now).text).toMatch(new RegExp(`^2 entries, \\d+ bytes, in ${dir.replace(/\\/g, '\\\\')}$`));
    expect(cacheText(['clear'], dir, now)).toEqual({code: 0, text: `removed 2 entries from ${dir}`});
    expect(cacheText(['ls'], dir, now)).toEqual({code: 0, text: `no entries in ${dir}`});
    expect(cacheText(['stats'], dir, now).text).toBe(`0 entries, 0 bytes, in ${dir}`);
  });

  it('counts one entry as one, and takes nothing but ls, stats or clear', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-cli-'));
    writeEntry(dir, entry('c'.repeat(64), 'x', '2026-10-15T11:00:00Z'));
    expect(cacheText(['clear'], dir, now).text).toBe(`removed 1 entry from ${dir}`);
    expect(cacheText(['purge'], dir, now)).toEqual({code: 2, text: 'cache takes ls, stats or clear'});
    expect(cacheText(['ls', 'more'], dir, now).code).toBe(2);
  });

  it('says how old an entry is in the largest unit that fits', () => {
    const at = (seconds: number) => new Date(now - seconds * 1000).toISOString();
    expect([ageOf(at(5), now), ageOf(at(90), now), ageOf(at(3 * 3600), now), ageOf(at(72 * 3600), now), ageOf(at(-10), now)]).toEqual(['5 s', '2 min', '3 h', '3 days', '0 s']);
  });

  it('prints what it says, and the refusal on stderr', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-cli-'));
    expect(cache(['ls'], dir)).toBe(0);
    expect(cache(['purge'], dir)).toBe(2);
    expect([out.mock.calls[0]?.[0], err.mock.calls[0]?.[0]]).toEqual([`no entries in ${dir}`, 'cache takes ls, stats or clear']);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {BenchResult} from './bench.ts';
import {FEWEST, ITERATIONS, bench, iterationsFrom, percentile, renderBench, summarise} from './bench.ts';
import {DEFAULT_TIMING} from './settle.ts';
import type {Driver} from './types.ts';
import {elsewhere, failed, ok} from './types.ts';

describe('percentile', () => {
  const twenty = Array.from({length: 20}, (_, at) => at + 1);

  it('is the nearest rank: of twenty, p50 is the tenth and p95 the nineteenth', () => {
    expect(percentile(twenty, 50)).toBe(10);
    expect(percentile(twenty, 95)).toBe(19);
    expect(percentile(twenty, 0)).toBe(1);
    expect(percentile(twenty, 100)).toBe(20);
  });

  it('is the one sample there is, and nothing when there is none', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNaN();
  });
});

describe('summarise', () => {
  it('sorts before it ranks, and leaves the first call out', () => {
    expect(summarise({operation: 'snapshot', ms: [5, 1, 3], cold: 900})).toEqual({p50: 3, p95: 5, min: 1, max: 5, n: 3});
  });
});

describe('iterationsFrom', () => {
  it('is twenty unless told, and refuses fewer than five or a part of one', () => {
    expect(iterationsFrom(undefined)).toBe(ITERATIONS);
    expect(iterationsFrom('50')).toBe(50);
    expect(iterationsFrom(String(FEWEST))).toBe(FEWEST);
    expect(iterationsFrom('4')).toBeNull();
    expect(iterationsFrom('7.5')).toBeNull();
    expect(iterationsFrom('many')).toBeNull();
  });
});

describe('bench', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) fs.rmSync(folder, {recursive: true, force: true});
  });

  function folder(): string {
    const made = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-bench-'));
    folders.push(made);
    return made;
  }

  function stub(overrides: Partial<Driver> = {}): Driver {
    return {
      platform: 'web',
      available: async () => ({ready: true}),
      open: async () => ok('opened'),
      snapshot: async () => ({platform: 'web', source: 'http://localhost:8081', nodes: []}),
      press: async () => ok('pressed'),
      fill: async () => ok('filled'),
      type: async () => ok('typed'),
      screenshot: async file => {
        fs.writeFileSync(file, 'not really a PNG');
        return ok('saved');
      },
      idleSeconds: async () => null,
      close: async () => {},
      ...overrides,
    };
  }

  it('times each operation once, kept apart, and then as many times as asked', async () => {
    const directory = folder();
    const press = vi.fn(async () => ok('pressed'));
    const fill = vi.fn(async () => ok('filled'));
    const result = await bench(stub({press, fill}), {iterations: 5, press: 'label="Settings"', field: 'testID=name', directory, timing: {...DEFAULT_TIMING, settle: 1}});
    expect(result).toMatchObject({platform: 'web', source: 'http://localhost:8081', iterations: 5, node: process.versions.node});
    expect(result.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(result.samples.map(sample => sample.operation)).toEqual(['snapshot', 'snapshot -i', 'press', 'fill', 'settle', 'screenshot']);
    for (const sample of result.samples) {
      expect(sample.ms, sample.operation).toHaveLength(5);
      expect(sample.cold, sample.operation).toBeTypeOf('number');
    }
    // Found afresh each time, as a test's element(…).press() does.
    expect(press).toHaveBeenCalledTimes(6);
    expect(press).toHaveBeenCalledWith('label="Settings"');
    expect(fill).toHaveBeenCalledWith('testID=name', 'bench');
    // The screenshots are gone; the folder stays, since the result is written there too.
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("times the wait after a step as the run waits, the reads with the run's settle between, where the driver does not wait by itself", async () => {
    const snapshot = vi.fn(async () => ({platform: 'web' as const, nodes: []}));
    const result = await bench(stub({snapshot}), {iterations: 5, directory: folder(), timing: {...DEFAULT_TIMING, settle: 30, samples: 2}});
    const waited = result.samples.find(sample => sample.operation === 'settle');
    expect(waited?.ms).toHaveLength(5);
    expect(Math.min(...(waited?.ms ?? []))).toBeGreaterThanOrEqual(25);
    // Two snapshots, then two reads a wait, six waits.
    expect(snapshot).toHaveBeenCalledTimes(2 * 6 + 12);
    const own = await bench(stub({settles: true}), {iterations: 5, directory: folder()});
    expect(own.samples.find(sample => sample.operation === 'settle')).toEqual({operation: 'settle', ms: [], cold: null, skipped: 'the driver waits for the screen inside each step, so press and fill include it'});
    const none = await bench(stub(), {iterations: 5, directory: folder(), timing: {...DEFAULT_TIMING, settle: 0}});
    expect(none.samples.find(sample => sample.operation === 'settle')).toEqual({operation: 'settle', ms: [], cold: null, skipped: 'a settle of 0 makes the steps wait for nothing'});
  });

  it('presses and fills nothing it was not told to', async () => {
    const press = vi.fn(async () => ok('pressed'));
    const result = await bench(stub({press, snapshot: async () => ({platform: 'web', nodes: []})}), {iterations: 5, directory: folder(), timing: {...DEFAULT_TIMING, settle: 1}});
    expect('source' in result).toBe(false);
    expect(result.samples[2]).toEqual({operation: 'press', ms: [], cold: null, skipped: 'pass --press <target> to measure it'});
    expect(result.samples[3]).toEqual({operation: 'fill', ms: [], cold: null, skipped: 'pass --field <target> to measure it'});
    expect(press).not.toHaveBeenCalled();
  });

  it('stops pressing the moment the driver refuses, as when someone comes back, and keeps what it timed', async () => {
    let presses = 0;
    const press = vi.fn(async () => (++presses > 3 ? failed('refusing a press: someone used this machine 1 seconds ago') : ok('pressed')));
    const result = await bench(stub({press}), {iterations: 5, press: '@e1', directory: folder(), timing: {...DEFAULT_TIMING, settle: 1}});
    expect(press).toHaveBeenCalledTimes(4);
    expect(result.samples[2]).toEqual({
      operation: 'press',
      cold: expect.any(Number),
      ms: [expect.any(Number), expect.any(Number)],
      failed: 'refusing a press: someone used this machine 1 seconds ago',
    });
  });

  it('stops an operation at its first failure and says what failed, and keeps going with the rest', async () => {
    let presses = 0;
    const result = await bench(
      stub({
        snapshot: async options => {
          if (options?.interactive) throw new Error('could not read the tree of MyApp: access is denied');
          return {platform: 'windows', source: 'MyApp', nodes: []};
        },
        press: async () => (++presses === 3 ? failed('press failed: no window') : ok('pressed')),
        screenshot: async () => elsewhere('a screenshot', 'web'),
      }),
      {iterations: 5, press: 'label="Settings"', directory: folder(), timing: {...DEFAULT_TIMING, settle: 1}},
    );
    expect(result.samples[1]).toEqual({operation: 'snapshot -i', ms: [], cold: null, failed: 'could not read the tree of MyApp: access is denied'});
    expect(result.samples[2]).toMatchObject({operation: 'press', failed: 'press failed: no window'});
    expect(result.samples[2]?.ms).toHaveLength(1);
    expect(result.samples[5]).toEqual({operation: 'screenshot', ms: [], cold: null, skipped: 'a screenshot is not something the web harness can do'});
  });
});

describe('renderBench', () => {
  it('is a table a person can read', () => {
    const result: BenchResult = {
      platform: 'windows',
      source: 'MyApp',
      iterations: 5,
      node: '24.20.0',
      at: '2026-10-14T20:31:00Z',
      samples: [
        {operation: 'snapshot', cold: 1842, ms: [1611.3, 1588.1, 1702.9, 1740.2, 1650]},
        {operation: 'snapshot -i', cold: 25, ms: [50, 10, 40, 20, 30]},
        {operation: 'press', ms: [], cold: null, skipped: 'refusing a press: someone used this machine 3 seconds ago'},
        {operation: 'fill', ms: [], cold: null, skipped: 'pass --field <target> to measure it'},
        {operation: 'screenshot', ms: [12.5], cold: 300.25, failed: 'screenshot failed: the window is minimised'},
      ],
    };
    expect(renderBench(result)).toBe(
      [
        'bench on windows (MyApp), 5 iterations, node 24.20.0, 2026-10-14T20:31:00Z',
        '',
        '  operation         cold      p50      p95      min      max',
        '  snapshot        1842.0   1650.0   1740.2   1588.1   1740.2',
        '  snapshot -i       25.0     30.0     50.0     10.0     50.0',
        '  press        skipped: refusing a press: someone used this machine 3 seconds ago',
        '  fill         skipped: pass --field <target> to measure it',
        '  screenshot   failed: screenshot failed: the window is minimised',
      ].join('\n'),
    );
  });

  it('says nothing of a source it was not told', () => {
    expect(renderBench({platform: 'web', iterations: 5, node: '24.20.0', at: '2026-10-14T20:31:00Z', samples: []})).toBe(
      ['bench on web, 5 iterations, node 24.20.0, 2026-10-14T20:31:00Z', '', '  operation         cold      p50      p95      min      max'].join('\n'),
    );
  });
});

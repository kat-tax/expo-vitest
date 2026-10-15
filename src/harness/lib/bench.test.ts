import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {BenchResult} from './bench.ts';
import {FEWEST, ITERATIONS, bench, iterationsFrom, percentile, quietPoint, renderBench, summarise} from './bench.ts';
import type {Snapshot, SnapshotNode} from './snapshot.ts';
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

function node(overrides: Partial<SnapshotNode>): SnapshotNode {
  return {ref: '@e1', role: 'Text', name: 'Settings', depth: 1, interactive: false, bounds: {x: 0, y: 0, width: 10, height: 10}, ...overrides};
}

describe('quietPoint', () => {
  it('is the middle of the first static node that sits inside nothing that acts', () => {
    const tree: Snapshot = {
      platform: 'windows',
      nodes: [
        node({ref: '@e1', role: 'Button', interactive: true, bounds: {x: 0, y: 0, width: 100, height: 40}}),
        // The button's own label: pressing it presses the button.
        node({ref: '@e2', name: 'Save', bounds: {x: 10, y: 10, width: 40, height: 20}}),
        node({ref: '@e3', offscreen: true, bounds: {x: 0, y: 200, width: 10, height: 10}}),
        node({ref: '@e4', bounds: null}),
        node({ref: '@e5', bounds: {x: 0, y: 100, width: 0, height: 10}}),
        node({ref: '@e6', bounds: {x: 0, y: 100, width: 10, height: 0}}),
        node({ref: '@e7', bounds: {x: 200, y: 100, width: 60, height: 20}}),
      ],
    };
    expect(quietPoint(tree)).toEqual({x: 230, y: 110});
  });

  it('is nothing when everything acts or sits inside something that does', () => {
    expect(quietPoint({platform: 'web', nodes: [node({interactive: true}), node({ref: '@e2'})]})).toBeNull();
    expect(quietPoint({platform: 'web', nodes: []})).toBeNull();
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
      snapshot: async () => ({platform: 'web', source: 'http://localhost:8081', nodes: [node({bounds: {x: 0, y: 0, width: 20, height: 20}})]}),
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
    const result = await bench(stub({press, fill}), {iterations: 5, field: 'testID=name', directory});
    expect(result).toMatchObject({platform: 'web', source: 'http://localhost:8081', iterations: 5, node: process.versions.node});
    expect(result.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(result.samples.map(sample => sample.operation)).toEqual(['snapshot', 'snapshot -i', 'press', 'fill', 'screenshot']);
    for (const sample of result.samples) {
      expect(sample.ms, sample.operation).toHaveLength(5);
      expect(sample.cold, sample.operation).toBeTypeOf('number');
    }
    // The press lands in the middle of the static node, every time.
    expect(press).toHaveBeenCalledTimes(6);
    expect(press).toHaveBeenCalledWith({x: 10, y: 10});
    expect(fill).toHaveBeenCalledWith('testID=name', 'bench');
    // The screenshots are gone; the folder stays, since the result is written there too.
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('leaves fill out without a field, and press when nothing is safe to press', async () => {
    const result = await bench(stub({snapshot: async () => ({platform: 'web', nodes: [node({interactive: true})]})}), {iterations: 5, directory: folder()});
    expect('source' in result).toBe(false);
    expect(result.samples[2]).toEqual({operation: 'press', ms: [], cold: null, skipped: 'nothing on screen is safe to press: every node with bounds acts, or sits inside one that does'});
    expect(result.samples[3]).toEqual({operation: 'fill', ms: [], cold: null, skipped: 'pass --field <target> to measure it'});
  });

  it('sends no input when it is refused, and says why', async () => {
    const press = vi.fn(async () => ok('pressed'));
    const fill = vi.fn(async () => ok('filled'));
    const refuse = async (what: string) => `refusing ${what}: someone used this machine 3 seconds ago`;
    const result = await bench(stub({press, fill}), {iterations: 5, field: '@e3', directory: folder(), refuse});
    expect(result.samples[2]?.skipped).toBe('refusing a press: someone used this machine 3 seconds ago');
    expect(result.samples[3]?.skipped).toBe('refusing typing: someone used this machine 3 seconds ago');
    expect(press).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
  });

  it('sends input when nothing refuses it', async () => {
    const result = await bench(stub(), {iterations: 5, field: '@e3', directory: folder(), refuse: async () => null});
    expect(result.samples[2]?.ms).toHaveLength(5);
    expect(result.samples[3]?.ms).toHaveLength(5);
  });

  it('stops an operation at its first failure and says what failed, and keeps going with the rest', async () => {
    let presses = 0;
    const result = await bench(
      stub({
        snapshot: async options => {
          if (options?.interactive) throw new Error('could not read the tree of MyApp: access is denied');
          return {platform: 'windows', source: 'MyApp', nodes: [node({})]};
        },
        press: async () => (++presses === 3 ? failed('press failed: no window') : ok('pressed')),
        screenshot: async () => elsewhere('a screenshot', 'web'),
      }),
      {iterations: 5, directory: folder()},
    );
    expect(result.samples[1]).toEqual({operation: 'snapshot -i', ms: [], cold: null, failed: 'could not read the tree of MyApp: access is denied'});
    expect(result.samples[2]).toMatchObject({operation: 'press', failed: 'press failed: no window'});
    expect(result.samples[2]?.ms).toHaveLength(1);
    expect(result.samples[4]).toEqual({operation: 'screenshot', ms: [], cold: null, skipped: 'a screenshot is not something the web harness can do'});
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

/**
 * How long each thing a driver does takes, so that "faster" is a number
 * rather than an impression: the same operations, the same number of times,
 * on whichever platform is under test, before and after a change.
 *
 * The first call of each operation is kept apart as `cold`, because it pays
 * for whatever starts on first use, which is a different fact from the
 * steady state. Percentiles are nearest rank over the rest.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Target} from './snapshot.ts';
import type {Driver, StepResult} from './types.ts';

/** How many times each operation runs after its first, unless told otherwise. */
export const ITERATIONS = 20;

/** The fewest that mean anything: of fewer samples, the p95 is only the slowest. */
export const FEWEST = 5;

export interface Sample {
  operation: string;
  /** Milliseconds for each call after the first, in the order they ran. */
  ms: number[];
  /** The first call, or null when there was none. */
  cold: number | null;
  /** Why the operation was not measured. */
  skipped?: string;
  /** What went wrong, when a call failed and the rest were not made. */
  failed?: string;
}

export interface BenchResult {
  platform: string;
  /** What the snapshots were of: a process, a page, a device. */
  source?: string;
  iterations: number;
  /** The Node version, since it is part of what was measured. */
  node: string;
  at: string;
  samples: Sample[];
}

export interface BenchOptions {
  iterations: number;
  /**
   * What `press` presses; without it, `press` is not measured. It has to be
   * something a press does nothing to, such as a heading, since it is pressed
   * every time; only the person who knows the app can say what that is.
   */
  press?: Target;
  /** The field `fill` types into; without one, `fill` is not measured. */
  field?: Target;
  /** Where screenshots go while they are taken. Each is removed afterwards. */
  directory: string;
}

/**
 * The `p`th percentile of samples sorted in ascending order, by nearest rank:
 * of `n` samples, the one at `ceil(p / 100 × n)`, counting from one. Of twenty,
 * p50 is the tenth and p95 the nineteenth.
 */
export function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

export function summarise(sample: Sample): {p50: number; p95: number; min: number; max: number; n: number} {
  const sorted = [...sample.ms].sort((a, b) => a - b);
  return {p50: percentile(sorted, 50), p95: percentile(sorted, 95), min: percentile(sorted, 0), max: percentile(sorted, 100), n: sorted.length};
}

/** The iterations a command line asked for, or null when they will not do. */
export function iterationsFrom(value: string | undefined): number | null {
  const iterations = value === undefined ? ITERATIONS : Number(value);
  return Number.isInteger(iterations) && iterations >= FEWEST ? iterations : null;
}

function skipped(operation: string, reason: string): Sample {
  return {operation, ms: [], cold: null, skipped: reason};
}

/**
 * Times a call once, kept apart, and then `iterations` more times. A call
 * that fails stops the operation there, with what it timed kept: that is
 * also how a press the driver refuses ends it, once someone comes back to
 * the desk.
 */
async function measure(operation: string, iterations: number, call: () => Promise<StepResult | void>): Promise<Sample> {
  const sample: Sample = {operation, ms: [], cold: null};
  for (let at = 0; at <= iterations; at++) {
    const started = performance.now();
    let result: StepResult | void;
    try {
      result = await call();
    } catch (error) {
      return {...sample, failed: (error as Error).message};
    }
    const ms = Math.round((performance.now() - started) * 10) / 10;
    if (result?.skipped) return skipped(operation, result.message);
    if (result && !result.ok) return {...sample, failed: result.message};
    if (at === 0) sample.cold = ms;
    else sample.ms.push(ms);
  }
  return sample;
}

/**
 * The input operations, each only when it has a target. Both find their
 * target afresh every time, as `element(…).press()` and `.fill()` do in a
 * test, and the Windows driver checks the desk before each, so what they cost
 * is what a test pays.
 */
async function input(operation: 'press' | 'fill', target: Target | undefined, flag: string, options: BenchOptions, call: (target: Target) => Promise<StepResult>): Promise<Sample> {
  if (target === undefined) return skipped(operation, `pass ${flag} <target> to measure it`);
  return measure(operation, options.iterations, () => call(target));
}

/**
 * Snapshot, snapshot of what can be acted on, press, fill and screenshot, each
 * `iterations` times after a first call. `press` presses what it is told to
 * and `fill` types `bench` into the field it is told of, which keeps it; the
 * screenshots are deleted once they are all taken.
 */
export async function bench(driver: Driver, options: BenchOptions): Promise<BenchResult> {
  const {iterations} = options;
  const samples: Sample[] = [];
  let source: string | undefined;

  samples.push(
    await measure('snapshot', iterations, async () => {
      source = (await driver.snapshot()).source;
    }),
  );
  samples.push(
    await measure('snapshot -i', iterations, async () => {
      await driver.snapshot({interactive: true});
    }),
  );
  samples.push(await input('press', options.press, '--press', options, target => driver.press(target)));
  samples.push(await input('fill', options.field, '--field', options, target => driver.fill(target, 'bench')));

  const shots: string[] = [];
  samples.push(
    await measure('screenshot', iterations, () => {
      const file = path.join(options.directory, `${shots.length}.png`);
      shots.push(file);
      return driver.screenshot(file);
    }),
  );
  for (const file of shots) fs.rmSync(file, {force: true});

  return {
    platform: driver.platform,
    ...(source ? {source} : null),
    iterations,
    node: process.versions.node,
    at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    samples,
  };
}

/** The result as a table, which is what a person reads. */
export function renderBench(result: BenchResult): string {
  const columns = ['cold', 'p50', 'p95', 'min', 'max'];
  const rows = result.samples.map(sample => {
    const name = `  ${sample.operation.padEnd(13)}`;
    if (sample.skipped) return `${name}skipped: ${sample.skipped}`;
    if (sample.failed) return `${name}failed: ${sample.failed}`;
    const {p50, p95, min, max} = summarise(sample);
    // A sample that was measured had a first call: only a skipped or failed one has none.
    return name + [sample.cold!, p50, p95, min, max].map(value => value.toFixed(1).padStart(9)).join('');
  });
  const what = result.source ? ` (${result.source})` : '';
  return [
    `bench on ${result.platform}${what}, ${result.iterations} iterations, node ${result.node}, ${result.at}`,
    '',
    `  ${'operation'.padEnd(13)}${columns.map(column => column.padStart(9)).join('')}`,
    ...rows,
  ].join('\n');
}

/**
 * Waiting for the tree to say something, as Playwright's assertions wait:
 * read, and read again a little later, until it says it or the time is up.
 * One scheduler serves every wait in the device layer: an action looking for
 * its node, `findBy*`, a locator's `waitFor` and the matchers.
 *
 * The readings come from one feed per device, so waits that run at the same
 * moment share a snapshot rather than each taking one, and the gap between
 * readings grows, so a screen that answers at once costs one read and one
 * that takes four seconds about twelve, not forty.
 */
import type {Snapshot} from '../harness/lib/snapshot.ts';
import type {Clock} from '../harness/lib/settle.ts';
import {realClock} from '../harness/lib/settle.ts';
import type {Driver} from '../harness/lib/types.ts';

export interface Polling {
  /** How long an assertion, an action's search for its node and a `findBy*` wait, in ms. */
  assertionTimeout: number;
  /** How long a negated assertion's condition must hold on every reading before it passes, in ms. */
  stable: number;
}

/** e2e's numbers: five seconds for an assertion, and a second of truth before a negated one passes. */
export const DEFAULT_POLLING: Polling = {assertionTimeout: 5000, stable: 1000};

/** The gap after the `polls`th reading: 100 ms, growing by half each time, to 400. */
export function gapAfter(polls: number): number {
  return Math.min(400, Math.round(100 * 1.5 ** (polls - 1)));
}

export interface SnapshotFeed {
  /** A snapshot of the whole tree: the one being taken, if one is, the last one if it is recent, else a new one. */
  next(): Promise<Snapshot>;
  /** Forgets what it has, after something that may have changed the screen. */
  invalidate(): void;
}

/**
 * Snapshots shared between the waits that ask at the same moment: a request
 * while one is being taken joins it, and one within `minSpacing` ms of the
 * last gets that one. An action calls `invalidate`, so nothing read before it
 * answers a request made after it.
 */
export function snapshotFeed(read: () => Promise<Snapshot>, {minSpacing = 50, clock = realClock}: {minSpacing?: number; clock?: Clock} = {}): SnapshotFeed {
  let taking: Promise<Snapshot> | null = null;
  let kept: {snapshot: Snapshot; at: number} | null = null;
  let generation = 0;
  return {
    next() {
      if (taking) return taking;
      if (kept && clock.now() - kept.at < minSpacing) return Promise.resolve(kept.snapshot);
      const asked = generation;
      const mine: Promise<Snapshot> = read()
        .then(snapshot => {
          if (asked === generation) kept = {snapshot, at: clock.now()};
          return snapshot;
        })
        .finally(() => {
          if (taking === mine) taking = null;
        });
      taking = mine;
      return mine;
    },
    invalidate() {
      generation++;
      kept = null;
      taking = null;
    },
  };
}

/** The steps that can change the screen, which a driver may or may not have. */
const ACTIONS = ['open', 'press', 'fill', 'type', 'key', 'longPress', 'hover', 'focus', 'scrollIntoView', 'swipe', 'control'];

/** A driver whose every action tells the feed when it is done, so no wait answers with a tree from before it. */
export function invalidating(driver: Driver, feed: SnapshotFeed): Driver {
  const steps = driver as unknown as Record<string, unknown>;
  const told: Record<string, unknown> = {...steps};
  for (const name of ACTIONS) {
    const step = steps[name];
    if (typeof step !== 'function') continue;
    told[name] = async (...args: unknown[]) => {
      try {
        return await step.apply(driver, args);
      } finally {
        feed.invalidate();
      }
    };
  }
  return told as unknown as Driver;
}

export interface PollOptions {
  /** How long to keep reading, in ms. The first reading is taken at once. */
  timeout: number;
  /** For a negated wait, how long its condition must hold on every reading, in ms; no longer than `timeout`. */
  stable: number;
  /** Whether the wait is for `passes` to be false, and to stay false. */
  negated: boolean;
  feed: SnapshotFeed;
  /** A fixed gap between readings, in ms, in place of the growing one. */
  interval?: number;
  signal?: AbortSignal;
  clock?: Clock;
}

/** One reading, and when it was taken, in ms since the wait began. */
export interface Reading<T> {
  value: T;
  at: number;
}

export interface PollResult<T> {
  pass: boolean;
  last: T;
  polls: number;
  readings: Reading<T>[];
  /** How long the wait took, in ms. */
  elapsed: number;
}

/**
 * Reads until `passes` says so, or until `timeout`. A negated wait passes
 * only once `passes` has said no on every reading for `stable` ms: right
 * after an action a single reading proves little, since `toBeHidden` on a
 * spinner that has not come in yet would pass, and the test would carry on
 * into the spinner.
 */
export async function poll<T>(read: (snapshot: Snapshot) => T, passes: (value: T) => boolean, options: PollOptions): Promise<PollResult<T>> {
  const clock = options.clock ?? realClock;
  const stable = Math.min(options.stable, options.timeout);
  const started = clock.now();
  const readings: Reading<T>[] = [];
  let heldSince: number | null = null;
  for (let polls = 1; ; polls++) {
    const value = read(await options.feed.next());
    const at = clock.now() - started;
    readings.push({value, at});
    const done = (pass: boolean): PollResult<T> => ({pass, last: value, polls, readings, elapsed: at});
    if (passes(value) !== options.negated) {
      if (!options.negated) return done(true);
      heldSince ??= at;
      if (at - heldSince >= stable) return done(true);
    } else heldSince = null;
    // While a negated condition holds, the next reading is no later than the
    // moment it will have held for long enough.
    const until = heldSince === null ? options.timeout : Math.min(options.timeout, heldSince + stable);
    const gap = Math.min(options.interval ?? gapAfter(polls), until - at);
    if (gap <= 0 || options.signal?.aborted) return done(false);
    await clock.sleep(gap);
  }
}

/** A length of time as a message says it: `120 ms`, `1.2 s`. */
export function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The readings as a message says them, each run of the same value with how
 * long it lasted: `read 14 times; it was "" for 1.2 s, then "a@b" for 3.8 s`.
 */
/** Each run of readings that said the same, as it said it, and when it began. */
function runsOf<T>(result: PollResult<T>, show: (value: T) => string): {said: string; from: number}[] {
  const runs: {said: string; from: number}[] = [];
  for (const reading of result.readings) {
    const said = show(reading.value);
    if (runs.at(-1)?.said !== said) runs.push({said, from: reading.at});
  }
  return runs;
}

/** What the readings said, each run of the same once, in order. */
export function readingsOf<T>(result: PollResult<T>, show: (value: T) => string): string[] {
  return runsOf(result, show).map(run => run.said);
}

export function describeReadings<T>(result: PollResult<T>, show: (value: T) => string): string {
  const runs = runsOf(result, show);
  // The last run may be the last reading alone, which lasted no time to speak of.
  const told = runs.map((run, at) => {
    const lasted = (runs[at + 1]?.from ?? result.elapsed) - run.from;
    return lasted > 0 ? `${run.said} for ${duration(lasted)}` : run.said;
  });
  const times = result.polls === 1 ? 'once' : `${result.polls} times`;
  return `read ${times}; it was ${told.join(', then ')}`;
}

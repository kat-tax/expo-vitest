/**
 * Waiting for the screen after a step, as e2e's `settle` and `transition` do:
 * after a press, a fill, typing, a key or an open, the next step waits until
 * the screen holds still; and a control that the last step brought in or
 * moved is given a moment to stop moving before it is pressed.
 *
 * Holding still means `samples` reads in a row agree, `settle` ms apart, which
 * on web costs nothing while the page is unchanged, since a read is then the
 * last one kept. A driver that waits by itself, as agent-device does with its
 * own `--settle`, is handed the times instead, so a device that takes a second
 * to read is not read twice more per step. A screen that never holds still,
 * such as one with a spinner, gives up after `settleTimeout` and the step
 * goes on, saying so.
 */
import type {Bounds, Point, Snapshot, SnapshotNode, Target} from './snapshot.ts';
import {asSelector, findNode, isPoint} from './snapshot.ts';
import type {Driver, FillOptions, LongPressOptions, PressOptions, ScrollIntoViewOptions, StepResult, StepTiming} from './types.ts';

export interface Timing {
  /** The gap between the reads that must agree after a step, in ms. 0 turns the wait off. */
  settle: number;
  /** How long a control the last step brought in or moved is given before it is pressed, in ms. 0 turns it off. */
  transition: number;
  /** How long a step waits for the screen to hold still before it goes on regardless, in ms. */
  settleTimeout: number;
  /** How many reads in a row must agree. */
  samples: number;
}

/** e2e's own numbers, and two reads, which is what agent-device asks after an open. */
export const DEFAULT_TIMING: Timing = {settle: 150, transition: 500, settleTimeout: 2000, samples: 2};

/** The timing for one step: the call's own `settle` and `transition` over the run's, `false` as 0, as e2e spells it. */
export function timingFor(base: Timing, options: {settle?: number | false; transition?: number | false} = {}): Timing {
  const pick = (value: number | false | undefined, otherwise: number): number => (value === undefined ? otherwise : value === false ? 0 : value);
  return {...base, settle: pick(options.settle, base.settle), transition: pick(options.transition, base.transition)};
}

function near(a: Bounds | null | undefined, b: Bounds | null | undefined, jitter: number): boolean {
  if (!a || !b) return !a && !b;
  return Math.abs(a.x - b.x) <= jitter && Math.abs(a.y - b.y) <= jitter && Math.abs(a.width - b.width) <= jitter && Math.abs(a.height - b.height) <= jitter;
}

/**
 * Whether two reads show the same screen: the same nodes in the same order,
 * each in the same state and within `jitter` px of the same place. Focus is
 * part of it, since the next step is often typing, and typing into the wrong
 * field is what the wait is for. Refs are not, since some platforms number
 * them afresh on every read.
 */
export function agree(a: Snapshot, b: Snapshot, jitter = 1): boolean {
  if (a.nodes.length !== b.nodes.length) return false;
  return a.nodes.every((node, at) => {
    const other = b.nodes[at] as SnapshotNode;
    return (
      node.role === other.role &&
      node.name === other.name &&
      node.testId === other.testId &&
      node.depth === other.depth &&
      node.interactive === other.interactive &&
      node.enabled === other.enabled &&
      node.offscreen === other.offscreen &&
      node.focused === other.focused &&
      near(node.bounds, other.bounds, jitter)
    );
  });
}

/** A node told apart without its ref: its role, name and testID, and which of the nodes alike it is. */
function placeOf(snapshot: Snapshot, node: SnapshotNode): {key: string; nth: number} {
  const key = `${node.role}\n${node.name}\n${node.testId ?? ''}`;
  let nth = 0;
  for (const each of snapshot.nodes) {
    if (each === node) break;
    if (`${each.role}\n${each.name}\n${each.testId ?? ''}` === key) nth++;
  }
  return {key, nth};
}

/** Whether `node`, as `after` shows it, was not in `before`, or was more than `moved` px from where it is now. */
export function appeared(before: Snapshot | null, after: Snapshot, node: SnapshotNode, moved = 8): boolean {
  if (!before) return false;
  const {key, nth} = placeOf(after, node);
  const alike = before.nodes.filter(each => `${each.role}\n${each.name}\n${each.testId ?? ''}` === key);
  const earlier = alike[nth];
  return !earlier || !near(earlier.bounds, node.bounds, moved);
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** The time as it passes, which a test swaps for one it moves itself. */
export const realClock: Clock = {now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms))};

/** Reads until `samples` reads in a row agree, `settle` ms apart, or `settleTimeout` passes. */
export async function settled(read: () => Promise<Snapshot>, timing: Timing, clock: Clock = realClock): Promise<{settled: boolean; last: Snapshot}> {
  const started = clock.now();
  let last = await read();
  let agreeing = 1;
  while (agreeing < timing.samples) {
    if (clock.now() - started + timing.settle > timing.settleTimeout) return {settled: false, last};
    await clock.sleep(timing.settle);
    const next = await read();
    agreeing = agree(last, next) ? agreeing + 1 : 1;
    last = next;
  }
  return {settled: true, last};
}

/**
 * A driver whose steps wait for the screen. Each step's own timing comes
 * from the options it was given over `timing`. Before a press or a fill, a
 * node the last step brought in or moved is given what is left of
 * `transition` since the screen held still; the trees for that are the ones
 * the wait already read, so it costs no read of its own.
 */
export function withTiming(driver: Driver, timing: Timing, clock: Clock = realClock): Driver {
  // The tree before the last step, the one it settled to, and when.
  let before: Snapshot | null = null;
  let after: Snapshot | null = null;
  let settledAt = 0;

  async function afterStep(result: StepResult, own: Timing): Promise<StepResult> {
    if (!result.ok || own.settle <= 0 || driver.settles) return result;
    before = after;
    const outcome = await settled(() => driver.snapshot(), own, clock);
    after = outcome.last;
    settledAt = clock.now();
    return outcome.settled ? result : {...result, message: `${result.message}; the screen was still changing after ${own.settleTimeout} ms`};
  }

  async function transition(target: Target, own: Timing): Promise<string> {
    const selector = asSelector(target);
    if (own.transition <= 0 || !after || isPoint(selector)) return '';
    const node = findNode(after, selector);
    if (!node || !appeared(before, after, node)) return '';
    const left = own.transition - (clock.now() - settledAt);
    if (left <= 0) return '';
    await clock.sleep(left);
    return `; it had just come in or moved, so the step waited ${left} ms first`;
  }

  /** What a driver that waits by itself is given: the times, and how many reads it should not make. */
  const handed = (own: Timing) => (driver.settles && own.settle > 0 ? {settle: own.settle, settleTimeout: own.settleTimeout} : {});

  return {
    ...driver,
    async open(to: string): Promise<StepResult> {
      return afterStep(await driver.open(to), timing);
    },
    async press(target: Target, options: PressOptions = {}): Promise<StepResult> {
      const own = timingFor(timing, options);
      const waited = await transition(target, own);
      const result = await driver.press(target, {...options, ...handed(own)});
      return afterStep(waited && result.ok ? {...result, message: result.message + waited} : result, own);
    },
    async fill(target: Target, text: string, options: FillOptions = {}): Promise<StepResult> {
      const own = timingFor(timing, options);
      const waited = await transition(target, own);
      const result = await driver.fill(target, text, {...options, ...handed(own)});
      return afterStep(waited && result.ok ? {...result, message: result.message + waited} : result, own);
    },
    async type(text: string): Promise<StepResult> {
      return afterStep(await driver.type(text, handed(timing)), timing);
    },
    ...(driver.key ? {key: async (name: string): Promise<StepResult> => afterStep(await (driver.key as (name: string) => Promise<StepResult>)(name), timing)} : {}),
    ...(driver.longPress
      ? {
          async longPress(target: Target, options: LongPressOptions = {}): Promise<StepResult> {
            const own = timingFor(timing, options);
            const waited = await transition(target, own);
            const result = await (driver.longPress as NonNullable<Driver['longPress']>)(target, {...options, ...handed(own)});
            return afterStep(waited && result.ok ? {...result, message: result.message + waited} : result, own);
          },
        }
      : {}),
    ...(driver.hover ? {hover: async (target: Target): Promise<StepResult> => afterStep(await (driver.hover as NonNullable<Driver['hover']>)(target), timing)} : {}),
    ...(driver.focus ? {focus: async (target: Target): Promise<StepResult> => afterStep(await (driver.focus as NonNullable<Driver['focus']>)(target), timing)} : {}),
    ...(driver.scrollIntoView
      ? {
          async scrollIntoView(target: Target, options: ScrollIntoViewOptions = {}): Promise<StepResult> {
            const own = timingFor(timing, options);
            return afterStep(await (driver.scrollIntoView as NonNullable<Driver['scrollIntoView']>)(target, {...options, ...handed(own)}), own);
          },
        }
      : {}),
    ...(driver.swipe
      ? {
          async swipe(from: Point, to: Point, options: StepTiming = {}): Promise<StepResult> {
            const own = timingFor(timing, options);
            return afterStep(await (driver.swipe as NonNullable<Driver['swipe']>)(from, to, {...options, ...handed(own)}), own);
          },
        }
      : {}),
  };
}

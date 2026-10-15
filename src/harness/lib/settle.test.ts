import {describe, expect, it, vi} from 'vitest';
import type {Clock, Timing} from './settle.ts';
import {DEFAULT_TIMING, agree, appeared, settled, timingFor, withTiming} from './settle.ts';
import type {Snapshot, SnapshotNode} from './snapshot.ts';
import type {Driver, StepResult} from './types.ts';
import {failed, ok} from './types.ts';

const node = (ref: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({
  ref,
  role: 'button',
  name,
  depth: 1,
  interactive: true,
  enabled: true,
  offscreen: false,
  focused: false,
  bounds: {x: 10, y: 10, width: 100, height: 40},
  ...extra,
});
const tree = (...nodes: SnapshotNode[]): Snapshot => ({platform: 'web', nodes});

/** A clock that moves only when something sleeps, so a test reads as the timeline it describes. */
function fakeClock(): Clock & {slept: number[]} {
  let now = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async ms => {
      slept.push(ms);
      now += ms;
    },
  };
}

describe('timingFor', () => {
  it('takes the call\'s own settle and transition over the run\'s, false as 0', () => {
    expect(timingFor(DEFAULT_TIMING)).toEqual(DEFAULT_TIMING);
    expect(timingFor(DEFAULT_TIMING, {settle: false, transition: 200})).toEqual({...DEFAULT_TIMING, settle: 0, transition: 200});
    expect(timingFor(DEFAULT_TIMING, {settle: 300})).toEqual({...DEFAULT_TIMING, settle: 300});
  });
});

describe('agree', () => {
  it('holds for the same screen read twice, whatever the refs, and within a pixel of jitter', () => {
    expect(agree(tree(node('@e1', 'Save')), tree(node('@e9', 'Save', {bounds: {x: 11, y: 9, width: 100, height: 41}})))).toBe(true);
    expect(agree(tree(node('@e1', 'Save', {bounds: null})), tree(node('@e1', 'Save', {bounds: null})))).toBe(true);
  });

  it('fails on another node, another state, another place, or a box come or gone', () => {
    const save = tree(node('@e1', 'Save'));
    expect(agree(save, tree())).toBe(false);
    expect(agree(save, tree(node('@e1', 'Cancel')))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {role: 'link'})))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {testId: 'save'})))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {depth: 2})))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {interactive: false})))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {enabled: false})))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {offscreen: true})))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {focused: true})))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {bounds: {x: 10, y: 60, width: 100, height: 40}})))).toBe(false);
    expect(agree(save, tree(node('@e1', 'Save', {bounds: null})))).toBe(false);
  });
});

describe('appeared', () => {
  const sheet = node('@e5', 'Done', {bounds: {x: 10, y: 400, width: 100, height: 40}});

  it('is false with nothing to compare with, and for a node that stayed within 8 px', () => {
    expect(appeared(null, tree(sheet), sheet)).toBe(false);
    expect(appeared(tree(node('@e2', 'Done', {bounds: {x: 10, y: 404, width: 100, height: 40}})), tree(sheet), sheet)).toBe(false);
  });

  it('is true for a node that was not there, or was further away', () => {
    expect(appeared(tree(node('@e1', 'Save')), tree(sheet), sheet)).toBe(true);
    expect(appeared(tree(node('@e2', 'Done', {bounds: {x: 10, y: 900, width: 100, height: 40}})), tree(sheet), sheet)).toBe(true);
  });

  it('tells nodes alike apart by their order', () => {
    const first = node('@e1', 'Delete', {bounds: {x: 10, y: 10, width: 100, height: 40}});
    const second = node('@e2', 'Delete', {bounds: {x: 10, y: 60, width: 100, height: 40}});
    expect(appeared(tree(first), tree(first, second), second)).toBe(true);
    expect(appeared(tree(first, second), tree(first, second), second)).toBe(false);
  });
});

describe('settled', () => {
  const timing: Timing = {...DEFAULT_TIMING, settle: 100, settleTimeout: 1000};

  it('is settled once two reads agree, a settle apart', async () => {
    const clock = fakeClock();
    const read = vi.fn(async () => tree(node('@e1', 'Save')));
    expect((await settled(read, timing, clock)).settled).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(clock.slept).toEqual([100]);
  });

  it('starts counting again when a read differs, and takes as many reads in a row as it is asked', async () => {
    const clock = fakeClock();
    const reads = [tree(node('@e1', 'Saving')), tree(node('@e1', 'Saved')), tree(node('@e1', 'Saved')), tree(node('@e1', 'Saved'))];
    const read = vi.fn(async () => reads.shift() as Snapshot);
    const outcome = await settled(read, {...timing, samples: 3}, clock);
    expect(outcome.settled).toBe(true);
    expect(outcome.last.nodes[0]?.name).toBe('Saved');
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('gives up when the screen never holds still', async () => {
    const clock = fakeClock();
    let tick = 0;
    const outcome = await settled(async () => tree(node('@e1', `Loading ${tick++}`)), timing, clock);
    expect(outcome.settled).toBe(false);
    expect(clock.now()).toBeLessThanOrEqual(1000);
  });
});

describe('withTiming', () => {
  const timing: Timing = {...DEFAULT_TIMING, settle: 100, transition: 500, settleTimeout: 1000};
  const home = tree(node('@e1', 'Open sheet'));
  const sheet = tree(node('@e1', 'Open sheet'), node('@e2', 'Done', {bounds: {x: 10, y: 400, width: 100, height: 40}}));

  function stub(screens: Snapshot[], overrides: Partial<Driver> = {}): Driver {
    let at = 0;
    return {
      platform: 'web',
      available: async () => ({ready: true}),
      open: async () => ok('opened'),
      snapshot: vi.fn(async () => screens[Math.min(at++, screens.length - 1)] as Snapshot),
      press: vi.fn(async (): Promise<StepResult> => ok('pressed')),
      fill: vi.fn(async (): Promise<StepResult> => ok('filled')),
      type: vi.fn(async (): Promise<StepResult> => ok('typed')),
      screenshot: async () => ok('saved'),
      idleSeconds: async () => null,
      close: async () => {},
      ...overrides,
    };
  }

  it('waits after a step until the screen holds still, and says so when it never does', async () => {
    const steady = stub([home]);
    expect((await withTiming(steady, timing, fakeClock()).open('/')).message).toBe('opened');
    expect(steady.snapshot).toHaveBeenCalledTimes(2);
    let tick = 0;
    const spinning = stub([], {snapshot: async () => tree(node('@e1', `Loading ${tick++}`))});
    expect((await withTiming(spinning, timing, fakeClock()).press('@e1')).message).toBe('pressed; the screen was still changing after 1000 ms');
  });

  it('does not wait after a step that failed, or when told not to', async () => {
    const driver = stub([home], {press: async () => failed('nothing matches label="Save"', 'LOCATOR_NOT_FOUND')});
    const timed = withTiming(driver, timing, fakeClock());
    expect((await timed.press('label="Save"')).code).toBe('LOCATOR_NOT_FOUND');
    expect(await timed.fill('@e1', 'Ada', {settle: false})).toEqual(ok('filled'));
    expect(driver.snapshot).not.toHaveBeenCalled();
  });

  it('gives a control the last step brought in what is left of the transition, from trees it already read', async () => {
    const clock = fakeClock();
    const driver = stub([home, home, sheet, sheet]);
    const timed = withTiming(driver, timing, clock);
    await timed.open('/');
    await timed.press('label="Open sheet"');
    // The sheet held still at 200 ms; the press on its button comes then, so it waits the other 500.
    expect((await timed.press('label="Done"')).message).toBe('pressed; it had just come in or moved, so the step waited 500 ms first');
    expect(driver.snapshot).toHaveBeenCalledTimes(6);
  });

  it('gives a field the last step brought in the same wait before a fill', async () => {
    const timed = withTiming(stub([home, home, sheet, sheet]), timing, fakeClock());
    await timed.open('/');
    await timed.press('label="Open sheet"');
    expect((await timed.fill('label="Done"', 'x')).message).toBe('filled; it had just come in or moved, so the step waited 500 ms first');
  });

  it('presses straight away on what was already there, on a point, on what it cannot find, and once the transition has passed', async () => {
    const clock = fakeClock();
    const timed = withTiming(stub([home, home, sheet, sheet, sheet]), timing, clock);
    expect((await timed.press('label="Open sheet"')).message).toBe('pressed');
    await timed.open('/');
    await clock.sleep(600);
    expect((await timed.fill('label="Done"', 'x', {transition: 500})).message).toBe('filled');
    expect((await timed.press('label="Open sheet"')).message).toBe('pressed');
    expect((await timed.press({x: 20, y: 400})).message).toBe('pressed');
    expect((await timed.press('label="Gone"')).message).toBe('pressed');
  });

  it('keeps real time when given no clock', async () => {
    const outcome = await settled(async () => home, {...timing, settle: 1, settleTimeout: 1000});
    expect(outcome.settled).toBe(true);
    expect((await withTiming(stub([home]), {...timing, settle: 1}).type('Ada')).message).toBe('typed');
  });

  it('hands a driver that waits by itself the times, and reads nothing itself', async () => {
    const driver = stub([home], {settles: true});
    const timed = withTiming(driver, timing, fakeClock());
    await timed.press('@e1', {via: 'pointer'});
    expect(driver.press).toHaveBeenCalledWith('@e1', {via: 'pointer', settle: 100, settleTimeout: 1000});
    await timed.fill('@e1', 'Ada', {settle: false});
    expect(driver.fill).toHaveBeenCalledWith('@e1', 'Ada', {settle: false});
    await timed.type('Ada');
    expect(driver.type).toHaveBeenCalledWith('Ada', {settle: 100, settleTimeout: 1000});
    expect(driver.snapshot).not.toHaveBeenCalled();
  });

  it('waits after a key where the driver has keys, and has none where it has not', async () => {
    const key = vi.fn(async (): Promise<StepResult> => ok('pressed ArrowDown'));
    const keyed = withTiming(stub([home], {key}), timing, fakeClock());
    expect(await keyed.key?.('ArrowDown')).toEqual(ok('pressed ArrowDown'));
    expect('key' in withTiming(stub([home]), timing, fakeClock())).toBe(false);
  });

  it('waits after each action a driver may have, gives a long press the transition, and has none the driver has not', async () => {
    const longPress = vi.fn(async (): Promise<StepResult> => ok('held'));
    const hover = vi.fn(async (): Promise<StepResult> => ok('hovered'));
    const focus = vi.fn(async (): Promise<StepResult> => ok('focused'));
    const scrollIntoView = vi.fn(async (): Promise<StepResult> => ok('scrolled'));
    const swipe = vi.fn(async (): Promise<StepResult> => ok('swiped'));
    const driver = stub([home, home, sheet, sheet], {longPress, hover, focus, scrollIntoView, swipe});
    const timed = withTiming(driver, timing, fakeClock());
    await timed.open('/');
    await timed.press('label="Open sheet"');
    expect((await timed.longPress?.('label="Done"', {duration: 900}))?.message).toBe('held; it had just come in or moved, so the step waited 500 ms first');
    expect(longPress).toHaveBeenCalledWith('label="Done"', {duration: 900});
    expect((await timed.longPress?.('label="Done"'))?.message).toBe('held');
    expect(await timed.hover?.('@e1')).toEqual(ok('hovered'));
    expect(await timed.focus?.('@e1')).toEqual(ok('focused'));
    expect(await timed.scrollIntoView?.('@e2', {direction: 'up'})).toEqual(ok('scrolled'));
    expect(scrollIntoView).toHaveBeenCalledWith('@e2', {direction: 'up'});
    expect(await timed.scrollIntoView?.('@e2')).toEqual(ok('scrolled'));
    expect(await timed.swipe?.({x: 50, y: 500}, {x: 50, y: 100}, {settle: false})).toEqual(ok('swiped'));
    expect(await timed.swipe?.({x: 50, y: 500}, {x: 50, y: 100})).toEqual(ok('swiped'));
    expect(swipe).toHaveBeenCalledWith({x: 50, y: 500}, {x: 50, y: 100}, {settle: false});
    const bare = withTiming(stub([home]), timing, fakeClock());
    for (const name of ['longPress', 'hover', 'focus', 'scrollIntoView', 'swipe']) expect(name in bare, name).toBe(false);
  });

  it('hands a driver that waits by itself the times for a long press, a scroll and a swipe', async () => {
    const longPress = vi.fn(async (): Promise<StepResult> => ok('held'));
    const scrollIntoView = vi.fn(async (): Promise<StepResult> => ok('scrolled'));
    const swipe = vi.fn(async (): Promise<StepResult> => ok('swiped'));
    const timed = withTiming(stub([home], {settles: true, longPress, scrollIntoView, swipe}), timing, fakeClock());
    await timed.longPress?.('@e1');
    expect(longPress).toHaveBeenCalledWith('@e1', {settle: 100, settleTimeout: 1000});
    await timed.scrollIntoView?.('@e1');
    expect(scrollIntoView).toHaveBeenCalledWith('@e1', {settle: 100, settleTimeout: 1000});
    await timed.swipe?.({x: 1, y: 2}, {x: 3, y: 4});
    expect(swipe).toHaveBeenCalledWith({x: 1, y: 2}, {x: 3, y: 4}, {settle: 100, settleTimeout: 1000});
  });
});

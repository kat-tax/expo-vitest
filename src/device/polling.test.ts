import {describe, expect, it, vi} from 'vitest';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import type {Clock} from '../harness/lib/settle.ts';
import type {PollOptions, PollResult, SnapshotFeed} from './polling.ts';
import type {Driver} from '../harness/lib/types.ts';
import {ok} from '../harness/lib/types.ts';
import {DEFAULT_POLLING, describeReadings, duration, gapAfter, invalidating, poll, snapshotFeed} from './polling.ts';

/** A clock that moves only when something sleeps. */
function fakeClock(): Clock & {at: number} {
  const clock = {at: 0, now: () => clock.at, sleep: async (ms: number) => void (clock.at += ms)};
  return clock;
}

const spinner: SnapshotNode = {ref: '@e1', role: 'progressbar', name: 'Loading', depth: 0, interactive: false};

/** A feed whose screen shows the spinner while `showing` says so, at the clock's time. */
function screenOver(clock: Clock, showing: (at: number) => boolean): SnapshotFeed {
  return {next: async () => ({platform: 'web', nodes: showing(clock.now()) ? [spinner] : []}), invalidate: () => {}};
}

const visible = (snapshot: Snapshot) => snapshot.nodes.length > 0;
const options = (clock: Clock, feed: SnapshotFeed, extra: Partial<PollOptions> = {}): PollOptions => ({timeout: 5000, stable: 1000, negated: false, feed, clock, ...extra});
const times = (result: PollResult<unknown>) => result.readings.map(reading => reading.at);

describe('the schedule', () => {
  it("is e2e's five seconds and one, and gaps growing by half from 100 ms to 400", () => {
    expect(DEFAULT_POLLING).toEqual({assertionTimeout: 5000, stable: 1000});
    expect([1, 2, 3, 4, 5, 6, 7].map(gapAfter)).toEqual([100, 150, 225, 338, 400, 400, 400]);
  });
});

describe('snapshotFeed', () => {
  it('lets a request join the snapshot being taken, and answers one just after with the same', async () => {
    const clock = fakeClock();
    const read = vi.fn(async () => ({platform: 'web', nodes: []}) as Snapshot);
    const feed = snapshotFeed(read, {clock});
    const [one, two] = await Promise.all([feed.next(), feed.next()]);
    expect(one).toBe(two);
    clock.at = 49;
    expect(await feed.next()).toBe(one);
    expect(read).toHaveBeenCalledTimes(1);
    clock.at = 50;
    expect(await feed.next()).not.toBe(one);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads afresh after an action, even what was being read when it came', async () => {
    const clock = fakeClock();
    const pending: ((snapshot: Snapshot) => void)[] = [];
    const read = vi.fn(() => new Promise<Snapshot>(resolve => pending.push(resolve)));
    const feed = snapshotFeed(read, {clock});
    const before = feed.next();
    pending[0]?.({platform: 'web', nodes: []});
    await before;
    feed.invalidate();
    // A read under way when an action comes is neither joined nor kept.
    const during = feed.next();
    feed.invalidate();
    const after = feed.next();
    expect(read).toHaveBeenCalledTimes(3);
    pending[2]?.({platform: 'web', nodes: [spinner]});
    expect((await after).nodes).toEqual([spinner]);
    pending[1]?.({platform: 'web', nodes: []});
    expect((await during).nodes).toEqual([]);
    expect((await feed.next()).nodes).toEqual([spinner]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('reads the real time by default', async () => {
    const read = vi.fn(async () => ({platform: 'web', nodes: []}) as Snapshot);
    const feed = snapshotFeed(read);
    await feed.next();
    await feed.next();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('invalidating', () => {
  it('tells the feed after each action, whether it worked or threw, and leaves the reads as they were', async () => {
    const invalidate = vi.fn();
    const feed: SnapshotFeed = {next: async () => ({platform: 'web', nodes: []}), invalidate};
    const driver = {
      platform: 'web',
      available: async () => ({ready: true}),
      open: async () => ok('opened'),
      snapshot: async () => ({platform: 'web', nodes: []}),
      press: async () => ok('pressed'),
      fill: async () => {
        throw new Error('no field');
      },
      type: async () => ok('typed'),
      screenshot: async () => ok('saved'),
      idleSeconds: async () => null,
      close: async () => {},
    } satisfies Driver;
    const told = invalidating(driver, feed);
    expect(told.snapshot).toBe(driver.snapshot);
    expect(told.key).toBeUndefined();
    expect(await told.press('@e1')).toEqual(ok('pressed'));
    await expect(told.fill('@e1', 'x')).rejects.toThrow('no field');
    await told.open('/');
    await told.type('x');
    await told.screenshot('x.png');
    expect(invalidate).toHaveBeenCalledTimes(4);
    const controlled = invalidating({...driver, control: async () => ok('restarted')}, feed);
    expect(await controlled.control?.({name: 'restart'})).toEqual(ok('restarted'));
    expect(invalidate).toHaveBeenCalledTimes(5);
  });
});

describe('poll', () => {
  it('passes on the first reading that says so, which is taken at once', async () => {
    const clock = fakeClock();
    const now = await poll(visible, shown => shown, options(clock, screenOver(clock, () => true)));
    expect(now).toMatchObject({pass: true, polls: 1, last: true, elapsed: 0});
    clock.at = 0;
    const later = await poll(visible, shown => shown, options(clock, screenOver(clock, at => at >= 400)));
    expect(later).toMatchObject({pass: true, polls: 4, elapsed: 475});
    expect(times(later)).toEqual([0, 100, 250, 475]);
  });

  it('reads until the time is up, the last reading at the deadline, and fails', async () => {
    const clock = fakeClock();
    const result = await poll(visible, shown => shown, options(clock, screenOver(clock, () => false), {timeout: 1000}));
    expect(result).toMatchObject({pass: false, last: false, elapsed: 1000});
    expect(times(result)).toEqual([0, 100, 250, 475, 813, 1000]);
  });

  it('passes a negated wait once its condition has held for the stable time, as the plan works it through', async () => {
    const clock = fakeClock();
    const result = await poll(visible, shown => shown, options(clock, screenOver(clock, at => at >= 100 && at < 900), {negated: true}));
    expect(times(result)).toEqual([0, 100, 250, 475, 813, 1213, 1613, 2013, 2213]);
    expect(result).toMatchObject({pass: true, polls: 9, elapsed: 2213});
  });

  it('fails a negated wait whose condition never holds long enough, and holds one no longer than the timeout', async () => {
    const clock = fakeClock();
    const flicker = await poll(visible, shown => shown, options(clock, screenOver(clock, at => Math.floor(at / 300) % 2 === 1), {negated: true, timeout: 2000}));
    expect(flicker.pass).toBe(false);
    clock.at = 0;
    const short = await poll(visible, shown => shown, options(clock, screenOver(clock, () => false), {negated: true, timeout: 300}));
    expect(short).toMatchObject({pass: true, elapsed: 300});
  });

  it('reads at a fixed gap when given one, and stops when the signal is aborted', async () => {
    const clock = fakeClock();
    const fixed = await poll(visible, shown => shown, options(clock, screenOver(clock, () => false), {timeout: 200, interval: 50}));
    expect(times(fixed)).toEqual([0, 50, 100, 150, 200]);
    clock.at = 0;
    const controller = new AbortController();
    controller.abort();
    const stopped = await poll(visible, shown => shown, options(clock, screenOver(clock, () => false), {signal: controller.signal}));
    expect(stopped).toMatchObject({pass: false, polls: 1});
  });

  it('waits on the real clock by default', async () => {
    const feed: SnapshotFeed = {next: async () => ({platform: 'web', nodes: []}), invalidate: () => {}};
    const result = await poll(visible, shown => shown, {timeout: 0, stable: 0, negated: false, feed});
    expect(result).toMatchObject({pass: false, polls: 1});
  });
});

describe('the readings, in words', () => {
  it('says a length of time in ms below a second and in seconds above', () => {
    expect(duration(120)).toBe('120 ms');
    expect(duration(1234)).toBe('1.2 s');
  });

  it('says each run of the same value with how long it lasted', async () => {
    const clock = fakeClock();
    const result = await poll(visible, shown => shown, options(clock, screenOver(clock, at => at >= 813), {timeout: 1500, negated: true, stable: 5000}));
    expect(describeReadings(result, shown => (shown ? 'shown' : 'gone'))).toBe('read 7 times; it was gone for 813 ms, then shown for 687 ms');
    clock.at = 0;
    const once = await poll(visible, shown => shown, options(clock, screenOver(clock, () => true)));
    expect(describeReadings(once, shown => (shown ? 'shown' : 'gone'))).toBe('read once; it was shown');
  });
});

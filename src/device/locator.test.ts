import {describe, expect, it, vi} from 'vitest';
import type {Clock} from '../harness/lib/settle.ts';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import type {Driver, Platform, StepResult} from '../harness/lib/types.ts';
import {failed, ok} from '../harness/lib/types.ts';
import type {LocatorHost} from './locator.ts';
import {Locator, follow, targetFor} from './locator.ts';
import {DEFAULT_POLLING} from './polling.ts';
import type {LocatorQuery, Predicate, QueryOptions, TextMatch} from './queries.ts';

function fakeClock(): Clock & {at: number} {
  const clock = {at: 0, now: () => clock.at, sleep: async (ms: number) => void (clock.at += ms)};
  return clock;
}

const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: true, ...extra});
const query = (predicate: Predicate, match: TextMatch, options: QueryOptions = {}, cardinality: 'one' | 'many' = 'one'): LocatorQuery => ({predicate, match, options, refinements: [], cardinality});

/** A device whose screen is whatever `screen` says at the clock's time, and a driver that does what a test tells it. */
function rig(screen: (at: number) => SnapshotNode[], overrides: Partial<Driver> = {}, platform: Platform = 'web') {
  const clock = fakeClock();
  const snapshot = async (): Promise<Snapshot> => ({platform, nodes: screen(clock.now())});
  const driver = {
    platform,
    available: async () => ({ready: true}),
    open: async () => ok('opened'),
    snapshot,
    press: vi.fn(async (): Promise<StepResult> => ok('pressed')),
    fill: vi.fn(async (): Promise<StepResult> => ok('filled')),
    type: vi.fn(async (): Promise<StepResult> => ok('typed')),
    screenshot: async () => ok('saved'),
    idleSeconds: async () => null,
    close: async () => {},
    ...overrides,
  } satisfies Driver;
  const host: LocatorHost = {platform, ready: async () => driver, feed: {next: snapshot, invalidate: () => {}}, polling: DEFAULT_POLLING, clock};
  const locate = (asked: LocatorQuery) => new Locator(host, asked);
  return {clock, driver, host, locate};
}

/** A thrown harness failure, matched on its code and its message. */
const failure = (code: string, message: string | RegExp) => expect.objectContaining({name: 'HarnessError', code, message: typeof message === 'string' ? message : expect.stringMatching(message)});

const save = node('@e2', 'button', 'Save', {kind: 'button', testId: 'save', bounds: {x: 10, y: 20, width: 80, height: 40}});
const cancel = node('@e3', 'button', 'Cancel', {kind: 'button'});

describe('targetFor', () => {
  it('points at the node by its ref on every platform but Windows, and at one that has a pattern to press there', () => {
    const text = node('@e2', 'Text', 'Save', {parent: '@e1', interactive: false});
    expect(targetFor(text, {platform: 'web', nodes: [node('@e1', 'Button', 'Save', {patterns: ['Invoke']}), text]})).toEqual({ref: '@e2'});
    const invoke = node('@e1', 'Button', 'Save', {patterns: ['Invoke', 'ScrollItem']});
    expect(targetFor(invoke, {platform: 'windows', nodes: [invoke]})).toEqual({ref: '@e1'});
  });

  it('presses a Windows text through the nearest control it sits in, where that control has Invoke', () => {
    const button = node('@e1', 'Button', 'Save', {patterns: ['Invoke', 'ScrollItem']});
    const group = node('@e2', 'Group', '', {parent: '@e1', interactive: false});
    const text = node('@e3', 'Text', 'Save', {parent: '@e2', interactive: false, patterns: ['ScrollItem']});
    expect(targetFor(text, {platform: 'windows', nodes: [button, group, text]})).toEqual({ref: '@e1'});
    const plain = node('@e1', 'Button', 'Save', {patterns: ['ScrollItem']});
    expect(targetFor(text, {platform: 'windows', nodes: [plain, group, text]})).toEqual({ref: '@e3'});
  });

  it('presses the text itself where nothing it sits in is a control, and on a loop of parents or one not in the tree', () => {
    const alone = node('@e1', 'Text', 'Save', {interactive: false});
    expect(targetFor(alone, {platform: 'windows', nodes: [alone]})).toEqual({ref: '@e1'});
    const lost = node('@e1', 'Text', 'Save', {parent: '@e9', interactive: false});
    expect(targetFor(lost, {platform: 'windows', nodes: [lost]})).toEqual({ref: '@e1'});
    const top = node('@e1', 'Group', '', {interactive: false});
    const under = node('@e2', 'Text', 'Save', {parent: '@e1', interactive: false});
    expect(targetFor(under, {platform: 'windows', nodes: [top, under]})).toEqual({ref: '@e2'});
    const a = node('@e1', 'Group', '', {parent: '@e2', interactive: false});
    const b = node('@e2', 'Group', '', {parent: '@e1', interactive: false});
    const text = node('@e3', 'Text', 'Save', {parent: '@e1', interactive: false});
    expect(targetFor(text, {platform: 'windows', nodes: [a, b, text]})).toEqual({ref: '@e3'});
  });
});

describe('follow', () => {
  const before: Snapshot = {platform: 'android', nodes: [node('@e1', 'switch', 'Wi-Fi'), node('@e2', 'switch', 'Wi-Fi', {checked: false})]};

  it('finds a node again by its ref where the ref still names it, else in the same place among those alike', () => {
    const kept = {platform: 'web', nodes: [node('@e1', 'switch', 'Wi-Fi'), node('@e2', 'switch', 'Wi-Fi', {checked: true})]};
    expect(follow(before.nodes[1] as SnapshotNode, before, kept)?.checked).toBe(true);
    const renumbered = {platform: 'android', nodes: [node('@e5', 'text', 'Network'), node('@e6', 'switch', 'Wi-Fi'), node('@e2', 'text', 'Wi-Fi'), node('@e7', 'switch', 'Wi-Fi', {checked: true})]};
    expect(follow(before.nodes[1] as SnapshotNode, before, renumbered)?.ref).toBe('@e7');
  });

  it('finds nothing for a node that was not in the first snapshot, or is not in the second', () => {
    expect(follow(node('@e9', 'switch', 'Bluetooth'), before, before)).toBeUndefined();
    expect(follow(before.nodes[1] as SnapshotNode, before, {platform: 'android', nodes: [node('@e1', 'switch', 'Wi-Fi')]})).toBeUndefined();
  });
});

describe('a locator', () => {
  it('reads as its query, resolves against a snapshot, and refines into a new locator each time', () => {
    const {locate} = rig(() => []);
    const buttons = locate(query('role', 'button', {}, 'many'));
    const tree: Snapshot = {platform: 'web', nodes: [save, cancel]};
    expect(String(buttons)).toBe('getAllByRole("button")');
    expect(buttons.resolve(tree)).toEqual([save, cancel]);
    expect(buttons.first().resolve(tree)).toEqual([save]);
    expect(buttons.last().resolve(tree)).toEqual([cancel]);
    expect(buttons.nth(1).resolve(tree)).toEqual([cancel]);
    expect(buttons.filter({hasText: 'canc'}).resolve(tree)).toEqual([cancel]);
    expect(String(buttons.filter({hasText: 'Save', has: locate(query('text', 'Save'))}))).toBe('getAllByRole("button").filter({hasText: "Save"}).filter({has: getByText("Save")})');
    expect(buttons.filter({}).query).toEqual(buttons.query);
  });
});

describe('an action', () => {
  it('waits for its node, then presses it by ref with the options it was given but the timeout', async () => {
    const {clock, driver, locate} = rig(at => (at >= 300 ? [save] : []));
    await locate(query('role', 'button', {name: 'Save'})).press({timeout: 1000, via: 'pointer'});
    expect(clock.at).toBe(475);
    expect(driver.press).toHaveBeenCalledWith({ref: '@e2'}, {via: 'pointer'});
  });

  it('keeps the real time on a device that names no clock of its own', async () => {
    const {driver, host} = rig(() => [save]);
    await new Locator({...host, clock: undefined}, query('testId', 'save')).press();
    expect(driver.press).toHaveBeenCalledWith({ref: '@e2'}, {});
  });

  it('is ambiguous at once when the query names several, and lists them', async () => {
    const {clock, locate} = rig(() => [save, {...cancel, name: 'Save'}]);
    await expect(locate(query('role', 'button', {name: 'Save'})).press()).rejects.toThrow(
      failure('LOCATOR_AMBIGUOUS', 'getByRole("button", {name: "Save"}) matches 2 nodes; narrow it with first(), nth() or filter(), or use getAllByRole:\n  @e2   button "Save" #save  at 10,20\n  @e3   button "Save"'),
    );
    expect(clock.at).toBe(0);
  });

  it('says what it found instead when its node never comes', async () => {
    const {clock, locate} = rig(() => [save, cancel]);
    await expect(locate(query('role', 'button', {name: 'Delete'})).press()).rejects.toThrow(
      failure('LOCATOR_NOT_FOUND', 'getByRole("button", {name: "Delete"}) matched nothing within 5.0 s; the tree has 2 nodes; 2 nodes have role button: "Save", "Cancel"'),
    );
    expect(clock.at).toBe(5000);
  });

  it('waits for a disabled node to be enabled, and says so when it never is', async () => {
    const enabling = rig(at => [{...save, enabled: at >= 200}]);
    await enabling.locate(query('testId', 'save')).press();
    expect(enabling.driver.press).toHaveBeenCalledTimes(1);
    const stuck = rig(() => [{...save, enabled: false}]);
    await expect(stuck.locate(query('testId', 'save')).press({timeout: 500})).rejects.toThrow(failure('NOT_ACTIONABLE', 'getByTestId("save") found @e2   button "Save" #save  at 10,20, and it stayed disabled for 500 ms'));
  });

  it("passes on the driver's failure with its code, or ACTION_FAILED", async () => {
    const coded = rig(() => [save], {press: vi.fn(async () => failed('@e2 is covered', 'NOT_ACTIONABLE'))});
    await expect(coded.locate(query('testId', 'save')).press()).rejects.toThrow(failure('NOT_ACTIONABLE', '@e2 is covered'));
    const plain = rig(() => [save], {press: vi.fn(async () => ({ok: false, message: 'press failed'}))});
    await expect(plain.locate(query('testId', 'save')).press()).rejects.toThrow(failure('ACTION_FAILED', 'press failed'));
  });

  it('fills and clears a field by ref, and types after pressing it', async () => {
    const field = node('@e4', 'input', 'Email', {kind: 'textbox', testId: 'email'});
    const {driver, locate} = rig(() => [field]);
    const email = locate(query('testId', 'email'));
    await email.fill('a@b.c', {via: 'keys', timeout: 100});
    expect(driver.fill).toHaveBeenLastCalledWith({ref: '@e4'}, 'a@b.c', {via: 'keys'});
    await email.clear();
    expect(driver.fill).toHaveBeenLastCalledWith({ref: '@e4'}, '', {});
    await email.type(' more');
    expect(driver.press).toHaveBeenLastCalledWith({ref: '@e4'});
    expect(driver.type).toHaveBeenLastCalledWith(' more');
  });
});

describe('check and uncheck', () => {
  /** A switch that a press flips, or does not when `stuck`. */
  function toggle(start: boolean | 'mixed' | undefined, {stuck = false, vanish = false} = {}) {
    let checked = start;
    let gone = false;
    const made = rig(() => (gone ? [] : [node('@e1', 'switch', 'Wi-Fi', {kind: 'switch', ...(checked === undefined ? {} : {checked})})]), {
      press: vi.fn(async () => {
        if (vanish) gone = true;
        else if (!stuck) checked = checked !== true;
        return ok('pressed');
      }),
    });
    return {...made, wifi: made.locate(query('role', 'switch', {name: 'Wi-Fi'}))};
  }

  it('presses only a control not already as asked, and reads it back', async () => {
    const on = toggle(true);
    await on.wifi.check();
    expect(on.driver.press).not.toHaveBeenCalled();
    const off = toggle(false);
    await off.wifi.check();
    expect(off.driver.press).toHaveBeenCalledTimes(1);
    await off.wifi.uncheck({timeout: 300});
    expect(off.driver.press).toHaveBeenCalledTimes(2);
    const mixed = toggle('mixed');
    await mixed.wifi.check();
    expect(mixed.driver.press).toHaveBeenCalledTimes(1);
  });

  it('fails where the control has no state to set, the press changed nothing, or the control went', async () => {
    await expect(toggle(undefined).wifi.check()).rejects.toThrow(failure('NOT_ACTIONABLE', '@e1   switch "Wi-Fi" reports no checked state, so there is nothing to check'));
    await expect(toggle(false, {stuck: true}).wifi.check({timeout: 200})).rejects.toThrow(failure('ACTION_FAILED', 'pressed @e1   switch "Wi-Fi" to check it, and it is still unchecked'));
    await expect(toggle('mixed', {stuck: true}).wifi.uncheck({timeout: 200})).rejects.toThrow(failure('ACTION_FAILED', 'pressed @e1   switch "Wi-Fi" to uncheck it, and it is still mixed'));
    await expect(toggle(true, {stuck: true}).wifi.uncheck({timeout: 200})).rejects.toThrow(failure('ACTION_FAILED', 'pressed @e1   switch "Wi-Fi" to uncheck it, and it is still checked'));
    await expect(toggle(false, {vanish: true}).wifi.check({timeout: 200})).rejects.toThrow(failure('ACTION_FAILED', 'pressed @e1   switch "Wi-Fi" to check it, and it is gone'));
  });
});

describe('waitFor', () => {
  const offscreen = {...save, offscreen: true};

  it('waits for a node on screen by default, and one in the tree at all when attached is enough', async () => {
    const {locate} = rig(at => (at >= 250 ? [save] : [offscreen]));
    expect(await locate(query('testId', 'save')).waitFor()).toEqual(save);
    const hidden = rig(() => [offscreen]);
    expect(await hidden.locate(query('testId', 'save')).waitFor({state: 'attached'})).toEqual(offscreen);
    await expect(hidden.locate(query('testId', 'save')).waitFor({timeout: 300})).rejects.toThrow(failure('LOCATOR_NOT_FOUND', /^getByTestId\("save"\) matched nothing within 300 ms; the tree has 1 nodes/));
  });

  it('waits for a node to be gone, and to stay gone for the stable time', async () => {
    const leaving = rig(at => (at < 400 ? [save] : at < 700 ? [offscreen] : []));
    expect(await leaving.locate(query('testId', 'save')).waitFor({state: 'hidden'})).toBeNull();
    expect(leaving.clock.at).toBe(1475);
    leaving.clock.at = 0;
    expect(await leaving.locate(query('testId', 'save')).waitFor({state: 'detached'})).toBeNull();
    expect(leaving.clock.at).toBeGreaterThanOrEqual(1700);
  });

  it('says what it read when the node never goes', async () => {
    const {locate} = rig(at => (at < 300 ? [] : [save]));
    await expect(locate(query('testId', 'save')).waitFor({state: 'hidden', timeout: 1000})).rejects.toThrow(
      failure('ASSERTION_FAILED', 'getByTestId("save") was not hidden within 1.0 s: read 6 times; it was gone for 475 ms, then there (@e2   button "Save" #save  at 10,20) for 525 ms'),
    );
  });

  it('is ambiguous on several when it wants one', async () => {
    const {locate} = rig(() => [save, {...cancel, testId: 'save'}]);
    await expect(locate(query('testId', 'save')).waitFor()).rejects.toThrow(failure('LOCATOR_AMBIGUOUS', /^getByTestId\("save"\) matches 2 nodes/));
    expect(await locate(query('testId', 'save', {}, 'many')).first().waitFor()).toEqual(save);
  });
});

describe('the reads', () => {
  it('give the node now, all of them, and how many, without waiting', async () => {
    const {clock, locate} = rig(() => [save, cancel]);
    expect(await locate(query('testId', 'save')).node()).toEqual(save);
    expect(await locate(query('testId', 'gone')).node()).toBeUndefined();
    await expect(locate(query('role', 'button')).node()).rejects.toThrow(failure('LOCATOR_AMBIGUOUS', /matches 2 nodes/));
    expect(await locate(query('role', 'button', {}, 'many')).all()).toEqual([save, cancel]);
    expect(await locate(query('role', 'button', {}, 'many')).count()).toBe(2);
    expect(clock.at).toBe(0);
  });

  it('give its name as a role is named, and fail at once where there is no node', async () => {
    const row = node('@e1', 'android.view.ViewGroup', '', {kind: 'group'});
    const title = node('@e2', 'android.widget.TextView', 'Wi-Fi', {kind: 'text', parent: '@e1', interactive: false});
    const {locate} = rig(() => [row, title], {}, 'android');
    expect(await locate(query('role', 'group')).text()).toBe('Wi-Fi');
    await expect(locate(query('role', 'switch')).text()).rejects.toThrow(failure('LOCATOR_NOT_FOUND', /^getByRole\("switch"\) matched nothing within 0 ms/));
  });

  it("give a field's value, whether the node is on screen, and its box", async () => {
    const field = node('@e4', 'input', 'Email', {testId: 'email', value: 'a@b.c'});
    const below = node('@e5', 'input', 'Notes', {testId: 'notes', offscreen: true});
    const {locate} = rig(() => [field, below, save]);
    expect(await locate(query('testId', 'email')).value()).toBe('a@b.c');
    expect(await locate(query('testId', 'gone')).value()).toBeUndefined();
    expect(await locate(query('testId', 'email')).isVisible()).toBe(true);
    expect(await locate(query('testId', 'notes', {hidden: true})).isVisible()).toBe(false);
    expect(await locate(query('testId', 'gone')).isVisible()).toBe(false);
    expect(await locate(query('testId', 'save')).boundingBox()).toEqual({x: 10, y: 20, width: 80, height: 40});
    expect(await locate(query('testId', 'email')).boundingBox()).toBeNull();
    expect(await locate(query('testId', 'gone')).boundingBox()).toBeNull();
  });
});

import {describe, expect, it, vi} from 'vitest';
import type {Clock} from '../harness/lib/settle.ts';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import type {Driver, Platform, StepResult} from '../harness/lib/types.ts';
import {failed, ok} from '../harness/lib/types.ts';
import type {LocatorHost} from './locator.ts';
import {Journal} from './evidence.ts';
import {checkCount, Locator, selectorOf, swipePath, targetFor} from './locator.ts';
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

  it('presses twice in quick succession as one press, a double press, where it is asked to', async () => {
    const {driver, locate} = rig(() => [save]);
    await locate(query('testId', 'save')).press({count: 2});
    expect(driver.press).toHaveBeenCalledWith({ref: '@e2'}, {count: 2});
  });

  it('refuses a count that is not a whole number, 1 or more, before it looks', async () => {
    const {driver, locate} = rig(() => [save]);
    for (const count of [0, 1.5, -1, Number.NaN]) {
      await expect(locate(query('testId', 'save')).press({count})).rejects.toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT', message: `press takes count as a whole number, 1 or more; it was given ${count}`}));
    }
    expect(driver.press).not.toHaveBeenCalled();
    expect(checkCount({count: 3}, 'ios')).toEqual({count: 3});
    expect(() => checkCount({count: 0}, 'ios')).toThrow(expect.objectContaining({platform: 'ios'}));
  });

  it('drags its node to the node another locator names, both from one tree', async () => {
    const drag = vi.fn(async (): Promise<StepResult> => ok('dragged'));
    const {driver, locate} = rig(() => [save, cancel], {drag});
    await locate(query('testId', 'save')).dragTo(locate(query('role', 'button', {name: 'Cancel'})), {hold: 800, timeout: 1000});
    expect(driver.drag).toHaveBeenCalledWith({ref: '@e2'}, {ref: '@e3'}, {hold: 800});
  });

  it('cannot drag where the platform has no drag, or to a node the tree no longer holds', async () => {
    const {locate} = rig(() => [save, cancel]);
    await expect(locate(query('testId', 'save')).dragTo(locate(query('role', 'button', {name: 'Cancel'})))).rejects.toThrow(expect.objectContaining({code: 'UNSUPPORTED_CAPABILITY', message: 'a drag is not something the web harness can do'}));
    let reads = 0;
    const gone = rig(() => (++reads === 1 ? [save, cancel] : [save]), {drag: vi.fn(async (): Promise<StepResult> => ok('dragged'))});
    await expect(gone.locate(query('testId', 'save')).dragTo(gone.locate(query('role', 'button', {name: 'Cancel'})))).rejects.toThrow(expect.objectContaining({code: 'LOCATOR_NOT_FOUND'}));
    expect(gone.driver.drag).not.toHaveBeenCalled();
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

describe('swipePath', () => {
  const box = {x: 0, y: 100, width: 200, height: 400};

  it('draws the finger the way it is told, about the middle, over half the node by default', () => {
    expect(swipePath(box, 'up')).toEqual({from: {x: 100, y: 400}, to: {x: 100, y: 200}});
    expect(swipePath(box, 'down')).toEqual({from: {x: 100, y: 200}, to: {x: 100, y: 400}});
    expect(swipePath(box, 'left')).toEqual({from: {x: 150, y: 300}, to: {x: 50, y: 300}});
    expect(swipePath(box, 'right')).toEqual({from: {x: 50, y: 300}, to: {x: 150, y: 300}});
  });

  it('keeps the swipe inside the node, and goes nowhere for no distance', () => {
    expect(swipePath(box, 'up', 2)).toEqual({from: {x: 100, y: 480}, to: {x: 100, y: 120}});
    expect(swipePath(box, 'up', -1)).toEqual({from: {x: 100, y: 300}, to: {x: 100, y: 300}});
  });
});

describe('selectorOf', () => {
  it('spells a plain testID, text or label query as the selector a backend looks for as it scrolls', () => {
    expect(selectorOf(query('testId', 'row-50'))).toEqual({testId: 'row-50'});
    expect(selectorOf(query('text', 'Network'))).toEqual({label: 'Network'});
    expect(selectorOf(query('label', 'Network'))).toEqual({label: 'Network'});
  });

  it('has none for a role, a pattern, a loose match, a normaliser, a scope or a refinement', () => {
    expect(selectorOf(query('role', 'button'))).toBeNull();
    expect(selectorOf(query('text', /Network/))).toBeNull();
    expect(selectorOf(query('text', 'Net', {exact: false}))).toBeNull();
    expect(selectorOf(query('text', 'Net', {normalizer: text => text}))).toBeNull();
    expect(selectorOf({...query('text', 'Net'), scope: query('role', 'list')})).toBeNull();
    expect(selectorOf({...query('text', 'Net'), refinements: [{first: true}]})).toBeNull();
  });
});

describe('the actions a backend may not have', () => {
  const row = node('@e5', 'listitem', 'Ada', {kind: 'listitem', bounds: {x: 0, y: 100, width: 200, height: 400}});

  it('hold a press for as long as asked, and fail where the platform has no long press', async () => {
    const longPress = vi.fn(async (): Promise<StepResult> => ok('held'));
    const {driver, locate} = rig(() => [row], {longPress});
    await locate(query('text', 'Ada')).longPress({duration: 900, timeout: 100});
    expect(driver.longPress).toHaveBeenCalledWith({ref: '@e5'}, {duration: 900});
    await expect(rig(() => [row]).locate(query('text', 'Ada')).longPress()).rejects.toThrow(failure('UNSUPPORTED_CAPABILITY', 'a long press is not something the web harness can do'));
    const skipping = rig(() => [row], {longPress: vi.fn(async () => ({ok: true, skipped: true, message: 'a long press needs the host'}))});
    await expect(skipping.locate(query('text', 'Ada')).longPress()).rejects.toThrow(failure('UNSUPPORTED_CAPABILITY', 'a long press needs the host'));
  });

  it('hover a node, disabled or not, and skip where there is no pointer', async () => {
    const hover = vi.fn(async (): Promise<StepResult> => ok('hovered'));
    const {driver, locate} = rig(() => [{...row, enabled: false}], {hover});
    expect(await locate(query('text', 'Ada')).hover()).toBe('done');
    expect(driver.hover).toHaveBeenCalledWith({ref: '@e5'});
    expect(await rig(() => [row]).locate(query('text', 'Ada')).hover()).toBe('skipped');
    const skipping = rig(() => [row], {hover: vi.fn(async () => ({ok: true, skipped: true, message: 'no pointer'}))});
    expect(await skipping.locate(query('text', 'Ada')).hover()).toBe('skipped');
    const failing = rig(() => [row], {hover: vi.fn(async () => failed('covered', 'NOT_ACTIONABLE'))});
    await expect(failing.locate(query('text', 'Ada')).hover()).rejects.toThrow(failure('NOT_ACTIONABLE', 'covered'));
    const uncoded = rig(() => [row], {hover: vi.fn(async () => ({ok: false, message: 'hover failed'}))});
    await expect(uncoded.locate(query('text', 'Ada')).hover()).rejects.toThrow(failure('ACTION_FAILED', 'hover failed'));
  });

  it('give the focus without a press, and fail where the platform cannot give it', async () => {
    const focus = vi.fn(async (): Promise<StepResult> => ok('focused'));
    const {driver, locate} = rig(() => [row], {focus});
    await locate(query('text', 'Ada')).focus();
    expect(driver.focus).toHaveBeenCalledWith({ref: '@e5'});
    expect(driver.press).not.toHaveBeenCalled();
    await expect(rig(() => [row]).locate(query('text', 'Ada')).focus()).rejects.toThrow(failure('UNSUPPORTED_CAPABILITY', 'giving the focus is not something the web harness can do'));
  });

  it('scroll a node into view the way it lies, looking for it off screen too, and leave to the backend whether it must', async () => {
    const scrollIntoView = vi.fn(async (): Promise<StepResult> => ok('scrolled'));
    const below = {...row, offscreen: true, bounds: {x: 0, y: 2400, width: 200, height: 40}};
    const above = {...row, ref: '@e6', name: 'Bo', offscreen: true, bounds: {x: 0, y: -300, width: 200, height: 40}};
    const unplaced = {...row, ref: '@e7', name: 'Cy', offscreen: true, bounds: null};
    const {driver, locate} = rig(() => [row, below, above, unplaced].map((each, at) => (at === 1 ? {...each, ref: '@e8', name: 'Di'} : each)), {scrollIntoView});
    expect(await locate(query('text', 'Ada')).scrollIntoView()).toBe('done');
    expect(driver.scrollIntoView).toHaveBeenLastCalledWith({ref: '@e5'}, {direction: 'down'});
    expect(await locate(query('text', 'Di')).scrollIntoView()).toBe('done');
    expect(driver.scrollIntoView).toHaveBeenLastCalledWith({ref: '@e8'}, {direction: 'down'});
    expect(await locate(query('text', 'Bo')).scrollIntoView()).toBe('done');
    expect(driver.scrollIntoView).toHaveBeenLastCalledWith({ref: '@e6'}, {direction: 'up'});
    expect(await locate(query('text', 'Cy')).scrollIntoView()).toBe('done');
    expect(driver.scrollIntoView).toHaveBeenLastCalledWith({ref: '@e7'}, {direction: 'down'});
    expect(await rig(() => [below]).locate(query('text', 'Ada')).scrollIntoView()).toBe('skipped');
  });

  it('ask a backend to scroll until it sees a node that is not in the tree, down and then up', async () => {
    const scrollIntoView = vi.fn(async (_target: unknown, options?: {direction?: string}): Promise<StepResult> => (options?.direction === 'up' ? ok('found it') : failed('reached the bottom')));
    const {driver, locate} = rig(() => [row], {scrollIntoView});
    expect(await locate(query('text', 'Network')).scrollIntoView()).toBe('done');
    expect(driver.scrollIntoView).toHaveBeenNthCalledWith(1, {label: 'Network'}, {direction: 'down'});
    expect(driver.scrollIntoView).toHaveBeenNthCalledWith(2, {label: 'Network'}, {direction: 'up'});
    const skipping = rig(() => [row], {scrollIntoView: vi.fn(async () => ({ok: true, skipped: true, message: 'no scrolling'}))});
    expect(await skipping.locate(query('testId', 'row-50')).scrollIntoView()).toBe('skipped');
    expect(await rig(() => [row]).locate(query('testId', 'row-50')).scrollIntoView()).toBe('skipped');
    const never = rig(() => [row], {scrollIntoView: vi.fn(async () => failed('not there'))});
    await expect(never.locate(query('text', 'Nowhere')).scrollIntoView({timeout: 200})).rejects.toThrow(failure('LOCATOR_NOT_FOUND', /^getByText\("Nowhere"\) matched nothing within 200 ms/));
    expect(never.driver.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('swipe across a node, and say so where it has no bounds or the platform has no swipe', async () => {
    const swipe = vi.fn(async (): Promise<StepResult> => ok('swiped'));
    const {driver, locate} = rig(() => [row, {...row, ref: '@e9', name: 'Ed', bounds: null}], {swipe});
    expect(await locate(query('text', 'Ada')).swipe('up', {distance: 0.5})).toBe('done');
    expect(driver.swipe).toHaveBeenCalledWith({x: 100, y: 400}, {x: 100, y: 200});
    await expect(locate(query('text', 'Ed')).swipe('up')).rejects.toThrow(failure('NOT_ACTIONABLE', '@e9   listitem "Ed" has no bounds to swipe across'));
    expect(await rig(() => [row]).locate(query('text', 'Ada')).swipe('left')).toBe('skipped');
  });

  it('send a key with the node focused, focusing it first, and skip where there are no keys or no focus to give', async () => {
    const key = vi.fn(async (): Promise<StepResult> => ok('pressed'));
    const focus = vi.fn(async (): Promise<StepResult> => ok('focused'));
    const focused = rig(() => [{...row, focused: true}], {key, focus});
    expect(await focused.locate(query('text', 'Ada')).key('ArrowDown')).toBe('pressed');
    expect(focus).not.toHaveBeenCalled();
    expect(key).toHaveBeenCalledWith('ArrowDown');
    const unfocused = rig(() => [row], {key, focus});
    expect(await unfocused.locate(query('text', 'Ada')).key('Enter')).toBe('pressed');
    expect(focus).toHaveBeenCalledWith({ref: '@e5'});
    const noKeys = rig(() => [row], {focus: vi.fn(async (): Promise<StepResult> => ok('focused'))});
    expect(await noKeys.locate(query('text', 'Ada')).key('Enter')).toBe('skipped');
    expect(noKeys.driver.focus).not.toHaveBeenCalled();
    expect(await rig(() => [row], {key}).locate(query('text', 'Ada')).key('Enter')).toBe('skipped');
    const skippedKey = rig(() => [{...row, focused: true}], {key: vi.fn(async () => ({ok: true, skipped: true, message: 'no keys'}))});
    expect(await skippedKey.locate(query('text', 'Ada')).key('Enter')).toBe('skipped');
  });

  it('on a phone send a key to a field, touching it for the focus, and to nothing else, which the touch would press', async () => {
    const key = vi.fn(async (): Promise<StepResult> => ok('pressed'));
    const focus = vi.fn(async (): Promise<StepResult> => ok('focused'));
    const email = node('@e7', 'android.widget.EditText', 'Email', {kind: 'textbox'});
    const phone = rig(() => [row, email], {key, focus}, 'android');
    expect(await phone.locate(query('text', 'Ada')).key('Enter')).toBe('skipped');
    expect(focus).not.toHaveBeenCalled();
    expect(await phone.locate(query('label', 'Email')).key('Enter')).toBe('pressed');
    expect(focus).toHaveBeenCalledWith({ref: '@e7'});
    expect(await rig(() => [{...row, focused: true}], {key, focus}, 'ios').locate(query('text', 'Ada')).key('Enter')).toBe('pressed');
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

describe('the journal', () => {
  it('records each action with the query as written and the node it came to, a skipped one as skipped, and a wait that ends as verifying the action before it', async () => {
    const {host} = rig(() => [save]);
    const journal = new Journal(host.clock?.now);
    const locate = (asked: LocatorQuery) => new Locator({...host, journal}, asked);
    await locate(query('testId', 'save')).press();
    expect(await locate(query('testId', 'save')).hover()).toBe('skipped');
    await locate(query('testId', 'save')).waitFor();
    expect(journal.steps.map(step => [step.event, step.what, step.resolved, step.result])).toEqual([
      ['press', 'getByTestId("save")', '@e2   button "Save" #save  at 10,20', 'ok'],
      ['hover', 'getByTestId("save")', '@e2   button "Save" #save  at 10,20', 'skipped'],
      ['wait', 'getByTestId("save")', undefined, 'ok'],
      ['verified', 'getByTestId("save")', undefined, 'ok'],
    ]);
    expect(journal.steps.at(-1)?.verifies).toBe(1);
  });

  it('records a drag with the query it ended at', async () => {
    const {host} = rig(() => [save, cancel], {drag: vi.fn(async (): Promise<StepResult> => ok('dragged'))});
    const journal = new Journal(host.clock?.now);
    const locate = (asked: LocatorQuery) => new Locator({...host, journal}, asked);
    await locate(query('testId', 'save')).dragTo(locate(query('role', 'button', {name: 'Cancel'})));
    expect(journal.steps.map(step => [step.event, step.what, step.result])).toEqual([['drag', 'getByTestId("save") to getByRole("button", {name: "Cancel"})', 'ok']]);
  });
});

describe("device.web's actions on a locator's node", () => {
  const web = (selectOption = vi.fn(async (): Promise<StepResult> => ok('chose'))) => ({selectOption}) as unknown as NonNullable<Driver['web']>;

  it('run on the one node, recorded as a step that says what it did, and the screen is read afresh after', async () => {
    const controls = web();
    const {host} = rig(() => [save], {web: controls});
    const invalidate = vi.fn();
    const journal = new Journal(host.clock?.now);
    const located = new Locator({...host, journal, feed: {...host.feed, invalidate}}, query('testId', 'save'));
    expect(await located.web('choose "Blue" in', (each, target) => each.selectOption(target, 'Blue'))).toBe('done');
    expect(controls.selectOption).toHaveBeenCalledExactlyOnceWith({ref: '@e2'}, 'Blue');
    expect(invalidate).toHaveBeenCalledOnce();
    expect(journal.steps.map(step => [step.event, step.what, step.result])).toEqual([['web', 'choose "Blue" in getByTestId("save")', 'ok']]);
  });

  it('answer skipped off web, and where the driver has no web controls', async () => {
    const {locate} = rig(() => [save], {web: web()}, 'android');
    expect(await locate(query('testId', 'save')).web('choose', (each, target) => each.selectOption(target, 'x'))).toBe('skipped');
    const bare = rig(() => [save]);
    expect(await bare.locate(query('testId', 'save')).web('choose', (each, target) => each.selectOption(target, 'x'))).toBe('skipped');
  });

  it("fail with the driver's code and message", async () => {
    const {locate} = rig(() => [save], {web: web(vi.fn(async () => failed('the select has no option "Mauve"', 'ACTION_FAILED')))});
    await expect(locate(query('testId', 'save')).web('choose', (each, target) => each.selectOption(target, 'Mauve'), {timeout: 10})).rejects.toEqual(
      failure('ACTION_FAILED', 'the select has no option "Mauve"'),
    );
    const {locate: plain} = rig(() => [save], {web: web(vi.fn(async (): Promise<StepResult> => ({ok: false, message: 'refused'})))});
    await expect(plain(query('testId', 'save')).web('choose', (each, target) => each.selectOption(target, 'x'))).rejects.toEqual(failure('ACTION_FAILED', 'refused'));
  });
});

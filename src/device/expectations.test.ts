import {describe, expect, it} from 'vitest';
import type {Clock} from '../harness/lib/settle.ts';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {Journal} from './evidence.ts';
import {LOCATOR_MATCHERS} from './expectations.ts';
import type {LocatorHost} from './locator.ts';
import {Locator} from './locator.ts';
import {DEFAULT_POLLING} from './polling.ts';
import type {LocatorQuery, Predicate, QueryOptions, TextMatch} from './queries.ts';

expect.extend(LOCATOR_MATCHERS);

function fakeClock(): Clock & {at: number} {
  const clock = {at: 0, now: () => clock.at, sleep: async (ms: number) => void (clock.at += ms)};
  return clock;
}

const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: true, ...extra});
const query = (predicate: Predicate, match: TextMatch, options: QueryOptions = {}, cardinality: 'one' | 'many' = 'one'): LocatorQuery => ({predicate, match, options, refinements: [], cardinality});

/** A locator on a screen that is whatever `screen` says at the clock's time. */
function rig(screen: (at: number) => SnapshotNode[]) {
  const clock = fakeClock();
  const next = async (): Promise<Snapshot> => ({platform: 'web', nodes: screen(clock.now())});
  const host: LocatorHost = {platform: 'web', ready: () => Promise.reject(new Error('nothing acts here')), feed: {next, invalidate: () => {}}, polling: DEFAULT_POLLING, clock};
  return {clock, locate: (asked: LocatorQuery) => new Locator(host, asked)};
}

const saved = node('@e3', 'span', 'Saved', {kind: 'text', interactive: false});
const spinner = node('@e4', 'progressbar', 'Loading', {kind: 'progressbar', interactive: false});

describe('toBeVisible and toBeHidden', () => {
  it('waits for a node to be on screen, and for it to be gone and stay gone', async () => {
    const {clock, locate} = rig(at => (at >= 300 ? [saved] : []));
    await expect(locate(query('text', 'Saved'))).toBeVisible();
    expect(clock.at).toBe(475);
    const leaving = rig(at => (at >= 100 && at < 900 ? [spinner] : []));
    await expect(leaving.locate(query('role', 'progressbar'))).toBeHidden();
    expect(leaving.clock.at).toBe(2213);
  });

  it('counts a node that is off screen as hidden, and says what it read', async () => {
    const {locate} = rig(() => [{...saved, offscreen: true}]);
    await expect(locate(query('text', 'Saved'))).toBeHidden({timeout: 1000});
    await expect(expect(locate(query('text', 'Saved'))).toBeVisible({timeout: 300})).rejects.toThrow(
      'expected getByText("Saved") to be visible within 300 ms\n  read 4 times; it was off screen for 300 ms\n  the node: @e3   text "Saved"',
    );
    await expect(expect(rig(() => []).locate(query('text', 'Saved'))).toBeVisible({timeout: 0})).rejects.toThrow(
      'expected getByText("Saved") to be visible within 0 ms\n  read once; it was gone\n  no node matched; no node has a name',
    );
  });

  it('holds a negated wait for the stable time, and fails one that does not hold', async () => {
    const flicker = rig(at => (Math.floor(at / 300) % 2 === 1 ? [saved] : []));
    await expect(expect(flicker.locate(query('text', 'Saved'))).not.toBeVisible({timeout: 1500})).rejects.toThrow(/to be visible within 1\.5 s\n.*\n {2}it must hold for 1\.0 s on every reading/);
    const gone = rig(() => []);
    await expect(gone.locate(query('text', 'Saved'))).not.toBeVisible();
    await expect(rig(() => [saved]).locate(query('text', 'Saved'))).not.toBeHidden();
  });

  it('is ambiguous where several are on screen', async () => {
    const {locate} = rig(() => [saved, {...saved, ref: '@e9'}]);
    await expect(expect(locate(query('text', 'Saved'))).toBeVisible()).rejects.toThrow(expect.objectContaining({code: 'LOCATOR_AMBIGUOUS'}));
  });
});

describe('toBeAttached and toBeDetached', () => {
  it('reads the whole tree, on screen or off', async () => {
    const {locate} = rig(() => [{...saved, offscreen: true}]);
    await expect(locate(query('text', 'Saved'))).toBeAttached();
    await expect(expect(locate(query('text', 'Saved'))).toBeDetached({timeout: 200})).rejects.toThrow(/^expected getByText\("Saved"\) to be gone from the tree within 200 ms/);
    await expect(rig(() => []).locate(query('text', 'Saved'))).toBeDetached();
    await expect(rig(() => []).locate(query('text', 'Saved'))).not.toBeAttached();
  });
});

describe('the state of one node', () => {
  const field = node('@e5', 'input', 'Email', {kind: 'textbox', testId: 'email', value: 'a@b', enabled: false, focused: true, bounds: {x: 24, y: 300, width: 200, height: 40}});

  it('reads enabled and disabled, and names the node it read', async () => {
    const {locate} = rig(() => [field]);
    await expect(locate(query('testId', 'email'))).toBeDisabled();
    await expect(expect(locate(query('testId', 'email'))).toBeEnabled({timeout: 100})).rejects.toThrow(
      'expected getByTestId("email") to be enabled within 100 ms\n  read 2 times; it was disabled for 100 ms\n  the node: @e5   textbox "Email" #email  at 24,300',
    );
    await expect(rig(() => [{...field, enabled: true}]).locate(query('testId', 'email'))).toBeEnabled();
    await expect(expect(rig(() => []).locate(query('testId', 'email'))).toBeEnabled({timeout: 0})).rejects.toThrow('read once; it was gone');
    await expect(expect(rig(() => [{...field, enabled: true}]).locate(query('testId', 'email'))).toBeDisabled({timeout: 0})).rejects.toThrow('it was enabled');
    await expect(expect(rig(() => []).locate(query('testId', 'email'))).toBeDisabled({timeout: 0})).rejects.toThrow('it was gone');
    await expect(expect(rig(() => [field, {...field, ref: '@e6'}]).locate(query('testId', 'email'))).toBeEnabled()).rejects.toThrow(expect.objectContaining({code: 'LOCATOR_AMBIGUOUS'}));
  });

  it('reads a checked state, mixed included, and a control with none', async () => {
    const box = (checked?: boolean | 'mixed') => rig(() => [node('@e6', 'checkbox', 'News', {kind: 'checkbox', ...(checked === undefined ? {} : {checked})})]).locate(query('role', 'checkbox'));
    await expect(box(true)).toBeChecked();
    await expect(box(false)).toBeChecked(false);
    await expect(box('mixed')).toBeChecked('mixed');
    await expect(box(false)).not.toBeChecked();
    await expect(expect(box('mixed')).toBeChecked(true, {timeout: 0})).rejects.toThrow(/to be checked within 0 ms\n {2}read once; it was mixed/);
    await expect(expect(box(true)).toBeChecked(false, {timeout: 0})).rejects.toThrow(/to be unchecked within .*\n.*it was checked/);
    await expect(expect(box(false)).toBeChecked('mixed', {timeout: 0})).rejects.toThrow(/to be mixed within .*\n.*it was unchecked/);
    await expect(expect(box()).toBeChecked(true, {timeout: 0})).rejects.toThrow('it was with no checked state');
  });

  it('reads selected, expanded, pressed and focused', async () => {
    const {locate} = rig(() => [field, node('@e7', 'tab', 'Inbox', {kind: 'tab', selected: true, expanded: true, pressed: true})]);
    await expect(locate(query('role', 'tab'))).toBeSelected();
    await expect(locate(query('role', 'tab'))).toBeExpanded();
    await expect(locate(query('role', 'tab'))).toBePressed();
    await expect(locate(query('testId', 'email'))).toBeFocused();
    await expect(expect(locate(query('testId', 'email'))).toBeSelected({timeout: 0})).rejects.toThrow(/to be selected within 0 ms\n {2}read once; it was not selected/);
    await expect(expect(locate(query('role', 'tab'))).toBeFocused({timeout: 0})).rejects.toThrow('it was not focused');
    await expect(expect(locate(query('role', 'tab'))).not.toBeSelected({timeout: 0})).rejects.toThrow(/^expected getByRole\("tab"\) not to be selected within 0 ms\n {2}read once; it was selected/);
  });

  it('reads text, a part of it, a value, a name and a role', async () => {
    const row = node('@e8', 'android.view.ViewGroup', '', {kind: 'group'});
    const title = node('@e9', 'android.widget.TextView', 'Wi-Fi', {kind: 'text', parent: '@e8', interactive: false});
    const {locate} = rig(() => [field, row, title]);
    await expect(locate(query('role', 'group'))).toHaveText('Wi-Fi');
    await expect(locate(query('role', 'group'))).toHaveText(/wi-fi/i);
    await expect(locate(query('role', 'group'))).toContainText('wi');
    await expect(locate(query('role', 'group'))).toHaveAccessibleName('Wi-Fi');
    await expect(locate(query('testId', 'email'))).toHaveValue('a@b');
    await expect(locate(query('testId', 'email'))).toHaveValue('A@B', {normalizer: text => text.toUpperCase()});
    await expect(locate(query('testId', 'email'))).toHaveRole('textbox');
    await expect(locate(query('testId', 'email'))).toHaveRole(/^INPUT$/i);
    await expect(locate(query('role', 'group'))).toHaveRole(/^group$/);
    await expect(expect(locate(query('role', 'group'))).toHaveText('Bluetooth', {timeout: 0})).rejects.toThrow(/to have text "Bluetooth" within 0 ms\n {2}read once; it was "Wi-Fi"/);
    await expect(expect(locate(query('role', 'group'))).toContainText(/blue/, {timeout: 0})).rejects.toThrow('to contain text /blue/');
    await expect(expect(locate(query('role', 'group'))).toHaveAccessibleName('Bluetooth', {timeout: 0})).rejects.toThrow('to be named "Bluetooth"');
    await expect(expect(locate(query('testId', 'email'))).toHaveRole('button', {timeout: 0})).rejects.toThrow('it was input/textbox');
    await expect(expect(locate(query('role', 'group'))).toHaveRole('button', {timeout: 0})).rejects.toThrow('it was android.view.ViewGroup/group');
    await expect(expect(locate(query('role', 'group'))).toHaveValue('x', {timeout: 0})).rejects.toThrow('it was with no value');
    await expect(expect(locate(query('testId', 'email'))).toHaveValue('x', {timeout: 0})).rejects.toThrow('it was "a@b"');
    const none = rig(() => []).locate(query('testId', 'email'));
    for (const assertion of [expect(none).toHaveText('x', {timeout: 0}), expect(none).toContainText('x', {timeout: 0}), expect(none).toHaveAccessibleName('x', {timeout: 0}), expect(none).toHaveRole('x', {timeout: 0})]) {
      await expect(assertion).rejects.toThrow('it was gone');
    }
    const plain = rig(() => [node('@e1', 'Custom', 'Pane')]).locate(query('text', 'Pane'));
    await expect(plain).toHaveRole('custom');
    await expect(expect(plain).toHaveRole(/^x$/, {timeout: 0})).rejects.toThrow('it was Custom');
  });

  it("takes what RNTL's and jest-dom's forms let a test pass: a value or a name left out, and a number", async () => {
    const {locate} = rig(() => [field, node('@e2', 'h2', 'Settings', {kind: 'heading', heading: 2, testId: 'title', interactive: false}), node('@e3', 'button', '', {testId: 'blank'})]);
    await expect(locate(query('testId', 'email'))).toHaveValue();
    await expect(locate(query('testId', 'title'))).not.toHaveValue();
    await expect(locate(query('testId', 'title'))).toHaveAccessibleName();
    await expect(locate(query('testId', 'blank'))).not.toHaveAccessibleName();
    await expect(locate(query('testId', 'title'))).toHaveAttribute('heading', 2);
    await expect(locate(query('testId', 'title'))).toHaveAttribute('heading', null);
    await expect(expect(locate(query('testId', 'title'))).toHaveValue(undefined, {timeout: 0})).rejects.toThrow('to have a value within 0 ms');
    await expect(expect(locate(query('testId', 'blank'))).toHaveAccessibleName(undefined, {timeout: 0})).rejects.toThrow('to have a name within 0 ms');
    await expect(expect(rig(() => []).locate(query('testId', 'blank'))).toHaveAccessibleName(undefined, {timeout: 0})).rejects.toThrow('it was gone');
    await expect(expect(locate(query('testId', 'title'))).toHaveAttribute('heading', true)).rejects.toThrow('to have heading "true"');
    await expect(expect(locate(query('testId', 'email'))).toHaveValue(['a', 'b'])).rejects.toThrow(
      expect.objectContaining({code: 'INVALID_ARGUMENT', message: 'toHaveValue compares with a string, a pattern or a number, not a list'}),
    );
    await expect(expect(locate(query('testId', 'email'))).toHaveAttribute('help', {})).rejects.toThrow('toHaveAttribute compares with a string, a pattern or a number, not object');
  });

  it('reads every node in order for a list of texts', async () => {
    const items = ['Ada', 'Bo'].map((name, at) => node(`@e${at + 1}`, 'li', name, {kind: 'listitem'}));
    const {locate} = rig(() => items);
    await expect(locate(query('role', 'listitem', {}, 'many'))).toHaveText(['Ada', /^b/i]);
    await expect(expect(locate(query('role', 'listitem', {}, 'many'))).toHaveText(['Ada'], {timeout: 0})).rejects.toThrow('to have the texts ["Ada"] within 0 ms\n  read once; it was ["Ada","Bo"]');
    await expect(expect(locate(query('role', 'listitem', {}, 'many'))).toHaveText(['Ada', 'Cy'], {timeout: 0})).rejects.toThrow('to have the texts ["Ada","Cy"]');
  });
});

describe('toHaveCount', () => {
  it('counts what the locator names, and waits for none to stay none', async () => {
    const items = rig(at => (at < 500 ? [saved, {...saved, ref: '@e9'}] : []));
    await expect(items.locate(query('text', 'Saved', {}, 'many'))).toHaveCount(2);
    await expect(items.locate(query('text', 'Saved', {}, 'many'))).toHaveCount(0);
    expect(items.clock.at).toBeGreaterThanOrEqual(1500);
    await expect(expect(rig(() => [saved]).locate(query('text', 'Saved', {}, 'many'))).toHaveCount(2, {timeout: 0})).rejects.toThrow(/to name 2 nodes within 0 ms\n {2}read once; it was 1/);
    await expect(expect(rig(() => []).locate(query('text', 'Saved', {}, 'many'))).toHaveCount(1, {timeout: 0})).rejects.toThrow(/to name 1 node within/);
  });
});

describe('toHaveAttribute', () => {
  const heading = node('@e2', 'h2', 'Settings', {kind: 'heading', heading: 2, help: null, testId: 'title', interactive: false});

  it('reads a tree field, present and matching', async () => {
    const {locate} = rig(() => [heading]);
    await expect(locate(query('testId', 'title'))).toHaveAttribute('heading', '2');
    await expect(locate(query('testId', 'title'))).toHaveAttribute('kind');
    await expect(expect(locate(query('testId', 'title'))).toHaveAttribute('help', undefined, {timeout: 0})).rejects.toThrow(/to have help within 0 ms\n {2}read once; it was with no help/);
    await expect(expect(locate(query('testId', 'title'))).toHaveAttribute('live', undefined, {timeout: 0})).rejects.toThrow('it was with no live');
    await expect(expect(locate(query('testId', 'title'))).toHaveAttribute('heading', /^3$/, {timeout: 0})).rejects.toThrow('to have heading /^3$/ within 0 ms\n  read once; it was 2');
    await expect(expect(rig(() => []).locate(query('testId', 'title'))).toHaveAttribute('kind', undefined, {timeout: 0})).rejects.toThrow('it was gone');
  });

  it('reads only the fields it names', async () => {
    const {locate} = rig(() => [heading]);
    await expect(expect(locate(query('testId', 'title'))).toHaveAttribute('value' as never)).rejects.toThrow(
      expect.objectContaining({code: 'INVALID_ARGUMENT', message: 'toHaveAttribute reads help, inSet, heading, live, status, dialog, testId, placeholder, role, kind; "value" is not one of them'}),
    );
  });
});

describe('a matcher given something else', () => {
  it('says it takes a locator', async () => {
    await expect(expect({ref: '@e1'}).toBeVisible()).rejects.toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT', message: 'toBeVisible takes a locator, such as screen.getByText("Saved"); it was given object'}));
    await expect(expect(null).toBeSelected()).rejects.toThrow('toBeSelected takes a locator, such as screen.getByText("Saved"); it was given null');
  });

  it('waits on the real clock for a device with none of its own', async () => {
    const host: LocatorHost = {platform: 'web', ready: () => Promise.reject(new Error('no')), feed: {next: async () => ({platform: 'web', nodes: [saved]}), invalidate: () => {}}, polling: DEFAULT_POLLING};
    await expect(new Locator(host, query('text', 'Saved'))).toBeVisible();
  });
});

describe('the journal', () => {
  it('records an assertion with how often it read and what it read, and one that passes as verifying the action before it', async () => {
    const clock = fakeClock();
    const next = async (): Promise<Snapshot> => ({platform: 'web', nodes: clock.at >= 200 ? [saved] : []});
    const journal = new Journal(clock.now);
    const host: LocatorHost = {platform: 'web', ready: () => Promise.reject(new Error('no')), feed: {next, invalidate: () => {}}, polling: DEFAULT_POLLING, clock, journal};
    journal.steps.push({index: 1, event: 'press', what: 'Save', startedAt: 0, durationMs: 1, result: 'ok', message: ''});
    await expect(new Locator(host, query('text', 'Saved'))).toBeVisible();
    await expect(expect(new Locator(host, query('text', 'Gone'))).toBeVisible({timeout: 0})).rejects.toThrow();
    expect(journal.steps.slice(1).map(step => [step.event, step.what, step.result, step.message, step.readings])).toEqual([
      ['assert', 'expect(getByText("Saved")) to be visible', 'ok', '', expect.arrayContaining(['visible'])],
      ['verified', 'expect(getByText("Saved")) to be visible', 'ok', 'step 1 took effect', undefined],
      ['assert', 'expect(getByText("Gone")) to be visible', 'failed', 'not so within 0 ms', ['gone']],
    ]);
  });
});

import {describe, expect, it} from 'vitest';
import type {Clock} from '../harness/lib/settle.ts';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {Journal} from './evidence.ts';
import type {LocatorHost} from './locator.ts';
import {Locator} from './locator.ts';
import {DEFAULT_POLLING} from './polling.ts';
import {queriesOn, queryFor, scopeOf} from './screen.ts';

function fakeClock(): Clock & {at: number} {
  const clock = {at: 0, now: () => clock.at, sleep: async (ms: number) => void (clock.at += ms)};
  return clock;
}

const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: true, ...extra});

/** A device whose screen is whatever `screen` says at the clock's time; nothing here acts, so it has no driver. */
function rig(screen: (at: number) => SnapshotNode[]) {
  const clock = fakeClock();
  const next = async (): Promise<Snapshot> => ({platform: 'web', nodes: screen(clock.now())});
  const host: LocatorHost = {
    platform: 'web',
    ready: () => Promise.reject(new Error('no driver here')),
    feed: {next, invalidate: () => {}},
    polling: DEFAULT_POLLING,
    clock,
  };
  return {clock, host, queries: queriesOn(host)};
}

const failure = (code: string, message: string | RegExp) => expect.objectContaining({name: 'HarnessError', code, message: typeof message === 'string' ? message : expect.stringMatching(message)});

const dialog = node('@e1', 'dialog', 'Confirm', {kind: 'dialog', depth: 0, interactive: false});
const ok = node('@e2', 'button', 'OK', {kind: 'button', parent: '@e1', testId: 'ok'});
const outside = node('@e3', 'button', 'OK', {kind: 'button', testId: 'ok-outside'});

describe('the queries', () => {
  it("are RNTL's six families of nine predicates, Testing Library's AltText and Title among them", () => {
    const {queries} = rig(() => []);
    const names = Object.keys(queries).filter(name => name !== 'tree').sort();
    expect(names).toHaveLength(54);
    for (const family of ['getBy', 'getAllBy', 'queryBy', 'queryAllBy', 'findBy', 'findAllBy']) {
      for (const word of ['Role', 'Text', 'LabelText', 'PlaceholderText', 'DisplayValue', 'TestId', 'HintText', 'AltText', 'Title']) expect(names).toContain(`${family}${word}`);
    }
  });

  it('make a locator of a getBy and a getAllBy, with what they were asked', () => {
    const {queries} = rig(() => []);
    const one = queries.getByRole('button', {name: 'OK'});
    expect(one).toBeInstanceOf(Locator);
    expect(one.query).toEqual({predicate: 'role', match: 'button', options: {name: 'OK'}, refinements: [], cardinality: 'one'});
    expect(String(queries.getAllByPlaceholderText('Email'))).toBe('getAllByPlaceholderText("Email")');
    expect(queries.getByText('OK').query.options).toEqual({});
  });

  it('answer a queryBy at once, with the node, null, or the error that it is several', async () => {
    const {clock, queries} = rig(() => [dialog, ok, outside]);
    expect(await queries.queryByTestId('ok')).toEqual(ok);
    expect(await queries.queryByTestId('gone')).toBeNull();
    await expect(queries.queryByRole('button', {name: 'OK'})).rejects.toThrow(failure('LOCATOR_AMBIGUOUS', /^getByRole\("button", \{name: "OK"\}\) matches 2 nodes/));
    expect(await queries.queryAllByRole('button')).toEqual([ok, outside]);
    expect(clock.at).toBe(0);
  });

  it('wait in a findBy for exactly one, and in a findAllBy for at least one', async () => {
    const {clock, queries} = rig(at => (at >= 200 ? [dialog, ok] : [dialog]));
    expect(await queries.findByTestId('ok')).toEqual(ok);
    expect(clock.at).toBe(250);
    clock.at = 0;
    expect(await queries.findAllByRole('button')).toEqual([ok]);
    clock.at = 0;
    expect(await queries.findByText('OK', {}, {interval: 50})).toEqual(ok);
    expect(clock.at).toBe(200);
  });

  it('wait on the real clock on a device that names no clock of its own', async () => {
    const {host} = rig(() => [dialog, ok]);
    expect(await queriesOn({...host, clock: undefined}).findByTestId('ok')).toEqual(ok);
  });

  it('fail a findBy that never finds one, saying what was there, or that it stayed several', async () => {
    const {queries} = rig(() => [dialog, ok, outside]);
    await expect(queries.findByText('Cancel', {}, {timeout: 300})).rejects.toThrow(
      failure('LOCATOR_NOT_FOUND', 'getByText("Cancel") matched nothing within 300 ms; the tree has 3 nodes; the names there: "Confirm", "OK"'),
    );
    await expect(queries.findByRole('button', {}, {timeout: 300})).rejects.toThrow(failure('LOCATOR_AMBIGUOUS', /matches 2 nodes;[^]*\n {2}and still did after 300 ms$/));
    await expect(queries.findAllByRole('slider', {}, {timeout: 0})).rejects.toThrow(failure('LOCATOR_NOT_FOUND', /^getAllByRole\("slider"\) matched nothing within 0 ms/));
  });
});

describe('the tree', () => {
  it('prints what the queries read without refs, for a snapshot, and inside a scope its node and what is in it', async () => {
    const {host, queries} = rig(() => [dialog, ok, outside]);
    // Indented by what holds what, and named by kind: the button outside the dialog is at the left.
    expect(await queries.tree()).toBe('dialog "Confirm"\n  button "OK" #ok\nbutton "OK" #ok-outside');
    expect(await queriesOn(host, scopeOf(queries.getByRole('dialog'))).tree()).toBe('dialog "Confirm"\n  button "OK" #ok');
    expect(await queriesOn(host, scopeOf(queries.getByRole('button', {name: 'OK'}).last())).tree()).toBe('button "OK" #ok-outside');
    expect(await queriesOn(host, scopeOf(queries.getByRole('alert'))).tree()).toBe('');
    const field = node('@e5', 'input', 'Name', {kind: 'textbox', depth: 7, parent: '@e9'});
    const loop = [node('@e6', 'group', 'A', {parent: '@e7', depth: 3}), node('@e7', 'group', 'B', {parent: '@e6', depth: 4})];
    expect(await rig(() => [field, ...loop]).queries.tree()).toBe('textbox "Name"\n  group "A"\n  group "B"');
  });
});

describe('within', () => {
  it('keeps every query inside the one node a locator names', async () => {
    const {host, queries} = rig(() => [dialog, ok, outside]);
    const inside = queriesOn(host, scopeOf(queries.getByRole('dialog')));
    expect(await inside.queryAllByText('OK')).toEqual([ok]);
    expect(String(inside.getByText('OK'))).toBe('within(getByRole("dialog")).getByText("OK")');
  });

  it('finds a node it was given again, by its testID, else by its role and name', async () => {
    expect(queryFor(ok)).toEqual({predicate: 'testId', match: 'ok', options: {hidden: true}, refinements: [], cardinality: 'one'});
    expect(queryFor(dialog)).toEqual({predicate: 'role', match: 'dialog', options: {hidden: true, name: 'Confirm'}, refinements: [], cardinality: 'one'});
    expect(queryFor(node('@e4', 'Group', '')).options).toEqual({hidden: true});
    const {host} = rig(() => [dialog, ok, outside]);
    expect(await queriesOn(host, scopeOf(dialog)).queryAllByRole('button')).toEqual([ok]);
  });
});

describe('the journal', () => {
  it('records a findBy as a wait, and one that ends as verifying the action before it', async () => {
    const {host} = rig(() => [dialog, ok]);
    const journal = new Journal(host.clock?.now);
    journal.steps.push({index: 1, event: 'press', what: 'OK', startedAt: 0, durationMs: 1, result: 'ok', message: ''});
    expect(await queriesOn({...host, journal}).findByTestId('ok')).toEqual(ok);
    expect(journal.steps.slice(1).map(step => [step.event, step.what, step.verifies])).toEqual([
      ['wait', 'getByTestId("ok")', undefined],
      ['verified', 'getByTestId("ok")', 1],
    ]);
  });
});

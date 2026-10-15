import {runInThisContext} from 'node:vm';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ReactNode, ReactTree} from './react.ts';
import {PRIMITIVES, overlap, reactNodeOf, walkExpression, withComponents} from './react.ts';
import type {Snapshot, SnapshotNode} from './snapshot.ts';

/** A fiber, as React keeps one: its kind, its type, its props, and where it sits. */
interface Fiber {
  tag: number;
  type?: unknown;
  memoizedProps?: unknown;
  stateNode?: unknown;
  child?: Fiber;
  sibling?: Fiber;
}

/** Children in order, as a fiber's child and its siblings. */
function fiber(tag: number, type: unknown, props: unknown, ...children: Fiber[]): Fiber {
  const made: Fiber = {tag, type, memoizedProps: props};
  children.forEach((child, at) => (at === 0 ? (made.child = child) : (children[at - 1] as Fiber).sibling = child));
  return made;
}

const COMPOSITE = 0;
const FORWARD = 11;
const MEMO = 14;
const HOST = 5;
const TEXT = 6;

/** Runs the walk the way a runtime does, over the roots a hook holds. */
async function walk(roots: Fiber[][], extra: Record<string, unknown> = {}): Promise<ReactTree | {unavailable: string}> {
  const hook = {
    renderers: new Map(roots.map((_, at) => [at + 1, {}])),
    getFiberRoots: (id: number) => new Set((roots[id - 1] ?? []).map(top => ({current: {child: top}}))),
  };
  Object.assign(globalThis, {__REACT_DEVTOOLS_GLOBAL_HOOK__: hook, ...extra});
  return runInThisContext(walkExpression()) as Promise<ReactTree | {unavailable: string}>;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  delete (globalThis as Record<string, unknown>).__harnessRefs;
  vi.useRealTimers();
});

function SaveButton() {}
function App() {}
const Pressable = {render: function Pressable() {}};
const Memoised = {type: function Inner() {}};

describe('the walk', () => {
  it('names the components above each host node, its innermost of the app, its props and its text', async () => {
    const tree = fiber(COMPOSITE, App, {}, fiber(COMPOSITE, SaveButton, {}, fiber(FORWARD, Pressable, {}, fiber(HOST, 'div', {'data-testid': 'save', 'aria-label': 'Save the draft'}, fiber(HOST, 'span', {children: 'Save'}), fiber(TEXT, null, ' now')))));
    const read = (await walk([[tree]])) as ReactTree;
    expect(read.nodes).toEqual([
      {id: 1, host: 'div', chain: ['App', 'SaveButton', 'Pressable'], component: 'SaveButton', testId: 'save', label: 'Save the draft', text: ' now'},
      {id: 2, parent: 1, host: 'span', chain: ['App', 'SaveButton', 'Pressable'], component: 'SaveButton', text: 'Save'},
    ]);
  });

  it("reads React Native's props, a memo's name, a name given twice once, and passes over what draws nothing", async () => {
    const tree = fiber(
      MEMO,
      Memoised,
      {},
      fiber(COMPOSITE, Object.assign(() => {}, {displayName: 'Row'}), {}, fiber(COMPOSITE, Object.assign(() => {}, {displayName: 'Row'}), {}, fiber(HOST, 'RCTView', {testID: 'row', accessibilityLabel: 'Ada', children: 3}))),
      fiber(HOST, 'style', {children: ':root {}'}),
      // React Native's text holds its string in its props and in a text fiber below, and is read once.
      fiber(COMPOSITE, () => {}, {}, fiber(HOST, 'RCTText', {children: 'Hi'}, fiber(TEXT, null, 'Hi'))),
      fiber(COMPOSITE, 'not a component', {}, fiber(HOST, 'RCTView', null)),
    );
    const read = (await walk([[tree]])) as ReactTree;
    expect(read.nodes.map(node => [node.host, node.chain, node.component, node.testId, node.label, node.text])).toEqual([
      ['RCTView', ['Inner', 'Row'], 'Row', 'row', 'Ada', '3'],
      ['RCTText', ['Inner'], 'Inner', undefined, undefined, 'Hi'],
      ['RCTView', ['Inner'], 'Inner', undefined, undefined, undefined],
    ]);
  });

  it('keeps the root with the most host nodes, of every renderer, and leaves a node with only primitives above it unnamed', async () => {
    const small = fiber(HOST, 'div', {});
    const large = fiber(COMPOSITE, Object.assign(() => {}, {displayName: 'View'}), {}, fiber(HOST, 'div', {}), fiber(HOST, 'div', {}));
    const read = (await walk([[small], [large]])) as ReactTree;
    expect(read.nodes).toHaveLength(2);
    expect(read.nodes[0]?.component).toBeUndefined();
  });

  it('says why where there is no hook, and finds nothing in a renderer with no roots to give', async () => {
    expect(await runInThisContext(walkExpression())).toEqual({unavailable: 'there is no React DevTools hook in this runtime, which a production build leaves out'});
    Object.assign(globalThis, {__REACT_DEVTOOLS_GLOBAL_HOOK__: {renderers: new Map([[1, {}]])}});
    expect(await runInThisContext(walkExpression())).toEqual({nodes: []});
  });

  it('measures an element on web and gives it its ref, and a native node through measureInWindow, for what it can be matched by', async () => {
    const element = {getBoundingClientRect: () => ({x: 1.4, y: 2.6, width: 10, height: 20})};
    const measured = {canonical: {publicInstance: {measureInWindow: (done: (...box: number[]) => void) => done(5, 6, 7, 8)}}};
    const unmatched = {canonical: {publicInstance: {measureInWindow: () => {}}}};
    const tree = fiber(
      COMPOSITE,
      App,
      {},
      Object.assign(fiber(HOST, 'div', {}), {stateNode: element}),
      Object.assign(fiber(HOST, 'RCTView', {testID: 'a'}), {stateNode: measured}),
      Object.assign(fiber(HOST, 'RCTView', {}), {stateNode: unmatched}),
      Object.assign(fiber(HOST, 'RCTView', {testID: 'b'}), {stateNode: {canonical: {}}}),
    );
    const read = (await walk([[tree]], {__harnessRefs: {ids: new Map([[element, 7]])}})) as ReactTree;
    expect(read.nodes.map(node => [node.ref, node.bounds])).toEqual([
      ['@e7', {x: 1, y: 3, width: 10, height: 20}],
      [undefined, {x: 5, y: 6, width: 7, height: 8}],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it('gives up on a measure that never answers', async () => {
    vi.useFakeTimers();
    const silent = {canonical: {publicInstance: {measureInWindow: () => {}}}};
    const reading = walk([[Object.assign(fiber(HOST, 'RCTView', {testID: 'a'}), {stateNode: silent})]]);
    await vi.advanceTimersByTimeAsync(500);
    expect(((await reading) as ReactTree).nodes[0]?.bounds).toBeUndefined();
  });

  it('reads no further than its limit, and is handed the names to pass over', async () => {
    const many = fiber(COMPOSITE, App, {}, ...Array.from({length: 5}, () => fiber(HOST, 'div', {})));
    Object.assign(globalThis, {__REACT_DEVTOOLS_GLOBAL_HOOK__: {renderers: new Map([[1, {}]]), getFiberRoots: () => new Set([{current: {child: many}}])}});
    expect(((await runInThisContext(walkExpression(3))) as ReactTree).nodes).toHaveLength(3);
    expect(walkExpression()).toContain(JSON.stringify(PRIMITIVES));
  });
});

describe('matching the native tree', () => {
  const box = {x: 0, y: 0, width: 100, height: 40};
  const node = (ref: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role: 'button', name: 'Save', depth: 1, interactive: true, ...extra});
  const react = (id: number, extra: Partial<ReactNode> = {}): ReactNode => ({id, host: 'RCTView', chain: [], ...extra});

  it('measures how much two boxes cover of each other', () => {
    expect(overlap(box, box)).toBe(1);
    expect(overlap(box, {x: 200, y: 0, width: 10, height: 10})).toBe(0);
    expect(overlap(box, {x: 0, y: 40, width: 100, height: 40})).toBe(0);
    expect(overlap(box, {x: 0, y: 0, width: 50, height: 40})).toBe(0.5);
  });

  it('finds the React node by ref, then the innermost with the testID, then the box that covers the same place', () => {
    const tree: ReactTree = {nodes: [react(1, {ref: '@e1', component: 'A'}), react(2, {testId: 'save', component: 'B'}), react(3, {testId: 'save', component: 'C'}), react(4, {bounds: box, component: 'D'}), react(5, {bounds: {...box, width: 95}, component: 'E'})]};
    expect(reactNodeOf(node('@e1'), tree)?.component).toBe('A');
    expect(reactNodeOf(node('@e9', {testId: 'save'}), tree)?.component).toBe('C');
    expect(reactNodeOf(node('@e9', {testId: 'other', bounds: box}), tree)?.component).toBe('D');
    expect(reactNodeOf(node('@e9', {bounds: {x: 0, y: 0, width: 50, height: 40}}), tree)).toBeUndefined();
    expect(reactNodeOf(node('@e9'), tree)).toBeUndefined();
  });

  it('gives each native node the component behind it, where there is one', () => {
    const snapshot: Snapshot = {platform: 'android', nodes: [node('@e1', {testId: 'save'}), node('@e2')]};
    const joined = withComponents(snapshot, {nodes: [react(1, {testId: 'save', component: 'SaveButton'}), react(2, {testId: 'x'})]});
    expect(joined.nodes.map(each => each.component)).toEqual(['SaveButton', undefined]);
    expect(joined.platform).toBe('android');
  });
});

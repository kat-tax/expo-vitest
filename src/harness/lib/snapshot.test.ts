import {describe, expect, it} from 'vitest';
import type {Snapshot, SnapshotNode} from './snapshot.ts';
import {asSelector, by, centreOf, describeTarget, findNode, isPoint, narrow, parseTarget, renderSnapshot} from './snapshot.ts';

const tree: Snapshot = {
  platform: 'windows',
  nodes: [
    {ref: '@e1', role: 'TabItem', name: 'Drops', depth: 1, interactive: true, bounds: {x: 10, y: 20, width: 80, height: 40}},
    {ref: '@e2', role: 'TabItem', name: 'Settings', depth: 1, interactive: true, bounds: {x: 100, y: 20, width: 80, height: 40}},
    {ref: '@e3', role: 'Button', name: '', depth: 2, interactive: true, bounds: null},
    {ref: '@e4', role: 'Button', name: 'New drop', testId: 'new-drop', depth: 2, interactive: true, focused: true, bounds: {x: 0, y: 0, width: 50, height: 50}},
    {ref: '@e5', role: 'Text', name: 'HIS-201 Midterm Essay', depth: 3, interactive: false, enabled: false, offscreen: true},
  ],
};

describe('targets', () => {
  it('reads the spellings a command line gives', () => {
    expect(parseTarget('@e3')).toEqual({ref: '@e3'});
    expect(parseTarget('label="New drop"')).toEqual({label: 'New drop'});
    expect(parseTarget('role=button')).toEqual({role: 'button'});
    expect(parseTarget('contains="Essay"')).toEqual({contains: 'Essay'});
    // A bare word is the thing a person would have meant: its name.
    expect(parseTarget('Settings')).toEqual({label: 'Settings'});
  });

  it('keeps an object target as it is, and knows a point from a selector', () => {
    expect(asSelector({label: 'Drops'})).toEqual({label: 'Drops'});
    expect(asSelector('@e1')).toEqual({ref: '@e1'});
    expect(isPoint({x: 1, y: 2})).toBe(true);
    expect(isPoint({label: 'Drops'})).toBe(false);
    expect(isPoint('@e1')).toBe(false);
  });

  it('describes itself for a message', () => {
    expect(describeTarget('@e1')).toBe('@e1');
    expect(describeTarget({x: 3, y: 4})).toBe('3,4');
    expect(describeTarget(by.label('New'))).toBe('label="New"');
  });

  it('builds selectors the way a test writes them', () => {
    expect(by.ref('@e2')).toEqual({ref: '@e2'});
    expect(by.label('Drops')).toEqual({label: 'Drops'});
    expect(by.role('Button')).toEqual({role: 'Button'});
    expect(by.text('Essay')).toEqual({contains: 'Essay'});
    expect(by.testID('new-drop')).toEqual({testId: 'new-drop'});
  });

  it('takes every spelling of testID a command line might use', () => {
    // The prop is `testID`, the DOM attribute `data-testid`, the field
    // `testId`; a person types whichever they last saw.
    expect(parseTarget('testID=new-drop')).toEqual({testId: 'new-drop'});
    expect(parseTarget('testId="new-drop"')).toEqual({testId: 'new-drop'});
    expect(parseTarget('testid=new-drop')).toEqual({testId: 'new-drop'});
    expect(describeTarget(by.testID('new-drop'))).toBe('testId="new-drop"');
  });
});

describe('findNode', () => {
  it('finds by ref, exactly', () => {
    expect(findNode(tree, {ref: '@e2'})?.name).toBe('Settings');
    expect(findNode(tree, {ref: '@e9'})).toBeUndefined();
  });

  it('finds by testID, exactly, and without reading the copy', () => {
    expect(findNode(tree, {testId: 'new-drop'})?.ref).toBe('@e4');
    // Exact on purpose: a testID is written by the same hand as the test, so
    // a near miss is a mistake rather than something to be helpful about.
    expect(findNode(tree, {testId: 'new'})).toBeUndefined();
    expect(findNode(tree, {testId: 'nothing-here'})).toBeUndefined();
  });

  it('prefers a whole name over one that merely contains it', () => {
    // `New drop` also contains `Drops`… no: `Drops` is whole on @e1, so it wins.
    expect(findNode(tree, {label: 'Drops'})?.ref).toBe('@e1');
    // Nothing is called exactly `New`, so the one containing it answers.
    expect(findNode(tree, {label: 'New'})?.ref).toBe('@e4');
    // Case is not what a person means.
    expect(findNode(tree, {label: 'settings'})?.ref).toBe('@e2');
  });

  it('narrows by role, and matches loose text', () => {
    expect(findNode(tree, {role: 'Button', label: 'New drop'})?.ref).toBe('@e4');
    expect(findNode(tree, {role: 'TabItem'})?.ref).toBe('@e1');
    expect(findNode(tree, {contains: 'midterm'})?.ref).toBe('@e5');
    expect(findNode(tree, {role: 'Slider'})).toBeUndefined();
    expect(findNode(tree, {contains: 'nothing here'})).toBeUndefined();
  });
});

describe('centreOf', () => {
  it('is the middle of what the node covers', () => {
    expect(centreOf(tree.nodes[0]!)).toEqual({x: 50, y: 40});
  });

  it('is nothing when the platform gave no bounds', () => {
    expect(centreOf(tree.nodes[2]!)).toBeNull();
  });
});

describe('renderSnapshot', () => {
  it('indents by depth and calls out what a screen reader could not announce', () => {
    const text = renderSnapshot(tree);
    expect(text).toContain('  @e1 TabItem "Drops"');
    expect(text).toContain('@e3 Button ""  <- no accessible name');
    expect(text).toContain('[disabled,offscreen]');
  });

  it('prints the testID so it can be copied into a selector, and nothing when there is none', () => {
    const text = renderSnapshot(tree);
    expect(text).toContain('@e4 Button "New drop" #new-drop [focused]');
    expect(text).toContain('@e1 TabItem "Drops"');
    expect(text).not.toContain('@e1 TabItem "Drops" #');
  });

  it('prints what a screen reader says past the name, where the platform reported it', () => {
    const said: Snapshot = {
      platform: 'windows',
      nodes: [
        {ref: '@e1', role: 'ListItem', name: 'Inbox', depth: 0, interactive: true, inSet: '2 of 5', heading: 2, live: 'polite', status: 'Busy', dialog: true, help: 'Opens the inbox'},
      ],
    };
    expect(renderSnapshot(said)).toBe('@e1 ListItem "Inbox" (2 of 5 h2 live:polite status:Busy dialog help:"Opens the inbox")');
  });
});

describe('narrow', () => {
  const node = (ref: string, parent: string | undefined, interactive: boolean): SnapshotNode => ({ref, ...(parent ? {parent} : null), role: 'View', name: ref, depth: 0, interactive});
  // A list (kept) inside a pane (not kept) inside a window (kept), and a button
  // in the list, and one in a group that is not kept.
  const nodes = [node('@e1', undefined, true), node('@e2', '@e1', false), node('@e3', '@e2', true), node('@e4', '@e3', true), node('@e5', '@e3', false), node('@e6', '@e5', true)];

  it('keeps what it is asked to, each under its nearest ancestor that is kept', () => {
    const kept = narrow(nodes, each => each.interactive);
    expect(kept.map(each => [each.ref, each.parent])).toEqual([
      ['@e1', undefined],
      ['@e3', '@e1'],
      ['@e4', '@e3'],
      ['@e6', '@e3'],
    ]);
    expect('parent' in kept[0]!).toBe(false);
  });

  it('leaves a node with no kept ancestor at the top, and does not loop on a chain that goes round', () => {
    expect(narrow(nodes, each => each.ref === '@e4')).toEqual([{ref: '@e4', role: 'View', name: '@e4', depth: 0, interactive: true}]);
    const circle = [node('@e1', '@e2', false), node('@e2', '@e1', false), node('@e3', '@e1', true)];
    expect(narrow(circle, each => each.interactive)).toEqual([{ref: '@e3', role: 'View', name: '@e3', depth: 0, interactive: true}]);
    // A parent that names nothing in the list ends the chain.
    expect(narrow([node('@e2', '@e9', true)], () => true)).toEqual([{ref: '@e2', role: 'View', name: '@e2', depth: 0, interactive: true}]);
  });
});

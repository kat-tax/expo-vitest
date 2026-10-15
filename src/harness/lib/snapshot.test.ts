import {describe, expect, it} from 'vitest';
import type {Snapshot, SnapshotNode} from './snapshot.ts';
import {asSelector, by, centreOf, describeTarget, findNode, isPoint, narrow, parseTarget, renderSnapshot, seenInstead} from './snapshot.ts';

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

  it('prints the state a control is in, both ways, and what a field holds, where the platform reported them', () => {
    const states: Snapshot = {
      platform: 'web',
      nodes: [
        {ref: '@e1', role: 'checkbox', name: 'News', depth: 0, interactive: true, checked: false},
        {ref: '@e2', role: 'checkbox', name: 'All', depth: 0, interactive: true, checked: 'mixed'},
        {ref: '@e3', role: 'tab', name: 'Inbox', depth: 0, interactive: true, selected: true},
        {ref: '@e4', role: 'combobox', name: 'Dialect', depth: 0, interactive: true, expanded: false},
        {ref: '@e5', role: 'button', name: 'Bold', depth: 0, interactive: true, pressed: true},
        {ref: '@e6', role: 'textbox', name: 'Search', depth: 0, interactive: true, value: '', placeholder: 'Search documents'},
        {ref: '@e7', role: 'textbox', name: 'Password', depth: 0, interactive: true, secure: true},
        {ref: '@e8', role: 'tab', name: 'Sent', depth: 0, interactive: true, selected: false, checked: true, expanded: true, pressed: false},
      ],
    };
    expect(renderSnapshot(states).split('\n')).toEqual([
      '@e1 checkbox "News" [unchecked]',
      '@e2 checkbox "All" [checked:mixed]',
      '@e3 tab "Inbox" [selected]',
      '@e4 combobox "Dialect" [collapsed]',
      '@e5 button "Bold" [pressed]',
      '@e6 textbox "Search" (value:"" placeholder:"Search documents")',
      '@e7 textbox "Password" (secure)',
      '@e8 tab "Sent" [checked,unselected,expanded,unpressed]',
    ]);
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

describe('seenInstead', () => {
  const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: role === 'button' || role === 'tab', ...extra});
  const tree: Snapshot = {
    platform: 'web',
    nodes: [
      node('@e1', 'heading', 'Settings'),
      node('@e2', 'tab', 'Inbox', {testId: 'tab-inbox'}),
      node('@e3', 'tab', 'Documents', {testId: 'tab-documents'}),
      node('@e4', 'button', 'Save', {testId: 'save'}),
      node('@e5', 'button', ''),
    ],
  };

  it('names the nodes in the role asked for, or says there are none', () => {
    expect(seenInstead(tree, {role: 'tab', label: 'Settings'})).toBe('2 nodes have role tab: "Inbox", "Documents"');
    expect(seenInstead(tree, {role: 'heading'})).toBe('1 node has role heading: "Settings"');
    expect(seenInstead(tree, {role: 'slider'})).toBe('no node has role slider');
  });

  it('lists the testIDs there were for a testID, or says there were none', () => {
    expect(seenInstead(tree, {testId: 'search'})).toBe('the testIDs there: "tab-inbox", "tab-documents", "save"');
    expect(seenInstead({platform: 'web', nodes: [node('@e1', 'heading', 'Settings')]}, {testId: 'search'})).toBe('no node has a testID');
  });

  it('names what can be acted on for a label, a few of them, and nothing for a ref', () => {
    expect(seenInstead(tree, {label: 'Sent'})).toBe('what can be acted on: "Inbox", "Documents", "Save"');
    const many: Snapshot = {platform: 'web', nodes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, at) => node(`@e${at}`, 'button', name))};
    expect(seenInstead(many, {contains: 'Z'})).toBe('what can be acted on: "A", "B", "C", "D", "E" and 2 more');
    expect(seenInstead({platform: 'web', nodes: [node('@e1', 'heading', 'Settings')]}, {label: 'Save'})).toBe('nothing there can be acted on');
    expect(seenInstead(tree, {ref: '@e9'})).toBe('');
  });
});

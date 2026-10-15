import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {nodesFrom, toSnapshotNodes} from '../harness/platforms/agent-device-mapping.ts';
import type {LocatorQuery, Predicate, QueryOptions, Refinement, TextMatch} from './queries.ts';
import {ambiguity, describeCandidate, describeQuery, inside, matches, nameOf, normalise, resolve, suggestions} from './queries.ts';

const query = (predicate: Predicate, match: TextMatch, options: QueryOptions = {}, refinements: Refinement[] = [], cardinality: 'one' | 'many' = 'one'): LocatorQuery => ({predicate, match, options, refinements, cardinality});
const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: false, ...extra});
const refs = (nodes: SnapshotNode[]) => nodes.map(each => each.ref);
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'harness', 'lib', '__fixtures__', name), 'utf8'));

describe('matches', () => {
  it('takes a string as the whole text, both trimmed and with their whitespace collapsed, and minds case', () => {
    expect(normalise('  Saved \n  just now ')).toBe('Saved just now');
    expect(matches('  Saved \n just now', 'Saved just now')).toBe(true);
    expect(matches('Saved just now', '  Saved   just now ')).toBe(true);
    expect(matches('Saved just now', 'Saved')).toBe(false);
    expect(matches('Saved', 'saved')).toBe(false);
  });

  it('takes a part of the text, in any case, when not exact, and tests a pattern from the start every time', () => {
    expect(matches('Saved just now', 'SAVED', {exact: false})).toBe(true);
    expect(matches('Saved just now', /^saved/i)).toBe(true);
    expect(matches('Saved just now', /^now/, {exact: false})).toBe(false);
    const global = /save/gi;
    expect([matches('Save', global), matches('Save', global)]).toEqual([true, true]);
  });

  it('normalises both sides the way it is told, and matches nothing where there is no text', () => {
    expect(matches('Saved', 'saved', {normalizer: text => text.toUpperCase()})).toBe(true);
    expect(matches(undefined, 'Saved')).toBe(false);
    expect(matches(null, 'Saved')).toBe(false);
  });
});

describe('resolve', () => {
  const tree: Snapshot = {
    platform: 'web',
    nodes: [
      node('@e1', 'dialog', 'Confirm', {kind: 'dialog', depth: 0}),
      node('@e2', 'button', 'Save', {kind: 'button', parent: '@e1', interactive: true, testId: 'save-draft', bounds: {x: 24, y: 612, width: 80, height: 40}}),
      node('@e3', 'span', 'Save', {kind: 'text', parent: '@e2', depth: 2}),
      node('@e4', 'button', 'Save', {kind: 'button', interactive: true, testId: 'save-final'}),
      node('@e5', 'Text', 'Settings', {kind: 'heading', heading: 1, depth: 0}),
      node('@e6', 'Button', 'Wi-Fi', {kind: 'switch', checked: true, interactive: true, help: 'Turns Wi-Fi on'}),
      node('@e7', 'Button', 'Bluetooth', {kind: 'switch', checked: 'mixed', enabled: false, interactive: true}),
      node('@e8', 'tab', 'Inbox', {kind: 'tab', selected: true}),
      node('@e9', 'combobox', 'Dialect', {kind: 'combobox', expanded: false}),
      node('@e10', 'button', 'Bold', {kind: 'button', pressed: true}),
      node('@e11', 'input', 'Email', {kind: 'textbox', value: 'a@b.c', placeholder: 'you@example.com'}),
      node('@e12', 'button', 'Gone', {kind: 'button', offscreen: true}),
      node('@e13', 'Custom', ''),
    ],
  };

  it("finds a role by the platform's word or by kind, in any case, or by a pattern on either", () => {
    expect(refs(resolve(query('role', 'switch'), tree))).toEqual(['@e6', '@e7']);
    expect(refs(resolve(query('role', 'BUTTON'), tree))).toEqual(['@e2', '@e4', '@e6', '@e7', '@e10']);
    expect(refs(resolve(query('role', /^(dialog|tab)$/), tree))).toEqual(['@e1', '@e8']);
    expect(refs(resolve(query('role', /^Text$/), tree))).toEqual(['@e5']);
    expect(refs(resolve(query('role', /^heading$/), tree))).toEqual(['@e5']);
  });

  it('narrows a role by name, level, being disabled, and each state, with a global pattern matching every node it should', () => {
    expect(refs(resolve(query('role', 'button', {name: 'Save'}), tree))).toEqual(['@e2', '@e4']);
    expect(refs(resolve(query('role', 'button', {name: 'sav', exact: false}), tree))).toEqual(['@e2', '@e4']);
    expect(refs(resolve(query('role', 'button', {name: /Save/g}), tree))).toEqual(['@e2', '@e4']);
    expect(refs(resolve(query('role', 'heading', {level: 1}), tree))).toEqual(['@e5']);
    expect(refs(resolve(query('role', 'heading', {level: 2}), tree))).toEqual([]);
    expect(refs(resolve(query('role', 'switch', {disabled: true}), tree))).toEqual(['@e7']);
    expect(refs(resolve(query('role', 'switch', {disabled: false}), tree))).toEqual(['@e6']);
    expect(refs(resolve(query('role', 'switch', {checked: 'mixed'}), tree))).toEqual(['@e7']);
    expect(refs(resolve(query('role', 'tab', {selected: true}), tree))).toEqual(['@e8']);
    expect(refs(resolve(query('role', 'combobox', {expanded: false}), tree))).toEqual(['@e9']);
    expect(refs(resolve(query('role', 'button', {pressed: true}), tree))).toEqual(['@e10']);
  });

  it('finds text as a person reads it: a text or heading where one matches, else a control that draws its own, and the innermost', () => {
    expect(refs(resolve(query('text', 'Save'), tree))).toEqual(['@e3']);
    expect(refs(resolve(query('text', 'Settings'), tree))).toEqual(['@e5']);
    expect(refs(resolve(query('text', 'Bold'), tree))).toEqual(['@e10']);
    const cell: Snapshot = {platform: 'ios', nodes: [node('@e1', 'Cell', 'Save', {kind: 'listitem', depth: 0}), node('@e2', 'Button', 'Save', {kind: 'button'})]};
    expect(refs(resolve(query('text', 'Save'), cell))).toEqual(['@e2']);
  });

  it('finds a label on anything but text, and a placeholder, value, testID or hint by its own field', () => {
    expect(refs(resolve(query('label', 'Save'), tree))).toEqual(['@e2', '@e4']);
    expect(refs(resolve(query('label', 'Settings'), tree))).toEqual([]);
    expect(refs(resolve(query('label', 'Wi-Fi'), tree))).toEqual(['@e6']);
    expect(refs(resolve(query('placeholder', 'you@example.com'), tree))).toEqual(['@e11']);
    expect(refs(resolve(query('value', 'a@b.c'), tree))).toEqual(['@e11']);
    expect(refs(resolve(query('testId', 'save-final'), tree))).toEqual(['@e4']);
    expect(refs(resolve(query('testId', 'SAVE', {exact: false}), tree))).toEqual(['@e2', '@e4']);
    expect(refs(resolve(query('testId', /^save-/), tree))).toEqual(['@e2', '@e4']);
    expect(refs(resolve(query('hint', 'Turns Wi-Fi on'), tree))).toEqual(['@e6']);
  });

  it('leaves out what is off screen unless told to take it', () => {
    expect(refs(resolve(query('label', 'Gone'), tree))).toEqual([]);
    expect(refs(resolve(query('label', 'Gone', {hidden: true}), tree))).toEqual(['@e12']);
    expect(refs(resolve(query('label', 'Gone', {includeHiddenElements: true}), tree))).toEqual(['@e12']);
  });

  it('keeps within the one node a scope names, by parent, and nothing when the scope names none or several', () => {
    expect(refs(resolve({...query('role', 'button'), scope: query('role', 'dialog')}, tree))).toEqual(['@e2']);
    expect(refs(resolve({...query('role', 'button'), scope: query('role', 'slider')}, tree))).toEqual([]);
    expect(refs(resolve({...query('role', 'span'), scope: query('role', 'switch')}, tree))).toEqual([]);
  });

  it('keeps within a scope by depth on a tree that names no parents', () => {
    const flat: Snapshot = {
      platform: 'ios',
      nodes: [node('@e1', 'Sheet', 'Share', {depth: 0}), node('@e2', 'Button', 'Copy', {depth: 1}), node('@e3', 'Button', 'Print', {depth: 2}), node('@e4', 'Button', 'Outside', {depth: 0})],
    };
    expect(refs(inside(flat, flat.nodes[0] as SnapshotNode))).toEqual(['@e2', '@e3']);
    expect(refs(resolve({...query('role', 'Button'), scope: query('role', 'Sheet')}, flat))).toEqual(['@e2', '@e3']);
  });

  it('refines in the order written: first, last, nth, a text it has, a node it has', () => {
    const buttons = query('role', 'button', {}, [], 'many');
    expect(refs(resolve({...buttons, refinements: [{first: true}]}, tree))).toEqual(['@e2']);
    expect(refs(resolve({...buttons, refinements: [{last: true}]}, tree))).toEqual(['@e10']);
    expect(refs(resolve({...buttons, refinements: [{nth: 1}]}, tree))).toEqual(['@e4']);
    expect(refs(resolve({...buttons, refinements: [{hasText: 'wi-fi'}]}, tree))).toEqual(['@e6']);
    expect(refs(resolve({...buttons, refinements: [{has: query('text', 'Save')}]}, tree))).toEqual(['@e2']);
    expect(refs(resolve({...buttons, refinements: [{hasText: /^Save$/}, {last: true}]}, tree))).toEqual(['@e4']);
  });
});

describe('a name', () => {
  // A row of an Android list as agent-device gives it: the row and the list
  // are named after their testIDs, and the row's text is in the views inside.
  const row: Snapshot = {
    platform: 'android',
    nodes: [
      node('@e1', 'android.widget.ScrollView', 'com.example:id/list', {kind: 'list', testId: 'com.example:id/list', interactive: true, depth: 0}),
      node('@e2', 'android.view.ViewGroup', 'com.example:id/row', {kind: 'group', testId: 'com.example:id/row', interactive: true, parent: '@e1'}),
      node('@e3', 'android.widget.TextView', 'Wi-Fi', {kind: 'text', parent: '@e2', depth: 2}),
      node('@e4', 'android.widget.LinearLayout', '', {kind: 'group', parent: '@e2', depth: 2}),
      node('@e5', 'android.widget.TextView', 'Connected', {kind: 'text', parent: '@e4', depth: 3}),
      node('@e6', 'android.widget.Switch', 'Wi-Fi', {kind: 'switch', checked: true, interactive: true, parent: '@e2', depth: 2}),
      node('@e7', 'android.widget.TextView', 'icon', {kind: 'text', testId: 'icon', parent: '@e2', depth: 2}),
    ],
  };
  const at = (ref: string) => row.nodes.find(each => each.ref === ref) as SnapshotNode;

  it("is a control's own, or the text inside it but not inside a control within it, and a layout's own only", () => {
    expect(nameOf(at('@e6'), row)).toBe('Wi-Fi');
    expect(nameOf(at('@e2'), row)).toBe('Wi-Fi Connected');
    expect(nameOf(at('@e1'), row)).toBe('');
    expect(nameOf(at('@e4'), row)).toBe('');
  });

  it('is not the testID agent-device names a node after when it has no label', () => {
    expect(refs(resolve(query('text', 'icon'), row))).toEqual([]);
    expect(refs(resolve(query('testId', 'icon'), row))).toEqual(['@e7']);
    const ios: Snapshot = {platform: 'ios', nodes: [node('@e1', 'Button', 'save', {testId: 'save', interactive: true, depth: 0}), node('@e2', 'StaticText', 'Save', {kind: 'text', parent: '@e1'})]};
    expect(nameOf(ios.nodes[0] as SnapshotNode, ios)).toBe('Save');
    const web: Snapshot = {platform: 'web', nodes: [node('@e1', 'button', 'save', {testId: 'save', interactive: true})]};
    expect(nameOf(web.nodes[0] as SnapshotNode, web)).toBe('save');
  });

  it('is what a role, a label and a text look for on such a row', () => {
    expect(refs(resolve(query('role', 'group', {name: 'Wi-Fi Connected'}), row))).toEqual(['@e2']);
    expect(refs(resolve(query('label', 'Wi-Fi Connected'), row))).toEqual(['@e2']);
    expect(refs(resolve(query('label', 'Wi-Fi'), row))).toEqual(['@e6']);
    expect(refs(resolve(query('text', 'Wi-Fi'), row))).toEqual(['@e3']);
    expect(refs(resolve(query('role', 'group', {}, [{hasText: 'connected'}], 'many'), row))).toEqual(['@e2', '@e4']);
  });

  it('comes to an end on a loop of parents, a parent not in the tree, and a node from another tree', () => {
    const looped: Snapshot = {
      platform: 'web',
      nodes: [node('@e1', 'button', '', {interactive: true, parent: '@e2'}), node('@e2', 'div', '', {parent: '@e1'}), node('@e3', 'span', 'Lost', {kind: 'text', parent: '@e9'})],
    };
    expect(nameOf(looped.nodes[0] as SnapshotNode, looped)).toBe('');
    expect(refs(inside(looped, looped.nodes[0] as SnapshotNode))).toEqual(['@e2']);
    const stranger = node('@e1', 'button', '', {interactive: true});
    expect(inside(looped, stranger)).toEqual([]);
    expect(nameOf(stranger, looped)).toBe('');
  });
});

describe('real trees', () => {
  it('reads a web page: a selected tab, a checked switch, a field by its placeholder and its value', () => {
    const page = fixture('web-states.json') as Snapshot;
    const names = (found: SnapshotNode[]) => found.map(each => each.name);
    expect(names(resolve(query('role', 'tab', {selected: true}), page))).toEqual(['Inbox']);
    expect(names(resolve(query('role', 'switch', {checked: true}), page))).toEqual(['Wi-Fi']);
    expect(resolve(query('placeholder', 'Search'), page).map(each => each.testId)).toEqual(['search']);
    expect(resolve(query('value', 'Ada'), page).map(each => each.testId)).toEqual(['name']);
  });

  it('finds a link holding its text on react-native-web as the text by text, and as the link by label or role', () => {
    const home = fixture('web-expo-router.json') as Snapshot;
    const kinds = (found: SnapshotNode[]) => found.map(each => each.kind);
    expect(kinds(resolve(query('text', 'Settings'), home))).toEqual(['text']);
    expect(kinds(resolve(query('label', 'Settings'), home))).toEqual(['link']);
    expect(kinds(resolve(query('role', 'link', {name: 'Settings'}), home))).toEqual(['link']);
  });

  it("finds an Android row by the text it holds, the switch in it, and the row's title as text", () => {
    const display: Snapshot = {platform: 'android', nodes: toSnapshotNodes(nodesFrom(fixture('android-display.json')))};
    const [row, ...others] = resolve(query('role', 'group', {name: /^Dark theme/}), display);
    expect(others).toEqual([]);
    expect(resolve(query('role', 'switch'), display, row).map(each => [each.name, each.checked])).toEqual([['Dark theme', false]]);
    expect(resolve(query('text', 'Dark theme'), display).map(each => each.kind)).toEqual(['text']);
    const settings: Snapshot = {platform: 'android', nodes: toSnapshotNodes(nodesFrom(fixture('android-settings.json')))};
    expect(resolve(query('role', /group|list/, {name: 'network', exact: false}), settings).map(each => nameOf(each, settings))).toEqual(['Network & internet Mobile, Wi‑Fi, hotspot']);
  });
});

describe('suggestions', () => {
  const screen: Snapshot = {
    platform: 'web',
    nodes: [
      node('@e1', 'button', 'Save draft', {kind: 'button', testId: 'save-draft'}),
      node('@e2', 'button', 'OK', {kind: 'button'}),
      node('@e3', 'input', 'Email', {kind: 'textbox', placeholder: 'you@example.com', value: 'a@b.c', help: 'Where we write'}),
      node('@e4', 'Custom', ''),
    ],
  };

  it('name the nodes with the role a query asked for, whatever else it asked, or the kinds there are', () => {
    expect(suggestions(query('role', 'button', {name: 'Delete'}), screen)).toBe('2 nodes have role button: "Save draft", "OK"');
    expect(suggestions(query('role', 'textbox', {name: 'Name'}), screen)).toBe('1 node has role textbox: "Email"');
    expect(suggestions(query('role', 'slider'), screen)).toBe('no node has role slider; the kinds there: button, textbox');
    expect(suggestions(query('role', /slider/), {platform: 'web', nodes: [node('@e1', 'Custom', '')]})).toBe('no node has role /slider/');
  });

  it('name the names like the one asked for, or all of them, a few at a time', () => {
    expect(suggestions(query('text', 'save'), screen)).toBe('names like it: "Save draft"');
    expect(suggestions(query('label', 'Draft copy'), screen)).toBe('names like it: "Save draft"');
    expect(suggestions(query('label', 'Saved draft'), screen)).toBe('names like it: "Save draft"');
    expect(suggestions(query('text', 'book'), screen)).toBe('the names there: "Save draft", "OK", "Email"');
    expect(suggestions(query('text', /book/), screen)).toBe('the names there: "Save draft", "OK", "Email"');
    const many: Snapshot = {platform: 'web', nodes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, at) => node(`@e${at}`, 'text', name))};
    expect(suggestions(query('text', 'Z'), many)).toBe('the names there: "A", "B", "C", "D", "E" and 2 more');
    expect(suggestions(query('text', 'Z'), {platform: 'web', nodes: [node('@e1', 'Custom', '')]})).toBe('no node has a name');
  });

  it('say first that what a query names is off screen, where it is, and that {hidden: true} takes it', () => {
    const below: Snapshot = {platform: 'web', nodes: [node('@e1', 'slider', 'Volume', {kind: 'slider', offscreen: true}), node('@e2', 'slider', 'Balance', {kind: 'slider', offscreen: true})]};
    expect(suggestions(query('role', 'slider', {name: 'Volume'}), below)).toBe('a node off screen matches; {hidden: true} takes it');
    expect(suggestions(query('role', 'slider'), below)).toBe('2 nodes off screen match; {hidden: true} takes them');
    expect(suggestions(query('role', 'slider', {name: 'Treble', hidden: true}), below)).toBe('2 nodes have role slider: "Volume", "Balance"');
    expect(suggestions(query('role', 'slider', {name: 'Treble', includeHiddenElements: true}), below)).toBe('2 nodes have role slider: "Volume", "Balance"');
  });

  it('name the values of the field a query reads', () => {
    expect(suggestions(query('testId', 'save'), screen)).toBe('the testIDs there: "save-draft"');
    expect(suggestions(query('placeholder', 'Name'), screen)).toBe('the placeholders there: "you@example.com"');
    expect(suggestions(query('value', 'Ada'), screen)).toBe('the values there: "a@b.c"');
    expect(suggestions(query('hint', 'Opens'), screen)).toBe('the hints there: "Where we write"');
    expect(suggestions(query('testId', 'save'), {platform: 'web', nodes: [node('@e1', 'Custom', '')]})).toBe('no node has a testID');
  });
});

describe('the messages', () => {
  it('write a query as it was written, options, refinements and scope with it', () => {
    expect(describeQuery(query('role', 'button', {name: 'Save', exact: false}))).toBe('getByRole("button", {name: "Save", exact: false})');
    expect(describeQuery(query('text', /saved/i, {normalizer: text => text}, [{first: true}], 'many'))).toBe('getAllByText(/saved/i).first()');
    expect(describeQuery(query('testId', 'row', {hidden: true}, [{last: true}, {nth: 2}, {hasText: 'Ada'}, {has: query('role', 'checkbox', {checked: true})}]))).toBe(
      'getByTestId("row", {hidden: true}).last().nth(2).filter({hasText: "Ada"}).filter({has: getByRole("checkbox", {checked: true})})',
    );
    expect(describeQuery({...query('label', 'OK'), scope: query('role', 'dialog', {name: /confirm/})})).toBe('within(getByRole("dialog", {name: /confirm/})).getByLabelText("OK")');
    expect(describeQuery(query('placeholder', 'Email'))).toBe('getByPlaceholderText("Email")');
    expect(describeQuery(query('value', 'Ada'))).toBe('getByDisplayValue("Ada")');
    expect(describeQuery(query('hint', 'Opens'))).toBe('getByHintText("Opens")');
  });

  it('list the candidates of an ambiguous query, and the ways out', () => {
    const save = node('@e7', 'button', 'Save', {kind: 'button', testId: 'save-draft', bounds: {x: 24, y: 612, width: 80, height: 40}});
    const other = node('@e12', 'Button', 'Save', {});
    expect(describeCandidate(other)).toBe('@e12  Button "Save"');
    expect(ambiguity(query('role', 'button', {name: 'Save'}), [save, other])).toBe(
      'getByRole("button", {name: "Save"}) matches 2 nodes; narrow it with first(), nth() or filter(), or use getAllByRole:\n' +
        '  @e7   button "Save" #save-draft  at 24,612\n' +
        '  @e12  Button "Save"',
    );
  });
});

import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {nodesFrom, toSnapshotNodes} from '../platforms/agent-device-mapping.ts';
import {KINDS, kindOnAndroid, kindOnIos, kindOnWeb, kindOnWindows, withKinds} from './roles.ts';
import type {Snapshot, SnapshotNode} from './snapshot.ts';

const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '__fixtures__', name), 'utf8'));
const node = (role: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref: '@e1', role, name: '', depth: 0, interactive: false, ...extra});

describe('the vocabulary', () => {
  it('is the 26 words a test asks for by', () => {
    expect(KINDS).toHaveLength(26);
    expect(new Set(KINDS).size).toBe(26);
  });
});

describe('kindOnWindows', () => {
  it('maps a control type to its kind, and leaves one it does not know without one', () => {
    expect(kindOnWindows(node('TabItem'))).toBe('tab');
    expect(kindOnWindows(node('ComboBox'))).toBe('combobox');
    expect(kindOnWindows(node('Pane'))).toBe('group');
    expect(kindOnWindows(node('Custom'))).toBeUndefined();
  });

  it('tells a switch from a button by its patterns, and a tab by where it sits', () => {
    expect(kindOnWindows(node('Button', {patterns: ['Toggle', 'ScrollItem']}))).toBe('switch');
    expect(kindOnWindows(node('Button', {patterns: ['Invoke', 'Toggle']}))).toBe('button');
    expect(kindOnWindows(node('Button'))).toBe('button');
    expect(kindOnWindows(node('Button'), node('Tab'))).toBe('tab');
  });

  it('reads a search box, a heading and a dialog off what the node says of itself', () => {
    expect(kindOnWindows(node('Edit', {name: 'Search documents'}))).toBe('searchbox');
    expect(kindOnWindows(node('Edit', {testId: 'site-search'}))).toBe('searchbox');
    expect(kindOnWindows(node('Edit', {name: 'Display name'}))).toBe('textbox');
    expect(kindOnWindows(node('Text', {heading: 2}))).toBe('heading');
    expect(kindOnWindows(node('Text'))).toBe('text');
    expect(kindOnWindows(node('Window', {dialog: true}))).toBe('dialog');
    expect(kindOnWindows(node('Window'))).toBeUndefined();
  });

  it('gives every node of a real react-native-windows tree a kind, but its window and its custom views', () => {
    for (const name of ['windows-documents.json', 'windows-settings.json']) {
      const tree = fixture(name) as Snapshot;
      const unkinded = withKinds(tree.nodes, kindOnWindows).filter(each => !each.kind);
      expect([...new Set(unkinded.map(each => each.role))].sort(), name).toEqual(['Custom', 'Window']);
    }
  });
});

describe('kindOnAndroid', () => {
  it('maps a widget class by its simple name, and a class it does not know by agent-device\'s word for it', () => {
    expect(kindOnAndroid('android.widget.Switch', 'switch', 'Dark theme')).toBe('switch');
    expect(kindOnAndroid('androidx.cardview.widget.CardView', 'cardview', '')).toBe('group');
    expect(kindOnAndroid('com.example.FancyField', 'text-field', 'Email')).toBe('textbox');
    expect(kindOnAndroid('com.example.Fancy', undefined, '')).toBeUndefined();
    expect(kindOnAndroid('com.example.Fancy', 'widget', '')).toBeUndefined();
  });

  it('makes a field whose testID or name says search a search box', () => {
    expect(kindOnAndroid('android.widget.EditText', 'text-field', 'Search notes')).toBe('searchbox');
    expect(kindOnAndroid('android.widget.EditText', 'text-field', '', undefined, 'notes-search')).toBe('searchbox');
    expect(kindOnAndroid('android.widget.EditText', 'text-field', 'Email', undefined, 'sign-in-email')).toBe('textbox');
  });

  it('makes a named child of a tab bar a tab', () => {
    expect(kindOnAndroid('android.widget.FrameLayout', 'group', 'Home', 'com.google.android.material.bottomnavigation.BottomNavigationView')).toBe('tab');
    expect(kindOnAndroid('android.widget.FrameLayout', 'group', '', 'com.google.android.material.tabs.TabLayout')).toBe('group');
    expect(kindOnAndroid('android.widget.TextView', 'text', 'Home', 'android.widget.LinearLayout')).toBe('text');
  });

  it('gives every node of three real emulator screens a kind', () => {
    for (const name of ['android-settings.json', 'android-display.json', 'android-search.json']) {
      const nodes = toSnapshotNodes(nodesFrom(fixture(name)));
      expect(nodes.filter(each => !each.kind).map(each => each.role), name).toEqual([]);
    }
    const display = toSnapshotNodes(nodesFrom(fixture('android-display.json')));
    expect(display.find(each => each.role === 'android.widget.Switch')?.kind).toBe('switch');
    const search = toSnapshotNodes(nodesFrom(fixture('android-search.json')));
    // The Settings app's "Search settings" field.
    expect(search.find(each => each.role === 'android.widget.EditText')?.kind).toBe('searchbox');
  });
});

describe('kindOnIos', () => {
  it('maps an XCUIElement type, with or without its prefix', () => {
    expect(kindOnIos('Button')).toBe('button');
    expect(kindOnIos('XCUIElementTypeSearchField')).toBe('searchbox');
    expect(kindOnIos('Other')).toBeUndefined();
  });

  it('makes a button in a tab bar or a segmented control a tab', () => {
    expect(kindOnIos('Button', 'XCUIElementTypeTabBar')).toBe('tab');
    expect(kindOnIos('Button', 'SegmentedControl')).toBe('tab');
    expect(kindOnIos('Button', 'Cell')).toBe('button');
  });

  it("takes agent-device's own word for a type it does not know, as for a SwiftUI control read by its class", () => {
    expect(kindOnIos('SwiftUI.AccessibilityNode', undefined, 'button')).toBe('button');
    expect(kindOnIos('SwiftUI.AccessibilityNode', undefined, 'something-new')).toBeUndefined();
    expect(kindOnIos('SwiftUI.AccessibilityNode')).toBeUndefined();
    expect(kindOnIos('StaticText', undefined, 'button')).toBe('text');
  });

  it('reads an iOS snapshot through the mapping', () => {
    const nodes = toSnapshotNodes(
      [
        {index: 0, ref: 'e1', role: 'TabBar', type: 'XCUIElementTypeTabBar'},
        {index: 1, ref: 'e2', parentIndex: 0, role: 'Button', label: 'Home'},
        {index: 2, ref: 'e3', type: 'XCUIElementTypeStaticText', label: 'Hello'},
        {index: 3, ref: 'e4', parentIndex: 2},
      ],
      'ios',
    );
    expect(nodes.map(each => each.kind)).toEqual(['tablist', 'tab', 'text', undefined]);
  });
});

describe('kindOnWeb', () => {
  it('takes a role in the vocabulary as it is, img as an image, and a plain element kept for its text as text', () => {
    expect(kindOnWeb('switch', false)).toBe('switch');
    expect(kindOnWeb('img', false)).toBe('image');
    expect(kindOnWeb(undefined, true)).toBe('text');
  });

  it('leaves a role outside the vocabulary, and a node with neither, without a kind', () => {
    expect(kindOnWeb('presentation', false)).toBeUndefined();
    expect(kindOnWeb('generic', true)).toBeUndefined();
    expect(kindOnWeb(undefined, false)).toBeUndefined();
  });
});

describe('withKinds', () => {
  it('asks with the node each one sits inside, and adds nothing where there is no kind', () => {
    const tab = node('Tab', {ref: '@e1'});
    const inside = node('Button', {ref: '@e2', parent: '@e1'});
    const custom = node('Custom', {ref: '@e3'});
    expect(withKinds([tab, inside, custom], kindOnWindows)).toEqual([{...tab, kind: 'tablist'}, {...inside, kind: 'tab'}, custom]);
  });
});

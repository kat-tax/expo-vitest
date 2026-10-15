import {describe, expect, it} from 'vitest';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {describeNode, diffViews, identityOf, renderView} from './view.ts';

const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: false, ...extra});

const billing: Snapshot = {
  platform: 'web',
  viewport: {width: 1280, height: 900},
  nodes: [
    node('@e1', 'heading', 'Billing', {heading: 1}),
    node('@e2', 'main', '', {}),
    node('@e3', 'tab', 'Billing', {interactive: true, selected: true, parent: '@e2'}),
    node('@e5', 'StaticText', 'Your plan renews on 1 November', {kind: 'text', parent: '@e2'}),
    node('@e6', 'status', 'Saving', {live: 'polite'}),
    node('@e7', 'button', 'Upgrade to Pro', {interactive: true, testId: 'upgrade-cta', parent: '@e2'}),
    node('@e9', 'textbox', 'Workspace name', {interactive: true, value: 'Acme', parent: '@e2'}),
    node('@e12', 'textbox', 'Password', {interactive: true, secure: true, value: 'hunter22', parent: '@e2'}),
    node('@e14', 'checkbox', 'Email receipts', {interactive: true, checked: true}),
  ],
};

describe('a node, as the model reads it', () => {
  it('is its kind, its name, its test id, its states, and what a screen reader adds', () => {
    expect(describeNode(billing.nodes[5] as SnapshotNode)).toBe('button  "Upgrade to Pro"  #upgrade-cta');
    expect(describeNode(node('@e1', 'Button', 'Go', {kind: 'button', focused: true, enabled: false, offscreen: true, expanded: false, pressed: 'mixed'}))).toBe('button  "Go"  [focused, disabled, offscreen, collapsed, pressed:mixed]');
    expect(describeNode(node('@e1', 'ListItem', 'Second', {inSet: '2 of 5', help: 'Swipe to delete', status: 'busy', dialog: true, placeholder: 'Type'}))).toBe(
      'listitem  "Second"  2 of 5  status:busy  dialog  help="Swipe to delete"  placeholder="Type"',
    );
    expect(describeNode(node('@e1', 'checkbox', 'Mixed', {checked: 'mixed', selected: false}))).toBe('checkbox  "Mixed"  [checked:mixed, unselected]');
  });

  it("never shows a secure field's value", () => {
    expect(describeNode(billing.nodes[7] as SnapshotNode)).toBe('textbox  "Password"  [secure]');
  });
});

describe('the view', () => {
  it('is the route, the window, the controls in tree order, then the rest', () => {
    expect(renderView(billing, {route: '/settings/billing'})).toBe(
      [
        'route: /settings/billing',
        'window: 1280x900',
        '',
        '@e3   tab  "Billing"  [selected]',
        '@e7   button  "Upgrade to Pro"  #upgrade-cta',
        '@e9   textbox  "Workspace name"  value="Acme"',
        '@e12  textbox  "Password"  [secure]',
        '@e14  checkbox  "Email receipts"  [checked]',
        '',
        '@e1   heading  "Billing"  h1',
        '@e5   text  "Your plan renews on 1 November"',
        '@e6   status  "Saving"  live:polite',
      ].join('\n'),
    );
  });

  it('reads the same way from a Windows tree, an Android one and an iOS one', () => {
    const windows: Snapshot = {platform: 'windows', nodes: [node('e1', 'ListItem', 'Inbox', {interactive: true, inSet: '1 of 3', help: 'Opens the folder'}), node('e2', 'Text', 'Unread: 4', {live: 'assertive'})]};
    expect(renderView(windows)).toBe(['e1  listitem  "Inbox"  1 of 3  help="Opens the folder"', '', 'e2  text  "Unread: 4"  live:assertive'].join('\n'));
    const android: Snapshot = {platform: 'android', viewport: {width: 1080, height: 2400}, nodes: [node('@e1', 'Button', 'Sign in', {kind: 'button', interactive: true})]};
    expect(renderView(android, {route: 'com.example/.Main'})).toBe(['route: com.example/.Main', 'window: 1080x2400', '', '@e1  button  "Sign in"'].join('\n'));
    const ios: Snapshot = {platform: 'ios', nodes: [node('@e2', 'Switch', 'Wi-Fi', {kind: 'switch', interactive: true, checked: false})]};
    expect(renderView(ios)).toBe('@e2  switch  "Wi-Fi"  [unchecked]');
  });

  it('leaves out a nameless node that is not a control', () => {
    expect(renderView({platform: 'web', nodes: [node('@e1', 'group', ''), node('@e2', 'generic', '', {value: '3'})]})).toBe('@e2  generic  ""  value="3"');
  });

  it('leaves out what cannot be acted on first, from the end, then the controls off screen, to fit', () => {
    const many: Snapshot = {
      platform: 'web',
      nodes: [
        node('@e1', 'button', 'Keep', {interactive: true}),
        node('@e2', 'button', 'Far', {interactive: true, offscreen: true}),
        ...Array.from({length: 40}, (_, index) => node(`@e${index + 10}`, 'text', `Line ${index}`)),
      ],
    };
    const fitted = renderView(many, {maxBytes: 300});
    expect(Buffer.byteLength(fitted)).toBeLessThanOrEqual(300);
    expect(fitted).toContain('@e1   button  "Keep"');
    expect(fitted).toContain('@e10  text  "Line 0"');
    expect(fitted).not.toContain('Line 39');
    expect(fitted).toMatch(/\(\d+ more nodes left out, to fit\)$/);
    const tight = renderView(many, {maxBytes: 40});
    expect(tight).toContain('@e1   button  "Keep"');
    expect(tight).not.toContain('Far');
    expect(tight).toMatch(/\(41 more nodes left out, to fit\)$/);
  });
});

describe('an identity', () => {
  it('is what a node is and where, apart from its ref', () => {
    const byRef = new Map(billing.nodes.map(each => [each.ref, each]));
    expect(identityOf(billing.nodes[5] as SnapshotNode, byRef)).toBe('["button","Upgrade to Pro","upgrade-cta",["main",""]]');
    expect(identityOf(billing.nodes[0] as SnapshotNode, byRef)).toBe('["heading","Billing",null,null]');
  });
});

describe('what changed', () => {
  const after: Snapshot = {
    ...billing,
    nodes: [
      ...billing.nodes.filter(each => each.ref !== '@e7' && each.ref !== '@e6'),
      // The field kept its identity under a new ref, with a new value.
      ...billing.nodes.filter(each => each.ref === '@e9').map(each => ({...each, ref: '@e30', value: 'Acme Inc'})),
      node('@e31', 'status', 'Prorated amount', {}),
    ].filter(each => each.ref !== '@e9'),
  };

  it('is each node that came, went or changed, by identity, with its ref', () => {
    expect(diffViews(billing, after)).toEqual({
      text: ['~ @e30  textbox  "Workspace name"  value="Acme Inc"', '+ @e31  status  "Prorated amount"', '- @e6  status  "Saving"  live:polite', '- @e7  button  "Upgrade to Pro"  #upgrade-cta'].join('\n'),
      whole: false,
      changes: 4,
    });
  });

  it('says so where nothing moved, and names a route that changed', () => {
    expect(diffViews(billing, billing)).toEqual({text: 'screen: unchanged', whole: false, changes: 0});
    expect(diffViews(billing, billing, {before: {route: '/a'}, after: {route: '/b'}})).toEqual({text: 'route: /a -> /b', whole: false, changes: 0});
    expect(diffViews(billing, billing, {after: {route: '/b'}}).text).toBe('route: ? -> /b');
  });

  it('is the whole new view where more than half the screen changed', () => {
    const elsewhere: Snapshot = {platform: 'web', nodes: [node('@e40', 'heading', 'Checkout', {heading: 1}), node('@e41', 'button', 'Pay', {interactive: true})]};
    const diff = diffViews(billing, elsewhere, {after: {route: '/checkout'}});
    expect(diff.whole).toBe(true);
    expect(diff.text).toBe(['route: /checkout', '', '@e41  button  "Pay"', '', '@e40  heading  "Checkout"  h1'].join('\n'));
  });

  it('tells apart two nodes with one identity by their order', () => {
    const twice = (names: string[]): Snapshot => ({platform: 'web', nodes: names.map((name, index) => node(`@e${index}`, 'button', name, {interactive: true}))});
    expect(diffViews(twice(['Delete', 'Delete', 'Keep', 'Share']), twice(['Delete', 'Keep', 'Share'])).text).toBe('- @e1  button  "Delete"');
  });
});

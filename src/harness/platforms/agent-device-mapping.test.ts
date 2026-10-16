import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import type {Whereabouts} from './agent-device-mapping.ts';
import {capabilitiesFrom, clientEntry, clientTarget, clipboardText, cliScript, codeFor, commandArgs, commandRequest, connectArgs, describeDevice, describeFailure, factsOf, foregroundOf, installArgs, launchArgs, middleToPress, NO_TOUCH_POINT, nodesFrom, openTarget, packageFolders, parseFailure, parsePayload, recordArgs, screenshotArgs, screenshotRequest, selectionById, settingArgs, settingRequest, settleArgs, settleRequest, STILL_MOVING, targetArgs, toAgentTarget, toSnapshotNode, toSnapshotNodes, viewportFrom, waitFrom} from './agent-device-mapping.ts';

describe('toSnapshotNode', () => {
  it('reads an Android node as agent-device answers one', () => {
    const node = {
      index: 2,
      ref: 'e3',
      type: 'android.widget.TextView',
      kind: 'text',
      label: '10:23',
      identifier: 'com.android.systemui:id/clock',
      rect: {x: 101.6, y: 40.2, width: 36.4, height: 28},
      enabled: true,
      depth: 3,
      hittable: true,
      visibleToUser: true,
    };
    expect(toSnapshotNode(node, 2)).toStrictEqual({
      ref: '@e3',
      role: 'android.widget.TextView',
      name: '10:23',
      testId: 'com.android.systemui:id/clock',
      depth: 3,
      interactive: true,
      focused: undefined,
      enabled: true,
      offscreen: false,
      bounds: {x: 102, y: 40, width: 36, height: 28},
    });
  });

  it('prefers the platform role, then the class, then agent-device kind', () => {
    expect(toSnapshotNode({role: 'Button', type: 'XCUIElementTypeButton', kind: 'button'}, 0).role).toBe('Button');
    expect(toSnapshotNode({type: 'android.widget.Button', kind: 'button'}, 0).role).toBe('android.widget.Button');
    expect(toSnapshotNode({kind: 'button'}, 0).role).toBe('button');
    expect(toSnapshotNode({}, 0).role).toBe('');
  });

  it('names a node by its label, then its value, then its identifier', () => {
    expect(toSnapshotNode({label: 'Save', value: 'x', identifier: 'save'}, 0).name).toBe('Save');
    expect(toSnapshotNode({value: '42%', identifier: 'battery'}, 0).name).toBe('42%');
    expect(toSnapshotNode({identifier: 'battery'}, 0).name).toBe('battery');
    expect(toSnapshotNode({}, 0).name).toBe('');
  });

  it('fills what agent-device left out with what the tree shape says', () => {
    const node = toSnapshotNode({ref: '@e9', rect: {x: 1, width: 2}}, 4);
    expect(node).toMatchObject({ref: '@e9', depth: 0, interactive: false, offscreen: false, bounds: {x: 1, y: 0, width: 2, height: 0}});
    expect('testId' in node).toBe(false);
    // Without a ref of its own, a node is numbered by where it is in the list.
    expect(toSnapshotNode({}, 4).ref).toBe('@e5');
    expect(toSnapshotNode({visibleToUser: false}, 0).offscreen).toBe(true);
    expect(toSnapshotNode({rect: {y: 3}}, 0).bounds).toBeNull();
    expect(toSnapshotNode({}, 0).bounds).toBeNull();
  });
});

describe('nodesFrom', () => {
  it('finds the nodes in every shape an answer comes in', () => {
    const nodes = [{ref: 'e1'}];
    expect(nodesFrom(nodes)).toBe(nodes);
    expect(nodesFrom({nodes})).toBe(nodes);
    // The command line's --json wraps the snapshot in `data`.
    expect(nodesFrom({success: true, data: {nodes}})).toBe(nodes);
    expect(nodesFrom({result: {elements: nodes}})).toBe(nodes);
  });

  it('is nothing when there are no nodes', () => {
    expect(nodesFrom(null)).toEqual([]);
    expect(nodesFrom('text')).toEqual([]);
    expect(nodesFrom({nodes: []})).toEqual([]);
  });
});

describe('parsePayload', () => {
  it('reads JSON, and JSON after a line of prose', () => {
    expect(parsePayload('{"nodes":[]}')).toEqual({nodes: []});
    expect(parsePayload('connected\n{"nodes":[]}')).toEqual({nodes: []});
    expect(parsePayload('connected\n[1, 2]')).toEqual([1, 2]);
    expect(parsePayload('a [list] then {"nodes":[]}')).toBeNull();
    expect(parsePayload('{"nodes":[]} [after]')).toEqual(null);
  });

  it('is null when there is no JSON at all', () => {
    expect(parsePayload('nothing to see')).toBeNull();
    expect(parsePayload('{ broken')).toBeNull();
  });
});

describe('targets', () => {
  it('spell each kind of target the way the command line takes it', () => {
    expect(toAgentTarget({x: 10, y: 20})).toBe('10 20');
    expect(toAgentTarget('@e3')).toBe('@e3');
    expect(toAgentTarget({testId: 'save'})).toBe('id="save"');
    expect(toAgentTarget('testID=save')).toBe('id="save"');
    expect(toAgentTarget({label: 'Save'})).toBe('label="Save"');
    expect(toAgentTarget({role: 'button'})).toBe('role="button"');
    expect(toAgentTarget({contains: 'Sav'})).toBe('label="Sav"');
    expect(toAgentTarget({})).toBe('=""');
  });

  it('give the command line a point as two arguments, and anything else as one', () => {
    expect(targetArgs({x: 10, y: 20})).toEqual(['10', '20']);
    expect(targetArgs('@e3')).toEqual(['@e3']);
    expect(targetArgs({label: 'Save'})).toEqual(['label="Save"']);
  });

  it('hand the Node client a point, a ref or a selector', () => {
    expect(clientTarget({x: 10, y: 20})).toEqual({x: 10, y: 20});
    expect(clientTarget('@e3')).toEqual({ref: '@e3'});
    expect(clientTarget({testId: 'save'})).toEqual({selector: 'id="save"'});
  });
});

describe('openTarget', () => {
  it('opens a URL as it is, and a route as a deep link into the app', () => {
    expect(openTarget('https://example.com/a')).toEqual({url: 'https://example.com/a'});
    expect(openTarget('myapp://settings')).toEqual({url: 'myapp://settings'});
    expect(openTarget('/settings/profile', 'myapp')).toEqual({url: 'myapp://settings/profile'});
  });

  it('opens anything else as an app, and nothing for a route with no scheme', () => {
    expect(openTarget('com.android.settings')).toEqual({app: 'com.android.settings'});
    expect(openTarget('Settings', 'myapp')).toEqual({app: 'Settings'});
    expect(openTarget('/settings')).toBeNull();
  });
});

describe('failures', () => {
  it('read the command line line back into a code and a message', () => {
    expect(parseFailure('Error (SESSION_NOT_FOUND): No active session. Run open first.')).toEqual({code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.'});
    expect(parseFailure('agent-device gave no answer within 30 s')).toEqual({message: 'agent-device gave no answer within 30 s'});
  });

  it('print the same way whichever transport met them', () => {
    expect(describeFailure({code: 'APP_NOT_INSTALLED', message: 'No package found matching "x"'})).toBe('Error (APP_NOT_INSTALLED): No package found matching "x"');
    expect(describeFailure({message: 'request canceled'})).toBe('request canceled');
  });

  it('carry the code that says what to do about them', () => {
    expect(codeFor({code: 'DEVICE_NOT_FOUND', message: ''}, 'ACTION_FAILED')).toBe('DRIVER_UNAVAILABLE');
    expect(codeFor({code: 'DEVICE_IN_USE', message: ''}, 'ACTION_FAILED')).toBe('DRIVER_UNAVAILABLE');
    expect(codeFor({code: 'TOOL_MISSING', message: ''}, 'ACTION_FAILED')).toBe('DRIVER_UNAVAILABLE');
    expect(codeFor({code: 'UNSUPPORTED_PLATFORM', message: ''}, 'ACTION_FAILED')).toBe('DRIVER_UNAVAILABLE');
    expect(codeFor({code: 'UNAUTHORIZED', message: ''}, 'ACTION_FAILED')).toBe('DRIVER_UNAVAILABLE');
    expect(codeFor({code: 'APP_NOT_INSTALLED', message: ''}, 'ACTION_FAILED')).toBe('APP_UNREACHABLE');
    expect(codeFor({code: 'UNSUPPORTED_OPERATION', message: ''}, 'ACTION_FAILED')).toBe('UNSUPPORTED_CAPABILITY');
    expect(codeFor({code: 'NOT_IMPLEMENTED', message: ''}, 'ACTION_FAILED')).toBe('UNSUPPORTED_CAPABILITY');
    expect(codeFor({code: 'INVALID_ARGS', message: ''}, 'ACTION_FAILED')).toBe('INVALID_ARGUMENT');
    expect(codeFor({code: 'COMMAND_FAILED', message: 'Selector did not match: id="nothing"'}, 'ACTION_FAILED')).toBe('LOCATOR_NOT_FOUND');
    expect(codeFor({code: 'COMMAND_FAILED', message: 'request canceled'}, 'ACTION_FAILED')).toBe('ACTION_FAILED');
    expect(codeFor({message: 'agent-device gave no answer within 180 s'}, 'APP_UNREACHABLE')).toBe('APP_UNREACHABLE');
  });
});

describe('selectionById', () => {
  const devices = [
    {platform: 'android', id: 'emulator-5554', name: 'Pixel 9 Pro XL'},
    {platform: 'ios', id: '4B1E0A52-6F0C-4C8E-9C1D-2A7B3E5F6A10', name: 'iPhone 17'},
  ];

  it('selects a device by the serial or the UDID its id is, from the list or the payload that holds it', () => {
    expect(selectionById('android', 'emulator-5554', devices)).toEqual({serial: 'emulator-5554'});
    expect(selectionById('ios', '4B1E0A52-6F0C-4C8E-9C1D-2A7B3E5F6A10', {devices})).toEqual({udid: '4B1E0A52-6F0C-4C8E-9C1D-2A7B3E5F6A10'});
    expect(selectionById('android', 'emulator-5554', {success: true, data: {devices}})).toEqual({serial: 'emulator-5554'});
  });

  it("is null for a name, another platform's id, or a list it cannot read", () => {
    expect(selectionById('android', 'Pixel 9 Pro XL', devices)).toBeNull();
    expect(selectionById('ios', 'emulator-5554', devices)).toBeNull();
    expect(selectionById('android', 'emulator-5554', null)).toBeNull();
    expect(selectionById('android', 'emulator-5554', {data: 'none'})).toBeNull();
    expect(selectionById('android', 'emulator-5554', [null, 'emulator-5554'])).toBeNull();
  });
});

describe('describeDevice', () => {
  it('says what agent-device would drive, as its command line does', () => {
    const device = {name: 'Pixel 7 Pro', platform: 'android', kind: 'device', target: 'mobile', model: 'Pixel 7 Pro', osVersion: '16', booted: true};
    expect(describeDevice({device, availableCommands: ['open', 'snapshot']})).toBe(
      'Pixel 7 Pro (android device target=mobile model="Pixel 7 Pro" os=16) booted=true supports 2 commands',
    );
    expect(describeDevice({device: {name: 'iPhone 17', platform: 'ios', kind: 'simulator', target: 'mobile'}, availableCommands: []})).toBe(
      'iPhone 17 (ios simulator target=mobile) supports 0 commands',
    );
  });
});

describe('packageFolders', () => {
  const root = path.resolve('/work/app');
  function where(overrides: Partial<Whereabouts> = {}): Whereabouts {
    return {root, env: {} as NodeJS.ProcessEnv, home: path.resolve('/home/ada'), exists: () => false, npmRoot: () => null, ...overrides};
  }

  it('tries the folder it is told of, the project, bun, then npm, in that order', () => {
    const installed = (file: string) => file === path.join(root, 'node_modules', 'agent-device', 'package.json') || file === path.join(path.dirname(root), 'node_modules', 'agent-device', 'package.json');
    const named = path.resolve('/tools');
    const folders = [...packageFolders(where({env: {HARNESS_AGENT_DEVICE: named} as unknown as NodeJS.ProcessEnv, exists: installed, npmRoot: () => path.resolve('/npm/node_modules')}))];
    expect(folders).toEqual([
      named,
      path.join(named, 'node_modules', 'agent-device'),
      path.join(root, 'node_modules', 'agent-device'),
      path.join(path.dirname(root), 'node_modules', 'agent-device'),
      path.join(path.resolve('/home/ada'), '.bun', 'install', 'global', 'node_modules', 'agent-device'),
      path.join(path.resolve('/npm/node_modules'), 'agent-device'),
    ]);
  });

  it('asks npm only when nothing before it would do, and leaves it out when npm has no answer', () => {
    const npmRoot = vi.fn(() => null);
    const folders = packageFolders(where({npmRoot}));
    expect(folders.next().value).toBe(path.join(path.resolve('/home/ada'), '.bun', 'install', 'global', 'node_modules', 'agent-device'));
    expect(npmRoot).not.toHaveBeenCalled();
    expect(folders.next().done).toBe(true);
    expect(npmRoot).toHaveBeenCalledOnce();
  });

  it('reads HARNESS_AGENT_DEVICE=cli as a choice of transport, not a folder', () => {
    expect([...packageFolders(where({env: {HARNESS_AGENT_DEVICE: 'cli'} as unknown as NodeJS.ProcessEnv}))]).toHaveLength(1);
  });
});

describe('the manifest', () => {
  it('names the file the client loads from, in each way a package can say it', () => {
    expect(clientEntry({exports: {'.': {types: './dist/src/index.d.ts', import: './dist/src/index.js'}}})).toBe('./dist/src/index.js');
    expect(clientEntry({exports: {'.': {default: './index.js'}}})).toBe('./index.js');
    expect(clientEntry({exports: {'.': './index.js'}})).toBe('./index.js');
    expect(clientEntry({exports: './index.js'})).toBe('./index.js');
    expect(clientEntry({exports: {import: './index.mjs'}})).toBe('./index.mjs');
    expect(clientEntry({exports: {'.': {require: './index.cjs'}}, main: 'main.js'})).toBe('main.js');
    expect(clientEntry({main: 'main.js'})).toBe('main.js');
    expect(clientEntry({})).toBeNull();
  });

  it('names the command line script', () => {
    expect(cliScript({bin: {'agent-device': 'bin/agent-device.mjs'}})).toBe('bin/agent-device.mjs');
    expect(cliScript({bin: 'bin/agent-device.mjs'})).toBe('bin/agent-device.mjs');
    expect(cliScript({bin: {other: 'bin/other.mjs'}})).toBeNull();
    expect(cliScript({})).toBeNull();
  });
});

describe('toSnapshotNodes', () => {
  it('names each node parent by its ref, where the parent is in the same list', () => {
    const nodes = toSnapshotNodes([
      {index: 0, ref: 'e1', type: 'android.widget.FrameLayout'},
      {index: 1, parentIndex: 0, ref: 'e2', type: 'android.widget.LinearLayout'},
      {index: 2, parentIndex: 1, ref: 'e3', type: 'android.widget.TextView'},
      // Its parent was left out of an interactive snapshot, and nothing says whose child that was.
      {index: 7, parentIndex: 5, ref: 'e8', type: 'android.widget.Button'},
    ]);
    expect(nodes.map(node => [node.ref, node.parent])).toEqual([
      ['@e1', undefined],
      ['@e2', '@e1'],
      ['@e3', '@e2'],
      ['@e8', undefined],
    ]);
    expect('parent' in nodes[0]!).toBe(false);
  });

  it('names no parent from a list that does not carry the indexes', () => {
    expect(toSnapshotNodes([{ref: 'e1'}, {ref: 'e2', depth: 1}]).map(node => node.parent)).toEqual([undefined, undefined]);
  });
});

describe('middleToPress', () => {
  const at = (x: number, y: number) => ({x, y, width: 280, height: 144});
  const tree = {
    platform: 'android' as const,
    nodes: [
      {ref: '@e1', role: 'android.view.View', name: 'Sign in', depth: 0, interactive: true, bounds: at(96, 1023)},
      {ref: '@e2', parent: '@e1', role: 'android.widget.TextView', name: 'Sign in', depth: 1, interactive: false},
      {ref: '@e3', parent: '@e1', role: 'android.widget.Button', name: '', depth: 1, interactive: false},
      {ref: '@e4', role: 'android.view.View', name: 'Wi-Fi', depth: 0, interactive: true, bounds: at(0, 0)},
      {ref: '@e5', parent: '@e4', role: 'android.view.View', name: '', depth: 1, interactive: false},
      {ref: '@e6', parent: '@e5', role: 'android.widget.Switch', name: '', depth: 2, interactive: true},
    ],
  };

  it("is the node's middle where nothing inside it can be pressed, and agent-device's refusal names when to ask", () => {
    expect(middleToPress(tree, tree.nodes[0]!)).toEqual({x: 236, y: 1095});
    expect(NO_TOUCH_POINT.test('Error (COMMAND_FAILED): Ref @e34 has no parent-owned touch point outside its interactive descendants')).toBe(true);
  });

  it('is null where something inside can be pressed, however deep, or the node has no bounds', () => {
    expect(middleToPress(tree, tree.nodes[3]!)).toBeNull();
    expect(middleToPress(tree, {...tree.nodes[0]!, bounds: null})).toBeNull();
  });
});

describe('STILL_MOVING', () => {
  it("names agent-device's refusal of a target that had not come to rest, by ref or by selector, and no other", () => {
    expect(STILL_MOVING.test('Error (COMMAND_FAILED): Ref @e53 had no confirmed resting position when the transition window ran out')).toBe(true);
    expect(STILL_MOVING.test('Error (COMMAND_FAILED): Selector id="save" had no confirmed resting position when the transition window ran out')).toBe(true);
    expect(STILL_MOVING.test('Error (COMMAND_FAILED): Ref @e34 has no parent-owned touch point outside its interactive descendants')).toBe(false);
  });
});

describe('Android read as TalkBack reads it', () => {
  // Compose's button as Android reports it: a touch target that can be
  // pressed and says nothing, around its label and a node with its role.
  const button = [
    {index: 10, ref: 'e10', type: 'android.view.View', identifier: 'sign-in-submit', hittable: true},
    {index: 11, parentIndex: 10, ref: 'e11', type: 'android.widget.TextView', label: 'Sign in', hittable: false},
    {index: 12, parentIndex: 10, ref: 'e12', type: 'android.widget.Button', hittable: false},
  ];

  it('names a node that can be pressed by the text inside it, and gives it the role of the control inside it', () => {
    const [target, label, role] = toSnapshotNodes(button);
    expect(target).toMatchObject({ref: '@e10', name: 'Sign in', kind: 'button', testId: 'sign-in-submit'});
    expect([label!.name, role!.kind]).toEqual(['Sign in', 'button']);
  });

  it('gives a group that can be pressed the role of the one control inside it', () => {
    const [row] = toSnapshotNodes([
      {index: 1, ref: 'e1', type: 'android.view.ViewGroup', hittable: true},
      {index: 2, parentIndex: 1, ref: 'e2', type: 'android.widget.TextView', label: 'Dark mode'},
      {index: 3, parentIndex: 1, ref: 'e3', type: 'android.widget.Switch'},
    ]);
    expect(row).toMatchObject({name: 'Dark mode', kind: 'switch'});
  });

  it('names a field by the hint inside it, and keeps its own kind', () => {
    const [field] = toSnapshotNodes([
      {index: 1, ref: 'e1', type: 'android.widget.EditText', identifier: 'sign-in-email', hittable: true, editable: true},
      {index: 2, parentIndex: 1, ref: 'e2', type: 'android.widget.TextView', label: 'Email'},
    ]);
    expect(field).toMatchObject({name: 'Email', kind: 'textbox'});
  });

  it('takes nothing from what can be pressed itself, nor a role from more than one control', () => {
    const [outer] = toSnapshotNodes([
      {index: 1, ref: 'e1', type: 'android.view.View', identifier: 'row', hittable: true},
      {index: 2, parentIndex: 1, ref: 'e2', type: 'android.widget.TextView', label: 'Wi-Fi'},
      {index: 3, parentIndex: 1, ref: 'e3', type: 'android.view.View', hittable: true},
      {index: 4, parentIndex: 3, ref: 'e4', type: 'android.widget.TextView', label: 'Off'},
      {index: 5, parentIndex: 1, ref: 'e5', type: 'android.widget.Button'},
      {index: 6, parentIndex: 1, ref: 'e6', type: 'android.widget.CheckBox'},
      {index: 7, parentIndex: 1, ref: 'e7', type: 'android.view.View'},
    ]);
    expect(outer).toMatchObject({name: 'Wi-Fi'});
    expect(outer!.kind).toBeUndefined();
  });

  it('leaves alone a node that says something, one that cannot be pressed, one with nothing inside, and iOS', () => {
    const labelled = toSnapshotNodes([{...button[0]!, label: 'Send'}, ...button.slice(1)]);
    expect(labelled[0]).toMatchObject({name: 'Send'});
    expect(labelled[0]!.kind).toBeUndefined();
    expect(toSnapshotNodes([{...button[0]!, hittable: false}, ...button.slice(1)])[0]).toMatchObject({name: 'sign-in-submit'});
    expect(toSnapshotNodes([{index: 1, ref: 'e1', type: 'android.widget.CheckBox', identifier: 'sign-in-show', hittable: true}])[0]).toMatchObject({name: 'sign-in-show', kind: 'checkbox'});
    expect(toSnapshotNodes([{...button[0]!, index: undefined}, ...button.slice(1)])[0]).toMatchObject({name: 'sign-in-submit'});
    expect(toSnapshotNodes(button, 'ios')[0]).toMatchObject({name: 'sign-in-submit'});
  });
});

describe('the wait after an action', () => {
  it('is asked for by a settle above 0, with its timeout or the harness\'s', () => {
    expect(waitFrom({settle: 150, settleTimeout: 2000})).toEqual({quietMs: 150, timeoutMs: 2000});
    expect(waitFrom({settle: 300})).toEqual({quietMs: 300, timeoutMs: 2000});
    expect(waitFrom({settle: 0})).toBeUndefined();
    expect(waitFrom({settle: false})).toBeUndefined();
    expect(waitFrom()).toBeUndefined();
  });

  it('is agent-device\'s --settle, in the client\'s words and on its command line', () => {
    expect(settleRequest({quietMs: 150, timeoutMs: 2000})).toEqual({settle: true, settleQuietMs: 150, timeoutMs: 2000});
    expect(settleRequest()).toEqual({});
    expect(settleArgs({quietMs: 150, timeoutMs: 2000})).toEqual(['--settle', '--settle-quiet', '150', '--timeout', '2000']);
    expect(settleArgs()).toEqual([]);
  });
});

describe('the state a node is in', () => {
  const base = {ref: 'e1', type: 'android.widget.EditText', depth: 1};

  it('passes checked through, selected where it is true, and the placeholder', () => {
    expect(toSnapshotNode({...base, type: 'android.widget.Switch', checked: true, selected: true}, 0)).toMatchObject({checked: true, selected: true});
    // On Android every node says selected: false, which is no state at all.
    expect(toSnapshotNode({...base, type: 'android.widget.TextView', selected: false}, 0)).not.toHaveProperty('selected');
    expect(toSnapshotNode({...base, editable: true, value: 'Ada', placeholder: 'Name'}, 0)).toMatchObject({value: 'Ada', placeholder: 'Name'});
  });

  it('reads an empty field as empty while it shows its hint, and gives a secure field no value', () => {
    expect(toSnapshotNode({...base, editable: true, value: 'Name', placeholder: 'Name', hintShowing: true}, 0)).toMatchObject({value: '', placeholder: 'Name'});
    const secret = toSnapshotNode({...base, editable: true, password: true, value: '••••'}, 0);
    expect(secret.secure).toBe(true);
    expect(secret).not.toHaveProperty('value');
  });

  it('leaves out what was not reported, and the value of what cannot be edited', () => {
    const label = toSnapshotNode({...base, type: 'android.widget.TextView', value: 'Hello'}, 0);
    for (const field of ['checked', 'selected', 'placeholder', 'secure', 'value']) expect(label).not.toHaveProperty(field);
  });
});

describe('real snapshots', () => {
  const fixture = (name: string) => toSnapshotNodes(nodesFrom(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', '__fixtures__', name), 'utf8'))));

  it('reads the emulator\'s search field: its placeholder, and empty while the hint shows', () => {
    const field = fixture('android-search.json').find(node => node.role === 'android.widget.EditText');
    expect(field).toMatchObject({placeholder: 'Search settings', value: '', focused: true});
  });

  it('reads the emulator\'s switch as off, and no node as selected', () => {
    const nodes = fixture('android-display.json');
    expect(nodes.find(node => node.role === 'android.widget.Switch')).toMatchObject({name: 'Dark theme', checked: false});
    expect(nodes.filter(node => 'selected' in node)).toEqual([]);
  });
});

describe("the device's settings through agent-device", () => {
  it('spells each setting for the command line, and hands the client its own spelling', () => {
    const updates = [
      [{setting: 'appearance', state: 'dark'}, ['settings', 'appearance', 'dark']],
      [{setting: 'wifi', state: 'off'}, ['settings', 'wifi', 'off']],
      [{setting: 'airplane', state: 'on'}, ['settings', 'airplane', 'on']],
      [{setting: 'location', state: 'set', latitude: 51.5, longitude: -0.12}, ['settings', 'location', 'set', '51.5', '-0.12']],
      [{setting: 'location', state: 'set', latitude: 1, longitude: 2, app: 'com.example.app'}, ['settings', 'location', 'set', '1', '2', '--app', 'com.example.app']],
      [{setting: 'location', state: 'off'}, ['settings', 'location', 'off']],
      [{setting: 'location', state: 'off', app: 'com.example.app'}, ['settings', 'location', 'off', '--app', 'com.example.app']],
      [{setting: 'faceid', state: 'enroll'}, ['settings', 'faceid', 'enroll']],
      [{setting: 'fingerprint', state: 'nonmatch'}, ['settings', 'fingerprint', 'nonmatch']],
    ] as const;
    for (const [update, args] of updates) {
      expect(settingArgs(update)).toEqual(args);
      expect(settingRequest(update)).toEqual(update);
    }
  });

  it('spells each device command for the command line, and as the client method and its options', () => {
    expect(commandArgs({command: 'orientation', orientation: 'landscape-left'})).toEqual(['orientation', 'landscape-left']);
    expect(commandArgs({command: 'fold', pose: 'half-open'})).toEqual(['fold', 'half-open']);
    expect(commandArgs({command: 'clipboard', action: 'read'})).toEqual(['clipboard', 'read', '--json']);
    expect(commandArgs({command: 'clipboard', action: 'write', text: 'a b'})).toEqual(['clipboard', 'write', 'a b']);
    expect(commandArgs({command: 'keyboard', action: 'dismiss'})).toEqual(['keyboard', 'dismiss']);
    expect(commandArgs({command: 'alert', action: 'accept'})).toEqual(['alert', 'accept']);
    expect(commandRequest({command: 'fold', pose: 'open'})).toEqual({method: 'fold', options: {pose: 'open'}});
    expect(commandRequest({command: 'clipboard', action: 'write', text: 'x'})).toEqual({method: 'clipboard', options: {action: 'write', text: 'x'}});
  });

  it('reads the clipboard from what the command line and the client answer', () => {
    expect(clipboardText({success: true, data: {action: 'read', text: 'copied'}})).toBe('copied');
    expect(clipboardText({action: 'read', text: ''})).toBe('');
    expect(clipboardText({action: 'write', textLength: 3})).toBeNull();
    expect(clipboardText({data: 'text'})).toBeNull();
    expect(clipboardText(null)).toBeNull();
  });
});

describe("the app's life through agent-device", () => {
  it('opens an app relaunched, with each launch argument, on the command line', () => {
    expect(launchArgs('com.example.app', true, ['--initialUrl', 'http://localhost:8081'])).toEqual(['open', 'com.example.app', '--relaunch', '--launch-args', '--initialUrl', '--launch-args', 'http://localhost:8081']);
    expect(launchArgs('com.example.app', false, [])).toEqual(['open', 'com.example.app']);
  });

  it('installs a build, naming the app where it has one, and needs it to reinstall', () => {
    expect(installArgs(undefined, '/builds/app.apk', false)).toEqual(['install', '/builds/app.apk']);
    expect(installArgs('com.example.app', '/builds/app.apk', false)).toEqual(['install', 'com.example.app', '/builds/app.apk']);
    expect(installArgs('com.example.app', '/builds/app.apk', true)).toEqual(['reinstall', 'com.example.app', '/builds/app.apk']);
    expect(installArgs(undefined, '/builds/app.apk', true)).toEqual(['reinstall', '', '/builds/app.apk']);
  });

  it("spells a permission and an app's state cleared for the command line and the client", () => {
    const permission = {setting: 'permission', state: 'grant', permission: 'camera', app: 'com.example.app'} as const;
    expect(settingArgs(permission)).toEqual(['settings', 'permission', 'grant', 'camera', '--app', 'com.example.app']);
    expect(settingRequest(permission)).toEqual({setting: 'permission', state: 'grant', permission: 'camera', app: 'com.example.app'});
    expect(settingArgs({setting: 'clear-app-state', app: 'com.example.app'})).toEqual(['settings', 'clear-app-state', 'com.example.app']);
    expect(settingRequest({setting: 'clear-app-state', app: 'com.example.app'})).toEqual({setting: 'clear-app-state', state: 'clear', app: 'com.example.app'});
  });

  it('reads the app in front from what the command line and the client answer', () => {
    expect(foregroundOf({success: true, data: {platform: 'android', package: 'com.android.settings', activity: 'com.android.settings.SubSettings'}})).toEqual({
      app: 'com.android.settings',
      said: 'com.android.settings, on com.android.settings.SubSettings',
    });
    expect(foregroundOf({platform: 'ios', appName: 'Example', appBundleId: 'com.example.app', source: 'runner'})).toEqual({app: 'com.example.app', said: 'com.example.app'});
    expect(foregroundOf({platform: 'ios', appName: 'Example', source: 'session'})).toEqual({app: 'Example', said: 'Example'});
    expect(foregroundOf({platform: 'android', package: ''})).toBeNull();
    expect(foregroundOf({data: null})).toBeNull();
    expect(foregroundOf('nothing')).toBeNull();
    expect(foregroundOf(null)).toBeNull();
  });
});

describe("the device's capabilities", () => {
  const device = {platform: 'android', id: 'emulator-5554', name: 'Pixel 9 Pro XL', kind: 'emulator', target: 'mobile', model: 'sdk_gphone64_x86_64', osVersion: '16', booted: true};

  it('are read from what the command line prints and the client answers', () => {
    expect(capabilitiesFrom({success: true, data: {device, availableCommands: ['open', 'fold']}})).toEqual({device, availableCommands: ['open', 'fold']});
    expect(capabilitiesFrom({device})).toEqual({device, availableCommands: []});
    expect(capabilitiesFrom({data: {availableCommands: []}})).toBeNull();
    expect(capabilitiesFrom('capabilities')).toBeNull();
    expect(capabilitiesFrom(null)).toBeNull();
  });

  it("say what the device is: its name, its kind and its version", () => {
    expect(factsOf({device, availableCommands: []})).toEqual({name: 'Pixel 9 Pro XL', kind: 'emulator', osVersion: '16'});
    expect(factsOf({device: {name: 'iPhone 17', platform: 'ios', kind: 'simulator', target: 'mobile'}, availableCommands: []})).toEqual({name: 'iPhone 17', kind: 'simulator'});
  });
});

describe("the box a device's tree is measured in", () => {
  it('is the viewport the client or the command line gives beside the nodes', () => {
    expect(viewportFrom({nodes: [], viewport: {width: 390, height: 844}})).toEqual({width: 390, height: 844});
    expect(viewportFrom({success: true, data: {nodes: [], viewport: {width: 1080, height: 2400}}})).toEqual({width: 1080, height: 2400});
  });

  it('is nothing where none was measured, or what was given is not a box', () => {
    expect(viewportFrom({nodes: []})).toBeUndefined();
    expect(viewportFrom({data: 'nodes'})).toBeUndefined();
    expect(viewportFrom({viewport: {width: 0, height: 10}})).toBeUndefined();
    expect(viewportFrom({viewport: {width: '390', height: 844}})).toBeUndefined();
    expect(viewportFrom(null)).toBeUndefined();
  });
});

describe('the status bar in a screenshot', () => {
  it("is agent-device's own on Android unless real, and normalised on iOS when fixed", () => {
    expect(screenshotArgs('android')).toEqual([]);
    expect(screenshotArgs('android', 'real')).toEqual(['--no-stabilize']);
    expect(screenshotArgs('ios')).toEqual(['--normalize-status-bar']);
    expect(screenshotArgs('ios', 'real')).toEqual([]);
    expect(screenshotRequest('android')).toEqual({});
    expect(screenshotRequest('android', 'real')).toEqual({stabilize: false});
    expect(screenshotRequest('ios', 'fixed')).toEqual({normalizeStatusBar: true});
    expect(screenshotRequest('ios', 'real')).toEqual({});
  });
});

describe('a recording through agent-device', () => {
  it('starts into a file, of the whole screen, and stops, on the command line', () => {
    expect(recordArgs('start', '/r/a.mp4')).toEqual(['record', 'start', '/r/a.mp4', '--scope', 'device']);
    expect(recordArgs('start')).toEqual(['record', 'start', '--scope', 'device']);
    expect(recordArgs('stop', '/r/a.mp4')).toEqual(['record', 'stop']);
  });
});

describe('a hosted device through agent-device', () => {
  it('connects to its provider with the flags the config gives, and never with a login', () => {
    expect(connectArgs('limrun')).toEqual(['connect', 'limrun', '--no-login']);
    expect(connectArgs('browserstack', {device: 'Google Pixel 8', 'provider-os-version': '14.0', 'provider-no-resign-app': true, force: false})).toEqual([
      'connect',
      'browserstack',
      '--no-login',
      '--device',
      'Google Pixel 8',
      '--provider-os-version',
      '14.0',
      '--provider-no-resign-app',
    ]);
  });
});

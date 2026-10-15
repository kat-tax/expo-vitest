import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import type {Whereabouts} from './agent-device-mapping.ts';
import {
  clientEntry,
  clientTarget,
  cliScript,
  codeFor,
  describeDevice,
  describeFailure,
  nodesFrom,
  openTarget,
  packageFolders,
  parseFailure,
  parsePayload,
  toAgentTarget,
  toSnapshotNode,
} from './agent-device-mapping.ts';

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

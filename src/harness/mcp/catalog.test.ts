import fs from 'node:fs';
import {describe, expect, it} from 'vitest';
import {done, FakeDevice, hostOf, node, signIn} from '../../agent/__fixtures__/device.ts';
import {SecretStore} from '../../agent/secrets.ts';
import {defineTool} from '../../agent/tools.ts';
import {encodePng} from '../lib/png.ts';
import type {Snapshot} from '../lib/snapshot.ts';
import {createCatalog, filled, locate, narrowings} from './catalog.ts';

const env = {} as NodeJS.ProcessEnv;
const none = {type: 'object', properties: {}, required: [], additionalProperties: false};

function catalogOf(options: {device?: FakeDevice; secrets?: SecretStore; capabilities?: string[]; tools?: Parameters<typeof createCatalog>[0]['tools']; uploads?: ReadonlyMap<string, string>; recordings?: string} = {}) {
  const device = options.device ?? new FakeDevice();
  const host = hostOf(device, options.capabilities ? {capabilities: new Set(options.capabilities)} : {});
  const catalog = createCatalog({
    host,
    secrets: options.secrets ?? new SecretStore({ADA_PASSWORD: 'correct horse battery'}, env),
    signal: new AbortController().signal,
    ...(options.tools ? {tools: options.tools} : {}),
    ...(options.uploads ? {uploads: options.uploads} : {}),
    ...(options.recordings ? {recordings: options.recordings} : {}),
  });
  return {catalog, device};
}

/** The text of an answer. */
const said = (answer: {content: {type: string; text?: string}[]}) => answer.content.map(part => part.text ?? `[${part.type}]`).join('\n');

describe("a session's catalog", () => {
  it("is the agent's tools the platform can do, type_secret where the config has a secret, the project's tools, and locate, by name", () => {
    expect(catalogOf().catalog.list().map(tool => tool.name)).toEqual(['back', 'check', 'dismiss_keyboard', 'double_tap', 'locate', 'long_press', 'navigate', 'observe', 'press', 'screenshot', 'scroll', 'scroll_to', 'tap', 'tap_at', 'type', 'type_secret']);
    const seed = defineTool({name: 'seed_cart', description: 'Seed.', schema: none, execute: () => 'seeded'});
    const plain = catalogOf({secrets: new SecretStore({}, env), capabilities: ['press'], tools: [seed]});
    expect(plain.catalog.list().map(tool => tool.name)).toEqual(['check', 'double_tap', 'locate', 'observe', 'seed_cart', 'tap']);
    expect(plain.catalog.list().find(tool => tool.name === 'tap')).toEqual({name: 'tap', description: 'Press the node a ref names.', inputSchema: expect.objectContaining({required: ['ref']})});
    const handing = catalogOf({capabilities: ['press', 'web'], uploads: new Map([['fixtures/avatar.png', '/app/fixtures/avatar.png']])});
    expect(handing.catalog.list().find(tool => tool.name === 'upload')?.inputSchema).toMatchObject({properties: {file: {enum: ['fixtures/avatar.png']}}});
  });

  it('reads the screen, and acts on a ref, answering what changed', async () => {
    const device = new FakeDevice();
    device.onPress = () => signIn({signedIn: true});
    const {catalog} = catalogOf({device});
    const first = await catalog.observe();
    expect([first.text.split('\n')[0], first.tree.nodes.length]).toEqual(['window: 400x800', 5]);
    expect(said(await catalog.call('tap', {ref: '@e5'}))).toContain('@e6  heading  "Welcome back"  h1');
    expect(device.calls).toEqual(['press {"ref":"@e14"}']);
  });

  it('takes an optional argument left out as null', async () => {
    const {catalog, device} = catalogOf();
    await catalog.call('long_press', {ref: '@e5'});
    expect(device.calls).toEqual(['longPress {"ref":"@e14"} 800']);
    expect(said(await catalog.call('observe', undefined))).toContain('button  "Sign in"');
  });

  it('answers a tool it has not got, an input its schema refuses, and a ref no longer on the screen, each as an error the model reads', async () => {
    const {catalog} = catalogOf();
    expect(await catalog.call('wave', {})).toEqual({content: [{type: 'text', text: expect.stringMatching(/^UNKNOWN_TOOL: there is no tool called wave; the tools are back, check, /)}], isError: true});
    expect(await catalog.call('tap', {})).toEqual({content: [{type: 'text', text: 'INVALID_ARGUMENT: $.ref is missing'}], isError: true});
    expect(said(await catalog.call('tap', {ref: '@e40'}))).toBe('NODE_STALE: @e40 is not on the screen now; observe to see what is');
  });

  it("types a secret by its name, hides its value in every answer, and sends no picture after it, saying why", async () => {
    const device = new FakeDevice({
      screenshot: file => {
        fs.writeFileSync(file, encodePng({width: 400, height: 800, pixels: Buffer.alloc(400 * 800 * 4, 255)}));
        return Promise.resolve(done());
      },
      fill: (_target, text) => Promise.resolve({ok: false, message: `the field refused ${text}`}),
    });
    const {catalog} = catalogOf({device});
    const picture = await catalog.call('screenshot', {});
    expect(picture.content.map(part => part.type)).toEqual(['text', 'image']);
    expect(picture.content[1]).toMatchObject({type: 'image', mimeType: 'image/png'});
    expect(said(await catalog.call('type_secret', {ref: '@e3', secret: 'ADA_PASSWORD'}))).toBe('ACTION_FAILED: the field refused <secret:ADA_PASSWORD>');
    expect(said(await catalog.call('screenshot', {}))).toBe('PIXEL_TAINTED: a secret was filled in this test, so no picture of the screen leaves it');
    expect(said(await catalog.call('tap_at', {x: 1, y: 1}))).toBe('PIXEL_TAINTED: a secret was filled in this test, so the pixel tools are off');
  });

  it('records where the platform records, keeping the video in the recordings folder at the stop, and answering where', async () => {
    const device: FakeDevice = new FakeDevice({
      video: (action, file) => {
        device.calls.push(`video ${action}${file ? ` ${file}` : ''}`);
        return Promise.resolve(action === 'stop' && file ? {...done(), value: file} : done());
      },
    });
    const {catalog} = catalogOf({device, capabilities: ['press', 'video'], recordings: '/project/.harness/mcp/recordings'});
    expect(catalog.list().map(tool => tool.name)).toEqual(expect.arrayContaining(['start_recording', 'stop_recording']));
    expect(said(await catalog.call('stop_recording', {}))).toBe('NOT_RECORDING: nothing is being recorded; start_recording starts it');
    expect(said(await catalog.call('start_recording', {}))).toBe('recording the screen; stop_recording keeps it');
    expect(said(await catalog.call('start_recording', {}))).toBe('already recording; stop_recording keeps it');
    const kept = await catalog.call('stop_recording', {});
    expect(said(kept)).toMatch(/^kept the recording at .*recordings[\\/]\d{4}-\d{2}-\d{2}T[\d-]+Z\.webm$/);
    expect(kept.structuredContent?.file).toMatch(/\.webm$/);
    expect(device.calls).toEqual(['video start', expect.stringMatching(/^video stop .*\.webm$/)]);
    expect(catalogOf({capabilities: ['press'], recordings: '/r'}).catalog.list().map(tool => tool.name)).not.toContain('start_recording');
    expect(catalogOf({capabilities: ['press', 'video']}).catalog.list().map(tool => tool.name)).not.toContain('start_recording');
  });

  it('starts no recording after a secret was filled, and throws away one a secret was filled during', async () => {
    const device: FakeDevice = new FakeDevice({
      video: action => Promise.resolve((device.calls.push(`video ${action}`), done())),
      fill: () => Promise.resolve(done()),
    });
    const {catalog} = catalogOf({device, capabilities: ['press', 'fill', 'video'], recordings: '/r'});
    await catalog.call('start_recording', {});
    await catalog.call('type_secret', {ref: '@e3', secret: 'ADA_PASSWORD'});
    expect(said(await catalog.call('stop_recording', {}))).toBe('a secret was filled while it recorded, so the recording was thrown away');
    expect(device.calls.filter(call => call.startsWith('video'))).toEqual(['video start', 'video stop']);
    expect(said(await catalog.call('start_recording', {}))).toBe('PIXEL_TAINTED: a secret was filled in this session, so no recording of it leaves it');
  });

  it("answers a recording the driver could not start or keep with the driver's own failure", async () => {
    const refusing = new FakeDevice({video: () => Promise.resolve({ok: false, code: 'ACTION_FAILED', message: 'no screen to record'})});
    expect(said(await catalogOf({device: refusing, capabilities: ['video'], recordings: '/r'}).catalog.call('start_recording', {}))).toBe('ACTION_FAILED: no screen to record');
    expect(said(await catalogOf({capabilities: ['video'], recordings: '/r'}).catalog.call('start_recording', {}))).toBe('TOOL_FAILED: the platform records nothing');
    let calls = 0;
    const losing = new FakeDevice({video: () => Promise.resolve(++calls === 1 ? done() : {ok: false, message: 'the file could not be written'})});
    const {catalog} = catalogOf({device: losing, capabilities: ['video'], recordings: '/r'});
    await catalog.call('start_recording', {});
    expect(said(await catalog.call('stop_recording', {}))).toBe('TOOL_FAILED: the file could not be written');
    const silent = new FakeDevice({video: () => Promise.resolve(done())});
    const quiet = catalogOf({device: silent, capabilities: ['video'], recordings: '/r'}).catalog;
    await quiet.call('start_recording', {});
    expect(said(await quiet.call('stop_recording', {}))).toMatch(/^kept the recording at .*\.webm$/);
  });

  it("names a device's recording as agent-device writes one, an mp4", async () => {
    const device = new FakeDevice({video: () => Promise.resolve(done())});
    const host = {...hostOf(device, {capabilities: new Set(['video'])}), platform: 'android' as const};
    const catalog = createCatalog({host, secrets: new SecretStore({}, env), signal: new AbortController().signal, recordings: '/r'});
    await catalog.call('start_recording', {});
    expect(said(await catalog.call('stop_recording', {}))).toMatch(/^kept the recording at .*[\\/]\d{4}-[\d-]+T[\d-]+Z\.mp4$/);
  });

  it("refuses a picture for a reason of the policy's own as POLICY_DENIED, naming the ref the session knows", async () => {
    const device = new FakeDevice();
    device.screen = {...signIn(), nodes: signIn().nodes.map(each => (each.secure ? {...each, bounds: undefined} : each))};
    const {catalog} = catalogOf({device});
    expect(said(await catalog.call('screenshot', {}))).toBe('POLICY_DENIED: the secure field @e3 has no bounds to paint over, so a picture could show it');
  });

  it("tells a project tool the app's scheme, where the session has one", async () => {
    const seen: unknown[] = [];
    const where = defineTool({name: 'where', description: 'Where.', schema: none, execute: (_input, context) => void seen.push(context.app)});
    const device = new FakeDevice();
    const catalog = createCatalog({host: hostOf(device, {scheme: 'entz'}), secrets: new SecretStore({}, env), signal: new AbortController().signal, tools: [where]});
    await catalog.call('where', {});
    expect(seen).toEqual([{scheme: 'entz'}]);
  });

  it("answers a project tool's text, and its failure, without the step an agent's error names", async () => {
    const seed = defineTool({name: 'seed_cart', description: 'Seed.', schema: none, execute: () => 'seeded correct horse battery'});
    const peek = defineTool({name: 'peek', description: 'Peek.', schema: none, mutates: true, execute: (_input, context) => context.observe()});
    const odd = defineTool({name: 'odd', description: 'Odd.', schema: none, execute: () => Promise.reject('a string')});
    const {catalog} = catalogOf({tools: [seed, peek, odd]});
    expect(said(await catalog.call('seed_cart', {}))).toBe('seeded <secret:ADA_PASSWORD>');
    expect(said(await catalog.call('peek', {}))).toBe('POLICY_DENIED: a tool that changes the app may not look at the screen: look in a call of its own');
    expect(said(await catalog.call('odd', {}))).toBe('TOOL_FAILED: a string');
  });
});

describe('locate', () => {
  const tree: Snapshot = {
    platform: 'web',
    nodes: [
      node('@e1', 'button', 'Save', {kind: 'button', testId: 'save-draft', interactive: true}),
      node('@e2', 'button', 'Save', {kind: 'button', testId: 'save-final', interactive: true}),
      node('@e3', 'button', 'Cancel', {kind: 'button', interactive: true}),
      node('@e4', 'link', 'Help', {kind: 'link', interactive: true}),
      node('@e5', 'link', 'Help', {kind: 'link', interactive: true}),
      node('@e6', 'textbox', 'Email', {kind: 'textbox', placeholder: 'you@example.com', interactive: true}),
    ],
  };

  it('answers the call that finds one node', () => {
    expect(locate({role: 'button', name: 'Cancel'}, tree)).toEqual({count: 1, suggestion: 'screen.getByRole("button", {name: "Cancel"})', matches: [{ref: '@e3', kind: 'button', name: 'Cancel'}]});
    expect(locate({placeholder: 'you@example.com'}, tree)).toMatchObject({count: 1, suggestion: 'screen.getByPlaceholderText("you@example.com")'});
    expect(locate({testId: 'save-final'}, tree)).toMatchObject({count: 1, matches: [{ref: '@e2', testId: 'save-final'}]});
  });

  it('answers, for several, the call that finds each alone: its test id, its name, or its place', () => {
    expect(locate({text: 'Save'}, tree)).toMatchObject({count: 2, suggestions: ['screen.getByTestId("save-draft")', 'screen.getByTestId("save-final")']});
    expect(locate({role: 'link'}, tree)).toMatchObject({count: 2, suggestions: ['screen.getByRole("link").nth(0)', 'screen.getByRole("link").nth(1)']});
    const query = {predicate: 'role' as const, match: 'button', options: {}, refinements: [], cardinality: 'many' as const};
    expect(narrowings(query, [{name: 'Save'}, {name: 'Cancel'}])).toEqual(['screen.getByRole("button", {name: "Save"})', 'screen.getByRole("button", {name: "Cancel"})']);
  });

  it('answers the names near a miss, where there are any', () => {
    expect(locate({text: 'Sav'}, tree)).toEqual({count: 0, near: ['Save'], matches: []});
    expect(locate({label: 'Nothing like it'}, tree)).toEqual({count: 0, matches: []});
  });

  it('takes one of its ways to find, and a name with a role alone', async () => {
    const {catalog} = catalogOf();
    expect(said(await catalog.call('locate', {}))).toBe('INVALID_ARGUMENT: locate takes one of role, text, label, placeholder, testId, not none');
    expect(said(await catalog.call('locate', {role: 'button', text: 'Save'}))).toBe('INVALID_ARGUMENT: locate takes one of role, text, label, placeholder, testId, not role and text');
    expect(said(await catalog.call('locate', {text: 'Save', name: 'x'}))).toBe('INVALID_ARGUMENT: locate takes name with a role alone');
    const found = await catalog.call('locate', {role: 'button', name: 'Sign in'});
    expect([said(found), found.structuredContent]).toEqual([
      JSON.stringify({count: 1, suggestion: 'screen.getByRole("button", {name: "Sign in"})', matches: [{ref: '@e5', kind: 'button', name: 'Sign in'}]}),
      {count: 1, suggestion: 'screen.getByRole("button", {name: "Sign in"})', matches: [{ref: '@e5', kind: 'button', name: 'Sign in'}]},
    ]);
    expect(said(await catalog.call('locate', undefined))).toMatch(/^INVALID_ARGUMENT/);
  });
});

describe('an input as a caller gives it', () => {
  it('fills a nullable property it left out with null, and leaves what is not an object as it is', () => {
    const schema = {type: 'object', properties: {ref: {type: 'string'}, durationMs: {anyOf: [{type: 'integer'}, {type: 'null'}]}}, required: ['ref', 'durationMs'], additionalProperties: false};
    expect(filled(schema, {ref: '@e1'})).toEqual({ref: '@e1', durationMs: null});
    expect(filled(schema, {ref: '@e1', durationMs: 5})).toEqual({ref: '@e1', durationMs: 5});
    expect([filled(schema, 'x'), filled(schema, null), filled(schema, [1])]).toEqual(['x', null, [1]]);
    expect(filled({type: 'object'}, {a: 1})).toEqual({a: 1});
  });
});

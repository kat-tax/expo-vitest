import {describe, expect, it, vi} from 'vitest';
import {FakeDevice, hostOf} from '../../agent/__fixtures__/device.ts';
import {SecretStore} from '../../agent/secrets.ts';
import {HarnessError} from '../lib/errors.ts';
import type {Catalog, ToolAnswer} from './catalog.ts';
import {createCatalog} from './catalog.ts';
import {INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR} from './rpc.ts';
import type {McpSession, OpenArgs} from './server.ts';
import {INSTRUCTIONS, McpServer, PROTOCOL, TOOLS} from './server.ts';

const line = (id: number | string | undefined, method: string, params?: unknown) => JSON.stringify({jsonrpc: '2.0', ...(id === undefined ? {} : {id}), method, ...(params === undefined ? {} : {params})});
const call = (id: number, name: string, args?: unknown) => line(id, 'tools/call', {name, ...(args === undefined ? {} : {arguments: args})});

/** A catalog that answers as a test says. */
function stubCatalog(answer: (name: string, args: unknown) => Promise<ToolAnswer> = async name => ({content: [{type: 'text', text: `ran ${name}`}]})): Catalog {
  return {
    list: () => [
      {name: 'observe', description: 'Read the screen.', inputSchema: {type: 'object'}},
      {name: 'tap', description: 'Press a ref.', inputSchema: {type: 'object', properties: {ref: {type: 'string'}}}},
    ],
    call: answer,
    observe: async () => ({text: '@e1  button  "Save"', tree: {platform: 'web', nodes: [{ref: '@e1', role: 'button', name: 'Save', depth: 1, interactive: true}]}}),
  };
}

function serverOf(options: {open?: (args: OpenArgs) => Promise<McpSession>; configOf?: (args: OpenArgs) => string | null; maxSessions?: number; catalog?: Catalog; send?: (line: string) => void; progressEvery?: number} = {}) {
  const closed: string[] = [];
  let opened = 0;
  const open =
    options.open ??
    (async (args: OpenArgs) => {
      opened += 1;
      const name = `${args.target ?? 'web'}-${opened}`;
      return {platform: args.target ?? 'web', source: 'http://localhost:8090', config: args.config ?? null, catalog: options.catalog ?? stubCatalog(), close: async () => void closed.push(name)};
    });
  const server = new McpServer({
    version: '0.1.0',
    maxSessions: options.maxSessions ?? 4,
    open,
    configOf: options.configOf ?? (args => args.config ?? null),
    secrets: () => [{name: 'ADA_PASSWORD', value: 'correct horse battery'}],
    ...(options.send ? {send: options.send} : {}),
    ...(options.progressEvery ? {progressEvery: options.progressEvery} : {}),
  });
  return {server, closed};
}

/** A server that has said hello. */
async function started(options: Parameters<typeof serverOf>[0] = {}) {
  const made = serverOf(options);
  await made.server.handle(line(0, 'initialize', {protocolVersion: PROTOCOL, capabilities: {}, clientInfo: {name: 'test', version: '1'}}));
  await made.server.handle(line(undefined, 'notifications/initialized'));
  return made;
}

/** A response's result or error. */
const parsed = (text: string | null) => JSON.parse(text as string) as {id: unknown; result?: {content: {type: string; text: string}[]; isError?: true; structuredContent?: Record<string, unknown>} & Record<string, unknown>; error?: {code: number; message: string; data?: unknown}};

describe('the MCP server', () => {
  it('answers ping at any time, and nothing else before initialize', async () => {
    const {server} = serverOf();
    expect(parsed(await server.handle(line(1, 'ping'))).result).toEqual({});
    expect(parsed(await server.handle(line(2, 'tools/list'))).error).toEqual({code: INVALID_REQUEST, message: 'Invalid Request: not initialized'});
  });

  it('says on initialize the revision it speaks, that its tools never change, who it is, and how to use it', async () => {
    const {server} = serverOf();
    expect(parsed(await server.handle(line(1, 'initialize', {protocolVersion: '2025-11-25'}))).result).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: {tools: {listChanged: false}},
      serverInfo: {name: 'expo-harness', version: '0.1.0'},
      instructions: INSTRUCTIONS,
    });
  });

  it("answers a line that is no request with the framing's error, a response and a notification with nothing, and a method it has not got with METHOD_NOT_FOUND", async () => {
    const {server} = await started();
    expect(parsed(await server.handle('{nope'))).toMatchObject({id: null, error: {code: PARSE_ERROR}});
    expect(await server.handle('{"jsonrpc":"2.0","id":4,"result":{}}')).toBeNull();
    expect(await server.handle(line(undefined, 'notifications/roots/list_changed'))).toBeNull();
    expect(parsed(await server.handle(line(5, 'resources/list'))).error).toEqual({code: METHOD_NOT_FOUND, message: 'Method not found: resources/list'});
  });

  it('lists its four tools, each closed to properties it does not take', async () => {
    const {server} = await started();
    const listed = parsed(await server.handle(line(1, 'tools/list'))).result as unknown as {tools: {name: string}[]};
    expect(listed.tools.map(tool => tool.name)).toEqual(['open_session', 'tools', 'call', 'close_session']);
    expect(TOOLS.every(tool => tool.inputSchema.additionalProperties === false)).toBe(true);
  });

  it('refuses a call of a tool it has not got, or arguments its schema does not take, as INVALID_PARAMS', async () => {
    const {server} = await started();
    expect(parsed(await server.handle(call(1, 'run'))).error).toEqual({code: INVALID_PARAMS, message: 'Invalid params: tools/call takes the name of one of open_session, tools, call, close_session'});
    expect(parsed(await server.handle(line(2, 'tools/call', 'open_session'))).error?.code).toBe(INVALID_PARAMS);
    expect(parsed(await server.handle(call(3, 'call', [1]))).error?.message).toBe("Invalid params: call's arguments are an object");
    expect(parsed(await server.handle(call(4, 'call', {tool: 'tap', ref: '@e1'}))).error).toEqual({code: INVALID_PARAMS, message: 'Invalid params: call takes no ref', data: {takes: ['tool', 'args', 'session']}});
    expect(parsed(await server.handle(call(5, 'call', {tool: 7}))).error?.message).toBe("Invalid params: call's tool is a number, where it takes a string");
    expect(parsed(await server.handle(call(6, 'call', {args: null}))).error?.message).toBe("Invalid params: call's args is a null, where it takes a object");
    expect(parsed(await server.handle(call(7, 'call', {}))).error?.message).toBe('Invalid params: call needs tool');
    expect(parsed(await server.handle(call(8, 'call', {tool: ['tap']}))).error?.message).toBe("Invalid params: call's tool is a array, where it takes a string");
    expect(parsed(await server.handle(call(9, 'tools'))).result?.content[0]?.text).toBe('NO_SESSION: no session is open; open one with open_session');
  });

  it('hides nothing where it was given no secrets', async () => {
    const server = new McpServer({version: '0.1.0', maxSessions: 1, open: () => Promise.reject(new Error('no browser')), configOf: () => null});
    await server.handle(line(0, 'initialize', {}));
    expect(parsed(await server.handle(call(1, 'open_session', {}))).result?.content[0]?.text).toBe('INTERNAL: no browser');
  });
});

describe('a session', () => {
  it('opens on a target, answering its id, its tools and the first observation', async () => {
    const {server} = await started();
    const {result} = parsed(await server.handle(call(1, 'open_session', {target: 'web'})));
    expect(result?.content[0]?.text).toBe('session s1 on web (http://localhost:8090, 1 nodes)\ntools: observe tap\n\n@e1  button  "Save"');
    expect(result?.structuredContent).toEqual({session: 's1', platform: 'web', source: 'http://localhost:8090', tools: ['observe', 'tap'], observation: '@e1  button  "Save"'});
    const sourceless = await started({open: async () => ({platform: 'windows', config: null, catalog: stubCatalog(), close: async () => undefined})});
    expect(parsed(await sourceless.server.handle(call(1, 'open_session', {}))).result?.content[0]?.text).toMatch(/^session s1 on windows \(1 nodes\)\n/);
  });

  it("lists its tools, or one tool's schema, and runs one, answering what the catalog said", async () => {
    const {server} = await started();
    await server.handle(call(1, 'open_session', {}));
    const listed = parsed(await server.handle(call(2, 'tools', {})));
    const shown = listed.result as unknown as {content: {text: string}[]; structuredContent: {platform: string}};
    expect([shown.content[0]?.text, shown.structuredContent.platform]).toEqual(['observe: Read the screen.\ntap: Press a ref.', 'web']);
    expect(parsed(await server.handle(call(3, 'tools', {tool: 'tap'}))).result).toMatchObject({content: [{type: 'text', text: '{"type":"object","properties":{"ref":{"type":"string"}}}'}], structuredContent: {name: 'tap'}});
    expect(parsed(await server.handle(call(4, 'tools', {tool: 'wave'}))).result).toEqual({content: [{type: 'text', text: 'UNKNOWN_TOOL: there is no tool called wave; the tools are observe, tap'}], isError: true});
    expect(parsed(await server.handle(call(5, 'call', {tool: 'tap', args: {ref: '@e1'}}))).result).toEqual({content: [{type: 'text', text: 'ran tap'}]});
    expect(parsed(await server.handle(call(6, 'call', {tool: 'observe'}))).result?.content[0]?.text).toBe('ran observe');
  });

  it('is named where several are open, refused where the most are, and closed by its id', async () => {
    const {server, closed} = await started({maxSessions: 2});
    await server.handle(call(1, 'open_session', {target: 'web'}));
    await server.handle(call(2, 'open_session', {target: 'android'}));
    expect(parsed(await server.handle(call(3, 'open_session', {target: 'ios'}))).result).toEqual({content: [{type: 'text', text: 'SESSION_OPEN: 2 sessions are open, the most there may be: close one first (s1, s2)'}], isError: true});
    expect(parsed(await server.handle(call(4, 'call', {tool: 'tap'}))).result?.content[0]?.text).toBe('SESSION_REQUIRED: 2 sessions are open; name one with session (s1, s2)');
    expect(parsed(await server.handle(call(5, 'call', {tool: 'tap', session: 's2'}))).result?.content[0]?.text).toBe('ran tap');
    expect(parsed(await server.handle(call(6, 'close_session', {session: 's1'}))).result).toEqual({content: [{type: 'text', text: 'closed s1'}]});
    expect(parsed(await server.handle(call(7, 'close_session', {session: 's1'}))).result?.content[0]?.text).toBe('NO_SESSION: there is no session s1; the open ones are s2');
    await server.close();
    expect(closed).toEqual(['web-1', 'android-2']);
  });

  it("is refused where the open sessions use another harness config, whose secrets and tools must not meet another's", async () => {
    const {server} = await started();
    await server.handle(call(1, 'open_session', {config: 'a/harness.config.ts'}));
    expect(parsed(await server.handle(call(2, 'open_session', {config: 'b/harness.config.ts'}))).result).toEqual({
      content: [{type: 'text', text: 'CONFIG_IN_USE: the open sessions use a/harness.config.ts; close them to open one on b/harness.config.ts'}],
      isError: true,
    });
    const noFile = await started();
    await noFile.server.handle(call(1, 'open_session', {}));
    expect(parsed(await noFile.server.handle(call(2, 'open_session', {config: 'b.ts'}))).result?.content[0]?.text).toBe('CONFIG_IN_USE: the open sessions use no harness config; close them to open one on b.ts');
    expect(parsed(await server.handle(call(3, 'open_session', {config: 'a/harness.config.ts'}))).result?.content[0]?.text).toMatch(/^session s2 on web/);
    const reversed = await started();
    await reversed.server.handle(call(1, 'open_session', {config: 'a.ts'}));
    expect(parsed(await reversed.server.handle(call(2, 'open_session', {}))).result?.content[0]?.text).toBe('CONFIG_IN_USE: the open sessions use a.ts; close them to open one on no harness config');
  });

  it('opens one session at a time on Windows or a device, closing the one it refused, and several on web', async () => {
    const {server, closed} = await started();
    expect(parsed(await server.handle(call(1, 'open_session', {target: 'windows'}))).result?.content[0]?.text).toMatch(/^session s1 on windows/);
    expect(parsed(await server.handle(call(2, 'open_session', {target: 'web'}))).result?.content[0]?.text).toMatch(/^session s2 on web/);
    expect(parsed(await server.handle(call(3, 'open_session', {target: 'web'}))).result?.content[0]?.text).toMatch(/^session s3 on web/);
    expect(parsed(await server.handle(call(4, 'open_session', {target: 'windows'}))).result).toEqual({
      content: [{type: 'text', text: 'SESSION_OPEN: s1 is open on windows, which one session drives at a time: close it first'}],
      isError: true,
    });
    expect(closed).toEqual(['windows-4']);
    expect(parsed(await server.handle(call(5, 'open_session', {target: 'android'}))).result?.content[0]?.text).toMatch(/^session s5 on android/);
  });

  it('answers an open that failed with its code, every secret hidden, and one that threw no code as INTERNAL', async () => {
    const failing = await started({open: () => Promise.reject(new HarnessError('DRIVER_UNAVAILABLE', 'no browser for correct horse battery'))});
    expect(parsed(await failing.server.handle(call(1, 'open_session', {}))).result).toEqual({content: [{type: 'text', text: 'DRIVER_UNAVAILABLE: no browser for <secret:ADA_PASSWORD>'}], isError: true});
    const odd = await started({open: () => Promise.reject('a string')});
    expect(parsed(await odd.server.handle(call(1, 'open_session', {}))).result?.content[0]?.text).toBe('INTERNAL: a string');
  });

  it('gives no answer to a call the client cancelled while it ran, and passes over a cancel it cannot read', async () => {
    let finish: (answer: ToolAnswer) => void = () => undefined;
    const {server} = await started({catalog: stubCatalog(() => new Promise(resolve => (finish = resolve)))});
    await server.handle(call(1, 'open_session', {}));
    const running = server.handle(call(9, 'call', {tool: 'tap', args: {ref: '@e1'}}));
    expect(await server.handle(line(undefined, 'notifications/cancelled', {requestId: 9, reason: 'the user stopped it'}))).toBeNull();
    expect(await server.handle(line(undefined, 'notifications/cancelled', 'nine'))).toBeNull();
    expect(await server.handle(line(undefined, 'notifications/cancelled', {requestId: {id: 9}}))).toBeNull();
    const turn = () => new Promise(resolve => setImmediate(resolve));
    await turn();
    finish({content: [{type: 'text', text: 'pressed'}]});
    expect(await running).toBeNull();
    const next = server.handle(call(10, 'call', {tool: 'tap'}));
    await turn();
    finish({content: [{type: 'text', text: 'pressed'}]});
    expect(parsed(await next).result?.content[0]?.text).toBe('pressed');
  });

  it('tells a client that gave a progress token that its call is still going, every two seconds, until it ends', async () => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
    try {
      const sent: string[] = [];
      let finish: (answer: ToolAnswer) => void = () => undefined;
      const {server} = await started({catalog: stubCatalog(() => new Promise(resolve => (finish = resolve))), send: each => void sent.push(each)});
      await server.handle(call(1, 'open_session', {}));
      const running = server.handle(line(2, 'tools/call', {name: 'call', arguments: {tool: 'tap', args: {ref: '@e1'}}, _meta: {progressToken: 'tap-1'}}));
      vi.advanceTimersByTime(4000);
      expect(sent.map(each => JSON.parse(each))).toEqual([
        {jsonrpc: '2.0', method: 'notifications/progress', params: {progressToken: 'tap-1', progress: 1, message: 'call tap: still going after 2 s'}},
        {jsonrpc: '2.0', method: 'notifications/progress', params: {progressToken: 'tap-1', progress: 2, message: 'call tap: still going after 4 s'}},
      ]);
      await new Promise(resolve => setImmediate(resolve));
      finish({content: [{type: 'text', text: 'pressed'}]});
      expect(parsed(await running).result?.content[0]?.text).toBe('pressed');
      vi.advanceTimersByTime(10_000);
      expect(sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names an open by its platform, and says nothing where the client gave no token, a token of another kind, or cancelled the call', async () => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
    try {
      const sent: string[] = [];
      let opened: (session: McpSession) => void = () => undefined;
      let finish: (answer: ToolAnswer) => void = () => undefined;
      const catalog = stubCatalog(() => new Promise(resolve => (finish = resolve)));
      const {server} = await started({open: () => new Promise(resolve => (opened = resolve)), send: each => void sent.push(each), progressEvery: 1000});
      const opening = server.handle(line(1, 'tools/call', {name: 'open_session', arguments: {target: 'android'}, _meta: {progressToken: 7}}));
      vi.advanceTimersByTime(1000);
      expect(JSON.parse(sent[0] as string).params).toEqual({progressToken: 7, progress: 1, message: 'open_session on android: still going after 1 s'});
      opened({platform: 'android', config: null, catalog, close: async () => undefined});
      await opening;
      const turn = () => new Promise(resolve => setImmediate(resolve));
      for (const meta of [undefined, {progressToken: {id: 3}}, 'tap']) {
        const quiet = server.handle(line(2, 'tools/call', {name: 'call', arguments: {tool: 'tap'}, ...(meta === undefined ? {} : {_meta: meta})}));
        vi.advanceTimersByTime(5000);
        await turn();
        finish({content: [{type: 'text', text: 'pressed'}]});
        await quiet;
      }
      const cancelled = server.handle(line(3, 'tools/call', {name: 'call', arguments: {tool: 'tap'}, _meta: {progressToken: 'gone'}}));
      await server.handle(line(undefined, 'notifications/cancelled', {requestId: 3}));
      vi.advanceTimersByTime(5000);
      await turn();
      finish({content: [{type: 'text', text: 'pressed'}]});
      expect(await cancelled).toBeNull();
      expect(sent).toHaveLength(1);
      const silent = await started({catalog, progressEvery: 1000});
      await silent.server.handle(call(1, 'open_session', {}));
      const unsent = silent.server.handle(line(2, 'tools/call', {name: 'close_session', arguments: {}, _meta: {progressToken: 1}}));
      vi.advanceTimersByTime(5000);
      expect(parsed(await unsent).result?.content[0]?.text).toMatch(/^closed /);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs a real catalog over the device, the agent's tools behind call", async () => {
    const device = new FakeDevice();
    const catalog = createCatalog({host: hostOf(device), secrets: new SecretStore({}, {} as NodeJS.ProcessEnv), signal: new AbortController().signal});
    const {server} = await started({catalog});
    const opened = parsed(await server.handle(call(1, 'open_session', {})));
    expect(opened.result?.content[0]?.text).toContain('@e5  button  "Sign in"');
    expect(parsed(await server.handle(call(2, 'call', {tool: 'tap', args: {ref: '@e5'}}))).result?.content[0]?.text).toBe('screen: unchanged');
    expect(device.calls).toEqual(['press {"ref":"@e14"}']);
  });
});

import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {InspectorPage, Socket} from './metro.ts';
import {cdp, choosePage, consoleLine, followConsole, metroFrom, readReact, serverOf, symbolicate} from './metro.ts';

const page = (id: string, extra: Partial<InspectorPage> = {}): InspectorPage => ({
  id,
  title: `App ${id}`,
  webSocketDebuggerUrl: `ws://localhost:8081/inspector/debug?page=${id}`,
  reactNative: {capabilities: {supportsMultipleDebuggers: true}},
  ...extra,
});

/** A socket a test drives: what it was sent, and a way to answer or fail. */
function fakeSocket() {
  const listeners = new Map<string, ((event: {data?: unknown}) => void)[]>();
  const sent: {id: number; method: string; params: unknown}[] = [];
  const socket: Socket & {emit(type: string, data?: unknown): void; listening(type: string): boolean; sent: typeof sent; closed: boolean} = {
    sent,
    closed: false,
    listening: type => (listeners.get(type) ?? []).length > 0,
    send: data => void sent.push(JSON.parse(data)),
    close: () => void (socket.closed = true),
    addEventListener: (type, listener) => void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    emit: (type, data) => {
      for (const listener of listeners.get(type) ?? []) listener({data});
    },
  };
  return socket;
}

afterEach(() => vi.useRealTimers());

describe("the app's console", () => {
  it('is read from what the runtime sends: a call to console, or an exception nothing caught', () => {
    const args = [{type: 'string', value: 'low'}, {type: 'number', value: 3}, {type: 'object', description: 'Object'}, {type: 'number', unserializableValue: 'NaN'}, {type: 'undefined'}, {}];
    expect(consoleLine({method: 'Runtime.consoleAPICalled', params: {type: 'warn', args}})).toEqual({level: 'warn', text: 'low 3 Object NaN undefined '});
    expect(consoleLine({method: 'Runtime.consoleAPICalled'})).toEqual({level: 'log', text: ''});
    expect(consoleLine({method: 'Runtime.exceptionThrown', params: {exceptionDetails: {text: 'Uncaught', exception: {description: 'TypeError: x is undefined'}}}})).toEqual({level: 'uncaught', text: 'TypeError: x is undefined'});
    expect(consoleLine({method: 'Runtime.exceptionThrown', params: {exceptionDetails: {text: 'Uncaught'}}})).toEqual({level: 'uncaught', text: 'Uncaught'});
    expect(consoleLine({method: 'Runtime.exceptionThrown'})).toEqual({level: 'uncaught', text: 'an exception nothing caught'});
    // A terminal's colours are taken out, and React Native's note to a debugger that is not its DevTools left out.
    const escape = String.fromCharCode(27);
    expect(consoleLine({method: 'Runtime.consoleAPICalled', params: {type: 'log', args: [{type: 'string', value: `${escape}[1mbold${escape}[22m text`}]}})).toEqual({level: 'log', text: 'bold text'});
    const note = `${escape}[48;2;253;247;231m${escape}[30m${escape}[1mNOTE: ${escape}[22mYou are using an unsupported debugging client. Use the Dev Menu in your app to open React Native DevTools.`;
    expect(consoleLine({method: 'Runtime.consoleAPICalled', params: {type: 'info', args: [{type: 'string', value: note}]}})).toBeNull();
    expect(consoleLine({method: 'Debugger.paused'})).toBeNull();
    expect(consoleLine({})).toBeNull();
  });

  it('is followed over a connection held open, looked for again while there is no page, and again once the app is back', async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const lists = [[], [page('1', {appId: 'com.example.app'})], [page('2', {appId: 'com.example.app'})]];
    let looks = 0;
    const waits: number[] = [];
    const lines: string[] = [];
    const following = followConsole(
      {
        url: 'http://metro',
        take: false,
        app: 'com.example.app',
        fetch: async () => ({ok: true, json: async () => lists[Math.min(looks++, lists.length - 1)]}),
        connect: () => {
          const socket = fakeSocket();
          sockets.push(socket);
          return socket;
        },
      },
      (level, text) => lines.push(`${level}: ${text}`),
      async ms => void waits.push(ms),
    );
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const first = sockets[0] as ReturnType<typeof fakeSocket>;
    first.emit('open');
    expect(first.sent).toEqual([{id: 1, method: 'Runtime.enable', params: {}}]);
    first.emit('message', JSON.stringify({method: 'Runtime.consoleAPICalled', params: {type: 'log', args: [{type: 'string', value: 'hello'}]}}));
    first.emit('message', 'not json');
    first.emit('message', JSON.stringify({id: 1, result: {}}));
    // The app restarted: its page went, and a new one is listed.
    first.emit('close');
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    const second = sockets[1] as ReturnType<typeof fakeSocket>;
    second.emit('message', JSON.stringify({method: 'Runtime.exceptionThrown', params: {exceptionDetails: {text: 'boom'}}}));
    // A connection that fails is looked for again, as one that closed is.
    second.emit('error');
    await vi.waitFor(() => expect(sockets).toHaveLength(3));
    following.stop();
    expect((sockets[2] as ReturnType<typeof fakeSocket>).closed).toBe(true);
    expect(lines).toEqual(['log: hello', 'uncaught: boom']);
    expect(waits).toEqual([1000, 1000, 1000]);
  });

  it('looks again a second after a miss, then twice as long each time, up to ten, and stops between looks', async () => {
    const waits: number[] = [];
    const following = followConsole({url: 'http://metro', take: false, fetch: () => Promise.reject(new Error('refused'))}, () => {}, async ms => {
      waits.push(ms);
      if (waits.length === 6) following.stop();
    });
    await vi.waitFor(() => expect(waits).toHaveLength(6));
    expect(waits).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
  });

  it('connects to nothing once stopped, though the page comes, and waits without holding the process open', async () => {
    let following: ReturnType<typeof followConsole> | undefined;
    const connect = vi.fn(() => fakeSocket());
    following = followConsole({
      url: 'http://metro',
      take: false,
      app: 'com.example.app',
      fetch: async () => {
        // A look already under way when the follow is stopped.
        await Promise.resolve();
        following?.stop();
        return {ok: true, json: async () => [page('1', {appId: 'com.example.app'})]};
      },
      connect,
    }, () => {});
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(connect).not.toHaveBeenCalled();
    let calls = 0;
    const idle = followConsole({url: 'http://metro', take: false, fetch: async () => (calls++, {ok: true, json: async () => []})}, () => {});
    await vi.waitFor(() => expect(calls).toBe(1));
    // Into its pause, whose timer holds nothing open, before it is stopped.
    await new Promise(resolve => setTimeout(resolve, 20));
    idle.stop();
  });
});

describe('a stack symbolicated', () => {
  const frames = [{file: 'http://localhost:8081/index.bundle?platform=web', line: 900, column: 4, name: 'View'}, {file: 'http://localhost:8081/index.bundle?platform=web', line: 120, column: 9}];

  it("is Metro's answer to one request for every frame, in its words and back", async () => {
    const sent: {url: string; body: unknown}[] = [];
    const send = async (url: string, init: {body: string}) => {
      sent.push({url, body: JSON.parse(init.body)});
      return {ok: true, json: async () => ({stack: [{file: '/app/node_modules/rnw/View.js', lineNumber: 9, column: 1, methodName: 'View'}, {file: '/app/src/Save.tsx', lineNumber: 12}, {lineNumber: 3}], codeFrame: null})};
    };
    expect(await symbolicate(frames, 'http://localhost:8081', send)).toEqual([
      {file: '/app/node_modules/rnw/View.js', line: 9, column: 1, name: 'View'},
      {file: '/app/src/Save.tsx', line: 12, column: 0},
    ]);
    expect(sent).toEqual([
      {
        url: 'http://localhost:8081/symbolicate',
        body: {stack: [{file: frames[0]?.file, lineNumber: 900, column: 4, methodName: 'View'}, {file: frames[1]?.file, lineNumber: 120, column: 9, methodName: ''}]},
      },
    ]);
  });

  it('is null where Metro refuses, answers no stack, or cannot be reached', async () => {
    expect(await symbolicate(frames, 'http://metro', async () => ({ok: false, json: async () => ({})}))).toBeNull();
    expect(await symbolicate(frames, 'http://metro', async () => ({ok: true, json: async () => ({stack: 'no'})}))).toBeNull();
    expect(await symbolicate(frames, 'http://metro', async () => ({ok: true, json: async () => null}))).toBeNull();
    expect(await symbolicate(frames, 'http://metro', () => Promise.reject(new Error('refused')))).toBeNull();
  });

  it("is sent to the server a page's frame names", () => {
    expect(serverOf('http://localhost:41751/node_modules/expo-router/entry.bundle?platform=web')).toBe('http://localhost:41751');
    expect(serverOf('file:///C:/app/index.js')).toBeNull();
    expect(serverOf('<anonymous>')).toBeNull();
  });
});

describe('metroFrom', () => {
  it("is HARNESS_METRO, or Expo's port, and takes a page over only when HARNESS_REACT=take says so", () => {
    expect(metroFrom({} as NodeJS.ProcessEnv)).toEqual({url: 'http://localhost:8081', take: false});
    expect(metroFrom({HARNESS_METRO: 'http://localhost:8086/', HARNESS_REACT: 'take'} as unknown as NodeJS.ProcessEnv)).toEqual({url: 'http://localhost:8086', take: true});
  });
});

describe('choosePage', () => {
  it('takes the newest React Native page with somewhere to connect, or the one the target names', () => {
    const pages = [page('1', {deviceName: 'Pixel_9_Pro_XL'}), page('2', {appId: 'com.example.app'}), page('3', {reactNative: undefined}), page('4', {webSocketDebuggerUrl: undefined})];
    expect(choosePage(pages, {take: false})).toEqual({page: pages[1]});
    expect(choosePage(pages, {take: false, target: 'pixel_9'})).toEqual({page: pages[0]});
    expect(choosePage(pages, {take: false, target: 'nothing'})).toEqual({page: pages[1]});
  });

  it("reads the app under test's own pages alone where its id is known, and refuses another app's", () => {
    const pages = [page('1', {appId: 'com.example.app', deviceName: 'sdk_gphone64_x86_64 - 16 - API 36'}), page('2', {appId: 'com.example.other'}), page('3', {appId: 'com.example.app', deviceName: 'Pixel 9'})];
    expect(choosePage(pages, {take: false, app: 'COM.EXAMPLE.APP'})).toEqual({page: pages[2]});
    expect(choosePage(pages, {take: false, app: 'com.example.app', target: 'sdk_gphone'})).toEqual({page: pages[0]});
    expect(choosePage(pages, {take: false, app: 'com.example.app', target: 'Pixel_9_Pro_XL'})).toEqual({page: pages[2]});
    expect(choosePage([pages[1] as InspectorPage, page('4')], {take: false, app: 'com.example.app'})).toEqual({refused: 'Metro lists no page for com.example.app, only for com.example.other, App 4: it serves another app'});
    expect(choosePage([], {take: false, app: 'com.example.app'})).toEqual({refused: 'Metro lists no app to read: a development build has to be running against it'});
  });

  it('takes only a page the app or the target names where it is to be held open', () => {
    const pages = [page('1', {appId: 'com.example.other'}), page('2', {deviceName: 'Windows', title: 'TestApp'})];
    expect(choosePage(pages, {take: false, target: 'testapp', only: true})).toEqual({page: pages[1]});
    expect(choosePage(pages, {take: false, target: 'MyApp', only: true})).toEqual({refused: 'Metro lists no page that MyApp names'});
    expect(choosePage(pages, {take: false, only: true})).toEqual({refused: 'nothing names the app to follow'});
    expect(choosePage(pages, {take: false, app: 'com.example.other', only: true})).toEqual({page: pages[0]});
  });

  it('refuses where no app is there, or reading would close another debugger, unless told to take it', () => {
    expect(choosePage([], {take: false})).toEqual({refused: 'Metro lists no app to read: a development build has to be running against it'});
    const single = page('1', {reactNative: {capabilities: {}}});
    expect(choosePage([single], {take: false})).toEqual({
      refused: 'Metro would close the debugger already connected to App 1, since the app does not say it takes more than one. HARNESS_REACT=take reads it anyway, and closes React Native DevTools if it is open',
    });
    expect(choosePage([single], {take: true})).toEqual({page: single});
  });
});

describe('cdp', () => {
  it('answers each call by its id, and passes over what is not an answer to one', async () => {
    const socket = fakeSocket();
    const session = cdp(socket);
    const first = session.call('Runtime.evaluate', {expression: '1'});
    const second = session.call('Runtime.enable');
    expect(socket.sent).toEqual([
      {id: 1, method: 'Runtime.evaluate', params: {expression: '1'}},
      {id: 2, method: 'Runtime.enable', params: {}},
    ]);
    socket.emit('message', 'not json');
    socket.emit('message', JSON.stringify({method: 'Runtime.consoleAPICalled'}));
    socket.emit('message', JSON.stringify({id: 9, result: {}}));
    socket.emit('message', JSON.stringify({id: 2, error: {message: 'not allowed'}}));
    socket.emit('message', JSON.stringify({id: 1, result: {value: 1}}));
    await expect(second).rejects.toThrow('not allowed');
    expect(await first).toEqual({value: 1});
    const third = session.call('Runtime.evaluate');
    socket.emit('message', JSON.stringify({id: 3, error: {}}));
    await expect(third).rejects.toThrow('the runtime refused the call');
    session.close();
    expect(socket.closed).toBe(true);
  });

  it('fails what is waiting when the connection closes or fails', async () => {
    const socket = fakeSocket();
    const session = cdp(socket);
    const waiting = session.call('Runtime.evaluate');
    socket.emit('close');
    await expect(waiting).rejects.toThrow('the connection to the app closed');
    const again = session.call('Runtime.evaluate');
    socket.emit('error');
    await expect(again).rejects.toThrow('the connection to the app failed');
  });
});

describe('readReact', () => {
  const listed = (pages: unknown) => async () => ({ok: true, json: async () => pages});

  it('reads the tree from the chosen page, and closes the connection after', async () => {
    const socket = fakeSocket();
    const reading = readReact({url: 'http://metro', take: false, fetch: listed([page('1')]), connect: url => (expect(url).toBe('ws://127.0.0.1:8081/inspector/debug?page=1'), socket)});
    await vi.waitFor(() => expect(socket.listening('open')).toBe(true));
    socket.emit('open');
    // The walk is started, and leaves what it finds in the app, since Hermes's debugger cannot wait on its Promise.
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(socket.sent[0]).toMatchObject({method: 'Runtime.evaluate', params: {returnByValue: true}});
    expect((socket.sent[0] as unknown as {params: {expression: string}}).params.expression).toMatch(/^\(globalThis\.__harnessReact = undefined, \(async .*\.then\(tree => \{ globalThis\.__harnessReact = tree; \}/s);
    socket.emit('message', JSON.stringify({id: 1, result: {result: {value: 'started'}}}));
    // A look before it is done finds nothing, and the next one the tree, which it takes away.
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect((socket.sent[1] as unknown as {params: {expression: string}}).params.expression).toBe('(() => { const found = globalThis.__harnessReact; if (found !== undefined) delete globalThis.__harnessReact; return found; })()');
    socket.emit('message', JSON.stringify({id: 2, result: {result: {type: 'undefined'}}}));
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    socket.emit('message', JSON.stringify({id: 3, result: {result: {value: {nodes: [{id: 1, host: 'RCTView', chain: []}]}}}}));
    expect(await reading).toEqual({nodes: [{id: 1, host: 'RCTView', chain: []}]});
    expect(socket.closed).toBe(true);
  });

  it('says why where Metro is not there, lists nothing, or will not let the page be read', async () => {
    expect(await readReact({url: 'http://metro', take: false, fetch: () => Promise.reject(new Error('refused'))})).toEqual({unavailable: 'no Metro answers at http://metro; set HARNESS_METRO to where it runs'});
    expect(await readReact({url: 'http://metro', take: false, fetch: async () => ({ok: false, json: async () => []})})).toEqual({unavailable: 'Metro at http://metro did not list its apps'});
    expect(await readReact({url: 'http://metro', take: false, fetch: listed({not: 'a list'})})).toEqual({unavailable: 'Metro lists no app to read: a development build has to be running against it'});
  });

  it('says what the app answered where the walk could not start, threw, or found no hook', async () => {
    const started = {result: {value: 'started'}};
    for (const [start, look, said] of [
      [{exceptionDetails: {exception: {description: 'TypeError: x'}}}, undefined, 'the walk threw in the app: TypeError: x'],
      [{exceptionDetails: {text: 'Uncaught'}}, undefined, 'the walk threw in the app: Uncaught'],
      [{exceptionDetails: {}}, undefined, 'the walk threw in the app: no message'],
      [started, {exceptionDetails: {text: 'ReferenceError'}}, 'the walk threw in the app: ReferenceError'],
      [started, {result: {value: {unavailable: 'there is no React DevTools hook in this runtime'}}}, 'there is no React DevTools hook in this runtime'],
    ] as const) {
      const socket = fakeSocket();
      const reading = readReact({url: 'http://metro', take: false, fetch: listed([page('1')]), connect: () => socket});
      await vi.waitFor(() => expect(socket.listening('open')).toBe(true));
      socket.emit('open');
      await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
      socket.emit('message', JSON.stringify({id: 1, result: start}));
      if (look) {
        await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
        socket.emit('message', JSON.stringify({id: 2, result: look}));
      }
      expect(await reading).toEqual({unavailable: said});
    }
  });

  it('gives up on an app that does not answer, or a connection that fails', async () => {
    vi.useFakeTimers();
    const silent = fakeSocket();
    const reading = readReact({url: 'http://metro', take: false, timeout: 1000, fetch: listed([page('1')]), connect: () => silent});
    await vi.advanceTimersByTimeAsync(1000);
    expect(await reading).toEqual({unavailable: 'the app gave no answer within 1 s'});
    vi.useRealTimers();
    const broken = fakeSocket();
    const failing = readReact({url: 'http://metro', take: false, fetch: listed([page('1')]), connect: () => broken});
    await vi.waitFor(() => expect(broken.listening('open')).toBe(true));
    broken.emit('error');
    expect(await failing).toEqual({unavailable: 'the connection to the app failed'});
  });

  it('connects where Metro lists localhost by IPv4, with the origin of that host, as its inspector proxy asks of a debugger', async () => {
    const origins: (string | undefined)[] = [];
    const server = http.createServer();
    server.on('upgrade', (request, socket) => {
      origins.push(request.headers.origin);
      socket.destroy();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const {port} = server.address() as AddressInfo;
    const fetching = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ok: true, json: async () => [page('1', {webSocketDebuggerUrl: `ws://localhost:${port}/inspector/debug`})]} as Response);
    await readReact({url: `http://localhost:${port}/`, take: false, timeout: 3000});
    fetching.mockRestore();
    server.close();
    expect(origins).toEqual([`http://127.0.0.1:${port}`]);
  });

  it("uses Node's own fetch and WebSocket when given neither", async () => {
    const fetching = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no'));
    expect(await readReact({url: 'http://127.0.0.1:9', take: false})).toEqual({unavailable: 'no Metro answers at http://127.0.0.1:9; set HARNESS_METRO to where it runs'});
    fetching.mockResolvedValue({ok: true, json: async () => [page('1', {webSocketDebuggerUrl: 'ws://127.0.0.1:9/x'})]} as Response);
    const read = await readReact({url: 'http://127.0.0.1:9', take: false, timeout: 3000});
    expect(read).toEqual({unavailable: expect.stringMatching(/connection to the app (failed|closed)|no answer/)});
    fetching.mockRestore();
  });
});

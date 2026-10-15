import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {InspectorPage, Socket} from './metro.ts';
import {cdp, choosePage, metroFrom, readReact} from './metro.ts';

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

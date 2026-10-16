/**
 * The React tree of an app on a device, through Metro: a development build's
 * Hermes runtime registers with Metro's inspector proxy, which lists it at
 * `/json/list`, and a Chrome DevTools Protocol connection to it can run the
 * walk in `react.ts`. react-native-windows builds the same inspector into
 * its host, so this reaches iOS, Android and Windows alike. A release build
 * has no Metro, and none of this.
 *
 * Metro's proxy closes every other debugger connection to a page when a new
 * one opens, unless the page says it takes more than one. Connecting would
 * then close a developer's React Native DevTools, and their opening it would
 * close this. So a page is read only where it says so, or where
 * `HARNESS_REACT=take` says to take it over. Only `Runtime.evaluate` is sent,
 * and for the console `Runtime.enable`: nothing that pauses, or that the
 * runtime keeps after the connection goes.
 */
import type {ReactTree} from './react.ts';
import {walkExpression} from './react.ts';

/** Where the walk leaves what it found in the app's runtime, and how often it is looked for, in ms. */
const RESULT = '__harnessReact';
const LOOK_EVERY = 50;

/** A page as Metro's inspector proxy lists it. */
export interface InspectorPage {
  id: string;
  title: string;
  description?: string;
  appId?: string;
  deviceName?: string;
  webSocketDebuggerUrl?: string;
  reactNative?: {logicalDeviceId?: string; capabilities?: {supportsMultipleDebuggers?: boolean}};
}

/** Where Metro is: `HARNESS_METRO`, or the port Expo starts it on. */
export function metroFrom(environment: NodeJS.ProcessEnv): {url: string; take: boolean} {
  return {url: (environment.HARNESS_METRO ?? 'http://localhost:8081').replace(/\/+$/, ''), take: environment.HARNESS_REACT === 'take'};
}

/**
 * The page to read: a React Native page with somewhere to connect, of the
 * app under test alone where its id is known, so another app's debugger is
 * never read; of those, the one whose app or device names `target` where
 * one is given, the newest otherwise. Refused where reading it would close
 * another debugger.
 */
export function choosePage(pages: InspectorPage[], options: {take: boolean; app?: string; target?: string; only?: boolean}): {page: InspectorPage} | {refused: string} {
  const connectable = pages.filter(page => page.webSocketDebuggerUrl && page.reactNative);
  const app = options.app?.toLowerCase();
  const own = app ? connectable.filter(page => page.appId?.toLowerCase() === app) : connectable;
  if (app && own.length === 0 && connectable.length > 0) {
    return {refused: `Metro lists no page for ${options.app}, only for ${[...new Set(connectable.map(page => page.appId ?? page.title))].join(', ')}: it serves another app`};
  }
  const wanted = options.target?.toLowerCase();
  const named = wanted ? own.filter(page => [page.appId, page.title, page.description, page.deviceName].some(field => field?.toLowerCase().includes(wanted))) : [];
  // A connection held open the whole test is to a page the app or the target names, never to whichever is newest.
  if (options.only && !app && named.length === 0) return {refused: options.target ? `Metro lists no page that ${options.target} names` : 'nothing names the app to follow'};
  const page = (named.length > 0 ? named : own).at(-1);
  if (!page) return {refused: 'Metro lists no app to read: a development build has to be running against it'};
  if (!page.reactNative?.capabilities?.supportsMultipleDebuggers && !options.take) {
    return {
      refused:
        `Metro would close the debugger already connected to ${page.title}, since the app does not say it takes more than one. ` +
        'HARNESS_REACT=take reads it anyway, and closes React Native DevTools if it is open',
    };
  }
  return {page};
}

/** What a connection needs of a WebSocket: Node's own has it, and a test's fake. */
export interface Socket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: {data?: unknown}) => void): void;
}

/** One Chrome DevTools Protocol session over a socket: calls answered by id. */
export function cdp(socket: Socket): {call(method: string, params?: Record<string, unknown>): Promise<unknown>; close(): void} {
  let next = 0;
  const pending = new Map<number, {resolve(value: unknown): void; reject(error: Error): void}>();
  const fail = (reason: string) => {
    for (const waiting of pending.values()) waiting.reject(new Error(reason));
    pending.clear();
  };
  socket.addEventListener('message', event => {
    let message: {id?: number; result?: unknown; error?: {message?: string}};
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const waiting = message.id === undefined ? undefined : pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id as number);
    if (message.error) waiting.reject(new Error(message.error.message ?? 'the runtime refused the call'));
    else waiting.resolve(message.result);
  });
  socket.addEventListener('close', () => fail('the connection to the app closed'));
  socket.addEventListener('error', () => fail('the connection to the app failed'));
  return {
    call(method, params = {}) {
      next += 1;
      const id = next;
      return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject});
        socket.send(JSON.stringify({id, method, params}));
      });
    },
    close: () => socket.close(),
  };
}

export interface MetroOptions {
  url: string;
  take: boolean;
  /** The app under test, by its id: a page of another app is not read. */
  app?: string;
  target?: string;
  /** A page the app or the target names, or none: never the newest in their place. */
  only?: boolean;
  /** How a page list is fetched, and a socket opened: Node's own by default. */
  fetch?: (url: string) => Promise<{ok: boolean; json(): Promise<unknown>}>;
  connect?: (url: string) => Socket;
  /** How long the whole read may take, in ms. */
  timeout?: number;
}

/** Opens a socket and waits for it to be open, or for it to fail. */
function opened(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('the connection to the app failed')));
  });
}

/** The page of the app under test that Metro lists, or why there is none to connect to. */
async function pageFrom(options: MetroOptions): Promise<{page: InspectorPage} | {unavailable: string}> {
  const fetching = options.fetch ?? ((url: string) => fetch(url));
  let pages: InspectorPage[];
  try {
    const answer = await fetching(`${options.url}/json/list`);
    if (!answer.ok) return {unavailable: `Metro at ${options.url} did not list its apps`};
    pages = (await answer.json()) as InspectorPage[];
  } catch {
    return {unavailable: `no Metro answers at ${options.url}; set HARNESS_METRO to where it runs`};
  }
  const chosen = choosePage(Array.isArray(pages) ? pages : [], options);
  return 'refused' in chosen ? {unavailable: chosen.refused} : chosen;
}

/** A socket to a page's debugger. */
function connectTo(page: InspectorPage, options: MetroOptions): Socket {
  // Metro's inspector proxy takes a debugger only from an origin on the host it is reached at, and Node's WebSocket
  // sends none of its own, so it is given that host's, through the headers Node's WebSocket takes beside the standard's.
  const connect = options.connect ?? ((url: string) => new WebSocket(url, {headers: {Origin: new URL(url.replace(/^ws/, 'http')).origin}} as unknown as string[]) as unknown as Socket);
  // Metro lists its debugger at localhost, which Node's WebSocket may try as ::1 alone, where Metro need not listen.
  return connect((page.webSocketDebuggerUrl as string).replace(/^ws:\/\/localhost(?=[:/])/, 'ws://127.0.0.1'));
}

/** The escapes that colour a terminal's text, which a console line may carry. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** How React Native's note to a debugger that is not its DevTools begins. */
const NOT_DEVTOOLS = 'NOTE: You are using an unsupported debugging client.';

/** A line of the app's console from a message its runtime sent: a call to console, or an exception nothing caught. */
export function consoleLine(message: {method?: string; params?: unknown}): {level: string; text: string} | null {
  if (message.method === 'Runtime.consoleAPICalled') {
    type Argument = {type?: string; value?: unknown; unserializableValue?: string; description?: string};
    const {type = 'log', args = []} = (message.params ?? {}) as {type?: string; args?: Argument[]};
    const shown = (arg: Argument) => (typeof arg.value === 'string' ? arg.value : arg.value !== undefined ? JSON.stringify(arg.value) : (arg.unserializableValue ?? arg.description ?? arg.type ?? ''));
    const line = args.map(shown).join(' ').replace(ANSI, '');
    // React Native's inspector tells a debugger that is not its DevTools to use those, as a console line of its own: not the app's.
    return line.startsWith(NOT_DEVTOOLS) ? null : {level: type, text: line};
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const {exceptionDetails: details} = (message.params ?? {}) as {exceptionDetails?: {text?: string; exception?: {description?: string}}};
    return {level: 'uncaught', text: details?.exception?.description ?? details?.text ?? 'an exception nothing caught'};
  }
  return null;
}

/** A pause that does not hold the process open. */
const pause = (ms: number) => new Promise<void>(resolve => (setTimeout(resolve, ms) as unknown as {unref(): void}).unref());

/**
 * Follows what the app Metro serves writes to its console, and the
 * exceptions nothing catches, over a connection held open with
 * `Runtime.enable`, the page chosen as for the React tree, but only one the
 * app's id or the target names. The connection
 * ends when the app does, as on a restart, and is opened again once a page
 * is listed; where Metro lists none, or would close another debugger, it
 * looks again a moment later, a second at first and up to ten, until
 * stopped.
 */
export function followConsole(given: MetroOptions, listener: (level: string, text: string) => void, wait: (ms: number) => Promise<void> = pause): {stop(): void} {
  const options = {...given, only: true};
  let stopped = false;
  let socket: Socket | null = null;
  void (async () => {
    let misses = 0;
    while (!stopped) {
      const chosen = await pageFrom(options);
      if ('page' in chosen && !stopped) {
        const open = connectTo(chosen.page, options);
        socket = open;
        await new Promise<void>(ended => {
          open.addEventListener('open', () => open.send(JSON.stringify({id: 1, method: 'Runtime.enable', params: {}})));
          open.addEventListener('message', event => {
            let message: {method?: string; params?: unknown};
            try {
              message = JSON.parse(String(event.data));
            } catch {
              return;
            }
            const line = consoleLine(message);
            if (line) listener(line.level, line.text);
          });
          open.addEventListener('close', () => ended());
          open.addEventListener('error', () => ended());
        });
        socket = null;
        misses = 0;
      } else {
        misses += 1;
      }
      if (!stopped) await wait(Math.min(1000 * 2 ** Math.max(misses - 1, 0), 10_000));
    }
  })();
  return {
    stop() {
      stopped = true;
      socket?.close();
    },
  };
}

/** The React tree of the app Metro serves, or why it cannot be read. */
export async function readReact(options: MetroOptions): Promise<ReactTree | {unavailable: string}> {
  const chosen = await pageFrom(options);
  if ('unavailable' in chosen) return chosen;
  const socket = connectTo(chosen.page, options);
  const session = cdp(socket);
  const timeout = options.timeout ?? 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`the app gave no answer within ${timeout / 1000} s`)), timeout);
    });
    await Promise.race([opened(socket), late]);
    type Answer = {result?: {value?: ReactTree | {unavailable: string} | string}; exceptionDetails?: {text?: string; exception?: {description?: string}}};
    const evaluate = async (expression: string) => (await Promise.race([session.call('Runtime.evaluate', {expression, returnByValue: true}), late])) as Answer;
    const threw = (answer: Answer) => ({unavailable: `the walk threw in the app: ${answer.exceptionDetails?.exception?.description ?? answer.exceptionDetails?.text ?? 'no message'}`});
    // Hermes's debugger cannot wait on React Native's own Promise, so the walk leaves what it found in the app, and
    // a look after reads it and takes it away.
    const started = await evaluate(
      `(globalThis.${RESULT} = undefined, ${walkExpression()}.then(tree => { globalThis.${RESULT} = tree; }, error => { globalThis.${RESULT} = {unavailable: 'the walk threw in the app: ' + error}; }), 'started')`,
    );
    if (started.exceptionDetails) return threw(started);
    for (;;) {
      const look = await evaluate(`(() => { const found = globalThis.${RESULT}; if (found !== undefined) delete globalThis.${RESULT}; return found; })()`);
      if (look.exceptionDetails) return threw(look);
      const found = look.result?.value;
      if (found !== undefined) return found as ReactTree | {unavailable: string};
      await new Promise(resolve => setTimeout(resolve, LOOK_EVERY));
    }
  } catch (error) {
    return {unavailable: (error as Error).message};
  } finally {
    clearTimeout(timer);
    session.close();
  }
}

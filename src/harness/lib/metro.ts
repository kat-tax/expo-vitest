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
 * `HARNESS_REACT=take` says to take it over. Only `Runtime.evaluate` is sent:
 * nothing that pauses, or that the runtime keeps after the connection goes.
 */
import type {ReactTree} from './react.ts';
import {walkExpression} from './react.ts';

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
 * The page to read: a React Native page with somewhere to connect, the one
 * whose app or device names `target` where one is given, the newest
 * otherwise. Refused where reading it would close another debugger.
 */
export function choosePage(pages: InspectorPage[], options: {take: boolean; target?: string}): {page: InspectorPage} | {refused: string} {
  const connectable = pages.filter(page => page.webSocketDebuggerUrl && page.reactNative);
  const wanted = options.target?.toLowerCase();
  const named = wanted ? connectable.filter(page => [page.appId, page.title, page.description, page.deviceName].some(field => field?.toLowerCase().includes(wanted))) : [];
  const page = (named.length > 0 ? named : connectable).at(-1);
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
  target?: string;
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

/** The React tree of the app Metro serves, or why it cannot be read. */
export async function readReact(options: MetroOptions): Promise<ReactTree | {unavailable: string}> {
  const fetching = options.fetch ?? ((url: string) => fetch(url));
  const connect = options.connect ?? ((url: string) => new WebSocket(url) as unknown as Socket);
  let pages: InspectorPage[];
  try {
    const answer = await fetching(`${options.url}/json/list`);
    if (!answer.ok) return {unavailable: `Metro at ${options.url} did not list its apps`};
    pages = (await answer.json()) as InspectorPage[];
  } catch {
    return {unavailable: `no Metro answers at ${options.url}; set HARNESS_METRO to where it runs`};
  }
  const chosen = choosePage(Array.isArray(pages) ? pages : [], options);
  if ('refused' in chosen) return {unavailable: chosen.refused};
  const socket = connect(chosen.page.webSocketDebuggerUrl as string);
  const session = cdp(socket);
  const timeout = options.timeout ?? 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`the app gave no answer within ${timeout / 1000} s`)), timeout);
    });
    await Promise.race([opened(socket), late]);
    const answer = (await Promise.race([session.call('Runtime.evaluate', {expression: walkExpression(), returnByValue: true, awaitPromise: true}), late])) as {
      result?: {value?: ReactTree | {unavailable: string}};
      exceptionDetails?: {text?: string; exception?: {description?: string}};
    };
    if (answer.exceptionDetails) return {unavailable: `the walk threw in the app: ${answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text ?? 'no message'}`};
    return answer.result?.value ?? {unavailable: 'the app answered with nothing'};
  } catch (error) {
    return {unavailable: (error as Error).message};
  } finally {
    clearTimeout(timer);
    session.close();
  }
}

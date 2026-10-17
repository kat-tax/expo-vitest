/**
 * The MCP server's methods: `initialize`, `ping`, `tools/list` and
 * `tools/call`, over the framing, with the four tools e2e's server has. A
 * session's own catalog sits behind `call`, so the list a client reads
 * never changes. What a session is made of, a driver and a catalog, comes
 * from the opener it is given, so all of this runs in the unit tests
 * against a fake one.
 */
import {redactor} from '../../agent/redact.ts';
import type {Catalog, ToolAnswer} from './catalog.ts';
import type {Failure, Id, Request} from './rpc.ts';
import {fail, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, notify, parseLine, respond} from './rpc.ts';
import {SessionError, Sessions} from './sessions.ts';

/** The protocol's revision this server speaks. */
export const PROTOCOL = '2025-06-18';

/** How often a call whose client asked to hear its progress says it is still going, in ms. */
export const PROGRESS_EVERY = 2000;

export const INSTRUCTIONS =
  'Open a session with open_session, read its tools with tools, then observe before you act: a ref names the same node for the rest of the session. Check a locator with locate, which answers with the screen.* call to write in a device test. Close the session when you are done.';

/** What a session holds. */
export interface McpSession {
  platform: string;
  /** What the driver found: the window, the page, the device. */
  source?: string;
  /** The harness config the session loaded, which every open session shares. */
  config: string | null;
  catalog: Catalog;
  close(): Promise<void>;
}

export interface OpenArgs {
  target?: string;
  config?: string;
  headed?: boolean;
  force?: boolean;
}

export interface ServerOptions {
  /** The package's version, as serverInfo says it. */
  version: string;
  maxSessions: number;
  /** Makes a session: its driver, on the app, and its catalog; `signal` says the client cancelled the open, which stops it where it has got to. */
  open(args: OpenArgs, signal: AbortSignal): Promise<McpSession>;
  /** The harness config a session of these args would load, so two that differ never meet in one process. */
  configOf(args: OpenArgs): string | null;
  /** Every secret value the config knows, which no answer may carry. */
  secrets?: () => readonly {name: string; value: string}[];
  /** Sends the client a line it did not ask for: a call's progress. */
  send?: (line: string) => void;
  /** How often a call with a progress token says it is still going, in ms; `PROGRESS_EVERY` unless given. */
  progressEvery?: number;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({type: 'object', properties, ...(required.length > 0 ? {required} : {}), additionalProperties: false});

/** The four tools, fixed for the life of the server. */
export const TOOLS = [
  {
    name: 'open_session',
    description: 'Open a session on an app: its driver, on the app the harness config names, and the tools for it. Answers the session id, the tools and the first observation.',
    inputSchema: object({
      target: {type: 'string', description: 'A platform: web, windows, android or ios. The one the server was started with where left out.'},
      config: {type: 'string', description: "A harness config other than the project root's."},
      headed: {type: 'boolean', description: 'On web, a browser window to watch.'},
      force: {type: 'boolean', description: 'On Windows, act even while someone is using the machine.'},
    }),
  },
  {name: 'tools', description: "A session's tools, or one tool's input schema.", inputSchema: object({tool: {type: 'string'}, session: {type: 'string'}})},
  {
    name: 'call',
    description: "Run one of a session's tools, as tools lists them. Answers what it did and what changed on the screen.",
    inputSchema: object({tool: {type: 'string'}, args: {type: 'object'}, session: {type: 'string'}}, ['tool']),
  },
  {name: 'close_session', description: 'Close a session, and let go of its driver.', inputSchema: object({session: {type: 'string'}})},
] as const;

const answer = (text: string, structuredContent?: Record<string, unknown>): ToolAnswer => ({content: [{type: 'text', text}], ...(structuredContent ? {structuredContent} : {})});
const refused = (code: string, message: string): ToolAnswer => ({content: [{type: 'text', text: `${code}: ${message}`}], isError: true});
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The token a request's client gave to hear its progress by, where it gave one. */
function progressTokenOf(params: Record<string, unknown>): string | number | undefined {
  const token = isObject(params._meta) ? params._meta.progressToken : undefined;
  return typeof token === 'string' || typeof token === 'number' ? token : undefined;
}

/** A call as its progress names it: the session tool it runs, or the platform it opens on. */
function describeCall(name: string, args: Record<string, unknown>): string {
  if (name === 'call') return `call ${String(args.tool)}`;
  return name === 'open_session' && typeof args.target === 'string' ? `open_session on ${args.target}` : name;
}

/** The arguments a tool takes, checked against its schema's types; the first that is wrong is INVALID_PARAMS. */
function argsOf(name: string, given: unknown): {args: Record<string, unknown>} | {failure: Failure} {
  const tool = TOOLS.find(each => each.name === name) as (typeof TOOLS)[number];
  if (given !== undefined && !isObject(given)) return {failure: {code: INVALID_PARAMS, message: `Invalid params: ${name}'s arguments are an object`}};
  const args = given ?? {};
  const properties = tool.inputSchema.properties as Record<string, {type: string}>;
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!property) return {failure: {code: INVALID_PARAMS, message: `Invalid params: ${name} takes no ${key}`, data: {takes: Object.keys(properties)}}};
    const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (kind !== property.type) return {failure: {code: INVALID_PARAMS, message: `Invalid params: ${name}'s ${key} is a ${kind}, where it takes a ${property.type}`}};
  }
  for (const key of (tool.inputSchema as {required?: readonly string[]}).required ?? []) {
    if (!(key in args)) return {failure: {code: INVALID_PARAMS, message: `Invalid params: ${name} needs ${key}`}};
  }
  return {args};
}

export class McpServer {
  private readonly options: ServerOptions;
  private readonly sessions: Sessions<McpSession>;
  private initialized = false;
  /** Requests the client cancelled, whose answers are dropped when they come. */
  private readonly cancelled = new Set<Id>();
  /** The calls under way, each with what stops it where the client cancels it. */
  private readonly running = new Map<Id, AbortController>();

  constructor(options: ServerOptions) {
    this.options = options;
    this.sessions = new Sessions({max: options.maxSessions, close: session => session.close()});
  }

  /** Every secret value hidden, in what leaves as an error, which a driver's message can carry. */
  private hide(text: string): string {
    return redactor(this.options.secrets?.() ?? [])(text);
  }

  /** One line in: the line to answer with, or null where nothing is answered. */
  async handle(line: string): Promise<string | null> {
    const parsed = parseLine(line);
    if ('response' in parsed) return null;
    if ('error' in parsed) return fail(parsed.id, parsed.error);
    const {request} = parsed;
    if (request.id === undefined) {
      this.notified(request);
      return null;
    }
    const id = request.id;
    if (request.method === 'ping') return respond(id, {});
    if (request.method === 'initialize') {
      this.initialized = true;
      return respond(id, {protocolVersion: PROTOCOL, capabilities: {tools: {listChanged: false}}, serverInfo: {name: 'expo-harness', version: this.options.version}, instructions: INSTRUCTIONS});
    }
    if (!this.initialized) return fail(id, {code: INVALID_REQUEST, message: 'Invalid Request: not initialized'});
    if (request.method === 'tools/list') return respond(id, {tools: TOOLS});
    if (request.method !== 'tools/call') return fail(id, {code: METHOD_NOT_FOUND, message: `Method not found: ${request.method}`});
    const params = isObject(request.params) ? request.params : {};
    const name = params.name;
    if (typeof name !== 'string' || !TOOLS.some(tool => tool.name === name)) {
      return fail(id, {code: INVALID_PARAMS, message: `Invalid params: tools/call takes the name of one of ${TOOLS.map(tool => tool.name).join(', ')}`});
    }
    const checked = argsOf(name, params.arguments);
    if ('failure' in checked) return fail(id, checked.failure);
    const token = progressTokenOf(params);
    const going = token === undefined ? null : this.progress(token, describeCall(name, checked.args), id);
    const controller = new AbortController();
    this.running.set(id, controller);
    const result = await this.call(name, checked.args, controller.signal).catch((error: unknown) => {
      const code = (error as {code?: unknown} | null)?.code;
      return refused(typeof code === 'string' ? code : 'INTERNAL', this.hide(error instanceof Error ? error.message : String(error)));
    });
    this.running.delete(id);
    going?.stop();
    // A request the client cancelled while it ran gets no answer. A session
    // it opened is closed: the client never hears its id, and it would hold
    // a place, and on Windows or a device the platform, until it sat idle.
    if (this.cancelled.delete(id)) {
      const opened = name === 'open_session' ? result.structuredContent?.session : undefined;
      if (typeof opened === 'string') await this.sessions.close(opened).catch(() => undefined);
      return null;
    }
    return respond(id, result);
  }

  /**
   * Tells the client, every few seconds, that a call it gave a progress
   * token is still going, as an open that boots a device can take minutes,
   * and a client that hears progress can wait for it rather than time it
   * out. Each says how long so far, and none comes once the call ends or the
   * client cancels it.
   */
  private progress(token: string | number, what: string, id: Id): {stop(): void} {
    const send = this.options.send;
    if (!send) return {stop: () => undefined};
    const every = this.options.progressEvery ?? PROGRESS_EVERY;
    let ticks = 0;
    const timer = setInterval(() => {
      if (this.cancelled.has(id)) return;
      ticks += 1;
      send(notify('notifications/progress', {progressToken: token, progress: ticks, message: `${what}: still going after ${Math.round((ticks * every) / 1000)} s`}));
    }, every);
    // A call that is still going holds the process open, and its progress need not.
    (timer as unknown as {unref(): void}).unref();
    return {stop: () => clearInterval(timer)};
  }

  /** A notification: a cancel marks its request, and stops it where it can be; the rest need nothing. */
  private notified(request: Request): void {
    if (request.method !== 'notifications/cancelled' || !isObject(request.params)) return;
    const target = request.params.requestId;
    if (typeof target !== 'string' && typeof target !== 'number') return;
    this.cancelled.add(target);
    // An open stops where it has got to, rather than going on to its end and holding its place meanwhile.
    this.running.get(target)?.abort();
  }

  private async call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolAnswer> {
    const session = args.session as string | undefined;
    if (name === 'open_session') return this.open(args as OpenArgs, signal);
    if (name === 'close_session') {
      const closed = await this.sessions.close(session);
      return answer(`closed ${closed.id}`);
    }
    if (name === 'tools') {
      const {catalog, platform} = this.sessions.get(session).value;
      const tool = args.tool as string | undefined;
      if (tool === undefined) {
        const listed = catalog.list();
        return answer(listed.map(each => `${each.name}: ${each.description}`).join('\n'), {platform, tools: listed});
      }
      const one = catalog.list().find(each => each.name === tool);
      return one ? answer(JSON.stringify(one.inputSchema), {...one}) : refused('UNKNOWN_TOOL', `there is no tool called ${tool}; the tools are ${catalog.list().map(each => each.name).join(', ')}`);
    }
    return this.sessions.run(session, open => open.value.catalog.call(args.tool as string, args.args ?? {}));
  }

  private async open(args: OpenArgs, signal: AbortSignal): Promise<ToolAnswer> {
    const config = this.options.configOf(args);
    const sharing = this.sessions.ids.map(id => this.sessions.get(id).value).find(each => each.config !== config);
    if (sharing) return refused('CONFIG_IN_USE', `the open sessions use ${sharing.config ?? 'no harness config'}; close them to open one on ${config ?? 'no harness config'}`);
    const opened = await this.sessions.open(() => this.options.open(args, signal), signal);
    const {catalog, platform, source} = opened.value;
    // A browser is a session's own, but Windows is one desktop and a device is one device: two sessions there would act on each other's app.
    const busy = platform === 'web' ? undefined : this.sessions.ids.find(id => id !== opened.id && this.sessions.get(id).value.platform === platform);
    if (busy) {
      await this.sessions.close(opened.id);
      return refused('SESSION_OPEN', `${busy} is open on ${platform}, which one session drives at a time: close it first`);
    }
    const first = await catalog.observe();
    const tools = catalog.list().map(each => each.name);
    const header = `session ${opened.id} on ${platform}${source ? ` (${source}, ${first.tree.nodes.length} nodes)` : ` (${first.tree.nodes.length} nodes)`}`;
    return answer(`${header}\ntools: ${tools.join(' ')}\n\n${first.text}`, {session: opened.id, platform, ...(source ? {source} : {}), tools, observation: first.text});
  }

  /** Closes every session, as the server ends. */
  close(budget?: number): Promise<void> {
    return this.sessions.closeAll(budget);
  }
}

export {SessionError};

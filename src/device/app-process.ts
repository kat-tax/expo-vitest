/**
 * The process a device run starts for an app, such as a dev server. It is
 * started once however many platforms name it, waited for at its ready
 * url, and stopped at the end with everything it started.
 *
 * Everything that touches the machine comes in through `System`, so the
 * unit tests drive this against a fake process and a real local server,
 * and `global-setup.ts` hands it Node's own calls.
 */
import type {SpawnOptions} from 'node:child_process';
import path from 'node:path';
import {HarnessError} from '../harness/lib/errors.ts';
import type {Clock} from '../harness/lib/settle.ts';
import type {Platform} from '../harness/lib/types.ts';
import type {ResolvedCommand} from './config.ts';

/** `fetch`, as much of it as a probe uses. */
export type Fetcher = (url: string, init: {signal: AbortSignal; redirect: 'manual'}) => Promise<{status: number; body?: {cancel(): Promise<void>} | null}>;

/** Whether a status says the server is up, by Playwright's rule for its web server: 2xx, 3xx, and 400 to 403. */
export function isUp(status: number): boolean {
  return status >= 200 && status <= 403;
}

/** One GET of the url within the time given, answered as whether a server is up there. */
export async function probe(url: string, fetcher: Fetcher, timeout = 2000): Promise<boolean> {
  try {
    const response = await fetcher(url, {signal: AbortSignal.timeout(timeout), redirect: 'manual'});
    // An unread body holds the connection open.
    await response.body?.cancel().catch(() => {});
    return isUp(response.status);
  } catch {
    return false;
  }
}

/** The gap after the nth look at a starting server: 100 ms, doubling, to 1 s. */
export function backoff(looks: number): number {
  return Math.min(1000, 100 * 2 ** (looks - 1));
}

/** How a process ended. */
export interface Exit {
  code: number | null;
  signal: string | null;
}

/** Looks at the url until it answers, the time runs out, or the process it waits for has ended. */
export async function waitUntilReady(url: string, options: {timeout: number; clock: Clock; fetcher: Fetcher; exited?: () => Exit | null}): Promise<{ready: true} | {ready: false; exited: Exit | null}> {
  const {timeout, clock, fetcher} = options;
  const deadline = clock.now() + timeout;
  for (let looks = 1; ; looks++) {
    // A command that hands its server to another process and exits is still ready once that answers.
    if (await probe(url, fetcher, Math.max(1, Math.min(2000, deadline - clock.now())))) return {ready: true};
    const exited = options.exited?.() ?? null;
    const left = deadline - clock.now();
    if (exited || left <= 0) return {ready: false, exited};
    await clock.sleep(Math.min(backoff(looks), left));
  }
}

/** The last lines of a log, for a message. */
export function tail(text: string, lines = 20): string {
  return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

/** The variables a command is found and run with. */
export type Environment = Record<string, string | undefined>;

/** A variable from an environment, by Windows' rule that its name has no case. */
function variable(env: Environment, name: string): string | undefined {
  return Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
}

/** Where cmd.exe would find a command on Windows: a path, or a name on `PATH` with an extension from `PATHEXT`. */
export function findOnPath(executable: string, env: Environment, exists: (file: string) => boolean, cwd: string): string | null {
  const extensions = (variable(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const names = extensions.some(each => executable.toUpperCase().endsWith(each.toUpperCase())) ? [executable] : extensions.map(each => executable + each);
  const folders = /[\\/]/.test(executable) ? [cwd] : (variable(env, 'PATH') ?? '').split(';').filter(Boolean);
  for (const folder of folders) {
    for (const name of names) {
      const file = path.win32.resolve(folder, name);
      if (exists(file)) return file;
    }
  }
  return null;
}

/** cmd.exe's own characters, which a caret makes literal: cross-spawn's set. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * One argument on a cmd.exe line for a batch file: quoted as the C runtime
 * reads a command line, then with cmd's characters escaped twice. A batch
 * file hands its arguments on with `%*`, which cmd reads a second time, and
 * cmd knows nothing of `\"`, so escaped once, a quote inside an argument
 * would leave what follows it open to cmd.
 */
export function cmdArgument(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/** What to spawn for a command. */
export interface Launch {
  file: string;
  args: string[];
  /** The arguments are a command line already, which Node must not quote again. */
  verbatim: boolean;
}

/**
 * How to start a command without a shell. The one exception is on Windows,
 * where a `.cmd` or `.bat`, such as `npx`, is something only cmd.exe can
 * run, so it goes through cmd with every argument escaped.
 */
export function launchOf(command: Pick<ResolvedCommand, 'executable' | 'args' | 'cwd'>, platform: NodeJS.Platform, env: Environment, exists: (file: string) => boolean): Launch {
  const plain = {file: command.executable, args: command.args, verbatim: false};
  if (platform !== 'win32') return plain;
  const file = findOnPath(command.executable, env, exists, command.cwd);
  // Not found: spawn says so, in the words a reader expects.
  if (!file) return plain;
  if (!/\.(cmd|bat)$/i.test(file)) return {...plain, file};
  const line = [file.replace(CMD_META, '^$1'), ...command.args.map(cmdArgument)].join(' ');
  return {file: variable(env, 'COMSPEC') ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true};
}

/** What a process can be told to stop with. */
export interface Signals {
  platform: NodeJS.Platform;
  /** `process.kill`, where a negative pid names the process group. */
  signal(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void;
  /** `taskkill /PID <pid> /T /F`: the process and everything it started. */
  killTree(pid: number): void;
}

/** Waits for `done` to hold, looking every 50 ms, for up to `timeout`; answers whether it did. */
async function until(done: () => boolean, timeout: number, clock: Clock): Promise<boolean> {
  const deadline = clock.now() + timeout;
  while (!done()) {
    if (clock.now() >= deadline) return false;
    await clock.sleep(50);
  }
  return true;
}

/**
 * Stops a process and everything it started. On macOS and Linux the
 * process leads its own group, so the group is sent SIGTERM, then SIGKILL
 * if it outlives `timeout`. On Windows `taskkill` ends the tree, since
 * Node's own kill ends only the one process and a dev server's workers would
 * outlive it.
 */
export async function stopTree(pid: number, options: Signals & {alive: () => boolean; timeout: number; clock: Clock}): Promise<'stopped' | 'killed' | 'survived'> {
  const {timeout, clock, alive} = options;
  const gone = () => !alive();
  if (options.platform === 'win32') {
    options.killTree(pid);
    return (await until(gone, timeout, clock)) ? 'killed' : 'survived';
  }
  const send = (signal: 'SIGTERM' | 'SIGKILL') => {
    try {
      options.signal(-pid, signal);
    } catch {
      // The group has gone already.
    }
  };
  send('SIGTERM');
  if (await until(gone, timeout, clock)) return 'stopped';
  send('SIGKILL');
  return (await until(gone, 1000, clock)) ? 'killed' : 'survived';
}

/** A spawned process, as much of Node's `ChildProcess` as this uses. */
export interface ChildLike {
  pid?: number;
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  unref(): void;
}

/** Everything starting a command touches. */
export interface System extends Signals {
  env: NodeJS.ProcessEnv;
  exists(file: string): boolean;
  spawn(file: string, args: string[], options: SpawnOptions): ChildLike;
  /** Opens the log for writing from the start, and answers with its descriptor. */
  openLog(file: string): number;
  closeLog(fd: number): void;
  /** The log's text; empty when it cannot be read. */
  readLog(file: string): string;
  fetcher: Fetcher;
  clock: Clock;
  /** Has `stop` run if the main process exits before the run's teardown, and answers with how to undo that. */
  onExit(stop: () => void): () => void;
}

/** A command this run uses: one it started, or one that was already answering. */
export interface Started {
  key: string;
  pid: number | null;
  reused: boolean;
  log: string | false;
  /** Stops what was started, and fails if something still answers at the ready url after. */
  stop(): Promise<void>;
}

/** What makes two platforms' commands the same one. */
export function commandKey(command: Pick<ResolvedCommand, 'executable' | 'args' | 'cwd'>): string {
  return JSON.stringify([command.executable, command.args, command.cwd]);
}

function shownExit(exit: Exit): string {
  return exit.code === null ? `on ${exit.signal}` : `with code ${exit.code}`;
}

/**
 * Starts a platform's command, unless one already answers at its ready url:
 * that one is used when `reuseExisting` allows, and is otherwise an error,
 * since in CI it would be testing whatever build it serves. A command that
 * ends, or does not answer in `startupTimeout`, is stopped, and the error
 * carries the end of its log.
 */
export async function startCommand(platform: Platform, command: ResolvedCommand, readyUrl: string, system: System): Promise<Started> {
  const key = commandKey(command);
  const shown = [command.executable, ...command.args].join(' ');
  if (await probe(readyUrl, system.fetcher)) {
    // Its output goes wherever whoever started it sent it.
    if (command.reuseExisting) return {key, pid: null, reused: true, log: false, stop: async () => {}};
    throw new HarnessError('APP_ALREADY_RUNNING', `something already answers at ${readyUrl}, so ${shown} was not started: stop it, or set app.${platform}.command.reuseExisting to true to use it`, {platform});
  }
  const launch = launchOf(command, system.platform, system.env, system.exists);
  const log = command.log;
  const out = log === false ? 'ignore' : system.openLog(log);
  const child = system.spawn(launch.file, launch.args, {
    cwd: command.cwd,
    env: {...system.env, ...command.env},
    stdio: ['ignore', out, out],
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: launch.verbatim,
    // Its own process group, so the whole of it can be stopped; on Windows this would open a console.
    detached: system.platform !== 'win32',
  });
  // The child has its own copy of the descriptor.
  if (out !== 'ignore') system.closeLog(out);
  let exit: Exit | null = null;
  let error: Error | null = null;
  child.once('exit', (code, signal) => (exit = {code, signal}));
  child.once('error', thrown => (error = thrown));
  // The run's teardown stops it; it must not be what keeps Vitest from exiting.
  child.unref();
  const logLines = () => (log === false ? '' : tail(system.readLog(log)));
  const withLog = (message: string) => {
    const lines = logLines();
    return lines ? `${message}. The end of its log, ${log}:\n${lines}` : message;
  };
  if (child.pid === undefined) {
    // Node reports a program it could not start after spawn returns.
    await new Promise(resolve => setImmediate(resolve));
    throw new HarnessError('APP_UNREACHABLE', `${shown} could not be started: ${(error as Error | null)?.message ?? 'no process came of it'}`, {platform});
  }
  const pid = child.pid;
  const end = () => {
    try {
      if (system.platform === 'win32') system.killTree(pid);
      else system.signal(-pid, 'SIGKILL');
    } catch {
      // It has gone already.
    }
  };
  const undoExitHook = system.onExit(end);
  let stopping: Promise<string | null> | null = null;
  const stopped = () =>
    (stopping ??= (async () => {
      undoExitHook();
      const outcome = exit ? 'stopped' : await stopTree(pid, {...system, alive: () => exit === null, timeout: command.shutdownTimeout});
      if (outcome === 'survived') return `${shown} (pid ${pid}) did not stop`;
      if (await probe(readyUrl, system.fetcher)) return `${shown} (pid ${pid}) was stopped, and something still answers at ${readyUrl}`;
      return null;
    })());
  const readiness = await waitUntilReady(readyUrl, {timeout: command.startupTimeout, clock: system.clock, fetcher: system.fetcher, exited: () => exit});
  if (!readiness.ready) {
    const left = await stopped();
    const why = readiness.exited ? `${shown} ended ${shownExit(readiness.exited)} before it answered at ${readyUrl}` : `${shown} did not answer at ${readyUrl} within ${command.startupTimeout} ms`;
    throw new HarnessError('APP_UNREACHABLE', withLog(left ? `${why}; ${left}` : why), {platform});
  }
  return {
    key,
    pid,
    reused: false,
    log,
    stop: async () => {
      const left = await stopped();
      if (left) throw new HarnessError('ACTION_FAILED', `${left}: end it by hand`, {platform});
    },
  };
}

/** One command in the registry, and how many platforms are using it. */
export interface Shared {
  started: Promise<Started>;
  users: number;
}

const REGISTRY = Symbol.for('expo-vitest.commands');

/**
 * The commands this run has started. Every project's global setup runs in
 * the one main process, each through its own module runner, so the one
 * place they share is the global object.
 */
export function registry(store: object = globalThis): Map<string, Shared> {
  const holder = store as {[REGISTRY]?: Map<string, Shared>};
  return (holder[REGISTRY] ??= new Map());
}

/** The command under `key`, started by the first platform to ask for it and shared by the rest. */
export function acquire(commands: Map<string, Shared>, key: string, start: () => Promise<Started>): Promise<Started> {
  let shared = commands.get(key);
  if (!shared) {
    shared = {started: start(), users: 0};
    commands.set(key, shared);
    // One that failed to start is not there for the next platform to share.
    shared.started.catch(() => commands.delete(key));
  }
  shared.users++;
  return shared.started;
}

/** A platform done with the command under `key`: the last one stops it. */
export async function release(commands: Map<string, Shared>, key: string): Promise<void> {
  const shared = commands.get(key);
  if (!shared || --shared.users > 0) return;
  commands.delete(key);
  await (await shared.started).stop();
}

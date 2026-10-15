import {EventEmitter} from 'node:events';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {Clock} from '../harness/lib/settle.ts';
import type {ResolvedCommand} from './config.ts';
import type {Fetcher, Started, System} from './app-process.ts';
import {acquire, backoff, cmdArgument, commandKey, findOnPath, isUp, launchOf, probe, registry, release, startCommand, stopTree, tail, waitUntilReady} from './app-process.ts';

/** A clock that moves only when something sleeps. */
function fakeClock(): Clock & {at: number} {
  const clock = {at: 0, now: () => clock.at, sleep: async (ms: number) => void (clock.at += ms)};
  return clock;
}

/** A local server that answers with each status in turn, and the last one after. */
let statuses: number[] = [];
let server: http.Server;
let url: string;
const realFetch: Fetcher = (to, init) => fetch(to, init);

beforeAll(async () => {
  server = http.createServer((_request, response) => {
    response.statusCode = statuses.length > 1 ? (statuses.shift() as number) : (statuses[0] ?? 200);
    response.end('packager-status:running');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/status`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

/** A port nothing listens on. */
async function closedPort(): Promise<string> {
  const other = http.createServer();
  await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve));
  const port = (other.address() as AddressInfo).port;
  await new Promise(resolve => other.close(resolve));
  return `http://127.0.0.1:${port}/`;
}

describe('a probe', () => {
  it("counts a server up by Playwright's rule", () => {
    expect([200, 204, 302, 400, 403].every(isUp)).toBe(true);
    expect([199, 404, 500, 503].some(isUp)).toBe(false);
  });

  it('is one GET, answered by the status', async () => {
    statuses = [200];
    await expect(probe(url, realFetch)).resolves.toBe(true);
    statuses = [503];
    await expect(probe(url, realFetch)).resolves.toBe(false);
  });

  it('is down where nothing listens, or nothing answers in time', async () => {
    await expect(probe(await closedPort(), realFetch)).resolves.toBe(false);
    const hanging: Fetcher = (_to, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    await expect(probe(url, hanging, 10)).resolves.toBe(false);
  });

  it('lets go of the body, and answers even when that fails', async () => {
    const cancel = vi.fn(async () => Promise.reject(new Error('gone')));
    await expect(probe(url, async () => ({status: 200, body: {cancel}}))).resolves.toBe(true);
    expect(cancel).toHaveBeenCalled();
  });
});

describe('waiting for a server', () => {
  it('looks at gaps doubling from 100 ms to a second', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoff)).toEqual([100, 200, 400, 800, 1000, 1000]);
  });

  it('is ready at once when it answers at once', async () => {
    statuses = [200];
    const clock = fakeClock();
    await expect(waitUntilReady(url, {timeout: 5000, clock, fetcher: realFetch})).resolves.toEqual({ready: true});
    expect(clock.at).toBe(0);
  });

  it('is ready after the looks it takes to answer', async () => {
    statuses = [503, 503, 503, 200];
    const clock = fakeClock();
    await expect(waitUntilReady(url, {timeout: 5000, clock, fetcher: realFetch})).resolves.toEqual({ready: true});
    expect(clock.at).toBe(100 + 200 + 400);
  });

  it('gives up when it never answers, at the timeout', async () => {
    statuses = [503];
    const clock = fakeClock();
    await expect(waitUntilReady(url, {timeout: 5000, clock, fetcher: realFetch})).resolves.toEqual({ready: false, exited: null});
    expect(clock.at).toBe(5000);
  });

  it('gives up when the process it waits for has ended', async () => {
    const clock = fakeClock();
    const exited = vi.fn().mockReturnValueOnce(null).mockReturnValue({code: 1, signal: null});
    await expect(waitUntilReady(await closedPort(), {timeout: 5000, clock, fetcher: realFetch, exited})).resolves.toEqual({ready: false, exited: {code: 1, signal: null}});
    expect(clock.at).toBe(100);
  });

  it('is ready when a command that ended left its server answering', async () => {
    statuses = [200];
    const clock = fakeClock();
    await expect(waitUntilReady(url, {timeout: 5000, clock, fetcher: realFetch, exited: () => ({code: 0, signal: null})})).resolves.toEqual({ready: true});
  });
});

describe('the end of a log', () => {
  it('is its last twenty lines, or as many as asked', () => {
    const log = Array.from({length: 25}, (_, index) => `line ${index + 1}`).join('\r\n') + '\r\n';
    expect(tail(log).split('\n')).toEqual(Array.from({length: 20}, (_, index) => `line ${index + 6}`));
    expect(tail(log, 2)).toBe('line 24\nline 25');
    expect(tail('')).toBe('');
  });
});

describe('finding a command on Windows', () => {
  const on = (...files: string[]) => (file: string) => files.includes(file);

  it('looks along PATH for each extension in PATHEXT, whatever the case of their names', () => {
    const env = {Path: 'C:\\tools;C:\\Program Files\\nodejs;', PathExt: '.EXE;.CMD'};
    expect(findOnPath('npx', env, on('C:\\Program Files\\nodejs\\npx.CMD'), 'C:\\app')).toBe('C:\\Program Files\\nodejs\\npx.CMD');
    expect(findOnPath('node', env, on('C:\\tools\\node.EXE', 'C:\\Program Files\\nodejs\\node.EXE'), 'C:\\app')).toBe('C:\\tools\\node.EXE');
  });

  it('takes a name with its extension as it is', () => {
    expect(findOnPath('npx.cmd', {PATH: 'C:\\nodejs'}, on('C:\\nodejs\\npx.cmd'), 'C:\\app')).toBe('C:\\nodejs\\npx.cmd');
  });

  it('takes a path from the folder the command runs in, not from PATH', () => {
    expect(findOnPath('.\\scripts\\serve', {PATH: 'C:\\nodejs'}, on('C:\\app\\scripts\\serve.BAT'), 'C:\\app')).toBe('C:\\app\\scripts\\serve.BAT');
    expect(findOnPath('C:/bin/serve.exe', {}, on('C:\\bin\\serve.exe'), 'C:\\app')).toBe('C:\\bin\\serve.exe');
  });

  it('is none where it is not', () => {
    expect(findOnPath('npx', {PATH: 'C:\\nodejs'}, on(), 'C:\\app')).toBeNull();
    expect(findOnPath('npx', {}, on('C:\\app\\npx.CMD'), 'C:\\app')).toBeNull();
  });
});

describe('an argument for a batch file', () => {
  it('is quoted, with cmd characters escaped twice, once for cmd /c and once for the %* that passes it on', () => {
    expect(cmdArgument('start')).toBe('^^^"start^^^"');
    expect(cmdArgument('a b&c')).toBe('^^^"a^^^ b^^^&c^^^"');
    expect(cmdArgument('100%')).toBe('^^^"100^^^%^^^"');
    expect(cmdArgument('')).toBe('^^^"^^^"');
  });

  it('keeps its quotes and backslashes as the C runtime reads them', () => {
    expect(cmdArgument('say "hi"')).toBe('^^^"say^^^ \\^^^"hi\\^^^"^^^"');
    expect(cmdArgument('a\\"b')).toBe('^^^"a\\\\\\^^^"b^^^"');
    expect(cmdArgument('C:\\dir\\')).toBe('^^^"C:\\dir\\\\^^^"');
    expect(cmdArgument('C:\\dir\\file')).toBe('^^^"C:\\dir\\file^^^"');
  });
});

describe('what is spawned', () => {
  const command = {executable: 'npx', args: ['expo', 'start'], cwd: 'C:\\app'};

  it('is the command as it is, away from Windows', () => {
    expect(launchOf(command, 'linux', {}, () => true)).toEqual({file: 'npx', args: ['expo', 'start'], verbatim: false});
  });

  it('is the program found, on Windows, or the name for spawn to report missing', () => {
    expect(launchOf({...command, executable: 'node'}, 'win32', {PATH: 'C:\\nodejs'}, file => file === 'C:\\nodejs\\node.EXE')).toEqual({file: 'C:\\nodejs\\node.EXE', args: ['expo', 'start'], verbatim: false});
    expect(launchOf(command, 'win32', {PATH: 'C:\\nodejs'}, () => false)).toEqual({file: 'npx', args: ['expo', 'start'], verbatim: false});
  });

  it('is cmd.exe with an escaped line for a .cmd, such as npx', () => {
    const env = {PATH: 'C:\\Program Files\\nodejs', ComSpec: 'C:\\Windows\\system32\\cmd.exe'};
    expect(launchOf(command, 'win32', env, file => file === 'C:\\Program Files\\nodejs\\npx.CMD')).toEqual({
      file: 'C:\\Windows\\system32\\cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\Program^ Files\\nodejs\\npx.CMD ^^^"expo^^^" ^^^"start^^^""'],
      verbatim: true,
    });
    expect(launchOf({...command, executable: 'serve.bat'}, 'win32', {PATH: 'C:\\bin'}, file => file === 'C:\\bin\\serve.bat')).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\bin\\serve.bat ^^^"expo^^^" ^^^"start^^^""'],
      verbatim: true,
    });
  });
});

/** A spawned process, or one that never started, which has no pid. */
function fakeChild(started = true) {
  return Object.assign(new EventEmitter(), {pid: started ? 4242 : undefined, unref: vi.fn()});
}

describe('stopping a process', () => {
  const base = (clock: Clock) => ({killTree: vi.fn(), signal: vi.fn(), timeout: 1000, clock});

  it('ends the tree on Windows with taskkill', async () => {
    let alive = true;
    const options = {...base(fakeClock()), platform: 'win32' as const, alive: () => alive};
    options.killTree.mockImplementation(() => (alive = false));
    await expect(stopTree(4242, options)).resolves.toBe('killed');
    expect(options.killTree).toHaveBeenCalledWith(4242);
    expect(options.signal).not.toHaveBeenCalled();
  });

  it('says so when the tree outlives taskkill', async () => {
    const clock = fakeClock();
    await expect(stopTree(4242, {...base(clock), platform: 'win32', alive: () => true})).resolves.toBe('survived');
    expect(clock.at).toBe(1000);
  });

  it("sends the process group SIGTERM elsewhere, and is done when it ends", async () => {
    let alive = true;
    const options = {...base(fakeClock()), platform: 'linux' as const, alive: () => alive};
    options.signal.mockImplementation(() => (alive = false));
    await expect(stopTree(4242, options)).resolves.toBe('stopped');
    expect(options.signal.mock.calls).toEqual([[-4242, 'SIGTERM']]);
  });

  it('sends SIGKILL to a process that ignores SIGTERM for the shutdown timeout', async () => {
    let alive = true;
    const clock = fakeClock();
    const options = {...base(clock), platform: 'darwin' as const, alive: () => alive};
    options.signal.mockImplementation((_pid: number, signal: string) => void (signal === 'SIGKILL' && (alive = false)));
    await expect(stopTree(4242, options)).resolves.toBe('killed');
    expect(options.signal.mock.calls).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL'],
    ]);
    expect(clock.at).toBe(1000);
  });

  it('says so when it ignores both', async () => {
    const clock = fakeClock();
    await expect(stopTree(4242, {...base(clock), platform: 'linux', alive: () => true})).resolves.toBe('survived');
    expect(clock.at).toBe(2000);
  });

  it('takes a group that has gone already as stopped', async () => {
    const options = {...base(fakeClock()), platform: 'linux' as const, alive: () => false};
    options.signal.mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), {code: 'ESRCH'});
    });
    await expect(stopTree(4242, options)).resolves.toBe('stopped');
  });
});

describe("a command's key", () => {
  it('is its program, arguments and folder', () => {
    const one = {executable: 'npx', args: ['expo', 'start'], cwd: '/app'};
    expect(commandKey(one)).toBe(commandKey({...one}));
    expect(commandKey(one)).not.toBe(commandKey({...one, args: ['expo', 'start', '--web']}));
    expect(commandKey(one)).not.toBe(commandKey({...one, cwd: '/other'}));
  });
});

const resolved = (extra: Partial<ResolvedCommand> = {}): ResolvedCommand => ({
  executable: 'npx',
  args: ['expo', 'start'],
  cwd: '/app',
  env: {EXPO_NO_DEV_MENU: '1'},
  startupTimeout: 1000,
  shutdownTimeout: 500,
  log: '/app/.harness/app-web.log',
  reuseExisting: true,
  ...extra,
});

/**
 * A machine with a fake process and a fake server: the server is up for
 * each look in `up` in turn, and the last after; the process ends on the
 * signals in `endsOn`.
 */
function machine(options: {up?: boolean[]; endsOn?: string[]; platform?: NodeJS.Platform; child?: ReturnType<typeof fakeChild>} = {}) {
  const up = options.up ?? [false, true, false];
  const child = options.child ?? fakeChild();
  const undo = vi.fn();
  let looks = 0;
  const end = (signal: string) => {
    if (options.endsOn?.includes(signal)) child.emit('exit', null, signal);
  };
  const system = {
    platform: options.platform ?? 'linux',
    env: {PATH: '/usr/bin', HOME: '/home/me'} as unknown as NodeJS.ProcessEnv,
    exists: vi.fn((_file: string) => false),
    spawn: vi.fn(() => child),
    signal: vi.fn((_pid: number, signal: string) => end(signal)),
    killTree: vi.fn(() => end('taskkill')),
    openLog: vi.fn(() => 7),
    closeLog: vi.fn(),
    readLog: vi.fn(() => 'Starting Metro Bundler\nError: port taken\n'),
    fetcher: vi.fn(async () => ({status: (up[looks++] ?? up[up.length - 1]) ? 200 : 503})),
    clock: fakeClock(),
    onExit: vi.fn((_stop: () => void) => undo),
  } satisfies System;
  return {system, child, undo};
}

describe('starting a command', () => {
  it('uses one already answering, where it may', async () => {
    const {system} = machine({up: [true]});
    const started = await startCommand('web', resolved(), 'http://localhost:8081', system);
    expect(started).toMatchObject({key: commandKey(resolved()), pid: null, reused: true, log: false});
    expect(system.spawn).not.toHaveBeenCalled();
    await expect(started.stop()).resolves.toBeUndefined();
  });

  it('fails where one already answers and it may not use it', async () => {
    const {system} = machine({up: [true]});
    await expect(startCommand('web', resolved({reuseExisting: false}), 'http://localhost:8081', system)).rejects.toThrow(
      expect.objectContaining({
        code: 'APP_ALREADY_RUNNING',
        platform: 'web',
        message: 'something already answers at http://localhost:8081, so npx expo start was not started: stop it, or set app.web.command.reuseExisting to true to use it',
      }),
    );
    expect(system.spawn).not.toHaveBeenCalled();
  });

  it('spawns it with no shell, in its own group, writing to its log, and waits for it', async () => {
    const {system, child} = machine({up: [false, false, true]});
    const started = await startCommand('web', resolved(), 'http://localhost:8081', system);
    expect(started).toMatchObject({pid: 4242, reused: false, log: '/app/.harness/app-web.log'});
    expect(system.spawn).toHaveBeenCalledWith('npx', ['expo', 'start'], {
      cwd: '/app',
      env: {PATH: '/usr/bin', HOME: '/home/me', EXPO_NO_DEV_MENU: '1'},
      stdio: ['ignore', 7, 7],
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: false,
      detached: true,
    });
    expect(system.openLog).toHaveBeenCalledWith('/app/.harness/app-web.log');
    expect(system.closeLog).toHaveBeenCalledWith(7);
    expect(child.unref).toHaveBeenCalled();
    expect(system.clock.at).toBe(100);
  });

  it('runs a .cmd through cmd.exe on Windows, in the same console', async () => {
    const {system} = machine({platform: 'win32'});
    system.env.PATH = 'C:\\nodejs';
    system.exists.mockImplementation((file: string) => file === 'C:\\nodejs\\npx.CMD');
    await startCommand('web', resolved({log: false}), 'http://localhost:8081', system);
    expect(system.spawn).toHaveBeenCalledWith('cmd.exe', ['/d', '/s', '/c', '"C:\\nodejs\\npx.CMD ^^^"expo^^^" ^^^"start^^^""'], expect.objectContaining({stdio: ['ignore', 'ignore', 'ignore'], windowsVerbatimArguments: true, detached: false}));
    expect(system.openLog).not.toHaveBeenCalled();
    expect(system.closeLog).not.toHaveBeenCalled();
  });

  it('stops one that never answers, and says so with the end of its log', async () => {
    const {system} = machine({up: [false], endsOn: ['SIGTERM']});
    await expect(startCommand('android', resolved(), 'http://localhost:8081/status', system)).rejects.toThrow(
      expect.objectContaining({
        code: 'APP_UNREACHABLE',
        platform: 'android',
        message: 'npx expo start did not answer at http://localhost:8081/status within 1000 ms. The end of its log, /app/.harness/app-web.log:\nStarting Metro Bundler\nError: port taken',
      }),
    );
    expect(system.signal).toHaveBeenCalledWith(-4242, 'SIGTERM');
    expect(system.clock.at).toBe(1000);
  });

  it('says how one that ended before it answered ended', async () => {
    const {system, child} = machine({up: [false]});
    system.fetcher.mockImplementation(async () => {
      if (system.fetcher.mock.calls.length === 2) child.emit('exit', 1, null);
      return {status: 503};
    });
    await expect(startCommand('web', resolved({log: false}), 'http://localhost:8081', system)).rejects.toThrow('npx expo start ended with code 1 before it answered at http://localhost:8081');
    expect(system.signal).not.toHaveBeenCalled();
  });

  it('names the signal one that was killed ended on', async () => {
    const {system, child} = machine({up: [false]});
    system.fetcher.mockImplementation(async () => {
      if (system.fetcher.mock.calls.length === 2) child.emit('exit', null, 'SIGSEGV');
      return {status: 503};
    });
    await expect(startCommand('web', resolved(), 'http://localhost:8081', system)).rejects.toThrow(/^npx expo start ended on SIGSEGV before it answered at http:\/\/localhost:8081\. The end of its log/);
  });

  it('adds that it did not stop to a command that never answered', async () => {
    const {system} = machine({up: [false]});
    await expect(startCommand('web', resolved({log: false}), 'http://localhost:8081', system)).rejects.toThrow(
      'npx expo start did not answer at http://localhost:8081 within 1000 ms; npx expo start (pid 4242) did not stop',
    );
  });

  it("names what spawn could not start, and Node's reason", async () => {
    const child = fakeChild(false);
    const {system} = machine({child});
    system.spawn.mockImplementation(() => {
      process.nextTick(() => child.emit('error', new Error('spawn npxx ENOENT')));
      return child;
    });
    await expect(startCommand('web', resolved({executable: 'npxx'}), 'http://localhost:8081', system)).rejects.toThrow(
      expect.objectContaining({code: 'APP_UNREACHABLE', message: 'npxx expo start could not be started: spawn npxx ENOENT'}),
    );
    const silent = machine({child: fakeChild(false)});
    await expect(startCommand('web', resolved(), 'http://localhost:8081', silent.system)).rejects.toThrow('npx expo start could not be started: no process came of it');
  });

  it('stops what it started, once, however often it is asked', async () => {
    const {system, undo} = machine({endsOn: ['SIGTERM']});
    const started = await startCommand('web', resolved(), 'http://localhost:8081', system);
    await Promise.all([started.stop(), started.stop()]);
    expect(system.signal.mock.calls).toEqual([[-4242, 'SIGTERM']]);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('fails the stop when the server still answers after, or the process outlives it', async () => {
    const survivor = machine({up: [false, true], endsOn: ['SIGTERM']});
    const started = await startCommand('web', resolved(), 'http://localhost:8081', survivor.system);
    await expect(started.stop()).rejects.toThrow(
      expect.objectContaining({code: 'ACTION_FAILED', message: 'npx expo start (pid 4242) was stopped, and something still answers at http://localhost:8081: end it by hand'}),
    );
    const stubborn = machine({platform: 'win32'});
    await expect((await startCommand('windows', resolved(), 'http://localhost:8081', stubborn.system)).stop()).rejects.toThrow('npx expo start (pid 4242) did not stop: end it by hand');
    expect(stubborn.system.killTree).toHaveBeenCalledWith(4242);
  });

  it('ends what it started if the main process exits first', async () => {
    const posix = machine();
    await startCommand('web', resolved(), 'http://localhost:8081', posix.system);
    const end = posix.system.onExit.mock.calls[0]![0];
    end();
    expect(posix.system.signal).toHaveBeenLastCalledWith(-4242, 'SIGKILL');
    posix.system.signal.mockImplementation(() => {
      throw new Error('kill ESRCH');
    });
    expect(end).not.toThrow();
    const windows = machine({platform: 'win32'});
    await startCommand('windows', resolved(), 'http://localhost:8081', windows.system);
    windows.system.onExit.mock.calls[0]![0]();
    expect(windows.system.killTree).toHaveBeenCalledWith(4242);
  });
});

describe('sharing a command between platforms', () => {
  const handle = (stop = vi.fn(async () => {})): Started => ({key: 'k', pid: 1, reused: false, log: false, stop});

  it('starts it for the first platform and shares it with the next', async () => {
    const commands = registry({});
    const stop = vi.fn(async () => {});
    const start = vi.fn(async () => handle(stop));
    const [one, two] = await Promise.all([acquire(commands, 'k', start), acquire(commands, 'k', start)]);
    expect(one).toBe(two);
    expect(start).toHaveBeenCalledTimes(1);
    await release(commands, 'k');
    expect(stop).not.toHaveBeenCalled();
    await release(commands, 'k');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(commands.size).toBe(0);
    await expect(release(commands, 'k')).resolves.toBeUndefined();
  });

  it('forgets one that failed to start', async () => {
    const commands = registry({});
    const failing = acquire(commands, 'k', async () => Promise.reject(new Error('no')));
    await expect(failing).rejects.toThrow('no');
    expect(commands.size).toBe(0);
  });

  it('is kept on the global object, where every project can reach it', () => {
    const store = {};
    expect(registry(store)).toBe(registry(store));
    expect(registry()).toBe(registry(globalThis));
    expect(registry({})).not.toBe(registry(store));
  });
});

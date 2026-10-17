import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface Ran {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the program could not be started at all (it is not installed). */
  missing?: boolean;
}

/**
 * Runs a program with its arguments handed over as they are — no shell, so a
 * path with a space in it (every tool under "Program Files") survives.
 */
export function run(command: string, args: string[], options: {cwd?: string; timeout?: number; input?: string} = {}): Ran {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: options.cwd,
    timeout: options.timeout ?? 120_000,
    input: options.input,
    windowsHide: true,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  // ENOENT is the program not being there, which callers report as "not installed"
  // rather than as a failure of the thing they were asked to do.
  const missing = Boolean(result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT');
  return {ok: !missing && result.status === 0, status: result.status, stdout, stderr, missing};
}

export interface RunOptions {
  cwd?: string;
  /** Milliseconds before the program is stopped. 120 000 unless given; 0 for no limit. */
  timeout?: number;
  /** Written to the program's stdin, which is then closed. */
  input?: string;
  /** Stops the program when it aborts. */
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface RanAsync extends Ran {
  missing: boolean;
  /** The program outlived `timeout` and was stopped. */
  timedOut: boolean;
  /** `signal` aborted before the program finished. */
  aborted: boolean;
}

/**
 * Stops a program `runAsync` started, with what it started. On macOS and
 * Linux the program leads a process group of its own, which is sent the
 * signal, since a program's children outlive it there. On Windows Node starts
 * the program in a job that ends what it started through Node along with it,
 * so the program alone is sent it. A daemon started detached, as
 * agent-device's is, is meant to outlive the call, and does.
 */
export function stopProgram(child: {pid?: number; kill(signal: NodeJS.Signals): boolean}, group: boolean, kill: (pid: number, signal: NodeJS.Signals) => void = process.kill): void {
  if (group && child.pid !== undefined) {
    try {
      kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // The group has gone, and the program may not have.
    }
  }
  child.kill('SIGTERM');
}

/**
 * `run`, without blocking. `spawnSync` holds the event loop until the program
 * exits, so no timer fires meanwhile, a Vitest timeout included; this lets one
 * fire, and stops the program when a timeout or an abort says so.
 *
 * It answers rather than rejects, the way `run` does: every caller already
 * branches on `ok`, and a rejection would be the one shape none handles.
 */
export function runAsync(command: string, args: string[], options: RunOptions = {}): Promise<RanAsync> {
  const {signal, timeout = 120_000} = options;
  return new Promise(resolve => {
    const answer = {ok: false, status: null, stdout: '', stderr: '', missing: false, timedOut: false, aborted: false};
    if (signal?.aborted) return resolve({...answer, aborted: true});
    try {
      // No shell, ever: nothing a test hands over is interpreted.
      const group = process.platform !== 'win32';
      const child = spawn(command, args, {cwd: options.cwd, env: options.env, windowsHide: true, detached: group});
      let error: NodeJS.ErrnoException | undefined;
      const stop = (why: 'timedOut' | 'aborted') => {
        answer[why] = true;
        stopProgram(child, group);
      };
      // In a group of its own the program does not hear a terminal's Ctrl+C, so the run's exit stops it.
      const orphaned = stopProgram.bind(null, child, group, process.kill);
      process.once('exit', orphaned);
      const timer = timeout > 0 ? setTimeout(() => stop('timedOut'), timeout) : undefined;
      const abort = () => stop('aborted');
      signal?.addEventListener('abort', abort, {once: true});
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (answer.stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (answer.stderr += chunk));
      child.on('error', thrown => (error = thrown));
      // A program that exits without reading its input breaks the pipe under a
      // write still in flight. What it printed and how it exited still stand.
      child.stdin.on('error', () => {});
      child.stdin.end(options.input);
      // `close` rather than `exit`, so what the program wrote has all arrived.
      // It comes even when the program never started, after the error.
      child.on('close', status => {
        clearTimeout(timer);
        process.off('exit', orphaned);
        signal?.removeEventListener('abort', abort);
        const started = child.pid !== undefined;
        const missing = error?.code === 'ENOENT';
        resolve({...answer, ok: started && status === 0 && !answer.timedOut && !answer.aborted, status: started ? status : null, missing});
      });
    } catch (thrown) {
      // Arguments that cannot be handed over at all, such as one holding a null byte.
      resolve({...answer, stderr: (thrown as Error).message});
    }
  });
}

/** Whether a program answers at all, for the doctor. */
export function installed(command: string, args: string[] = ['--version']): boolean {
  return !run(command, args, {timeout: 20_000}).missing;
}

/**
 * The same, for a program whose output is bytes rather than text — a PNG down
 * a pipe survives this and would not survive being decoded as UTF-8.
 */
export function runBinary(command: string, args: string[], options: {cwd?: string; timeout?: number} = {}): {ok: boolean; stdout: Buffer; stderr: string; missing?: boolean} {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const missing = Boolean(result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT');
  return {
    ok: !missing && result.status === 0,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8'),
    missing,
  };
}

/** Makes sure a file's directory exists, and answers with the file. */
export function prepare(file: string): string {
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  return path.resolve(file);
}

/** The nth of a file and its siblings: the file itself first, then `name-2.ext`, `name-3.ext` beside it. */
export function numbered(file: string, n: number): string {
  if (n <= 1) return file;
  const extension = path.extname(file);
  return path.join(path.dirname(file), `${path.basename(file, extension)}-${n}${extension}`);
}

/**
 * Arguments as one Windows command line, each quoted as the C runtime and
 * CommandLineToArgvW read them back: as it is where it has no space, tab or
 * quote, else in quotes, a quote escaped, and the backslashes before a quote
 * or the closing one doubled.
 */
export function commandLine(args: readonly string[]): string {
  return args
    .map(arg => {
      if (arg !== '' && !/[\s"]/.test(arg)) return arg;
      let quoted = '"';
      let slashes = 0;
      for (const char of arg) {
        if (char === '\\') {
          slashes += 1;
          continue;
        }
        quoted += char === '"' ? `${'\\'.repeat(slashes * 2 + 1)}"` : `${'\\'.repeat(slashes)}${char}`;
        slashes = 0;
      }
      return `${quoted}${'\\'.repeat(slashes * 2)}"`;
    })
    .join(' ');
}

export function firstLine(text: string): string {
  // `split` always answers with at least one string, so the first is there.
  return text.trim().split(/\r?\n/)[0]!;
}

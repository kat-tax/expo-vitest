/**
 * The driver's end of the Windows host: one child process for the driver's
 * whole life, spoken to in JSON lines, one request at a time. A request that
 * gets no answer in its time, or a host that stops, fails every request it
 * held with a message that says so, and the next request starts a new host.
 *
 * The child is made by whoever creates the host, so this holds no process of
 * its own and a test can hand it a fake one.
 */
import {HarnessError} from '../lib/errors.ts';

/** The child, as far as the host uses it. Its output arrives as text. */
export interface HostChild {
  stdin: {write(text: string): unknown; end(): unknown; on(event: 'error', listener: (error: Error) => void): unknown};
  stdout: {on(event: 'data', listener: (chunk: string) => void): unknown};
  stderr: {on(event: 'data', listener: (chunk: string) => void): unknown};
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(): unknown;
}

export interface HostOptions {
  start: () => HostChild;
  /** Milliseconds a request may take unless it says otherwise. */
  timeout?: number;
  /** Milliseconds `close` gives the host to finish before stopping it. */
  quitTimeout?: number;
}

export interface WindowsHost {
  request<T = unknown>(op: string, fields?: Record<string, unknown>, timeout?: number): Promise<T>;
  close(): Promise<void>;
}

/** Text that arrives in chunks, handed on a whole line at a time. */
export function lines(onLine: (line: string) => void): (chunk: string) => void {
  let rest = '';
  return chunk => {
    rest += chunk;
    for (let end = rest.indexOf('\n'); end >= 0; end = rest.indexOf('\n')) {
      const line = rest.slice(0, end).replace(/\r$/, '');
      rest = rest.slice(end + 1);
      if (line.trim()) onLine(line);
    }
  };
}

interface Waiting {
  op: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Live {
  child: HostChild;
  waiting: Map<number, Waiting>;
  /** The end of what the host wrote to stderr, which is where a start that failed says why. */
  stderr: string;
  gone: boolean;
}

export function windowsHost(options: HostOptions): WindowsHost {
  let live: Live | null = null;
  let next = 1;
  let queue: Promise<unknown> = Promise.resolve();

  /** Fails what the host held; `kill` is false for a host that has already gone by itself. */
  function stop(current: Live, error: HarnessError, kill = true): void {
    if (current.gone) return;
    current.gone = true;
    if (live === current) live = null;
    for (const waiting of current.waiting.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    current.waiting.clear();
    if (kill) current.child.kill();
  }

  function answer(current: Live, line: string): void {
    let parsed: {id?: number; ok?: boolean; result?: unknown; error?: string};
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      // Not an answer: something the host printed on its own account.
      return;
    }
    const waiting = current.waiting.get(parsed.id ?? -1);
    if (!waiting) return;
    current.waiting.delete(parsed.id!);
    clearTimeout(waiting.timer);
    if (parsed.ok) waiting.resolve(parsed.result);
    else waiting.reject(new HarnessError('ACTION_FAILED', parsed.error ?? `the Windows host could not ${waiting.op}`));
  }

  function start(): Live {
    const child = options.start();
    const current: Live = {child, waiting: new Map(), stderr: '', gone: false};
    child.stdout.on('data', lines(line => answer(current, line)));
    child.stderr.on('data', chunk => {
      current.stderr = (current.stderr + chunk).slice(-4_000);
    });
    // A write to a host that has just stopped fails here, after the exit that says why.
    child.stdin.on('error', () => {});
    child.on('exit', code => {
      const said = current.stderr.trim().split(/\r?\n/)[0];
      stop(current, new HarnessError('ACTION_FAILED', `the Windows host stopped${code === null ? '' : ` with code ${code}`}${said ? `: ${said}` : ''}`), false);
    });
    child.on('error', error => stop(current, new HarnessError('DRIVER_UNAVAILABLE', `the Windows host could not start: ${error.message}`)));
    return current;
  }

  function send(op: string, fields: Record<string, unknown>, timeout: number): Promise<unknown> {
    live ??= start();
    const current = live;
    const id = next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop(current, new HarnessError('ACTION_FAILED', `the Windows host gave no answer to ${op} within ${timeout / 1000} s`)), timeout);
      current.waiting.set(id, {op, resolve, reject, timer});
      current.child.stdin.write(`${JSON.stringify({...fields, id, op})}\n`);
    });
  }

  return {
    request<T>(op: string, fields: Record<string, unknown> = {}, timeout = options.timeout ?? 10_000): Promise<T> {
      // One at a time: the host answers in order, and a step is a sequence anyway.
      const run = queue.then(() => send(op, fields, timeout));
      queue = run.catch(() => {});
      return run as Promise<T>;
    },

    async close(): Promise<void> {
      await queue;
      const current = live;
      if (!current) return;
      live = null;
      // A host whose stdin closes finishes its loop and exits; one that does not is stopped.
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          stop(current, new HarnessError('ACTION_FAILED', 'the Windows host was closed'));
          resolve();
        }, options.quitTimeout ?? 2_000);
        current.child.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        current.child.stdin.end();
      });
    },
  };
}

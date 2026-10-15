import {EventEmitter} from 'node:events';
import {describe, expect, it, vi} from 'vitest';
import type {HostChild} from './windows-host.ts';
import {lines, windowsHost} from './windows-host.ts';

/** A host process that answers however the test says, through what it is sent. */
class FakeChild extends EventEmitter implements HostChild {
  sent: Record<string, unknown>[] = [];
  ended = false;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), {
    write: (text: string) => {
      const request = JSON.parse(text) as Record<string, unknown>;
      this.sent.push(request);
      this.onRequest(request);
      return true;
    },
    end: () => {
      this.ended = true;
      this.onEnd();
    },
  });

  onRequest: (request: Record<string, unknown>) => void;
  onEnd: () => void = () => {};

  constructor(onRequest: (request: Record<string, unknown>) => void = () => {}) {
    super();
    this.onRequest = onRequest;
  }

  answer(text: string): void {
    this.stdout.emit('data', text);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

/** A child that answers every request at once with its op as the result. */
function echoing(): FakeChild {
  const child: FakeChild = new FakeChild(request => queueMicrotask(() => child.answer(`${JSON.stringify({id: request.id, ok: true, result: request.op})}\n`)));
  child.onEnd = () => queueMicrotask(() => child.emit('exit', 0));
  return child;
}

describe('lines', () => {
  it('hands on whole lines only, however the text arrives', () => {
    const seen: string[] = [];
    const feed = lines(line => seen.push(line));
    feed('{"id":1');
    expect(seen).toEqual([]);
    feed('}\r\n{"id":2}\n\n   \n{"id"');
    expect(seen).toEqual(['{"id":1}', '{"id":2}']);
    feed(':3}\n');
    expect(seen).toEqual(['{"id":1}', '{"id":2}', '{"id":3}']);
  });
});

describe('windowsHost', () => {
  it('starts one host on the first request and answers each request from it', async () => {
    const child = echoing();
    const start = vi.fn(() => child);
    const host = windowsHost({start});
    expect(start).not.toHaveBeenCalled();
    expect(await host.request('hello')).toBe('hello');
    expect(await host.request('snapshot', {process: 'MyApp', interactive: true})).toBe('snapshot');
    expect(start).toHaveBeenCalledOnce();
    expect(child.sent).toEqual([
      {id: 1, op: 'hello'},
      {process: 'MyApp', interactive: true, id: 2, op: 'snapshot'},
    ]);
  });

  it('sends one request at a time, the next only once the last was answered', async () => {
    const child = new FakeChild();
    const host = windowsHost({start: () => child});
    const first = host.request('raise', {process: 'MyApp'});
    const second = host.request('click', {points: [[1, 2]]});
    await Promise.resolve();
    expect(child.sent.map(request => request.op)).toEqual(['raise']);
    child.answer('{"id":1,"ok":true,"result":"foreground True (set True)"}\n');
    expect(await first).toBe('foreground True (set True)');
    await vi.waitFor(() => expect(child.sent.map(request => request.op)).toEqual(['raise', 'click']));
    child.answer('{"id":2,"ok":true,"result":"clicked 1,2"}\n');
    expect(await second).toBe('clicked 1,2');
  });

  it('passes a failure on in the host words, and ignores what is not an answer to anything waiting', async () => {
    const child = new FakeChild(request => {
      queueMicrotask(() => {
        child.answer('compiling...\n');
        child.answer(`${JSON.stringify({id: 99, ok: true, result: 'not this'})}\n`);
        child.answer(`${JSON.stringify({ok: true, result: 'nor this'})}\n`);
        if (request.op === 'rect') child.answer(`${JSON.stringify({id: request.id, ok: false, error: 'no window for MyApp'})}\n`);
        else child.answer(`${JSON.stringify({id: request.id, ok: false})}\n`);
      });
    });
    const host = windowsHost({start: () => child});
    await expect(host.request('rect', {process: 'MyApp'})).rejects.toThrow(expect.objectContaining({name: 'HarnessError', code: 'ACTION_FAILED', message: 'no window for MyApp'}));
    await expect(host.request('screen')).rejects.toThrow('the Windows host could not screen');
  });

  it('gives up on a request that gets no answer in time, stops that host, and starts another for the next', async () => {
    const quiet = new FakeChild();
    const children = [quiet, echoing()];
    const host = windowsHost({start: () => children.shift()!, timeout: 30});
    await expect(host.request('snapshot')).rejects.toThrow(expect.objectContaining({code: 'ACTION_FAILED', message: 'the Windows host gave no answer to snapshot within 0.03 s'}));
    expect(quiet.killed).toBe(true);
    expect(await host.request('hello', {}, 1_000)).toBe('hello');
  });

  it('fails what it held when the host stops, saying how and what it last said', async () => {
    const child = new FakeChild(() => {
      queueMicrotask(() => {
        child.stderr.emit('data', 'Add-Type : the type or namespace name could not be found\r\nmore detail\r\n');
        child.emit('exit', 1);
      });
    });
    const host = windowsHost({start: () => child});
    await expect(host.request('hello')).rejects.toThrow('the Windows host stopped with code 1: Add-Type : the type or namespace name could not be found');
    const silent = new FakeChild(() => queueMicrotask(() => silent.emit('exit', null)));
    await expect(windowsHost({start: () => silent}).request('hello')).rejects.toThrow(/^the Windows host stopped$/);
  });

  it('says the host could not start when there is no process to start', async () => {
    // Node reports a process that never started with an error and then an exit.
    const child = new FakeChild(() =>
      queueMicrotask(() => {
        child.emit('error', new Error('spawn powershell ENOENT'));
        child.emit('exit', -4058);
      }),
    );
    const host = windowsHost({start: () => child});
    await expect(host.request('hello')).rejects.toThrow(expect.objectContaining({code: 'DRIVER_UNAVAILABLE', message: 'the Windows host could not start: spawn powershell ENOENT'}));
    // A write failing after the host has gone is not an error of its own.
    expect(() => child.stdin.emit('error', new Error('write EPIPE'))).not.toThrow();
  });

  it('closes by ending the host input and waiting for it to go, and stops one that will not', async () => {
    const child = echoing();
    const host = windowsHost({start: () => child});
    await host.request('hello');
    await host.close();
    expect(child.ended).toBe(true);
    expect(child.killed).toBe(false);

    const stubborn = new FakeChild(request => queueMicrotask(() => stubborn.answer(`${JSON.stringify({id: request.id, ok: true, result: 1})}\n`)));
    const stuck = windowsHost({start: () => stubborn, quitTimeout: 20});
    await stuck.request('idle');
    await stuck.close();
    expect(stubborn.killed).toBe(true);

    // Nothing started is nothing to close.
    await expect(windowsHost({start: () => echoing()}).close()).resolves.toBeUndefined();
  });
});

import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import type {ResolvedCommand} from './config.ts';
import {startCommand} from './app-process.ts';
import {system} from './system.ts';

// The keeper and the processes around it are real here: Node, with the
// keeper run from its source, as `system` hands it over.
const RUN = fileURLToPath(new URL('__fixtures__/run.ts', import.meta.url));

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(done: () => boolean, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (!done()) {
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return true;
}

const node = (script: string, extra: Partial<ResolvedCommand> = {}): ResolvedCommand => ({
  executable: process.execPath,
  args: ['-e', script],
  cwd: process.cwd(),
  env: {},
  startupTimeout: 20_000,
  shutdownTimeout: 2000,
  log: false,
  reuseExisting: false,
  ...extra,
});

describe('the keeper', () => {
  it('ends the command when the run is killed without a teardown', {timeout: 30_000}, async () => {
    const port = await freePort();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-keeper-'));
    const run = spawn(process.execPath, [RUN, String(port), folder], {stdio: ['ignore', 'pipe', 'inherit']});
    const keeper = await new Promise<number>((resolve, reject) => {
      run.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        const ready = chunk.match(/ready (\d+)/);
        if (ready) resolve(Number(ready[1]));
      });
      run.once('exit', code => reject(new Error(`the run ended with code ${code} before its command was ready`)));
    });
    const pid = Number(fs.readFileSync(path.join(folder, 'pid'), 'utf8'));
    try {
      expect(alive(pid)).toBe(true);
      // A hard kill: no exit hook, no teardown.
      run.kill('SIGKILL');
      expect(await until(() => !alive(pid), 15_000)).toBe(true);
    } finally {
      // What a failure leaves would hold this run open: the server has a handle on the pipe from it.
      if (alive(keeper)) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(keeper), '/T', '/F'], {windowsHide: true});
        else process.kill(-keeper, 'SIGKILL');
      }
      // Windows holds a process's handles on the folder for a moment after it is gone, and refuses the removal till then.
      fs.rmSync(folder, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
    }
  });

  it('starts a command, and stops it with the run', {timeout: 30_000}, async () => {
    const port = await freePort();
    const serve = `require('node:http').createServer((_, response) => response.end('up')).listen(${port}, '127.0.0.1')`;
    const started = await startCommand('web', node(serve), `http://127.0.0.1:${port}/`, system);
    expect(started.pid).toBeGreaterThan(0);
    await expect(started.stop()).resolves.toBeUndefined();
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  it("answers with Node's reason for a command that cannot be started", {timeout: 30_000}, async () => {
    const port = await freePort();
    await expect(startCommand('web', node('', {executable: 'expo-vitest-no-such-program', args: []}), `http://127.0.0.1:${port}/`, system)).rejects.toThrow(
      'expo-vitest-no-such-program could not be started: spawn expo-vitest-no-such-program ENOENT',
    );
  });

  it('ends as the command ended', {timeout: 30_000}, async () => {
    const port = await freePort();
    await expect(startCommand('web', node('process.exit(3)'), `http://127.0.0.1:${port}/`, system)).rejects.toThrow(/ended with code 3 before it answered/);
  });
});

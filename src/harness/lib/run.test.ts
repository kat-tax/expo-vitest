import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {commandLine, firstLine, installed, numbered, prepare, run, runAsync, runBinary, stopProgram} from './run.ts';

// Every program here is this Node, so the cases run the same on every CI machine.
const node = process.execPath;
const PRINTS = "process.stdout.write('out'); process.stderr.write('err')";
const LINGERS = 'setTimeout(() => {}, 10000)';
const ECHOES = "process.stdin.setEncoding('utf8'); let all = ''; process.stdin.on('data', c => (all += c)); process.stdin.on('end', () => process.stdout.write(all))";
const MISSING = 'expo-vitest-no-such-program';

describe('stopping a program', () => {
  it('stops its group where it leads one, and the program itself where it does not', () => {
    const kill = vi.fn();
    const child = {pid: 7, kill: vi.fn(() => true)};
    stopProgram(child, true, kill);
    expect(kill).toHaveBeenCalledWith(-7, 'SIGTERM');
    expect(child.kill).not.toHaveBeenCalled();
    stopProgram(child, false, kill);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('stops the program itself where its group has gone, or it never started', () => {
    const child = {pid: 7, kill: vi.fn(() => true)};
    stopProgram(child, true, () => {
      throw new Error('kill ESRCH');
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    const kill = vi.fn();
    stopProgram({kill: child.kill}, true, kill);
    expect(kill).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledTimes(2);
  });
});

describe('runAsync', () => {
  it('answers with what the program printed and how it exited', async () => {
    expect(await runAsync(node, ['-e', PRINTS])).toStrictEqual({ok: true, status: 0, stdout: 'out', stderr: 'err', missing: false, timedOut: false, aborted: false});
    expect(await runAsync(node, ['-e', 'process.exit(3)'])).toMatchObject({ok: false, status: 3, missing: false});
  });

  it('says a program that is not there is missing', async () => {
    expect(await runAsync(MISSING, [])).toMatchObject({ok: false, status: null, missing: true});
  });

  it('stops a program that outlives its timeout, without waiting for it', async () => {
    const started = Date.now();
    expect(await runAsync(node, ['-e', LINGERS], {timeout: 200})).toMatchObject({ok: false, timedOut: true, aborted: false});
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops what the program started along with it', async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-run-')), 'pid');
    // A child of its own, through Node, that would linger well past the test.
    const starts = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(LINGERS)}], {stdio: 'ignore'}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); ${LINGERS}`;
    expect(await runAsync(node, ['-e', starts], {timeout: 1000})).toMatchObject({timedOut: true});
    const started = Number(fs.readFileSync(pidFile, 'utf8'));
    const alive = () => {
      try {
        process.kill(started, 0);
        return true;
      } catch {
        return false;
      }
    };
    const deadline = Date.now() + 5000;
    while (alive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    expect(alive()).toBe(false);
    fs.rmSync(path.dirname(pidFile), {recursive: true, force: true});
  });

  it('stops a program when the signal aborts', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    expect(await runAsync(node, ['-e', LINGERS], {signal: controller.signal})).toMatchObject({ok: false, aborted: true, timedOut: false});
  });

  it('starts nothing when the signal has already aborted', async () => {
    expect(await runAsync(node, ['-e', PRINTS], {signal: AbortSignal.abort()})).toStrictEqual({
      ok: false,
      status: null,
      stdout: '',
      stderr: '',
      missing: false,
      timedOut: false,
      aborted: true,
    });
  });

  it('hands the program its input, and closes stdin when there is none', async () => {
    expect((await runAsync(node, ['-e', ECHOES], {input: 'hello'})).stdout).toBe('hello');
    // A program reading stdin still finishes when it was handed nothing, rather than waiting for a person.
    expect(await runAsync(node, ['-e', ECHOES], {timeout: 0})).toMatchObject({ok: true, stdout: ''});
  });

  it('runs where it is told, with the environment it is given', async () => {
    const folder = fs.realpathSync(os.tmpdir());
    const reads = "process.stdout.write(process.cwd() + '|' + process.env.EXPO_VITEST_PROBE)";
    expect((await runAsync(node, ['-e', reads], {cwd: folder, env: {...process.env, EXPO_VITEST_PROBE: 'yes'}})).stdout).toBe(`${folder}|yes`);
  });

  it('lets a program exit without reading what it was handed', async () => {
    // Far more than a pipe holds, so the write is still in flight when the program goes.
    expect(await runAsync(node, ['-e', 'process.exit(0)'], {input: 'x'.repeat(16 * 1024 * 1024)})).toMatchObject({ok: true, status: 0});
  });

  it('answers rather than throws for arguments that cannot be handed over', async () => {
    const ran = await runAsync(node, ['a\u0000b']);
    expect(ran.ok).toBe(false);
    expect(ran.stderr).toMatch(/null bytes/);
  });
});

describe('run', () => {
  it('answers with what the program printed and how it exited', () => {
    expect(run(node, ['-e', PRINTS])).toStrictEqual({ok: true, status: 0, stdout: 'out', stderr: 'err', missing: false});
    expect(run(node, ['-e', 'process.exit(3)'])).toMatchObject({ok: false, status: 3});
  });

  it('hands the program its input, and runs where it is told', () => {
    expect(run(node, ['-e', ECHOES], {input: 'hello'}).stdout).toBe('hello');
    const folder = fs.realpathSync(os.tmpdir());
    expect(run(node, ['-e', 'process.stdout.write(process.cwd())'], {cwd: folder}).stdout).toBe(folder);
  });

  it('says a program that is not there is missing, and one that ran too long is not', () => {
    expect(run(MISSING, [])).toStrictEqual({ok: false, status: null, stdout: '', stderr: '', missing: true});
    expect(run(node, ['-e', LINGERS], {timeout: 200})).toMatchObject({ok: false, missing: false});
  });
});

describe('runBinary', () => {
  it('keeps bytes as bytes', () => {
    const ran = runBinary(node, ['-e', 'process.stdout.write(Buffer.from([0, 255, 128]))'], {timeout: 20_000});
    expect(ran.ok).toBe(true);
    expect([...ran.stdout]).toEqual([0, 255, 128]);
  });

  it('says a program that is not there is missing', () => {
    const ran = runBinary(MISSING, []);
    expect(ran).toMatchObject({ok: false, stderr: '', missing: true});
    expect(ran.stdout.length).toBe(0);
  });
});

describe('installed', () => {
  it('knows a program that answers from one that is not there', () => {
    expect(installed(node)).toBe(true);
    expect(installed(node, ['-e', '0'])).toBe(true);
    expect(installed(MISSING)).toBe(false);
  });
});

describe('prepare', () => {
  it('makes the folder a file goes in, and answers with the file', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-run-'));
    try {
      expect(prepare(path.join(folder, 'a', 'b', 'shot.png'))).toBe(path.join(folder, 'a', 'b', 'shot.png'));
      expect(fs.statSync(path.join(folder, 'a', 'b')).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(folder, {recursive: true, force: true});
    }
  });
});

describe('commandLine', () => {
  it('leaves a plain argument as it is, and quotes one with a space or a quote, as Windows reads them back', () => {
    expect(commandLine(['plain', 'myapp://settings?tab=1', 'C:\\Apps\\MyApp.exe'])).toBe('plain myapp://settings?tab=1 C:\\Apps\\MyApp.exe');
    expect(commandLine([''])).toBe('""');
    expect(commandLine(['two words'])).toBe('"two words"');
    expect(commandLine(['say "hi"'])).toBe('"say \\"hi\\""');
    // The backslashes before a quote, or the closing one, are doubled; the rest are as they are.
    expect(commandLine(['C:\\a dir\\'])).toBe('"C:\\a dir\\\\"');
    expect(commandLine(['a\\"b'])).toBe('"a\\\\\\"b"');
  });

  it.runIf(process.platform === 'win32')('is read back as the same arguments by a program on Windows', () => {
    const args = ['plain', '', 'two words', 'say "hi"', 'C:\\a dir\\', 'a\\"b', 'tab\there'];
    const read = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', commandLine(args)], {encoding: 'utf8', windowsVerbatimArguments: true, shell: false});
    expect(JSON.parse(read.stdout)).toEqual(args);
  });
});

describe('firstLine', () => {
  it('is the first line of what a program said, trimmed', () => {
    expect(firstLine('  one\r\ntwo\n')).toBe('one');
    expect(firstLine('one')).toBe('one');
    expect(firstLine('')).toBe('');
  });
});

describe('numbered', () => {
  it('is the file itself first, then a sibling with the number before the extension', () => {
    expect(numbered(path.join('r', 't', 'video.webm'), 1)).toBe(path.join('r', 't', 'video.webm'));
    expect(numbered(path.join('r', 't', 'video.webm'), 3)).toBe(path.join('r', 't', 'video-3.webm'));
    expect(numbered(path.join('r', 'clip'), 2)).toBe(path.join('r', 'clip-2'));
  });
});

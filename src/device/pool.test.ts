import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {isHarnessError} from '../harness/lib/errors.ts';
import type {Locks} from './pool.ts';
import {claimDevice, fileLocks, lockFile, orderFor, sessionName} from './pool.ts';

/** Locks in memory, as another file of the run would leave them. */
function memoryLocks(held: Record<string, string> = {}): Locks & {held: Record<string, string>} {
  return {
    held,
    take(file, holder) {
      if (file in held) return false;
      held[file] = holder;
      return true;
    },
    holder: file => held[file] ?? null,
    drop(file) {
      delete held[file];
    },
  };
}

const folder = path.join('/run', 'android');
const devices = ['Pixel_8', 'Pixel_9', 'Pixel_10'];

describe('the order a file tries the pool in', () => {
  it('starts where its name says, and goes round', () => {
    const order = orderFor(devices, 'device/a.test.ts');
    expect([...order].sort()).toEqual([...devices].sort());
    expect(orderFor(devices, 'device/a.test.ts')).toEqual(order);
    const starts = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(name => orderFor(devices, `device/${name}.test.ts`)[0]));
    expect(starts.size).toBeGreaterThan(1);
    expect(orderFor(['only'], 'x')).toEqual(['only']);
  });

  it('holds each device in a session of its own, named for the run', () => {
    expect(sessionName('2026-10-15T08-00-00Z-abc123', 'Pixel_8')).toBe('expo-vitest-2026-10-15T08-00-00Z-abc123-Pixel_8');
    expect(sessionName('r', 'iPhone 17 Pro')).toBe('expo-vitest-r-iPhone_17_Pro');
  });

  it('keeps a lock file per device, named safely', () => {
    expect(lockFile(folder, 'iPhone 17 Pro')).toBe(path.join(folder, 'iPhone_17_Pro'));
    expect(lockFile(folder, 'emulator-5554')).toBe(path.join(folder, 'emulator-5554'));
  });
});

describe('a claim', () => {
  it('takes the first device in the order that is free, and gives it back', async () => {
    const locks = memoryLocks();
    const order = orderFor(devices, 'device/a.test.ts');
    const open = vi.fn(async () => 'opened' as const);
    const claim = await claimDevice({devices, folder, platform: 'android', file: 'device/a.test.ts', open, timeout: 1000, locks});
    expect(claim.device).toBe(order[0]);
    expect(open).toHaveBeenCalledExactlyOnceWith(order[0]);
    expect(locks.held[lockFile(folder, order[0])]).toBe(`a.test.ts, process ${process.pid}`);
    claim.release();
    expect(locks.held).toEqual({});
  });

  it('passes over a device another file holds, and one a session outside the run holds', async () => {
    const order = orderFor(devices, 'device/a.test.ts');
    const locks = memoryLocks({[lockFile(folder, order[0])]: 'b.test.ts, process 1'});
    const open = vi.fn(async (device: string) => (device === order[1] ? ('in-use' as const) : ('opened' as const)));
    const claim = await claimDevice({devices, folder, platform: 'android', file: 'device/a.test.ts', open, timeout: 1000, locks});
    expect(claim.device).toBe(order[2]);
    expect(open.mock.calls.map(([device]) => device)).toEqual([order[1], order[2]]);
    expect(Object.keys(locks.held).sort()).toEqual([lockFile(folder, order[0]), lockFile(folder, order[2])].sort());
  });

  it('waits a second at a time for a device to come free', async () => {
    const locks = memoryLocks({[lockFile(folder, 'Pixel_8')]: 'b.test.ts, process 1'});
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
      if (clock === 2000) locks.drop(lockFile(folder, 'Pixel_8'));
    });
    const claim = await claimDevice({devices: ['Pixel_8'], folder, platform: 'android', file: 'a', open: async () => 'opened', timeout: 5000, locks, now: () => clock, sleep});
    expect(claim.device).toBe('Pixel_8');
    expect(sleep.mock.calls).toEqual([[1000], [1000]]);
  });

  it('fails with DEVICE_POOL_EXHAUSTED, naming who holds each, once the wait is up', async () => {
    const locks = memoryLocks({[lockFile(folder, 'Pixel_8')]: 'b.test.ts, process 1'});
    let clock = 0;
    const error = await claimDevice({
      devices: ['Pixel_8', 'Pixel_9'],
      folder,
      file: 'a',
      open: async () => 'in-use',
      timeout: 3000,
      platform: 'android',
      locks,
      now: () => clock,
      sleep: async ms => {
        clock += ms;
      },
    }).catch((thrown: unknown) => thrown);
    expect(isHarnessError(error) && [error.code, error.platform]).toEqual(['DEVICE_POOL_EXHAUSTED', 'android']);
    expect((error as Error).message).toMatch(/^no device in the pool came free within 3 s: /);
    expect((error as Error).message).toContain('Pixel_8 by b.test.ts, process 1');
    expect((error as Error).message).toContain('Pixel_9 by a session outside this run');
    expect(locks.held).toEqual({[lockFile(folder, 'Pixel_8')]: 'b.test.ts, process 1'});
  });

  it('stops at an error that is not a held device, and leaves no lock behind', async () => {
    const locks = memoryLocks();
    const open = async () => {
      throw new Error('the emulator would not boot');
    };
    await expect(claimDevice({devices, folder, platform: 'android', file: 'a', open, timeout: 1000, locks})).rejects.toThrow('the emulator would not boot');
    expect(locks.held).toEqual({});
  });

  it('waits on the clock by default', async () => {
    vi.useFakeTimers();
    try {
      const locks = memoryLocks({[lockFile(folder, 'Pixel_8')]: 'b'});
      const claiming = claimDevice({devices: ['Pixel_8'], folder, platform: 'android', file: 'a', open: async () => 'opened', timeout: 60_000, locks});
      await vi.advanceTimersByTimeAsync(999);
      locks.drop(lockFile(folder, 'Pixel_8'));
      await vi.advanceTimersByTimeAsync(1);
      await expect(claiming).resolves.toMatchObject({device: 'Pixel_8'});
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the lock files on disk', () => {
  it('are made where there is none, read and dropped', () => {
    const run = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-locks-'));
    try {
      const file = lockFile(path.join(run, 'android'), 'Pixel_8');
      expect(fileLocks.holder(file)).toBeNull();
      expect(fileLocks.take(file, 'a.test.ts')).toBe(true);
      expect(fileLocks.take(file, 'b.test.ts')).toBe(false);
      expect(fileLocks.holder(file)).toBe('a.test.ts');
      fileLocks.drop(file);
      expect(fs.existsSync(file)).toBe(false);
      fileLocks.drop(file);
    } finally {
      fs.rmSync(run, {recursive: true, force: true});
    }
  });

  it('say what else went wrong in making one', () => {
    const run = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-locks-'));
    const denied = Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'});
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw denied;
    });
    try {
      expect(() => fileLocks.take(lockFile(path.join(run, 'android'), 'Pixel_8'), 'a.test.ts')).toThrow(denied);
    } finally {
      write.mockRestore();
      fs.rmSync(run, {recursive: true, force: true});
    }
  });
});

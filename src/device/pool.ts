/**
 * A device pool: the devices a platform's test files share, a file to a
 * device at a time. A file claims one at its first use of the device and
 * gives it back when it closes. The claim is a lock file per device in the
 * run's folder, made with `O_EXCL` so two files never hold one, and then
 * agent-device's own: a session on the device, which it refuses another
 * session with `DEVICE_IN_USE`, so a device held from outside the run is
 * passed over too.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {HarnessError} from '../harness/lib/errors.ts';
import type {Platform} from '../harness/lib/types.ts';

/** The lock files, as the claim uses them; the real ones are files, and a test's can be anything. */
export interface Locks {
  /** Makes the lock, saying who holds it: true where this call made it, false where it was there. */
  take(file: string, holder: string): boolean;
  /** Who holds a lock, or null where no one does. */
  holder(file: string): string | null;
  drop(file: string): void;
}

/** Lock files on disk, each made only where there is none. */
export const fileLocks: Locks = {
  take(file, holder) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    try {
      fs.writeFileSync(file, holder, {flag: 'wx'});
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  },
  holder(file) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
  drop(file) {
    fs.rmSync(file, {force: true});
  },
};

export interface ClaimOptions {
  /** The pool, as the harness config names it. */
  devices: string[];
  /** Where the run keeps this platform's locks: `.harness/locks/<run>/<platform>`. */
  folder: string;
  /** The test file claiming, whose name says where in the pool it starts, so files spread out. */
  file: string;
  /** Takes agent-device's claim on a device: `in-use` where another session holds it. Anything else it throws stops the claim. */
  open(device: string): Promise<'opened' | 'in-use'>;
  /** How long to wait for a device when every one is held, in ms. */
  timeout: number;
  /** The platform, which the error names. */
  platform: Platform;
  locks?: Locks;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Claim {
  device: string;
  /** Gives the device back: the lock goes, for the next file to take. */
  release(): void;
}

/** The devices in the order a file tries them: from an offset its name's hash gives, round. */
export function orderFor(devices: string[], file: string): string[] {
  const start = createHash('sha1').update(file).digest().readUInt32BE(0) % devices.length;
  return [...devices.slice(start), ...devices.slice(0, start)];
}

/** The agent-device session a file holds a device of the pool in, one to each device the run claims. */
export function sessionName(runId: string, device: string): string {
  return `expo-vitest-${runId}-${device}`.replace(/[^\w.-]/g, '_');
}

/** A device's lock file in the run's folder, its name made safe for one. */
export function lockFile(folder: string, device: string): string {
  return path.join(folder, device.replace(/[^\w.-]/g, '_'));
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * A device of the pool, claimed for one test file. Each is tried in the
 * file's order: its lock, then agent-device's claim. Where every device is
 * held, the claim looks again each second until `timeout`, then fails with
 * `DEVICE_POOL_EXHAUSTED`, naming who holds each.
 */
export async function claimDevice(options: ClaimOptions): Promise<Claim> {
  const {devices, folder, file, open, timeout, platform, locks = fileLocks, now = Date.now, sleep = wait} = options;
  const order = orderFor(devices, file);
  const holder = `${path.basename(file)}, process ${process.pid}`;
  const until = now() + timeout;
  for (;;) {
    for (const device of order) {
      const lock = lockFile(folder, device);
      if (!locks.take(lock, holder)) continue;
      let answer: 'opened' | 'in-use';
      try {
        answer = await open(device);
      } catch (error) {
        locks.drop(lock);
        throw error;
      }
      if (answer === 'opened') return {device, release: () => locks.drop(lock)};
      // A session from outside the run holds it: the lock would only keep this run's other files off it too.
      locks.drop(lock);
    }
    if (now() >= until) {
      const held = order.map(device => `${device} by ${locks.holder(lockFile(folder, device)) ?? 'a session outside this run'}`);
      throw new HarnessError('DEVICE_POOL_EXHAUSTED', `no device in the pool came free within ${timeout / 1000} s: ${held.join('; ')}`, {platform});
    }
    await sleep(1000);
  }
}

import path from 'node:path';
import {codeOf} from '../lib/errors.ts';
import {prepare} from '../lib/run.ts';
import type {Snapshot, Target} from '../lib/snapshot.ts';
import {describeTarget} from '../lib/snapshot.ts';
import type {Availability, Driver, DriverOptions, Platform, SnapshotOptions, StepResult} from '../lib/types.ts';
import {failed, ok} from '../lib/types.ts';
import {nodesFrom, openTarget, toSnapshotNodes} from './agent-device-mapping.ts';
import type {AgentDeviceTransport} from './agent-device-transport.ts';
import {transportFor} from './agent-device-transport.ts';

/** What `agent-device` calls the platforms we care about. */
const PLATFORM_NAMES: Partial<Record<Platform, string>> = {ios: 'ios', android: 'android', web: 'web'};

/**
 * `agent-device` (callstack) driving iOS, Android and its own web backend. It
 * does far more than this adapter asks of it — video, logs, traces, network,
 * React profiles — but the harness only needs the shape every platform shares,
 * so a test written once runs on Windows too, where `agent-device` has no
 * backend at all.
 *
 * Installed separately (`npm i -g agent-device`); `available()` says so when
 * it is missing rather than failing a step.
 */
export function agentDeviceDriver(platform: Platform, options: DriverOptions): Driver {
  const name = PLATFORM_NAMES[platform] ?? platform;
  let connecting: Promise<AgentDeviceTransport> | null = null;

  /** The transport, chosen on first use and kept until `close()`. */
  function transport(): Promise<AgentDeviceTransport> {
    connecting ??= transportFor({platform: name, harnessPlatform: platform, root: options.root, device: options.target});
    return connecting;
  }

  /** A step, answered rather than thrown: what it did, or what went wrong and what kind of failure it was. */
  async function step(done: string, failing: string, work: (current: AgentDeviceTransport) => Promise<void>): Promise<StepResult> {
    try {
      await work(await transport());
      return ok(done);
    } catch (error) {
      return failed(`${failing}: ${(error as Error).message}`, codeOf(error));
    }
  }

  return {
    platform,

    async available(): Promise<Availability> {
      try {
        const current = await transport();
        return {ready: true, found: `${await current.capabilities()}, through ${current.description}`};
      } catch (error) {
        return {ready: false, reason: (error as Error).message};
      }
    },

    async open(to: string): Promise<StepResult> {
      const where = openTarget(to, options.scheme);
      if (!where) return failed(`cannot open ${to}: a route needs the app's URI scheme (pass --scheme, or set HARNESS_SCHEME)`, 'INVALID_ARGUMENT');
      try {
        await (await transport()).open(where);
        return ok(`opened ${'url' in where ? where.url : where.app}`);
      } catch (error) {
        return failed(`could not open ${to}: ${(error as Error).message}`, codeOf(error, 'APP_UNREACHABLE'));
      }
    },

    async snapshot(snapshotOptions: SnapshotOptions = {}): Promise<Snapshot> {
      const payload = await (await transport()).snapshot(Boolean(snapshotOptions.interactive));
      return {platform, source: options.target ?? name, nodes: toSnapshotNodes(nodesFrom(payload))};
    },

    press(what: Target): Promise<StepResult> {
      return step(`pressed ${describeTarget(what)}`, 'press failed', current => current.press(what));
    },

    fill(what: Target, text: string): Promise<StepResult> {
      return step(`filled ${describeTarget(what)}`, 'fill failed', current => current.fill(what, text));
    },

    type(text: string): Promise<StepResult> {
      return step(`typed ${JSON.stringify(text)}`, 'typing failed', current => current.type(text));
    },

    async screenshot(file: string): Promise<StepResult> {
      const out = prepare(file);
      return step(`saved ${path.relative(options.root, out)}`, 'screenshot failed', current => current.screenshot(out));
    },

    async idleSeconds(): Promise<number | null> {
      // A device or an emulator is not this machine's desktop.
      return null;
    },

    async close(): Promise<void> {
      const closing = connecting;
      connecting = null;
      await (await closing?.catch(() => null))?.close();
    },
  };
}

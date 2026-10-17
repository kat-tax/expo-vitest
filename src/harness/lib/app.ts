/**
 * The app a command drives outside a test, as an MCP session and an explore
 * have it: the one the project's harness config names, its command started
 * where nothing answers at its url yet and used as it is where something
 * does, since a coding agent's app is often served already, and a driver on
 * it whose steps wait for the screen to hold still.
 */
import {pathToFileURL} from 'node:url';
import type {ActingHost} from '../../agent/hands.ts';
import {SecretStore} from '../../agent/secrets.ts';
import type {Started} from '../../device/app-process.ts';
import {startCommand} from '../../device/app-process.ts';
import {capabilitiesOf} from '../../device/capabilities.ts';
import type {HarnessConfig} from '../../device/config.ts';
import {findHarnessFile, loadHarness, resolveRun} from '../../device/config.ts';
import {system} from '../../device/system.ts';
import {driverFor} from './drivers.ts';
import {HarnessError} from './errors.ts';
import {DEFAULT_TIMING, timingFor, withTiming} from './settle.ts';
import type {Availability, Driver, Platform} from './types.ts';
import {PLATFORMS} from './types.ts';

/** A project's harness config, and the file it came from: null for each where there is none. */
export interface Project {
  file: string | null;
  config: HarnessConfig | null;
}

/** The harness config a command reads: the one named, else the project root's. */
export async function projectAt(root: string, named?: string): Promise<Project> {
  const file = findHarnessFile(root, named);
  return {file, config: await loadHarness(file, each => import(/* @vite-ignore */ pathToFileURL(each).href))};
}

/** The first platform this machine can drive now. */
export async function firstReady(root: string): Promise<Platform> {
  for (const platform of PLATFORMS) {
    const driver = driverFor(platform, {root});
    const state = await driver.available().catch(() => ({ready: false}));
    await driver.close();
    if (state.ready) return platform;
  }
  throw new HarnessError('DRIVER_UNAVAILABLE', 'this machine can drive no platform now; expo-harness doctor says why');
}

/** The config's command for a platform, started where nothing answers at its url yet; undefined where it names none. */
export async function startConfigured(project: Project, platform: Platform, root: string): Promise<Started | undefined> {
  const run = resolveRun(platform, project.config, process.env, root);
  return run.command && run.readyUrl ? startCommand(platform, {...run.command, reuseExisting: true}, run.readyUrl, system) : undefined;
}

export interface OpenOptions {
  /** The platform; the first this machine can drive where none is named. */
  platform?: string;
  /** On web, a browser window to watch. */
  headed?: boolean;
  /** On Windows, act even while someone is using the machine. */
  force?: boolean;
  /** Where the hands keep the pictures they take on the way. */
  scratch: string;
  /** false leaves the config's command alone, as when the caller started it for several drivers. */
  command?: boolean;
  /** Stops the open where it has got to, as when the client that asked for it cancels, and undoes what it started. */
  signal?: AbortSignal;
}

export interface OpenedApp {
  platform: Platform;
  /** The driver, each step waiting for the screen to hold still. */
  driver: Driver;
  state: Availability;
  /** What the agent's hands act through. */
  host: ActingHost;
  secrets: SecretStore;
  /** Closes the driver, and stops the command where this started it. */
  close(): Promise<void>;
}

/** What `work` answers, or CANCELLED as soon as `signal` is aborted, the work let go. */
function unlessCancelled<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  work.catch(() => undefined);
  const cancelled = () => new HarnessError('CANCELLED', 'the open was cancelled before the app was ready');
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(cancelled());
    signal.addEventListener('abort', stop, {once: true});
    work.then(
      value => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      },
    );
  });
}

/**
 * The project's app on a platform, open and ready to act on. An open that
 * ends without it, failed or cancelled, undoes what it started: the driver
 * closed, and the config's command stopped where the open started it. A
 * cancelled one says so at once, and undoes what it started once the part
 * under way has ended, so a browser on its way up is closed when it is up.
 */
export async function openApp(project: Project, options: OpenOptions, root: string): Promise<OpenedApp> {
  // What the open has started, undone the last first, and the part under way.
  const undo: (() => Promise<unknown>)[] = [];
  let underWay: Promise<unknown> = Promise.resolve();
  /** One part of the open, cut short where the signal says; what a part cut short makes is let go once it has made it. */
  const phase = async <T>(work: Promise<T>, release?: (made: T) => Promise<unknown>): Promise<T> => {
    underWay = work.then(
      () => undefined,
      () => undefined,
    );
    try {
      const made = await unlessCancelled(work, options.signal);
      if (release) undo.push(() => release(made));
      return made;
    } catch (error) {
      if (release && (error as HarnessError).code === 'CANCELLED') undo.push(async () => release(await work));
      throw error;
    }
  };
  try {
    const platform = (options.platform ?? (await phase(firstReady(root)))) as Platform;
    if (!PLATFORMS.includes(platform)) throw new HarnessError('INVALID_ARGUMENT', `${platform} is not a platform: ${PLATFORMS.join(', ')}`);
    const run = resolveRun(platform, project.config, process.env, root);
    const started = options.command === false ? undefined : await phase(startConfigured(project, platform, root), async made => made?.stop());
    // The web driver reads whether to show its window as it is made.
    const before = process.env.HARNESS_HEADED;
    if (options.headed) process.env.HARNESS_HEADED = '1';
    const driver = driverFor(platform, {
      root,
      ...(run.url ? {url: run.url} : {}),
      ...(run.scheme ? {scheme: run.scheme} : {}),
      ...(run.target ? {target: run.target} : {}),
      force: options.force ?? false,
      actionTimeout: run.actionTimeout,
    });
    if (options.headed) {
      if (before === undefined) delete process.env.HARNESS_HEADED;
      else process.env.HARNESS_HEADED = before;
    }
    undo.push(() => driver.close());
    const state = await phase(driver.available());
    if (!state.ready) throw new HarnessError('DRIVER_UNAVAILABLE', `no ${platform} device to drive: ${state.reason}`, {platform});
    const timed = withTiming(driver, timingFor(DEFAULT_TIMING, {settle: run.settle, transition: run.transition}));
    if (platform === 'web') await phase(timed.open('/'));
    const host: ActingHost = {
      platform,
      ready: async () => timed,
      snapshot: () => timed.snapshot(),
      // Where the app is, on web; a device's screen has no route to read.
      ...(platform === 'web' ? {route: async () => (await timed.web?.evaluate<string>('location.pathname + location.search')) ?? undefined} : {}),
      capabilities: capabilitiesOf(platform, state.device ? {device: state.device} : {}),
      scratch: options.scratch,
      ...(run.scheme ? {scheme: run.scheme} : {}),
    };
    return {
      platform,
      driver: timed,
      state,
      host,
      secrets: new SecretStore(project.config?.secrets, process.env),
      close: async () => {
        await timed.close();
        await started?.stop();
      },
    };
  } catch (error) {
    const undone = (async () => {
      await underWay;
      for (const release of undo.reverse()) await release().catch(() => undefined);
    })();
    if ((error as HarnessError).code !== 'CANCELLED') await undone;
    throw error;
  }
}

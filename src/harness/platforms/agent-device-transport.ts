/**
 * How the harness reaches agent-device: through its Node client when the
 * package can be found and loaded, which is one round trip to its daemon per
 * step, or through its command line, which is a process per step, when it
 * cannot. Either way a step is asynchronous, so a test's timeout can fire
 * while one waits, and every step has a budget of its own.
 *
 * `HARNESS_AGENT_DEVICE=cli` picks the command line; any other value names a
 * folder agent-device is installed in.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import type {HarnessCode} from '../lib/errors.ts';
import {HarnessError} from '../lib/errors.ts';
import {firstLine, runAsync} from '../lib/run.ts';
import type {Point, Target} from '../lib/snapshot.ts';
import type {DeviceFacts, Platform} from '../lib/types.ts';
import type {AgentFailure, Capabilities, DeviceCommand, Manifest, SettingUpdate, Wait} from './agent-device-mapping.ts';
import {
  clientEntry,
  capabilitiesFrom,
  clientTarget,
  cliScript,
  codeFor,
  commandArgs,
  commandRequest,
  describeDevice,
  describeFailure,
  dragArgs,
  dragRequest,
  factsOf,
  installArgs,
  launchArgs,
  packageFolders,
  recordArgs,
  repeatArgs,
  repeatRequest,
  parseFailure,
  parsePayload,
  selectionById,
  screenshotArgs,
  screenshotRequest,
  settingArgs,
  settingRequest,
  settleArgs,
  settleRequest,
  targetArgs,
  typingArgs,
  typingRequest,
} from './agent-device-mapping.ts';

/** How long one step may take before it is given up on. */
const STEP_TIMEOUT = 30_000;
/** An `open` may boot a device and install agent-device's runner on it, which takes about a minute and a half. */
const OPEN_TIMEOUT = 180_000;
/**
 * The first call a run makes, asking what the device can do, which starts
 * agent-device's daemon and readies the device, and for an iOS simulator on
 * a macOS runner just started takes longer than a step's 30 s.
 */
const FIRST_TIMEOUT = OPEN_TIMEOUT;

export interface AgentDeviceTransport {
  readonly kind: 'client' | 'cli';
  /** What is driving, for `doctor`. */
  readonly description: string;
  /** The device a step would drive: in a line, and what it is. */
  capabilities(): Promise<{line: string; device?: DeviceFacts}>;
  open(to: {app: string} | {url: string}): Promise<void>;
  /** The answer as agent-device gave it; `nodesFrom` reads the nodes out of it. */
  snapshot(interactive: boolean): Promise<unknown>;
  /** With a wait, agent-device's own: after the press, until the screen has been quiet a while. */
  /** A press, or `count` of them in quick succession. */
  press(target: Target, wait?: Wait, count?: number): Promise<void>;
  /** A press drawn from one target to another, held `hold` ms first: two points or two nodes. */
  drag(from: Target, to: Target, hold?: number): Promise<void>;
  fill(target: Target, text: string, wait?: Wait): Promise<void>;
  /** A press held for `duration` ms, or for agent-device's own length when none is given. */
  longPress(target: Target, duration?: number, wait?: Wait): Promise<void>;
  /** The focus given at a point, which is the only way agent-device takes it. */
  focus(point: Point): Promise<void>;
  /** Scrolls the way the content moves until a selector is on screen. */
  scrollUntil(direction: 'up' | 'down', until: string, wait?: Wait): Promise<void>;
  swipe(from: Point, to: Point): Promise<void>;
  type(text: string): Promise<void>;
  /** A picture of the screen, with the status bar as the run asks for it. */
  screenshot(file: string, statusBar?: 'fixed' | 'real'): Promise<void>;
  /** Opens an app by its id, relaunched where asked, with the arguments a fresh launch is given. */
  launch(app: string, relaunch: boolean, launchArguments: string[]): Promise<void>;
  /** Installs a build, in place of the installed app where asked. */
  install(app: string | undefined, appPath: string, reinstall: boolean): Promise<void>;
  /** Changes an operating-system setting: an app's permission, or its state cleared. */
  setting(update: SettingUpdate): Promise<void>;
  back(): Promise<void>;
  home(): Promise<void>;
  /** What agent-device says of the app in front; `foregroundOf` reads it. */
  appState(): Promise<unknown>;
  /** One of the device commands, with what it answered. */
  command(command: DeviceCommand): Promise<unknown>;
  /** Starts a recording of the screen into a file, or stops it. */
  record(action: 'start' | 'stop', file?: string): Promise<void>;
  /** A command the Node client has no call for, through the command line: connect, disconnect, device release. */
  run(args: string[]): Promise<void>;
  /** Opens the session on the device with nothing in it, which claims the device for the session. */
  attach(): Promise<void>;
  close(): Promise<void>;
}

export interface TransportOptions {
  /** agent-device's word for the platform. */
  platform: string;
  /** Ours, for the errors. */
  harnessPlatform: Platform;
  root: string;
  /**
   * The device to drive, by a name agent-device lists or by its id: an id is
   * not one of its names, so the first call that finds no device by it asks
   * for the list, and selects the device by its id from then on.
   */
  device?: string;
  /** The session to drive it in, where not agent-device's default. */
  session?: string;
  /** How long one step may take; 30 s unless given. An open, which may boot a device, has its own. */
  stepTimeout?: number;
}

/** The parts of the client module the transport uses. */
interface ClientModule {
  createAgentDeviceClient(config?: Record<string, unknown>): Client;
  normalizeAgentDeviceError(error: unknown): {code?: string; message: string};
}

type Call = (options: Record<string, unknown>) => Promise<unknown>;

interface Client {
  devices: {capabilities: Call; list: Call};
  apps: {open: Call; install: Call; reinstall: Call};
  command: {back: Call; home: Call; appState: Call; orientation: Call; fold: Call; clipboard: Call; keyboard: Call; alert: Call};
  settings: {update: Call};
  recording: {record: Call};
  capture: {snapshot: Call; screenshot: Call};
  interactions: {press: Call; fill: Call; type: Call; longPress: Call; focus: Call; scroll: Call; swipe: Call; pan: Call; drag: Call};
  sessions: {close: Call};
}

interface Found {
  folder: string;
  manifest: Manifest;
  module?: ClientModule;
  /** Why the client could not be loaded from the folder. */
  reason?: string;
}

let npmRoot: string | null | undefined;

/** npm's global `node_modules`, asked once per process. Through the shell, since npm is a `.cmd` script on Windows. */
function globalNpmRoot(): string | null {
  if (npmRoot === undefined) {
    const answer = spawnSync('npm root -g', {shell: true, encoding: 'utf8', timeout: 10_000, windowsHide: true});
    npmRoot = answer.status === 0 ? firstLine(answer.stdout) || null : null;
  }
  return npmRoot;
}

const loaded = new Map<string, Promise<Found | null>>();

/** The first folder that holds agent-device, with its client loaded when it loads. */
function findAgentDevice(root: string): Promise<Found | null> {
  let finding = loaded.get(root);
  if (!finding) {
    finding = (async () => {
      const where = {root, env: process.env, home: os.homedir(), exists: fs.existsSync, npmRoot: globalNpmRoot, self: path.dirname(fileURLToPath(import.meta.url))};
      for (const folder of packageFolders(where)) {
        let manifest: Manifest;
        try {
          manifest = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')) as Manifest;
        } catch {
          continue;
        }
        if (manifest.name !== 'agent-device') continue;
        const entry = clientEntry(manifest);
        if (!entry) return {folder, manifest, reason: 'its manifest names no entry to load'};
        try {
          const module = (await import(pathToFileURL(path.join(folder, entry)).href)) as ClientModule;
          if (typeof module.createAgentDeviceClient !== 'function') return {folder, manifest, reason: 'it has no createAgentDeviceClient'};
          return {folder, manifest, module};
        } catch (error) {
          return {folder, manifest, reason: firstLine((error as Error).message)};
        }
      }
      return null;
    })();
    loaded.set(root, finding);
  }
  return finding;
}

/** The transport for a platform: the Node client where agent-device loads, its command line otherwise. */
export async function transportFor(options: TransportOptions): Promise<AgentDeviceTransport> {
  if (process.env.HARNESS_AGENT_DEVICE === 'cli') return cliTransport(options, 'agent-device', []);
  const found = await findAgentDevice(options.root);
  if (found?.module) return clientTransport(options, found.module, found.manifest.version ?? 'unknown version', commandLine(options, found));
  return commandLine(options, found);
}

/**
 * agent-device's command line. A package that would not load is still a
 * command line this Node can run, without the launcher a package manager put
 * on the PATH.
 */
function commandLine(options: TransportOptions, found: Found | null): AgentDeviceTransport {
  const script = found && cliScript(found.manifest);
  return script ? cliTransport(options, process.execPath, [path.join(found.folder, script)]) : cliTransport(options, 'agent-device', []);
}

function failure(options: TransportOptions, reason: AgentFailure, otherwise: HarnessCode, cause?: unknown): HarnessError {
  return new HarnessError(codeFor(reason, otherwise), describeFailure(reason), {platform: options.harnessPlatform, cause});
}

function clientTransport(options: TransportOptions, module: ClientModule, version: string, cli: AgentDeviceTransport): AgentDeviceTransport {
  const client = module.createAgentDeviceClient({cwd: options.root, ...(options.session ? {session: options.session} : {})});
  let select: Record<string, string> = {platform: options.platform, ...(options.device ? {device: options.device} : null)};
  let looked = false;

  /** Whether the device named is one agent-device lists by that id, which is then how it is selected. */
  async function byId(): Promise<boolean> {
    if (looked || !options.device) return false;
    looked = true;
    const listed = await client.devices.list({platform: options.platform, signal: AbortSignal.timeout(STEP_TIMEOUT)}).catch(() => null);
    const chosen = selectionById(options.platform, options.device, listed);
    if (chosen) select = {platform: options.platform, ...chosen};
    return chosen !== null;
  }

  async function call(work: (signal: AbortSignal) => Promise<unknown>, otherwise: HarnessCode, timeout = options.stepTimeout ?? STEP_TIMEOUT): Promise<unknown> {
    try {
      return await work(AbortSignal.timeout(timeout));
    } catch (error) {
      const failed = module.normalizeAgentDeviceError(error);
      if (failed.code === 'DEVICE_NOT_FOUND' && (await byId())) return call(work, otherwise, timeout);
      throw failure(options, failed, otherwise, error);
    }
  }

  return {
    kind: 'client',
    description: `agent-device ${version}'s Node client`,
    async capabilities() {
      const capabilities = (await call(signal => client.devices.capabilities({...select, signal}), 'DRIVER_UNAVAILABLE', FIRST_TIMEOUT)) as Capabilities;
      return {line: describeDevice(capabilities), device: factsOf(capabilities)};
    },
    async open(to) {
      // A link goes where the command line's first word does, as the app to open: the client's own url is a second
      // one, for the app named, and alone it opens nothing and fails nothing.
      await call(signal => client.apps.open({...select, app: 'url' in to ? to.url : to.app, signal}), 'APP_UNREACHABLE', OPEN_TIMEOUT);
    },
    snapshot(interactive) {
      return call(signal => client.capture.snapshot({...select, interactiveOnly: interactive, signal}), 'ACTION_FAILED');
    },
    async press(target, wait, count) {
      await call(signal => client.interactions.press({...select, ...clientTarget(target), ...repeatRequest(count), ...settleRequest(wait), signal}), 'ACTION_FAILED');
    },
    async drag(from, to, hold) {
      const request = dragRequest(from, to, hold);
      if (request.method === 'pan') await call(signal => client.interactions.pan({...select, ...request.options, signal}), 'ACTION_FAILED');
      else await call(signal => client.interactions.drag({...select, ...request.options, signal}), 'ACTION_FAILED');
    },
    async fill(target, text, wait) {
      await call(signal => client.interactions.fill({...select, ...clientTarget(target), text, ...typingRequest(options.platform), ...settleRequest(wait), signal}), 'ACTION_FAILED');
    },
    async longPress(target, duration, wait) {
      await call(signal => client.interactions.longPress({...select, ...clientTarget(target), ...(duration === undefined ? {} : {durationMs: duration}), ...settleRequest(wait), signal}), 'ACTION_FAILED');
    },
    async focus(point) {
      await call(signal => client.interactions.focus({...select, x: point.x, y: point.y, signal}), 'ACTION_FAILED');
    },
    async scrollUntil(direction, until, wait) {
      await call(signal => client.interactions.scroll({...select, direction, until, ...settleRequest(wait), signal}), 'ACTION_FAILED');
    },
    async swipe(from, to) {
      await call(signal => client.interactions.swipe({...select, from, to, signal}), 'ACTION_FAILED');
    },
    async type(text) {
      await call(signal => client.interactions.type({...select, text, ...typingRequest(options.platform), signal}), 'ACTION_FAILED');
    },
    async screenshot(file, statusBar) {
      await call(signal => client.capture.screenshot({path: file, ...screenshotRequest(options.platform, statusBar), signal}), 'ACTION_FAILED');
    },
    async launch(app, relaunch, launchArguments) {
      await call(signal => client.apps.open({...select, app, relaunch, ...(launchArguments.length ? {launchArgs: launchArguments} : {}), signal}), 'APP_UNREACHABLE', OPEN_TIMEOUT);
    },
    async install(app, appPath, reinstall) {
      await call(signal => (reinstall ? client.apps.reinstall({...select, app, appPath, signal}) : client.apps.install({...select, ...(app ? {app} : {}), appPath, signal})), 'ACTION_FAILED', OPEN_TIMEOUT);
    },
    async setting(update) {
      await call(signal => client.settings.update({...select, ...settingRequest(update), signal}), 'ACTION_FAILED');
    },
    async back() {
      await call(signal => client.command.back({...select, signal}), 'ACTION_FAILED');
    },
    async home() {
      await call(signal => client.command.home({...select, signal}), 'ACTION_FAILED');
    },
    appState() {
      return call(signal => client.command.appState({...select, signal}), 'ACTION_FAILED');
    },
    command(command) {
      const {method, options: given} = commandRequest(command);
      return call(signal => client.command[method]({...select, ...given, signal}), 'ACTION_FAILED');
    },
    async record(action, file) {
      await call(signal => client.recording.record({...select, action, ...(action === 'start' ? {recordingScope: 'device', ...(file ? {path: file} : {})} : {}), signal}), 'ACTION_FAILED');
    },
    run(args) {
      return cli.run(args);
    },
    async attach() {
      await call(signal => client.apps.open({...select, signal}), 'DRIVER_UNAVAILABLE', OPEN_TIMEOUT);
    },
    async close() {
      await call(signal => client.sessions.close({signal}), 'ACTION_FAILED', 10_000).catch(() => {});
    },
  };
}

function cliTransport(options: TransportOptions, command: string, prefix: string[]): AgentDeviceTransport {
  const session = options.session ? ['--session', options.session] : [];
  let device = options.device ? ['--device', options.device] : [];
  let looked = false;

  /** Whether the device named is one agent-device lists by that id, which is then how it is selected. */
  async function byId(): Promise<boolean> {
    if (looked || !options.device) return false;
    looked = true;
    const listed = await runAsync(command, [...prefix, 'devices', '--json', '--platform', options.platform], {cwd: options.root, timeout: STEP_TIMEOUT});
    const chosen = listed.ok ? selectionById(options.platform, options.device, parsePayload(listed.stdout)) : null;
    if (chosen) device = 'udid' in chosen ? ['--udid', chosen.udid] : ['--serial', chosen.serial];
    return chosen !== null;
  }

  async function agent(args: string[], otherwise: HarnessCode, timeout = options.stepTimeout ?? STEP_TIMEOUT): Promise<string> {
    const ran = await runAsync(command, [...prefix, ...args, '--platform', options.platform, ...device, ...session], {cwd: options.root, timeout});
    if (ran.ok) return ran.stdout;
    if (ran.missing) {
      throw new HarnessError('DRIVER_UNAVAILABLE', 'agent-device did not load: it comes with expo-vitest, so install expo-vitest again, or name another with HARNESS_AGENT_DEVICE', {platform: options.harnessPlatform});
    }
    const said = firstLine(ran.stderr) || firstLine(ran.stdout);
    const reason: AgentFailure = ran.timedOut ? {message: `agent-device gave no answer within ${timeout / 1000} s`} : parseFailure(said || 'agent-device failed with no message');
    if (reason.code === 'DEVICE_NOT_FOUND' && (await byId())) return agent(args, otherwise, timeout);
    throw failure(options, reason, otherwise);
  }

  return {
    kind: 'cli',
    description: 'the agent-device command line',
    async capabilities() {
      const capabilities = capabilitiesFrom(parsePayload(await agent(['capabilities', '--json'], 'DRIVER_UNAVAILABLE', FIRST_TIMEOUT)));
      return capabilities ? {line: describeDevice(capabilities), device: factsOf(capabilities)} : {line: 'a device agent-device did not describe'};
    },
    async open(to) {
      await agent(['open', 'url' in to ? to.url : to.app], 'APP_UNREACHABLE', OPEN_TIMEOUT);
    },
    async snapshot(interactive) {
      return parsePayload(await agent(['snapshot', ...(interactive ? ['-i'] : []), '--json'], 'ACTION_FAILED'));
    },
    async press(target, wait, count) {
      await agent(['press', ...targetArgs(target), ...repeatArgs(count), ...settleArgs(wait)], 'ACTION_FAILED');
    },
    async drag(from, to, hold) {
      await agent(dragArgs(from, to, hold), 'ACTION_FAILED');
    },
    async fill(target, text, wait) {
      await agent(['fill', ...targetArgs(target), text, ...typingArgs(options.platform), ...settleArgs(wait)], 'ACTION_FAILED');
    },
    async longPress(target, duration, wait) {
      await agent(['longpress', ...targetArgs(target), ...(duration === undefined ? [] : [String(duration)]), ...settleArgs(wait)], 'ACTION_FAILED');
    },
    async focus(point) {
      await agent(['focus', String(point.x), String(point.y)], 'ACTION_FAILED');
    },
    async scrollUntil(direction, until, wait) {
      await agent(['scroll', direction, '--until', until, ...settleArgs(wait)], 'ACTION_FAILED');
    },
    async swipe(from, to) {
      await agent(['swipe', String(from.x), String(from.y), String(to.x), String(to.y)], 'ACTION_FAILED');
    },
    async type(text) {
      await agent(['type', text, ...typingArgs(options.platform)], 'ACTION_FAILED');
    },
    async screenshot(file, statusBar) {
      await agent(['screenshot', file, ...screenshotArgs(options.platform, statusBar)], 'ACTION_FAILED');
    },
    async launch(app, relaunch, launchArguments) {
      await agent(launchArgs(app, relaunch, launchArguments), 'APP_UNREACHABLE', OPEN_TIMEOUT);
    },
    async install(app, appPath, reinstall) {
      await agent(installArgs(app, appPath, reinstall), 'ACTION_FAILED', OPEN_TIMEOUT);
    },
    async setting(update) {
      await agent(settingArgs(update), 'ACTION_FAILED');
    },
    async back() {
      await agent(['back'], 'ACTION_FAILED');
    },
    async home() {
      await agent(['home'], 'ACTION_FAILED');
    },
    async appState() {
      return parsePayload(await agent(['appstate', '--json'], 'ACTION_FAILED'));
    },
    async command(command) {
      return parsePayload(await agent(commandArgs(command), 'ACTION_FAILED'));
    },
    async record(action, file) {
      await agent(recordArgs(action, file), 'ACTION_FAILED');
    },
    async run(args) {
      // A provider checks its credentials over the network before it answers.
      await agent(args, 'DRIVER_UNAVAILABLE', OPEN_TIMEOUT);
    },
    async attach() {
      await agent(['open'], 'DRIVER_UNAVAILABLE', OPEN_TIMEOUT);
    },
    async close() {
      await agent(['close'], 'ACTION_FAILED', 60_000).catch(() => {});
    },
  };
}

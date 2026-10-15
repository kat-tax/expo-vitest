/**
 * `harness.config.ts`: what a device run needs that is not Vitest config, in
 * one file at the project root. Which app each platform drives, how to
 * start it, and the run's waits.
 *
 *   // harness.config.ts
 *   import {defineHarness} from 'expo-vitest/device';
 *
 *   export default defineHarness({
 *     app: {
 *       web: {url: 'http://localhost:8081', command: {executable: 'npx', args: ['expo', 'start', '--web', '--port', '{port}']}},
 *       android: {bundleId: 'com.example.app', scheme: 'myapp'},
 *     },
 *   });
 *
 * An environment variable beats the file, and the file beats the defaults,
 * so every run that works without a file keeps working, and a CI job can
 * change one value without editing it.
 */
import {createHash, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {HarnessError} from '../harness/lib/errors.ts';
import {DEFAULT_TIMING} from '../harness/lib/settle.ts';
import type {Platform} from '../harness/lib/types.ts';
import {PLATFORMS} from '../harness/lib/types.ts';
import type {DeviceConfig} from './index.ts';
import {DEFAULT_POLLING} from './polling.ts';

/** A process started once per run, such as a dev server, and stopped after. */
export interface CommandConfig {
  /** Found on `PATH`, and never run through a shell. */
  executable: string;
  /** `{port}` becomes the port of the app's `url`. */
  args?: string[];
  /** The project root unless given. */
  cwd?: string;
  /** Added to the whole environment the run has. */
  env?: Record<string, string>;
  /** How long it has to answer at `readyUrl`, in ms. 60 s. */
  startupTimeout?: number;
  /** How long it has to stop before it is killed, in ms. 10 s. */
  shutdownTimeout?: number;
  /** Where its output goes: `.harness/app-<platform>.log`, or `false` for nowhere. */
  log?: string | false;
  /** Whether one already answering at `readyUrl` is used rather than another started: yes, but in CI. */
  reuseExisting?: boolean;
}

export type Permission = 'grant' | 'deny' | 'reset';

/** One platform's app. */
export interface AppConfig {
  /** Web: where the app is served. `HARNESS_URL`. */
  url?: string;
  /** Windows: the exe or process; a device: the simulator, emulator or phone. `HARNESS_TARGET`. */
  target?: string;
  /** The same as `target`: e2e's word for it on a device. */
  device?: string;
  /** The app's URI scheme, for deep links. `HARNESS_SCHEME`. */
  scheme?: string;
  /** iOS and Android: the installed app. */
  bundleId?: string;
  /** iOS and Android: a build to install; Windows: an `.msix` to install. */
  appPath?: string;
  /** What keys this app's baselines and recordings. The bundle id or the url unless given. */
  identity?: string;
  /** Every fresh launch: process arguments on iOS, extras on Android, the exe's arguments on Windows. */
  launchArguments?: string[];
  /** Set before each fresh launch on iOS and Android, and granted on web. */
  permissions?: Record<string, Permission>;
  /** Windows: the folder `clearState` deletes. */
  stateDir?: string;
  /** A process started once per run. */
  command?: CommandConfig;
  /** Polled until the command is ready. The `url` unless given. */
  readyUrl?: string;
}

export interface HarnessConfig {
  app?: Partial<Record<Platform, AppConfig>>;
  /** How long an action looks for its node and a matcher waits, in ms. 5 s. */
  assertionTimeout?: number;
  /** How long something must stay gone before a wait for it to go passes, in ms. 1 s. */
  stable?: number;
  /** How long the screen must hold still after a step, in ms; `false` for no wait. 150. */
  settle?: number | false;
  /** How long a control the last step brought in is given before a press, in ms; `false` for none. 500. */
  transition?: number | false;
  /** On a device, a status bar made the same before every screenshot: `fixed`, the default, or `real`. */
  statusBar?: 'fixed' | 'real';
  /** How long one call to a driver may take, in ms. 30 s. */
  actionTimeout?: number;
}

/** A harness config, as written: the function only gives it its type. */
export function defineHarness(config: HarnessConfig): HarnessConfig {
  return config;
}

/** The names a harness config may have at the root, in the order they are looked for. */
export const HARNESS_FILES = ['harness.config.ts', 'harness.config.mts', 'harness.config.js', 'harness.config.mjs'];

/** The harness config to load: the one named, from the root, else the first at the root, else none. */
export function findHarnessFile(root: string, named?: string, exists: (file: string) => boolean = fs.existsSync): string | null {
  if (named) {
    const file = path.resolve(root, named);
    if (!exists(file)) throw new HarnessError('INVALID_CONFIG', `there is no harness config at ${file}`);
    return file;
  }
  for (const name of HARNESS_FILES) {
    const file = path.join(root, name);
    if (exists(file)) return file;
  }
  return null;
}

/**
 * The config in a file, checked. The import is the caller's, because only an
 * `import()` written in a file Vitest's module runner loads goes through it,
 * and the runner is what reads TypeScript without Node's type stripping.
 */
export async function loadHarness(file: string | null, load: (file: string) => Promise<{default?: unknown}>): Promise<HarnessConfig | null> {
  if (!file) return null;
  const module = await load(file);
  return validate(module.default, path.basename(file));
}

/** The keys a later version gives meaning, refused by name until then, so a config written for them is not quietly ignored. */
const RESERVED = ['agents', 'tools', 'secrets', 'cache'];

const ROOT_KEYS = ['app', 'assertionTimeout', 'stable', 'settle', 'transition', 'statusBar', 'actionTimeout'];
const APP_KEYS = ['url', 'target', 'device', 'scheme', 'bundleId', 'appPath', 'identity', 'launchArguments', 'permissions', 'stateDir', 'command', 'readyUrl'];
const COMMAND_KEYS = ['executable', 'args', 'cwd', 'env', 'startupTimeout', 'shutdownTimeout', 'log', 'reuseExisting'];

/** What a value should have been, or null when it is that. */
type Check = (value: unknown) => string | null;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text: Check = value => (typeof value === 'string' ? null : 'a string');
const ms: Check = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? null : 'a number of ms, 0 or more');
const msOrOff: Check = value => (value === false ? null : ms(value));
const texts: Check = value => (Array.isArray(value) && value.every(each => typeof each === 'string') ? null : 'a list of strings');
const flag: Check = value => (typeof value === 'boolean' ? null : 'true or false');
const textMap: Check = value => (isObject(value) && Object.values(value).every(each => typeof each === 'string') ? null : 'an object of strings');
const permissions: Check = value =>
  isObject(value) && Object.values(value).every(each => each === 'grant' || each === 'deny' || each === 'reset') ? null : "an object of 'grant', 'deny' or 'reset'";
const logTo: Check = value => (value === false || typeof value === 'string' ? null : 'a path, or false');
const statusBar: Check = value => (value === 'fixed' || value === 'real' ? null : "'fixed' or 'real'");

const ROOT_CHECKS: Record<string, Check> = {assertionTimeout: ms, stable: ms, settle: msOrOff, transition: msOrOff, statusBar, actionTimeout: ms};
const APP_CHECKS: Record<string, Check> = {
  url: text,
  target: text,
  device: text,
  scheme: text,
  bundleId: text,
  appPath: text,
  identity: text,
  launchArguments: texts,
  permissions,
  stateDir: text,
  readyUrl: text,
};
const COMMAND_CHECKS: Record<string, Check> = {executable: text, args: texts, cwd: text, env: textMap, startupTimeout: ms, shutdownTimeout: ms, log: logTo, reuseExisting: flag};

/** A value as a message names it. */
function shown(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'function') return 'a function';
  return String(value);
}

/** Checks an object's keys against those it may have, and each value against its check, naming the first that is wrong. */
function checkObject(value: unknown, where: string, keys: string[], checks: Record<string, Check>, file: string): void {
  if (!isObject(value)) throw new HarnessError('INVALID_CONFIG', `${file}: ${where || 'the default export'} is ${shown(value)}; it takes an object`);
  for (const [key, field] of Object.entries(value)) {
    const at = where ? `${where}.${key}` : key;
    if (!where && RESERVED.includes(key)) throw new HarnessError('INVALID_CONFIG', `${file}: ${key} is kept for the agent, which this version does not have`);
    if (!keys.includes(key)) throw new HarnessError('INVALID_CONFIG', `${file}: ${at} is not something a harness config takes here; it takes ${keys.join(', ')}`);
    if (field === undefined) continue;
    const wrong = checks[key]?.(field);
    if (wrong) throw new HarnessError('INVALID_CONFIG', `${file}: ${at} is ${shown(field)}; it takes ${wrong}`);
  }
}

/** A loaded config, checked: every key known and every value of its kind, or the error naming the first that is not. */
export function validate(value: unknown, file = 'harness.config.ts'): HarnessConfig {
  checkObject(value, '', ROOT_KEYS, ROOT_CHECKS, file);
  const app = (value as HarnessConfig).app;
  if (app === undefined) return value as HarnessConfig;
  checkObject(app, 'app', PLATFORMS, {}, file);
  for (const [platform, each] of Object.entries(app)) {
    if (each === undefined) continue;
    checkObject(each, `app.${platform}`, APP_KEYS, APP_CHECKS, file);
    if (each.command === undefined) continue;
    checkObject(each.command, `app.${platform}.command`, COMMAND_KEYS, COMMAND_CHECKS, file);
    if (each.command.executable === undefined) throw new HarnessError('INVALID_CONFIG', `${file}: app.${platform}.command needs an executable`);
  }
  return value as HarnessConfig;
}

/** A command with what it was not given filled in. */
export type ResolvedCommand = Required<Omit<CommandConfig, 'log'>> & {log: string | false};

/** Everything a device run on one platform goes by: the environment over the file over the defaults. */
export interface ResolvedRun {
  platform: Platform;
  url?: string;
  target?: string;
  scheme?: string;
  bundleId?: string;
  appPath?: string;
  identity?: string;
  launchArguments: string[];
  permissions: Record<string, Permission>;
  stateDir?: string;
  readyUrl?: string;
  command?: ResolvedCommand;
  assertionTimeout: number;
  stable: number;
  settle: number;
  transition: number;
  statusBar: 'fixed' | 'real';
  actionTimeout: number;
}

/** The built-in defaults: the device layer's own, and e2e's numbers for what it has. */
export const DEFAULTS = {
  url: 'http://localhost:8081',
  assertionTimeout: DEFAULT_POLLING.assertionTimeout,
  stable: DEFAULT_POLLING.stable,
  settle: DEFAULT_TIMING.settle,
  transition: DEFAULT_TIMING.transition,
  statusBar: 'fixed',
  actionTimeout: 30_000,
  startupTimeout: 60_000,
  shutdownTimeout: 10_000,
} as const;

/** A count of ms from the environment, with `false` as 0, as e2e spells it; undefined when it is not one. */
function fromEnvironment(value: string | undefined): number | undefined {
  if (value === 'false') return 0;
  const number = Number(value);
  return value && Number.isFinite(number) && number >= 0 ? number : undefined;
}

const off = (value: number | false | undefined): number | undefined => (value === false ? 0 : value);

/** Whether the run is in CI, by the variable CI services set, unless it is set to say no. */
export function isCI(environment: NodeJS.ProcessEnv): boolean {
  const ci = environment.CI;
  return Boolean(ci) && ci !== '0' && ci !== 'false';
}

/**
 * Whether a platform that cannot be driven here fails its tests rather than
 * skipping them: under `HARNESS_REQUIRE`, or in CI unless it is 0, since a
 * CI job that skips its device tests in silence is worse than one that fails.
 */
export function requiresDriver(environment: NodeJS.ProcessEnv): boolean {
  const required = environment.HARNESS_REQUIRE;
  if (required) return required !== '0' && required !== 'false';
  return isCI(environment);
}

/** A url's port, its scheme's own where it names none. */
export function portOf(url: string): string {
  const parsed = new URL(url);
  return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
}

/** A platform's command, filled in, with `{port}` taken from the url. */
function commandOf(platform: Platform, command: CommandConfig, url: string | undefined, environment: NodeJS.ProcessEnv, root: string): ResolvedCommand {
  const args = command.args ?? [];
  if (!url && args.some(arg => arg.includes('{port}'))) {
    throw new HarnessError('INVALID_CONFIG', `app.${platform}.command.args has {port}, and there is no url on ${platform} to take it from`);
  }
  return {
    executable: command.executable,
    args: url ? args.map(arg => arg.replaceAll('{port}', portOf(url))) : args,
    cwd: path.resolve(root, command.cwd ?? '.'),
    env: command.env ?? {},
    startupTimeout: command.startupTimeout ?? DEFAULTS.startupTimeout,
    shutdownTimeout: command.shutdownTimeout ?? DEFAULTS.shutdownTimeout,
    log: command.log === false ? false : path.resolve(root, command.log ?? path.join('.harness', `app-${platform}.log`)),
    // Locally a dev server already running is used; in CI it would be testing whatever build it serves.
    reuseExisting: command.reuseExisting ?? !isCI(environment),
  };
}

/**
 * One platform's run: what the environment says, over what the file says,
 * over the defaults. In a run of several platforms the environment applies
 * to each of them, so a value that differs by platform goes in the file.
 */
export function resolveRun(platform: Platform, config: HarnessConfig | null, environment: NodeJS.ProcessEnv, root: string): ResolvedRun {
  const app: AppConfig = config?.app?.[platform] ?? {};
  const url = environment.HARNESS_URL ?? app.url ?? (platform === 'web' ? DEFAULTS.url : undefined);
  const target = environment.HARNESS_TARGET ?? app.target ?? app.device;
  const scheme = environment.HARNESS_SCHEME ?? app.scheme;
  const command = app.command && commandOf(platform, app.command, url, environment, root);
  const readyUrl = app.readyUrl ?? (command ? url : undefined);
  if (command && !readyUrl) throw new HarnessError('INVALID_CONFIG', `app.${platform}.command needs a readyUrl, or a url, to tell when it has started`);
  const identity = app.identity ?? app.bundleId ?? url;
  return {
    platform,
    ...(url ? {url} : {}),
    ...(target ? {target} : {}),
    ...(scheme ? {scheme} : {}),
    ...(app.bundleId ? {bundleId: app.bundleId} : {}),
    ...(app.appPath ? {appPath: path.resolve(root, app.appPath)} : {}),
    ...(identity ? {identity} : {}),
    launchArguments: app.launchArguments ?? [],
    permissions: app.permissions ?? {},
    ...(app.stateDir ? {stateDir: path.resolve(root, app.stateDir)} : {}),
    ...(readyUrl ? {readyUrl} : {}),
    ...(command ? {command} : {}),
    assertionTimeout: fromEnvironment(environment.HARNESS_ASSERTION_TIMEOUT) ?? config?.assertionTimeout ?? DEFAULTS.assertionTimeout,
    stable: fromEnvironment(environment.HARNESS_STABLE) ?? config?.stable ?? DEFAULTS.stable,
    settle: fromEnvironment(environment.HARNESS_SETTLE) ?? off(config?.settle) ?? DEFAULTS.settle,
    transition: fromEnvironment(environment.HARNESS_TRANSITION) ?? off(config?.transition) ?? DEFAULTS.transition,
    statusBar: config?.statusBar ?? DEFAULTS.statusBar,
    actionTimeout: config?.actionTimeout ?? DEFAULTS.actionTimeout,
  };
}

const RUN = Symbol.for('expo-vitest.run');

/**
 * Hands the device the run a project's setup file resolved. It is kept on
 * the global object, which the setup file and the test share whatever copy
 * of this package each has loaded.
 */
export function setRun(run: ResolvedRun, store: object = globalThis): void {
  (store as {[RUN]?: ResolvedRun})[RUN] = run;
}

/** The run a project's setup file resolved in this worker, if one did. */
export function currentRun(store: object = globalThis): ResolvedRun | undefined {
  return (store as {[RUN]?: ResolvedRun})[RUN];
}

/** The device's config for a run: its app and waits, and the environment's `HARNESS_FORCE`, which is not a config's to give. */
export function configFromRun(run: ResolvedRun, environment: NodeJS.ProcessEnv): DeviceConfig {
  const force = environment.HARNESS_FORCE;
  return {
    platform: run.platform,
    ...(run.url ? {url: run.url} : {}),
    ...(run.scheme ? {scheme: run.scheme} : {}),
    ...(run.target ? {target: run.target} : {}),
    ...(force && force !== '0' ? {force: true} : {}),
    settle: run.settle,
    transition: run.transition,
    assertionTimeout: run.assertionTimeout,
    stable: run.stable,
    statusBar: run.statusBar,
    actionTimeout: run.actionTimeout,
    ...appOf(run),
  };
}

/** What the device's driver needs of the app for a fresh launch: only what the run has. */
function appOf(run: ResolvedRun): {app?: NonNullable<DeviceConfig['app']>} {
  const app = {
    ...(run.bundleId ? {bundleId: run.bundleId} : {}),
    ...(run.appPath ? {appPath: run.appPath} : {}),
    ...(run.launchArguments.length ? {launchArguments: run.launchArguments} : {}),
    ...(Object.keys(run.permissions).length ? {permissions: run.permissions} : {}),
    ...(run.stateDir ? {stateDir: run.stateDir} : {}),
  };
  return Object.keys(app).length ? {app} : {};
}

const RUN_ID = Symbol.for('expo-vitest.run-id');

/**
 * The run's id: made by the first platform's global setup, and the same for
 * every platform after, since they share the main process. It sorts by when
 * the run began and is safe in a file name.
 */
export function runId(store: object = globalThis, now: Date = new Date(), random: () => string = () => randomBytes(3).toString('hex')): string {
  const holder = store as {[RUN_ID]?: string};
  return (holder[RUN_ID] ??= `${now.toISOString().replace(/[:.]/g, '-')}-${random()}`);
}

/** A value with its keys in order and its functions left out, so the same config always hashes the same. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!isObject(value)) return value;
  const keys = Object.keys(value)
    .filter(key => value[key] !== undefined && typeof value[key] !== 'function')
    .sort();
  return Object.fromEntries(keys.map(key => [key, ordered(value[key])]));
}

/**
 * What of a config crosses from the main process to the workers, which is
 * all of it but functions, and a hash of that, so a worker that loads the
 * file again can tell it read the same one.
 */
export function serialisable(config: HarnessConfig | null): {value: HarnessConfig | null; hash: string} {
  const value = config && (ordered(config) as HarnessConfig);
  return {value, hash: createHash('sha1').update(JSON.stringify(value)).digest('hex')};
}

/** The worker's check that the file it loaded is the one the main process loaded. */
export function sameConfig(loaded: HarnessConfig | null, provided: string, file: string | null): void {
  if (serialisable(loaded).hash === provided) return;
  throw new HarnessError('INVALID_CONFIG', `${file ?? 'the harness config'} changed after the run started; start the run again`);
}

/**
 * Driving a real app from Vitest, in the shape `mobile-test` uses: a `device`,
 * an `element(by.…)` and matchers, with all the matching and waiting in
 * TypeScript rather than in a DSL.
 *
 * Underneath is this package's harness, so one test runs on Windows (driven
 * here, because `agent-device` has no Windows backend), on iOS and Android
 * (driven by `agent-device`) and on web (a headless Chromium). The app under
 * test needs no SDK and no rebuild.
 *
 *   import {by, device, element, screen} from 'expo-vitest';
 *
 *   await device.open('/');
 *   await screen.getByRole('button', {name: 'Settings'}).press();
 *   await element(by.label('Settings')).press();
 *   expect(await device.fullSnapshot()).toHaveElement(by.label('Name'));
 */
import path from 'node:path';
import {beforeEach, describe} from 'vitest';
import {driverFor} from '../harness/lib/drivers.ts';
import type {HarnessCode} from '../harness/lib/errors.ts';
import {HarnessError, isHarnessError} from '../harness/lib/errors.ts';
import type {Kind} from '../harness/lib/roles.ts';
import type {Selector, Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {by, describeTarget, findNode} from '../harness/lib/snapshot.ts';
import {DEFAULT_TIMING, timingFor, withTiming} from '../harness/lib/settle.ts';
import {describeControl} from '../harness/lib/controls.ts';
import type {AppOptions, ControlRequest, ControlResult, DeviceFacts, DialogAnswer, Driver, DriverOptions, FillOptions, HostedDevice, OptionChoice, Orientation, PermissionState, Platform, PressOptions, StepResult, WebControls, WebCookie, WebRequest, WebRoute} from '../harness/lib/types.ts';
import {elsewhere, ok} from '../harness/lib/types.ts';
import type {Capability, Circumstances} from './capabilities.ts';
import {cannotSentence, capabilitiesOf, knownFacts} from './capabilities.ts';
import type {AppConfig, CommandConfig, HarnessConfig, Permission, ResolvedRun} from './config.ts';
import {configFromRun, currentRun, defineHarness} from './config.ts';
import type {Place} from './travel.ts';
import {checkRoute, route} from './travel.ts';
import type {Claim} from './pool.ts';
import {claimDevice, sessionName} from './pool.ts';
import type {EvidenceSource, Step, StepEvent, TreeDigest} from './evidence.ts';
import {Journal} from './evidence.ts';
import type {ComponentType, ReactElement, ReactNode as ReactChildren} from 'react';
import type {ReactNode, ReactTree, StackFrame} from '../harness/lib/react.ts';
import {appFrame, reactNodeOf, withComponents} from '../harness/lib/react.ts';
import {metroFrom, serverOf, symbolicate} from '../harness/lib/metro.ts';
import {checkCount, Locator} from './locator.ts';
import type {LocatorHost, LocatorState, WaitOptions} from './locator.ts';
import type {Polling, SnapshotFeed} from './polling.ts';
import {DEFAULT_POLLING, invalidating, snapshotFeed} from './polling.ts';
import type {QueryOptions, TextMatch, TextMatchOptions} from './queries.ts';
import type {Attribute, ExpectOptions} from './expectations.ts';
import type {FindOptions, Queries, RoleQueryOptions, TextQueryOptions} from './screen.ts';
import {queriesOn, scopeOf} from './screen.ts';
import {describeOption, downloadFile, expressionOf, inputFiles} from './web.ts';
import type {Rendered, RenderOptions} from './surface.ts';
import {currentSurface} from './surface.ts';
import {modeFrom} from '../harness/platforms/web-browsers.ts';
import type {VideoMode} from './video.ts';
import {videoModeOf} from './video.ts';

export {by, defineHarness, HarnessError, isHarnessError, Journal, Locator, reactNodeOf, withComponents};
export type {AppConfig, Capability, CommandConfig, DialogAnswer, HarnessConfig, HostedDevice, OptionChoice, Orientation, Permission, WebCookie, WebRequest, WebRoute};
export type {Attribute, ExpectOptions, FindOptions, HarnessCode, Kind, ReactNode, ReactTree, Rendered, RenderOptions, Step, StepEvent, TreeDigest, LocatorState, Queries, QueryOptions, RoleQueryOptions, Selector, Snapshot, SnapshotNode, TextMatch, TextMatchOptions, TextQueryOptions, WaitOptions};

/** The project under test: where the tests are run from, unless `HARNESS_ROOT` names it. */
const ROOT = path.resolve(process.env.HARNESS_ROOT ?? process.cwd());

/** How the device under test is named, from the environment the runner was given. */
export interface DeviceConfig {
  platform: Platform;
  url?: string;
  scheme?: string;
  target?: string;
  /** Synthetic input on Windows even while someone is using the machine, which the driver otherwise refuses. */
  force?: boolean;
  /** How long the screen must hold still after a step, in ms, where the run did not keep the default. */
  settle?: number;
  /** How long a control the last step brought in is given before it is pressed, in ms, where the run did not keep the default. */
  transition?: number;
  /** How long an assertion, an action's search for its node and a `findBy*` wait, in ms, where the run did not keep the default. */
  assertionTimeout?: number;
  /** How long something must stay gone before a wait for it to go passes, in ms, where the run did not keep the default. */
  stable?: number;
  /** The app, for its fresh launches and its state, from the harness config. */
  app?: AppOptions;
  /** On a device, the status bar made the same in every screenshot, `fixed`, or left as it is, `real`. */
  statusBar?: 'fixed' | 'real';
  /** How long one call to the driver may take, in ms. */
  actionTimeout?: number;
  /** When a test's screen is recorded: `on`, `retain-on-failure` or `off`. */
  video?: VideoMode;
}

/** A count of milliseconds from the environment, with `false` as 0, as e2e spells it; undefined when it is not one. */
function milliseconds(value: string | undefined): number | undefined {
  if (value === 'false') return 0;
  const number = Number(value);
  return value && Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function configFromEnvironment(environment: NodeJS.ProcessEnv = process.env): DeviceConfig {
  const platform = (environment.HARNESS_PLATFORM ?? 'web') as Platform;
  const force = environment.HARNESS_FORCE;
  const settle = milliseconds(environment.HARNESS_SETTLE);
  const transition = milliseconds(environment.HARNESS_TRANSITION);
  const assertionTimeout = milliseconds(environment.HARNESS_ASSERTION_TIMEOUT);
  const stable = milliseconds(environment.HARNESS_STABLE);
  const video = videoModeOf(environment.HARNESS_VIDEO);
  return {
    platform,
    url: environment.HARNESS_URL,
    scheme: environment.HARNESS_SCHEME,
    target: environment.HARNESS_TARGET,
    // A device test cannot pass the command's --force, so this is its form.
    ...(force && force !== '0' ? {force: true} : {}),
    // deviceConfig's settle, transition, assertionTimeout and stable arrive this way.
    ...(settle === undefined ? {} : {settle}),
    ...(transition === undefined ? {} : {transition}),
    ...(assertionTimeout === undefined ? {} : {assertionTimeout}),
    ...(stable === undefined ? {} : {stable}),
    ...(video ? {video} : {}),
  };
}

/** A step that did not work, as the error a test sees: the driver's message, and what kind of failure it was. */
function failure(result: StepResult, platform: Platform, otherwise: HarnessCode): HarnessError {
  return new HarnessError(result.code ?? otherwise, result.message, {platform});
}

class Device {
  /** The snapshots every wait shares, so waits at the same moment take one between them. */
  readonly feed: SnapshotFeed;
  /** The record of the current test's steps, for the evidence a failing test leaves. */
  readonly journal = new Journal();
  private driver: Driver | null = null;
  private readonly resolve: () => DeviceConfig;
  private settled: DeviceConfig | null = null;
  /** Why the last control that was skipped was, for a test or a report that says so; null after one that was done. */
  lastSkip: string | null = null;
  /** What the driver found of the device when it opened. */
  private facts: DeviceFacts | undefined;
  /** Whether the screen is being recorded for the test that is running. */
  private recording = false;
  /** The device of the pool this file holds, given back when it closes. */
  private claim: Claim | null = null;
  /** A recording asked for before the device was opened, which starts when it is. */
  private recordWhenReady = false;
  private videoWarned = false;

  /** The feeds of the frames a test has a screen of, told whenever the device's is. */
  private readonly frameFeeds = new Set<SnapshotFeed>();
  /** What web alone has: the browser's own controls. Off web each answers `'skipped'`. */
  readonly web: WebSide = new WebSide(this);

  constructor(resolve: () => DeviceConfig) {
    this.resolve = resolve;
    const own = snapshotFeed(() => this.read({interactive: false}));
    // A frame's screen reads a tree of its own, which an action changes as much as the page's.
    this.feed = {
      next: () => own.next(),
      invalidate: () => {
        own.invalidate();
        for (const each of this.frameFeeds) each.invalidate();
      },
    };
  }

  /** The host of a frame's screen, for `device.web.frame`: its tree read from the frame, its steps the device's. */
  frameHost(selector: string): LocatorHost {
    const feed = snapshotFeed(async () => {
      const web = (await this.ready()).web;
      if (!web) throw new HarnessError('UNSUPPORTED_CAPABILITY', `${this.platform} has no frames`, {platform: this.platform});
      return web.frameSnapshot(web.frame(selector));
    });
    this.frameFeeds.add(feed);
    return {platform: this.platform, ready: () => this.ready(), feed, polling: this.polling, journal: this.journal};
  }

  /** How the device under test is named, worked out when first asked for, which is after a project's setup file has resolved the run. */
  get config(): DeviceConfig {
    return (this.settled ??= this.resolve());
  }

  /** A read of the tree, which the journal digests into the step it belongs to when it is the whole tree. */
  private async read(options: {interactive?: boolean}): Promise<Snapshot> {
    const snapshot = await (await this.ready()).snapshot(options);
    if (!options.interactive) this.journal.saw(snapshot);
    return snapshot;
  }

  /** Whether the driver is open, so evidence can be had from it without making another. */
  isOpen(): boolean {
    return this.driver !== null;
  }

  /** What the evidence writer needs of the device: a picture and a fresh tree, while the driver is open. */
  evidence(): EvidenceSource {
    return {
      platform: this.platform,
      journal: this.journal,
      open: () => this.isOpen(),
      screenshot: async file => {
        const result = await (this.driver as Driver).screenshot(file);
        return result.ok && !result.skipped;
      },
      tree: () => this.read({interactive: false}),
      react: async () => {
        const driver = this.driver as Driver;
        if (!driver.react) return null;
        const tree = await driver.react();
        return 'unavailable' in tree ? null : tree;
      },
      drawnAt: async node => {
        const driver = this.driver as Driver;
        if (!driver.reactFrames) return null;
        const read = await driver.reactFrames(node.id);
        const [first] = 'frames' in read ? read.frames : [];
        if (!first) return null;
        // A page's frames name the server that bundled them; a device's Metro is where the run reaches it.
        const metro = this.platform === 'web' ? serverOf(first.file) : metroFrom(process.env).url;
        const source = metro ? await symbolicate((read as {frames: StackFrame[]}).frames, metro) : null;
        return source ? appFrame(source, ROOT) : null;
      },
    };
  }

  get platform(): Platform {
    return this.config.platform;
  }

  /** What decides a capability beyond the platform: the device found, by this driver or the warm-up, the app, and the browser. */
  private circumstances(): Circumstances {
    const device = this.facts ?? knownFacts();
    return {
      ...(device ? {device} : {}),
      ...(this.config.app ? {app: this.config.app} : {}),
      ...(this.platform === 'web' ? {browser: modeFrom(process.env).browser} : {}),
      ...(currentSurface() ? {unit: true} : {}),
    };
  }

  /** Every step and control this platform and this device have. The device is known once the driver has opened, or from the warm-up. */
  get capabilities(): ReadonlySet<Capability> {
    return capabilitiesOf(this.platform, this.circumstances());
  }

  /** Whether this platform and this device have a step or a control. */
  can(capability: Capability): boolean {
    return this.capabilities.has(capability);
  }

  /** What of these this device cannot do, and why, in a sentence; null where it can do them all. */
  cannot(capabilities: Capability[]): string | null {
    return cannotSentence(capabilities, this.platform, this.circumstances());
  }

  /** How long a wait lasts, and how long an absence must hold, from the run's config. */
  get polling(): Polling {
    return {assertionTimeout: this.config.assertionTimeout ?? DEFAULT_POLLING.assertionTimeout, stable: this.config.stable ?? DEFAULT_POLLING.stable};
  }

  /** The driver, made on first use and kept for the file's tests; its steps wait for the screen to hold still. */
  async ready(): Promise<Driver> {
    if (this.driver) return this.driver;
    const {platform, url, scheme, target, force, app, statusBar, actionTimeout} = this.config;
    const options: DriverOptions = {root: ROOT, url, scheme, target, force, ...(app ? {app} : {}), ...(statusBar ? {statusBar} : {}), ...(actionTimeout ? {actionTimeout} : {})};
    const run = currentRun();
    // A unit test's device is the tree the test rendered, which its project's setup file names.
    const surface = currentSurface();
    const driver = surface ? surface.driver() : run?.devices ? await this.claimFrom(run.devices, run, options) : driverFor(platform, options);
    const state = await driver.available();
    if (!state.ready) {
      await driver.close();
      this.claim?.release();
      this.claim = null;
      throw new HarnessError('DRIVER_UNAVAILABLE', `no ${this.config.platform} device to drive: ${state.reason}`, {platform: this.config.platform});
    }
    if (state.device) this.facts = state.device;
    this.driver = invalidating(withTiming(driver, timingFor(DEFAULT_TIMING, {settle: this.config.settle, transition: this.config.transition})), this.feed);
    // What the app writes to its console goes in the journal, beside the steps.
    driver.onConsole?.((level, text) => this.journal.log(level, text));
    if (this.recordWhenReady) await this.startRecording(this.driver);
    return this.driver;
  }

  /**
   * A driver on a device of the pool, held for this test file: the device's
   * lock in the run's folder, then a session of its own on it, which
   * agent-device holds the device for. The device is the file's until it
   * closes.
   */
  private async claimFrom(devices: string[], run: ResolvedRun, options: DriverOptions): Promise<Driver> {
    const runId = run.runId ?? 'local';
    let held: Driver | undefined;
    this.claim = await claimDevice({
      devices,
      folder: path.join(ROOT, '.harness', 'locks', runId, run.platform),
      file: run.testFile ?? '',
      timeout: run.poolTimeout,
      platform: run.platform,
      open: async device => {
        const driver = driverFor(run.platform, {...options, target: device, session: sessionName(runId, device)});
        const attached = (await driver.attach?.()) ?? ok('nothing to hold');
        if (attached.ok) {
          held = driver;
          return 'opened';
        }
        await driver.close();
        if (/\bDEVICE_IN_USE\b/.test(attached.message)) return 'in-use';
        throw failure(attached, run.platform, 'DRIVER_UNAVAILABLE');
      },
    });
    return held as Driver;
  }

  async open(route: string): Promise<void> {
    await this.journal.run({event: 'open', what: route}, async () => {
      const result = await (await this.ready()).open(route);
      if (!result.ok) throw failure(result, this.platform, 'APP_UNREACHABLE');
    });
  }

  async snapshot(options: {interactive?: boolean} = {interactive: true}): Promise<Snapshot> {
    return this.journal.run({event: 'snapshot', what: options.interactive ? 'what can be acted on' : 'the whole tree'}, () => this.read(options));
  }

  /** The whole tree, including what cannot be acted on. */
  async fullSnapshot(): Promise<Snapshot> {
    return this.snapshot({interactive: false});
  }

  async screenshot(name: string): Promise<string> {
    return this.journal.run({event: 'screenshot', what: name}, async () => {
      const file = path.join(ROOT, '.harness', `${name}.png`);
      const result = await (await this.ready()).screenshot(file);
      if (!result.ok) throw failure(result, this.platform, 'ACTION_FAILED');
      // A unit test draws nothing, and a path to no picture would fail later for a reason that is not there.
      if (result.skipped) throw new HarnessError('UNSUPPORTED_CAPABILITY', result.message, {platform: this.platform});
      return file;
    });
  }

  async type(text: string): Promise<void> {
    await this.journal.run({event: 'type', what: JSON.stringify(text)}, async () => {
      const result = await (await this.ready()).type(text);
      if (!result.ok) throw failure(result, this.platform, 'ACTION_FAILED');
    });
  }

  /**
   * A named key where the focus is: `ArrowDown`, `Home`, `Enter`.
   *
   * Answers `'skipped'` on a backend that cannot send one, so a test written
   * for four platforms still runs on all of them and says what it could not do
   * rather than failing for the wrong reason.
   */
  async key(name: string): Promise<'pressed' | 'skipped'> {
    const pressed = await this.journal.run(
      {event: 'key', what: name},
      async (): Promise<'pressed' | 'skipped'> => {
        const driver = await this.ready();
        if (!driver.key) return 'skipped';
        const result = await driver.key(name);
        if (!result.ok) throw failure(result, this.platform, 'ACTION_FAILED');
        return result.skipped ? 'skipped' : 'pressed';
      },
      answer => (answer === 'skipped' ? {result: 'skipped', message: `the ${this.platform} harness sends no keys`} : {result: 'ok', message: ''}),
    );
    return pressed;
  }

  /**
   * The React tree behind the native one: the component behind each node,
   * the chain above it, and its props as written. Read from the page on web,
   * and through Metro from a development build elsewhere. Pass it with a
   * snapshot to `withComponents` for each node's component.
   */
  async react(): Promise<ReactTree> {
    return this.journal.run({event: 'snapshot', what: 'the React tree'}, async () => {
      const driver = await this.ready();
      if (!driver.react) throw new HarnessError('UNSUPPORTED_CAPABILITY', `reading the React tree is not something the ${this.platform} harness can do`, {platform: this.platform});
      const tree = await driver.react();
      if ('unavailable' in tree) throw new HarnessError('UNSUPPORTED_CAPABILITY', `the React tree cannot be read: ${tree.unavailable}`, {platform: this.platform});
      return tree;
    });
  }

  /** Waits until a selector is in the tree, or says what was there instead. */
  async waitFor(selector: Selector, {timeout = 10_000, interval = 400} = {}): Promise<SnapshotNode> {
    const node = await this.journal.run({event: 'wait', what: describeTarget(selector)}, async () => {
      const deadline = Date.now() + timeout;
      let last: Snapshot = {platform: this.config.platform, nodes: []};
      for (;;) {
        last = await this.read({interactive: false});
        const found = findNode(last, selector);
        if (found) return found;
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, interval));
      }
      throw new HarnessError('LOCATOR_NOT_FOUND', `${describeTarget(selector)} never appeared within ${timeout} ms; the tree has ${last.nodes.length} nodes`, {platform: this.platform});
    });
    this.journal.verified(describeTarget(selector));
    return node;
  }

  /** A control of the app's life, journalled, with the reason kept where the platform has no counterpart. */
  private async control(request: ControlRequest): Promise<ControlResult> {
    const result = await this.journal.run(
      {event: 'control', what: describeControl(request)},
      async (): Promise<ControlResult> => {
        const driver = await this.ready();
        const answer = driver.control ? await driver.control(request) : elsewhere(request.name, this.platform);
        if (!answer.ok) throw failure(answer, this.platform, 'ACTION_FAILED');
        return answer;
      },
      answer => ({result: answer.skipped ? 'skipped' : 'ok', message: answer.message}),
    );
    this.lastSkip = result.skipped ? result.message : null;
    return result;
  }

  /**
   * A fresh launch of the app, with its launch arguments and permissions. On
   * web, a new browser context at the base url; on Windows, the exe ended and
   * started again; on a device, the app relaunched.
   */
  async restart(): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'restart'}));
  }

  /** The app's state cleared, then a fresh launch: its data on a device, its folder on Windows, its cookies and storage on web. */
  async clearState(): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'clearState'}));
  }

  /**
   * The app ended, as Detox's `terminateApp` and Maestro's `stopApp` end it,
   * with its data kept: the app's process on a device and on Windows, and on
   * web the page, left for a blank one with its cookies and storage kept.
   * `open` or `restart` starts it again.
   */
  async stopApp(): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'stopApp'}));
  }

  /** Back, as the platform goes back: the history on web, the back button on a device. */
  async back(): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'back'}));
  }

  /** The device's home screen, leaving the app running behind it. */
  async home(): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'home'}));
  }

  /**
   * The app in front again where it left off, as Detox's `launchApp` with
   * `newInstance: false` brings it back: from the background after `home`
   * or another app, with no restart, or started where it is not running. On
   * web, the page brought to the front, and opened at the app again where
   * `stopApp` left it blank.
   */
  async resumeApp(): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'resumeApp'}));
  }

  /** A build installed: the one given, from the root, or the harness config's `appPath`; in place of the one there with `reinstall`. */
  async installApp(path?: string, options: {reinstall?: boolean} = {}): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'installApp', ...(path ? {path} : {}), ...(options.reinstall ? {reinstall: true} : {})}));
  }

  /** A link opened as the platform opens one, which on a device can be another app's. */
  async openLink(url: string): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'openLink', url}));
  }

  /** The app in front: its package or bundle id on a device, its process on Windows, the page's url on web. Null where that cannot be told. */
  async foregroundApp(): Promise<string | null> {
    const result = await this.control({name: 'foregroundApp'});
    return result.skipped ? null : (result.value ?? null);
  }

  /*
   * The device's settings. None of them puts itself back: a test that
   * changes one changes it back in `afterEach`, or the next test starts
   * where it left off.
   */

  /** Light or dark, as the system's appearance on a device and the page's colour scheme on web. */
  async setAppearance(mode: 'light' | 'dark'): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'setAppearance', mode}));
  }

  /** Which way up the device is; on web, the viewport turned to match. */
  async setOrientation(orientation: Orientation): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'setOrientation', orientation}));
  }

  /** The app on or off the network: Wi-Fi on Android, the browser context on web. */
  async setNetwork(state: 'online' | 'offline'): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'setNetwork', online: state === 'online'}));
  }

  async setAirplaneMode(on: boolean): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'setAirplaneMode', on}));
  }

  /** One of the app's permissions, by agent-device's name for it: `camera`, `location`, `notifications`. */
  async setPermission(permission: string, state: PermissionState): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'setPermission', permission, state}));
  }

  /** Where the device says it is. */
  async setLocation(where: {latitude: number; longitude: number}): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'setLocation', latitude: where.latitude, longitude: where.longitude}));
  }

  /**
   * The device moved along a route of places at `speed` metres a second, 100
   * by default, as Maestro's `travel` moves it: put at a position on the way
   * each second, through `setLocation`, and at the last place at the end.
   * One step in the trace, where it is skipped as `setLocation` is.
   */
  async travel(places: Place[], options: {speed?: number} = {}): Promise<'done' | 'skipped'> {
    const speed = options.speed ?? 100;
    checkRoute(places, speed, this.platform);
    const positions = route(places, speed);
    const result = await this.journal.run(
      {event: 'control', what: `travel through ${places.length} places at ${speed} m/s`},
      async (): Promise<ControlResult> => {
        const driver = await this.ready();
        for (const [index, at] of positions.entries()) {
          if (index > 0) await new Promise(resolve => setTimeout(resolve, 1000));
          const request: ControlRequest = {name: 'setLocation', latitude: at.latitude, longitude: at.longitude};
          const answer = driver.control ? await driver.control(request) : elsewhere(request.name, this.platform);
          if (!answer.ok) throw failure(answer, this.platform, 'ACTION_FAILED');
          if (answer.skipped) return answer;
        }
        return ok(`travelled through ${places.length} places, ${positions.length} positions a second apart`);
      },
      answer => ({result: answer.skipped ? 'skipped' : 'ok', message: answer.message}),
    );
    this.lastSkip = result.skipped ? result.message : null;
    return doneOrSkipped(result);
  }

  /** No location to read: off on a device, unavailable to the page on web. */
  async clearLocation(): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'clearLocation'}));
  }

  /** The answer the next biometric prompt gets: Face ID or Touch ID on an iOS simulator, a fingerprint on an Android emulator. */
  async setBiometrics(sensor: 'faceid' | 'touchid' | 'fingerprint', result: 'match' | 'nonmatch'): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'setBiometrics', sensor, result}));
  }

  /** Whether an iOS simulator has Face ID or Touch ID enrolled. */
  async enrollBiometrics(sensor: 'faceid' | 'touchid', enrolled: boolean): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'enrollBiometrics', sensor, enrolled}));
  }

  /** A foldable simulator or emulator put in a pose. */
  async fold(pose: 'closed' | 'half-open' | 'open'): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'fold', pose}));
  }

  /** The text on the clipboard, or null where it cannot be read. What it held is not written to the trace. */
  async clipboard(): Promise<string | null> {
    const result = await this.control({name: 'clipboard'});
    return result.skipped ? null : (result.value ?? null);
  }

  async setClipboard(text: string): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'setClipboard', text}));
  }

  /** The keyboard on the screen put away; on web, the focus taken off the field. */
  async dismissKeyboard(): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'dismissKeyboard'}));
  }

  /** The system alert accepted or dismissed. On web, the next dialog the page opens, since a browser decides one as it opens. */
  async alert(action: 'accept' | 'dismiss'): Promise<'done' | 'skipped'> {
    return doneOrSkipped(await this.control({name: 'alert', action}));
  }

  /**
   * Records the screen until `saveVideo`, where the platform records: from now
   * where the device is open, and from the first step where it is not yet. The
   * evidence hook does this under `video` or `HARNESS_VIDEO`. True while it is
   * recording or waiting to, false where the platform records nothing.
   */
  async recordVideo(): Promise<boolean> {
    if (this.recording) return true;
    if (!this.can('video')) return false;
    if (this.driver) return this.startRecording(this.driver);
    // Opening the device to record it would open it for a test that never uses it, so the recording waits for the first step.
    this.recordWhenReady = true;
    return true;
  }

  private async startRecording(driver: Driver): Promise<boolean> {
    this.recordWhenReady = false;
    const result = await driver.video?.('start');
    this.recording = Boolean(result?.ok && !result.skipped);
    if (result && !result.ok) this.warnVideo(result.message);
    return this.recording;
  }

  /** A recording that failed, in the journal each time and on the console once: the test goes on without it. */
  private warnVideo(message: string): void {
    this.journal.log('warn', `video: ${message}`);
    if (this.videoWarned) return;
    this.videoWarned = true;
    console.warn(`video: ${message}`);
  }

  /** Ends the recording, and keeps it at `file`, from the project root, or throws it away without one; the path it was kept at, or null. */
  async saveVideo(file?: string): Promise<string | null> {
    this.recordWhenReady = false;
    if (!this.recording || !this.driver?.video) return null;
    this.recording = false;
    const result = await this.driver.video('stop', file === undefined ? undefined : path.resolve(ROOT, file));
    if (!result.ok) this.warnVideo(result.message);
    return result.ok && result.value ? result.value : null;
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
    // The session is closed, so the device can go back to the pool.
    this.claim?.release();
    this.claim = null;
    this.recording = false;
    this.recordWhenReady = false;
    this.feed.invalidate();
  }
}

/**
 * What web alone has, on every platform. Off web each method answers
 * `'skipped'` and opens nothing, so a test file shared with a device still
 * runs and says what it could not do; `device.can('web')` is the gate a test
 * checks before relying on one. Each is a step in the trace, after which the
 * screen is read afresh.
 */
class WebSide {
  private readonly device: Device;

  constructor(device: Device) {
    this.device = device;
  }

  /** The browser's controls, on web; null elsewhere. */
  private async controls(): Promise<WebControls | null> {
    if (this.device.platform !== 'web') return null;
    return (await this.device.ready()).web ?? null;
  }

  private async step<T>(what: string, work: (web: WebControls) => Promise<T>): Promise<T | 'skipped'> {
    const web = await this.controls();
    if (!web) return 'skipped';
    try {
      return await this.device.journal.run({event: 'web', what}, () => work(web));
    } finally {
      this.device.feed.invalidate();
    }
  }

  /**
   * Answers the page's requests that match `pattern`, a glob such as
   * `**\/api/**`, until the function it answers is called. A restart's new
   * context has it too. A handler that answers nothing lets the request
   * through.
   */
  route(pattern: string, handler: (route: WebRoute) => unknown): Promise<(() => Promise<void>) | 'skipped'> {
    return this.step(`route ${pattern}`, web => web.route(pattern, handler));
  }

  /** Answers every dialog the page opens, one way or as a function decides, until the function it answers is called. `device.alert` still answers the next one. */
  onDialog(answer: DialogAnswer): Promise<(() => void) | 'skipped'> {
    return this.step(`answer dialogs: ${typeof answer === 'function' ? 'as a function decides' : answer}`, async web => web.onDialog(answer));
  }

  /**
   * An expression evaluated in the page, or a function called there with
   * `arg`, and its value, which must be JSON. A function goes by its source,
   * so it can use nothing of the test's but `arg`.
   */
  async evaluate<T, A = undefined>(source: string | ((arg: A) => T | Promise<T>), arg?: A): Promise<T | 'skipped'> {
    const expression = expressionOf(source as string | ((arg: never) => unknown), arg);
    return this.step(`evaluate ${typeof source === 'string' ? source.slice(0, 80) : 'a function'}`, web => web.evaluate<T>(expression));
  }

  setViewport(size: {width: number; height: number}): Promise<'done' | 'skipped'> {
    return this.step(`set the viewport to ${size.width} by ${size.height}`, async web => {
      await web.setViewport(size);
      return 'done' as const;
    });
  }

  /** The cookies the page's context holds. */
  cookies(): Promise<WebCookie[] | 'skipped'> {
    return this.step('read the cookies', web => web.cookies());
  }

  /** Sets cookies, each with a `url`, or a `domain` and a `path`. */
  setCookies(cookies: WebCookie[]): Promise<'done' | 'skipped'> {
    return this.step(`set ${cookies.length === 1 ? 'a cookie' : `${cookies.length} cookies`}`, async web => {
      await web.setCookies(cookies);
      return 'done' as const;
    });
  }

  clearCookies(): Promise<'done' | 'skipped'> {
    return this.step('clear the cookies', async web => {
      await web.clearCookies();
      return 'done' as const;
    });
  }

  /**
   * Keeps the page's cookies and storage at `file`, from the project root,
   * as Playwright's `storageState`, and answers where. A context the run
   * starts after begins from it where `app.web.storageState` names it.
   */
  storageState(file: string): Promise<string | 'skipped'> {
    return this.step(`keep the cookies and storage in ${file}`, web => web.storageState(path.resolve(ROOT, file)));
  }

  /**
   * Runs `trigger`, waits for the download it starts, and keeps the file: at
   * `file`, from the project root, or in `.harness/downloads/` by the name the
   * page gave it. Answers where.
   */
  waitForDownload(trigger: () => Promise<unknown>, file?: string): Promise<string | 'skipped'> {
    return this.step('wait for a download', web => web.download(trigger, suggested => downloadFile(ROOT, suggested, file)));
  }

  /** Chooses an option of the select a locator names: by its label, `{value}` or `{index}`. */
  selectOption(locator: Locator, option: OptionChoice): Promise<'done' | 'skipped'> {
    return locator.web(`choose ${describeOption(option)} in`, (web, target) => web.selectOption(target, option));
  }

  /** Gives the file input a locator names files from the project, none of them hidden, as a person choosing them would. */
  async setInputFiles(locator: Locator, files: string | string[]): Promise<'done' | 'skipped'> {
    if (this.device.platform !== 'web') return 'skipped';
    const chosen = inputFiles(ROOT, Array.isArray(files) ? files : [files]);
    return locator.web(`give ${chosen.length === 1 ? 'a file' : `${chosen.length} files`} to`, (web, target) => web.setInputFiles(target, chosen));
  }

  /** Presses what a locator names with the secondary button, as a right click does. */
  secondaryTap(locator: Locator): Promise<'done' | 'skipped'> {
    return locator.web('press with the secondary button', (web, target) => web.secondaryTap(target));
  }

  /**
   * A screen of the frame a CSS selector names: its queries read the frame's
   * tree, and its locators act in the frame, whichever origin it is from.
   */
  frame(selector: string): Queries | 'skipped' {
    if (this.device.platform !== 'web') return 'skipped';
    return queriesOn(this.device.frameHost(selector));
  }
}

function doneOrSkipped(result: ControlResult): 'done' | 'skipped' {
  return result.skipped ? 'skipped' : 'done';
}

/** The platforms named, as a sentence names them. */
function listed(platforms: Platform[]): string {
  return platforms.length > 1 ? `${platforms.slice(0, -1).join(', ')} and ${platforms.at(-1)}` : (platforms[0] ?? 'no platform');
}

/** A block of tests that runs only on these platforms, and is reported skipped on the others. */
export function onlyOn(platforms: Platform[], suite: () => void): void {
  describe.skipIf(!platforms.includes(device.platform))(`on ${listed(platforms)}`, suite);
}

/** A block of tests that is reported skipped on these platforms, and runs on the others. */
export function skipOn(platforms: Platform[], suite: () => void): void {
  describe.skipIf(platforms.includes(device.platform))(`not on ${listed(platforms)}`, suite);
}

/**
 * A block of tests that needs these steps or controls. On a platform or a
 * device without one, as a phone that does not fold, each test is skipped,
 * and the reason says which it lacks and why.
 */
export function requires(capabilities: Capability[], suite: () => void): void {
  describe(`with ${capabilities.join(', ')}`, () => {
    beforeEach(async context => {
      // The driver opens first, so what it found of the device is known.
      await device.ready();
      const unmet = device.cannot(capabilities);
      if (unmet) context.skip(unmet);
    });
    suite();
  });
}

/**
 * The device: in a unit test, the tree the test rendered, with no wait for
 * the screen to hold still after a step, since a render changes in the
 * test's own process and a matcher waits for what follows; in a device
 * test, the run a project's setup file resolved from the harness config, or
 * the environment alone.
 */
export const device = new Device(() => {
  const surface = currentSurface();
  if (surface) return {...configFromEnvironment(), platform: surface.platform, settle: 0, transition: 0};
  const run = currentRun();
  return run ? configFromRun(run, process.env) : configFromEnvironment();
});

/**
 * Renders a component for a unit test, which `screen` and `device` then read
 * and act on as they do a running app, so the test reads the same as a
 * device test. A device test has the app already, and opens a route of it
 * with `device.open`.
 */
export async function render(ui: ReactElement, options: {wrapper?: ComponentType<{children?: ReactChildren}>} = {}): Promise<Rendered> {
  const surface = currentSurface();
  if (!surface) throw new HarnessError('INVALID_ARGUMENT', 'render mounts a component in a unit test; a device test drives the running app, and opens a route of it with device.open', {platform: device.platform});
  device.feed.invalidate();
  return surface.render(ui, options as RenderOptions);
}

/**
 * React Native Testing Library's queries over the device's tree:
 * `screen.getByRole('button', {name: 'Save'})` is a locator, made at no cost
 * and resolved each time it is acted on or asserted.
 */
export const screen: Queries = queriesOn(device);

/** The same queries, kept inside one node: a locator's, or a node a query gave. */
export function within(target: Locator | SnapshotNode): Queries {
  return queriesOn(device, scopeOf(target));
}

/**
 * Runs `body` as one named step of the test, as Playwright's `test.step`:
 * the trace lists it with the steps taken inside it under its title, and
 * marks it failed where `body` throws. Steps nest. Answers with what `body`
 * answers.
 */
export function step<T>(title: string, body: () => T | Promise<T>): Promise<T> {
  return device.journal.group(title, body);
}

/** One element, found fresh each time it is acted on — a ref from an old tree is stale. */
export function element(selector: Selector) {
  return {
    selector,
    /** `{via: 'pointer'}` presses a Windows control with the pointer rather than through its pattern, and `{count: 2}` is a double press. */
    async press(options: PressOptions = {}): Promise<void> {
      checkCount(options, device.platform);
      await device.journal.run({event: 'press', what: describeTarget(selector)}, async () => {
        const result = await (await device.ready()).press(selector, options);
        if (!result.ok) throw failure(result, device.platform, 'ACTION_FAILED');
      });
    },
    /** `{via: 'keys'}` clicks a Windows field and types rather than setting its value. */
    async fill(text: string, options: FillOptions = {}): Promise<void> {
      await device.journal.run({event: 'fill', what: `${describeTarget(selector)} with ${JSON.stringify(text)}`}, async () => {
        const result = await (await device.ready()).fill(selector, text, options);
        if (!result.ok) throw failure(result, device.platform, 'ACTION_FAILED');
      });
    },
    async node(): Promise<SnapshotNode | undefined> {
      return findNode(await device.fullSnapshot(), selector);
    },
    async waitFor(options?: {timeout?: number}): Promise<SnapshotNode> {
      return device.waitFor(selector, options);
    },
  };
}

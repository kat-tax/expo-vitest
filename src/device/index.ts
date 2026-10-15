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
 *   import {by, device, element} from 'expo-vitest/device';
 *
 *   await device.open('/');
 *   await element(by.label('Settings')).press();
 *   expect(await device.fullSnapshot()).toHaveElement(by.label('Name'));
 */
import path from 'node:path';
import {driverFor} from '../harness/lib/drivers.ts';
import type {HarnessCode} from '../harness/lib/errors.ts';
import {HarnessError, isHarnessError} from '../harness/lib/errors.ts';
import type {Selector, Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {by, describeTarget, findNode} from '../harness/lib/snapshot.ts';
import {DEFAULT_TIMING, timingFor, withTiming} from '../harness/lib/settle.ts';
import type {Driver, FillOptions, Platform, PressOptions, StepResult} from '../harness/lib/types.ts';

export {by, HarnessError, isHarnessError};
export type {HarnessCode, Selector, Snapshot, SnapshotNode};

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
  return {
    platform,
    url: environment.HARNESS_URL,
    scheme: environment.HARNESS_SCHEME,
    target: environment.HARNESS_TARGET,
    // A device test cannot pass the command's --force, so this is its form.
    ...(force && force !== '0' ? {force: true} : {}),
    // deviceConfig's settle and transition arrive this way.
    ...(settle === undefined ? {} : {settle}),
    ...(transition === undefined ? {} : {transition}),
  };
}

/** A step that did not work, as the error a test sees: the driver's message, and what kind of failure it was. */
function failure(result: StepResult, platform: Platform, otherwise: HarnessCode): HarnessError {
  return new HarnessError(result.code ?? otherwise, result.message, {platform});
}

class Device {
  readonly config: DeviceConfig;
  private driver: Driver | null = null;

  constructor(config: DeviceConfig) {
    this.config = config;
  }

  get platform(): Platform {
    return this.config.platform;
  }

  /** The driver, made on first use and kept for the file's tests; its steps wait for the screen to hold still. */
  async ready(): Promise<Driver> {
    if (this.driver) return this.driver;
    const driver = driverFor(this.config.platform, {root: ROOT, url: this.config.url, scheme: this.config.scheme, target: this.config.target, force: this.config.force});
    const state = await driver.available();
    if (!state.ready) throw new HarnessError('DRIVER_UNAVAILABLE', `no ${this.config.platform} device to drive: ${state.reason}`, {platform: this.config.platform});
    this.driver = withTiming(driver, timingFor(DEFAULT_TIMING, {settle: this.config.settle, transition: this.config.transition}));
    return this.driver;
  }

  async open(route: string): Promise<void> {
    const result = await (await this.ready()).open(route);
    if (!result.ok) throw failure(result, this.platform, 'APP_UNREACHABLE');
  }

  async snapshot(options: {interactive?: boolean} = {interactive: true}): Promise<Snapshot> {
    return (await this.ready()).snapshot(options);
  }

  /** The whole tree, including what cannot be acted on. */
  async fullSnapshot(): Promise<Snapshot> {
    return (await this.ready()).snapshot({interactive: false});
  }

  async screenshot(name: string): Promise<string> {
    const file = path.join(ROOT, '.harness', `${name}.png`);
    const result = await (await this.ready()).screenshot(file);
    if (!result.ok) throw failure(result, this.platform, 'ACTION_FAILED');
    return file;
  }

  async type(text: string): Promise<void> {
    const result = await (await this.ready()).type(text);
    if (!result.ok) throw failure(result, this.platform, 'ACTION_FAILED');
  }

  /**
   * A named key where the focus is: `ArrowDown`, `Home`, `Enter`.
   *
   * Answers `'skipped'` on a backend that cannot send one, so a test written
   * for four platforms still runs on all of them and says what it could not do
   * rather than failing for the wrong reason.
   */
  async key(name: string): Promise<'pressed' | 'skipped'> {
    const driver = await this.ready();
    if (!driver.key) return 'skipped';
    const result = await driver.key(name);
    if (!result.ok) throw failure(result, this.platform, 'ACTION_FAILED');
    return result.skipped ? 'skipped' : 'pressed';
  }

  /** Waits until a selector is in the tree, or says what was there instead. */
  async waitFor(selector: Selector, {timeout = 10_000, interval = 400} = {}): Promise<SnapshotNode> {
    const deadline = Date.now() + timeout;
    let last: Snapshot = {platform: this.config.platform, nodes: []};
    for (;;) {
      last = await this.snapshot({interactive: false});
      const node = findNode(last, selector);
      if (node) return node;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new HarnessError('LOCATOR_NOT_FOUND', `${describeTarget(selector)} never appeared within ${timeout} ms; the tree has ${last.nodes.length} nodes`, {platform: this.platform});
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
  }
}

export const device = new Device(configFromEnvironment());

/** One element, found fresh each time it is acted on — a ref from an old tree is stale. */
export function element(selector: Selector) {
  return {
    selector,
    /** `{via: 'pointer'}` presses a Windows control with the pointer rather than through its pattern. */
    async press(options: PressOptions = {}): Promise<void> {
      const result = await (await device.ready()).press(selector, options);
      if (!result.ok) throw failure(result, device.platform, 'ACTION_FAILED');
    },
    /** `{via: 'keys'}` clicks a Windows field and types rather than setting its value. */
    async fill(text: string, options: FillOptions = {}): Promise<void> {
      const result = await (await device.ready()).fill(selector, text, options);
      if (!result.ok) throw failure(result, device.platform, 'ACTION_FAILED');
    },
    async node(): Promise<SnapshotNode | undefined> {
      return findNode(await device.fullSnapshot(), selector);
    },
    async waitFor(options?: {timeout?: number}): Promise<SnapshotNode> {
      return device.waitFor(selector, options);
    },
  };
}

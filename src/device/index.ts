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
 *   import {by, device, element, screen} from 'expo-vitest/device';
 *
 *   await device.open('/');
 *   await screen.getByRole('button', {name: 'Settings'}).press();
 *   await element(by.label('Settings')).press();
 *   expect(await device.fullSnapshot()).toHaveElement(by.label('Name'));
 */
import path from 'node:path';
import {driverFor} from '../harness/lib/drivers.ts';
import type {HarnessCode} from '../harness/lib/errors.ts';
import {HarnessError, isHarnessError} from '../harness/lib/errors.ts';
import type {Kind} from '../harness/lib/roles.ts';
import type {Selector, Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {by, describeTarget, findNode} from '../harness/lib/snapshot.ts';
import {DEFAULT_TIMING, timingFor, withTiming} from '../harness/lib/settle.ts';
import type {Driver, FillOptions, Platform, PressOptions, StepResult} from '../harness/lib/types.ts';
import type {EvidenceSource, Step, StepEvent, TreeDigest} from './evidence.ts';
import {Journal} from './evidence.ts';
import type {ReactNode, ReactTree} from '../harness/lib/react.ts';
import {reactNodeOf, withComponents} from '../harness/lib/react.ts';
import {Locator} from './locator.ts';
import type {LocatorState, WaitOptions} from './locator.ts';
import type {Polling, SnapshotFeed} from './polling.ts';
import {DEFAULT_POLLING, invalidating, snapshotFeed} from './polling.ts';
import type {QueryOptions, TextMatch, TextMatchOptions} from './queries.ts';
import type {Attribute, ExpectOptions} from './expectations.ts';
import type {FindOptions, Queries, RoleQueryOptions, TextQueryOptions} from './screen.ts';
import {queriesOn, scopeOf} from './screen.ts';

export {by, HarnessError, isHarnessError, Journal, Locator, reactNodeOf, withComponents};
export type {Attribute, ExpectOptions, FindOptions, HarnessCode, Kind, ReactNode, ReactTree, Step, StepEvent, TreeDigest, LocatorState, Queries, QueryOptions, RoleQueryOptions, Selector, Snapshot, SnapshotNode, TextMatch, TextMatchOptions, TextQueryOptions, WaitOptions};

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
  };
}

/** A step that did not work, as the error a test sees: the driver's message, and what kind of failure it was. */
function failure(result: StepResult, platform: Platform, otherwise: HarnessCode): HarnessError {
  return new HarnessError(result.code ?? otherwise, result.message, {platform});
}

class Device {
  readonly config: DeviceConfig;
  /** The snapshots every wait shares, so waits at the same moment take one between them. */
  readonly feed: SnapshotFeed;
  /** The record of the current test's steps, for the evidence a failing test leaves. */
  readonly journal = new Journal();
  private driver: Driver | null = null;

  constructor(config: DeviceConfig) {
    this.config = config;
    this.feed = snapshotFeed(() => this.read({interactive: false}));
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
    };
  }

  get platform(): Platform {
    return this.config.platform;
  }

  /** How long a wait lasts, and how long an absence must hold, from the run's config. */
  get polling(): Polling {
    return {assertionTimeout: this.config.assertionTimeout ?? DEFAULT_POLLING.assertionTimeout, stable: this.config.stable ?? DEFAULT_POLLING.stable};
  }

  /** The driver, made on first use and kept for the file's tests; its steps wait for the screen to hold still. */
  async ready(): Promise<Driver> {
    if (this.driver) return this.driver;
    const driver = driverFor(this.config.platform, {root: ROOT, url: this.config.url, scheme: this.config.scheme, target: this.config.target, force: this.config.force});
    const state = await driver.available();
    if (!state.ready) throw new HarnessError('DRIVER_UNAVAILABLE', `no ${this.config.platform} device to drive: ${state.reason}`, {platform: this.config.platform});
    this.driver = invalidating(withTiming(driver, timingFor(DEFAULT_TIMING, {settle: this.config.settle, transition: this.config.transition})), this.feed);
    // What the app writes to its console goes in the journal, beside the steps.
    driver.onConsole?.((level, text) => this.journal.log(level, text));
    return this.driver;
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

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
    this.feed.invalidate();
  }
}

export const device = new Device(configFromEnvironment());

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

/** One element, found fresh each time it is acted on — a ref from an old tree is stale. */
export function element(selector: Selector) {
  return {
    selector,
    /** `{via: 'pointer'}` presses a Windows control with the pointer rather than through its pattern. */
    async press(options: PressOptions = {}): Promise<void> {
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

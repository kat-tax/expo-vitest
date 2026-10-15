/**
 * A locator: a query held, not yet run, as Playwright's are. Making one costs
 * nothing; each action and each read resolves it against the tree as it is
 * then, so a locator made before a screen changed still finds what is on it
 * after. An action waits for its node and is strict: a locator that names
 * several nodes cannot be pressed, and says which they were.
 */
import type {HarnessCode} from '../harness/lib/errors.ts';
import {HarnessError} from '../harness/lib/errors.ts';
import type {Clock} from '../harness/lib/settle.ts';
import type {Bounds, Point, Selector, Snapshot, SnapshotNode, Target} from '../harness/lib/snapshot.ts';
import type {Direction, Driver, FillOptions, LongPressOptions, Platform, PressOptions, StepResult, WebControls} from '../harness/lib/types.ts';
import type {Journal, StepEvent} from './evidence.ts';
import type {Polling, SnapshotFeed} from './polling.ts';
import {describeReadings, duration, poll} from './polling.ts';
import type {LocatorQuery, Refinement, TextMatch} from './queries.ts';
import {ambiguity, describeCandidate, describeQuery, nameOf, resolve, suggestions} from './queries.ts';

/** What a locator needs of the device it finds its nodes on. */
export interface LocatorHost {
  readonly platform: Platform;
  ready(): Promise<Driver>;
  /** The snapshots every wait on the device shares. */
  readonly feed: SnapshotFeed;
  /** How long a wait lasts, and how long an absence must hold. */
  readonly polling: Polling;
  /** The time the waits keep, where it is not the real one. */
  readonly clock?: Clock;
  /** Where the device records each step, for the evidence of a failing test. */
  readonly journal?: Journal;
}

/** How long an action or a wait looks for its node, in ms, over `assertionTimeout`. */
export interface WaitOptions {
  timeout?: number;
}

export type LocatorState = 'attached' | 'detached' | 'visible' | 'hidden';

const PRESSES = new Set(['Invoke', 'Toggle', 'SelectionItem']);

/**
 * What an action on a node is pointed at: its ref. Every backend can act on
 * one from the snapshot the node came from: agent-device keeps that
 * snapshot's refs until the next, the web driver keeps a ref for as long as
 * its element stays, and a Windows ref names the same node in every snapshot
 * of a screen.
 *
 * A Windows text has no pattern to press it by, so a press on one goes to the
 * control it sits in when that control has Invoke, and is pressed through the
 * pattern rather than with synthetic input, which needs a quiet desk.
 */
export function targetFor(node: SnapshotNode, snapshot: Snapshot): Selector {
  if (snapshot.platform !== 'windows' || node.patterns?.some(pattern => PRESSES.has(pattern))) return {ref: node.ref};
  const byRef = new Map(snapshot.nodes.map(each => [each.ref, each]));
  let up = node.parent === undefined ? undefined : byRef.get(node.parent);
  for (let hops = 0; up && !up.interactive && hops < snapshot.nodes.length; hops++) up = up.parent === undefined ? undefined : byRef.get(up.parent);
  return up?.interactive && up.patterns?.includes('Invoke') ? {ref: up.ref} : {ref: node.ref};
}

/**
 * The node in a later snapshot that `node` was in an earlier one: the one
 * with its ref, where that is still the same control, else the one in the
 * same place among the nodes alike, since on iOS and Android every snapshot
 * numbers its refs afresh.
 */
export function follow(node: SnapshotNode, before: Snapshot, after: Snapshot): SnapshotNode | undefined {
  const same = (each: SnapshotNode) => each.role === node.role && each.name === node.name && each.testId === node.testId;
  const byRef = after.nodes.find(each => each.ref === node.ref);
  if (byRef && same(byRef)) return byRef;
  const place = before.nodes.filter(same).indexOf(node);
  return place < 0 ? undefined : after.nodes.filter(same)[place];
}

/**
 * The path of a swipe across a node, the way the finger moves, over
 * `distance` of the node's length along that way, about its middle. A
 * finger drawn up scrolls the content down. At most nine tenths, so the
 * swipe starts and ends inside the node.
 */
export function swipePath(bounds: Bounds, direction: Direction, distance = 0.5): {from: Point; to: Point} {
  const x = Math.round(bounds.x + bounds.width / 2);
  const y = Math.round(bounds.y + bounds.height / 2);
  const share = Math.min(Math.max(distance, 0), 0.9) / 2;
  const across = Math.round(bounds.width * share);
  const along = Math.round(bounds.height * share);
  if (direction === 'up') return {from: {x, y: y + along}, to: {x, y: y - along}};
  if (direction === 'down') return {from: {x, y: y - along}, to: {x, y: y + along}};
  if (direction === 'left') return {from: {x: x + across, y}, to: {x: x - across, y}};
  return {from: {x: x - across, y}, to: {x: x + across, y}};
}

/**
 * The selector a backend can look for as it scrolls, for a query plain
 * enough to spell as one: a testID, or a whole text or label, with nothing
 * scoping or refining it. Null for anything else.
 */
export function selectorOf(query: LocatorQuery): Selector | null {
  const {predicate, match, options, scope, refinements} = query;
  if (scope || refinements.length > 0 || typeof match !== 'string' || options.exact === false || options.normalizer) return null;
  if (predicate === 'testId') return {testId: match};
  if (predicate === 'text' || predicate === 'label') return {label: match};
  return null;
}

/** How a check box's state reads in a message. */
function stateOf(checked: SnapshotNode['checked']): string {
  return checked === 'mixed' ? 'mixed' : checked ? 'checked' : 'unchecked';
}

/**
 * Where a locator keeps the device it was made on, for the matchers, which
 * wait on its snapshots and its config's times. A registered symbol, so a
 * second copy of this module, as after `vi.resetModules()` or in a project
 * that loads the package twice, reads the same key.
 */
const HOST = Symbol.for('expo-vitest.locator-host');

/** The device a locator was made on, or undefined for anything that is not a locator. */
export function hostOf(value: unknown): LocatorHost | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<symbol, LocatorHost | undefined>)[HOST] : undefined;
}

export class Locator {
  readonly query: LocatorQuery;
  private readonly host: LocatorHost;

  constructor(host: LocatorHost, query: LocatorQuery) {
    this.host = host;
    this.query = query;
    // Not enumerable, so a locator printed in a failed assertion shows its query, not the device.
    Object.defineProperty(this, HOST, {value: host});
  }

  /** The query as it was written, as a message names it. */
  toString(): string {
    return describeQuery(this.query);
  }

  /** The nodes this names in a snapshot, in its order. */
  resolve(snapshot: Snapshot): SnapshotNode[] {
    return resolve(this.query, snapshot);
  }

  private refined(...refinements: Refinement[]): Locator {
    return new Locator(this.host, {...this.query, refinements: [...this.query.refinements, ...refinements]});
  }

  first(): Locator {
    return this.refined({first: true});
  }

  last(): Locator {
    return this.refined({last: true});
  }

  /** The node at `index`, counting from 0, of those this names. */
  nth(index: number): Locator {
    return this.refined({nth: index});
  }

  /** Only the nodes with this text in them, or with a node inside that `has` names. */
  filter(options: {hasText?: TextMatch; has?: Locator}): Locator {
    return this.refined(...(options.hasText === undefined ? [] : [{hasText: options.hasText}]), ...(options.has ? [{has: options.has.query}] : []));
  }

  /** The host's clock for a wait, where it has one. */
  private timed(): {clock?: Clock} {
    return this.host.clock ? {clock: this.host.clock} : {};
  }

  private error(code: HarnessCode, message: string): HarnessError {
    return new HarnessError(code, message, {platform: this.host.platform});
  }

  /** At most one node, or the error that it is several. */
  private only(found: SnapshotNode[]): SnapshotNode | undefined {
    if (found.length > 1) throw this.error('LOCATOR_AMBIGUOUS', ambiguity(this.query, found));
    return found[0];
  }

  private notFound(snapshot: Snapshot, waited: number): HarnessError {
    return this.error('LOCATOR_NOT_FOUND', `${describeQuery(this.query)} matched nothing within ${duration(waited)}; the tree has ${snapshot.nodes.length} nodes; ${suggestions(this.query, snapshot)}`);
  }

  /**
   * The one node an action is for, waited for while there is none, or, for
   * an action that needs it, while it is disabled, as Playwright waits for a
   * control to be enabled. Several is an error at once: waiting would not
   * say which was meant. `anywhere` looks off screen too, while a message
   * still names the query as it was written.
   */
  private async one(timeout = this.host.polling.assertionTimeout, enabled = true, anywhere = false): Promise<{node: SnapshotNode; snapshot: Snapshot}> {
    const asked = anywhere ? {...this.query, options: {...this.query.options, hidden: true}} : this.query;
    const result = await poll(
      snapshot => ({snapshot, found: resolve(asked, snapshot)}),
      ({found}) => found.length > 1 || (found.length === 1 && (!enabled || (found[0] as SnapshotNode).enabled !== false)),
      {timeout, stable: 0, negated: false, feed: this.host.feed, ...this.timed()},
    );
    const {snapshot, found} = result.last;
    const node = this.only(found);
    if (!node) throw this.notFound(snapshot, timeout);
    if (!result.pass) throw this.error('NOT_ACTIONABLE', `${describeQuery(this.query)} found ${describeCandidate(node)}, and it stayed disabled for ${duration(timeout)}`);
    return {node, snapshot};
  }

  /**
   * A step a backend may have no counterpart for: `skipped` where it has
   * none, or, with `must`, the error that the platform cannot, since a test
   * that went on as if a context menu had opened would fail later for the
   * wrong reason.
   */
  private async optional(what: string, run: (driver: Driver) => Promise<StepResult> | undefined, must = false): Promise<'done' | 'skipped'> {
    const pending = run(await this.host.ready());
    const result = pending ? await pending : {ok: true, skipped: true, message: `${what} is not something the ${this.host.platform} harness can do`};
    if (!result.ok) throw this.error(result.code ?? 'ACTION_FAILED', result.message);
    if (!result.skipped) return 'done';
    if (must) throw this.error('UNSUPPORTED_CAPABILITY', result.message);
    return 'skipped';
  }

  /** A step in the device's journal, where it keeps one: what it did, this locator as written, the node it came to, and how the step ended. */
  private record<T>(event: StepEvent, node: SnapshotNode | undefined, work: () => Promise<T>, doing?: string): Promise<T> {
    const journal = this.host.journal;
    if (!journal) return work();
    const judged = (value: T) => (value === 'skipped' ? {result: 'skipped' as const, message: 'the platform has no counterpart'} : {result: 'ok' as const, message: ''});
    const what = doing ? `${doing} ${describeQuery(this.query)}` : describeQuery(this.query);
    return journal.run({event, what, ...(node ? {resolved: describeCandidate(node)} : {})}, work, judged);
  }

  /**
   * One of `device.web`'s actions, on this locator's one node, waited for
   * as a press waits, and recorded as a step that says `doing`. A test calls
   * it through `device.web`; off web it answers `'skipped'`.
   */
  async web(doing: string, run: (web: WebControls, target: Target) => Promise<StepResult>, options: WaitOptions = {}): Promise<'done' | 'skipped'> {
    if (this.host.platform !== 'web') return 'skipped';
    const {node} = await this.one(options.timeout);
    return this.record(
      'web',
      node,
      async () => {
        const driver = await this.host.ready();
        if (!driver.web) return 'skipped' as const;
        const result = await run(driver.web, {ref: node.ref});
        if (!result.ok) throw this.error(result.code ?? 'ACTION_FAILED', result.message);
        this.host.feed.invalidate();
        return 'done' as const;
      },
      doing,
    );
  }

  /** A step through the driver, as the error a test sees when it did not work. */
  private async act(run: (driver: Driver) => Promise<StepResult>): Promise<StepResult> {
    const result = await run(await this.host.ready());
    if (!result.ok) throw this.error(result.code ?? 'ACTION_FAILED', result.message);
    return result;
  }

  async press(options: PressOptions & WaitOptions = {}): Promise<void> {
    const {timeout, ...pressing} = options;
    const {node, snapshot} = await this.one(timeout);
    await this.record('press', node, () => this.act(driver => driver.press(targetFor(node, snapshot), pressing)));
  }

  /** Puts text in the field, in place of what it held. */
  async fill(text: string, options: FillOptions & WaitOptions = {}): Promise<void> {
    const {timeout, ...filling} = options;
    const {node} = await this.one(timeout);
    await this.record('fill', node, () => this.act(driver => driver.fill({ref: node.ref}, text, filling)));
  }

  /** Empties the field. */
  async clear(options: FillOptions & WaitOptions = {}): Promise<void> {
    const {timeout, ...filling} = options;
    const {node} = await this.one(timeout);
    await this.record('clear', node, () => this.act(driver => driver.fill({ref: node.ref}, '', filling)));
  }

  /** Presses the field to give it the focus, then types where the press put the caret. */
  async type(text: string, options: WaitOptions = {}): Promise<void> {
    const {node, snapshot} = await this.one(options.timeout);
    await this.record('type', node, async () => {
      await this.act(driver => driver.press(targetFor(node, snapshot)));
      await this.act(driver => driver.type(text));
    });
  }

  /** A press held for `duration` ms, as for a context menu; an error where the platform has none. */
  async longPress(options: LongPressOptions & WaitOptions = {}): Promise<void> {
    const {timeout, ...holding} = options;
    const {node, snapshot} = await this.one(timeout);
    await this.record('longPress', node, () => this.optional('a long press', driver => driver.longPress?.(targetFor(node, snapshot), holding), true));
  }

  /** The pointer over the node, without a press; `skipped` on a device, which has no pointer. */
  async hover(options: WaitOptions = {}): Promise<'done' | 'skipped'> {
    const {node} = await this.one(options.timeout, false);
    return this.record('hover', node, () => this.optional('a hover', driver => driver.hover?.({ref: node.ref})));
  }

  /** The keyboard focus on the node, without a press; an error where the platform cannot give it. */
  async focus(options: WaitOptions = {}): Promise<void> {
    const {node} = await this.one(options.timeout, false);
    await this.record('focus', node, () => this.optional('giving the focus', driver => driver.focus?.({ref: node.ref}), true));
  }

  /**
   * Scrolls the node onto the screen, where it is not there already, which
   * each backend tells for itself: a web node below the fold is not off
   * screen in the tree, since `offscreen` there means a node with no size.
   * It may be off screen to begin with, so it is looked for there too.
   */
  async scrollIntoView(options: WaitOptions = {}): Promise<'done' | 'skipped'> {
    return this.record('scroll', undefined, () => this.scrolled(options));
  }

  private async scrolled(options: WaitOptions): Promise<'done' | 'skipped'> {
    const selector = selectorOf(this.query);
    // A row of an Android list that is not drawn is not in the tree at all,
    // and agent-device finds it as it scrolls, down and then up.
    if (selector && resolve({...this.query, options: {...this.query.options, hidden: true}}, await this.host.feed.next()).length === 0) {
      const driver = await this.host.ready();
      if (!driver.scrollIntoView) return 'skipped';
      for (const direction of ['down', 'up'] as const) {
        const result = await driver.scrollIntoView(selector, {direction});
        if (result.ok) return result.skipped ? 'skipped' : 'done';
      }
    }
    const {node} = await this.one(options.timeout, false, true);
    const direction = node.bounds && node.bounds.y < 0 ? 'up' : 'down';
    return this.optional('scrolling into view', driver => driver.scrollIntoView?.({ref: node.ref}, {direction}));
  }

  /** A finger drawn across the node, the way `direction` says, over `distance` of it (half by default). */
  async swipe(direction: Direction, options: {distance?: number} & WaitOptions = {}): Promise<'done' | 'skipped'> {
    const {node} = await this.one(options.timeout, false);
    if (!node.bounds) throw this.error('NOT_ACTIONABLE', `${describeCandidate(node)} has no bounds to swipe across`);
    const {from, to} = swipePath(node.bounds, direction, options.distance);
    return this.record('swipe', node, () => this.optional('a swipe', driver => driver.swipe?.(from, to)));
  }

  /**
   * A named key pressed with the node focused, given the focus first where it
   * has not: `skipped` where the platform sends no keys or gives no focus.
   * Whether it sends keys is asked first, since on a device the focus is
   * given with a touch, which would press a button for nothing.
   */
  async key(name: string, options: WaitOptions = {}): Promise<'pressed' | 'skipped'> {
    const {node} = await this.one(options.timeout);
    return this.record('key', node, async () => {
      if (!(await this.host.ready()).key) return 'skipped';
      if (!node.focused && (await this.optional('giving the focus', driver => driver.focus?.({ref: node.ref}))) === 'skipped') return 'skipped';
      return (await this.optional(`the ${name} key`, driver => driver.key?.(name))) === 'done' ? 'pressed' : 'skipped';
    });
  }

  async check(options: PressOptions & WaitOptions = {}): Promise<void> {
    await this.setChecked(true, options);
  }

  async uncheck(options: PressOptions & WaitOptions = {}): Promise<void> {
    await this.setChecked(false, options);
  }

  /** Presses the control only if it is not already as asked, and fails if the press did not make it so. */
  private async setChecked(want: boolean, options: PressOptions & WaitOptions): Promise<void> {
    const {timeout, ...pressing} = options;
    const {node, snapshot} = await this.one(timeout);
    await this.record('check', node, async () => {
      if (node.checked === want) return;
      const verb = want ? 'check' : 'uncheck';
      if (node.checked === undefined) throw this.error('NOT_ACTIONABLE', `${describeCandidate(node)} reports no checked state, so there is nothing to ${verb}`);
      await this.act(driver => driver.press(targetFor(node, snapshot), pressing));
      const after = await poll(
        next => follow(node, snapshot, next),
        now => now?.checked === want,
        {timeout: timeout ?? this.host.polling.assertionTimeout, stable: 0, negated: false, feed: this.host.feed, ...this.timed()},
      );
      if (!after.pass) throw this.error('ACTION_FAILED', `pressed ${describeCandidate(node)} to ${verb} it, and it ${after.last ? `is still ${stateOf(after.last.checked)}` : 'is gone'}`);
    });
  }

  /**
   * Waits for the nodes to be in a state: `visible` (the default), on screen;
   * `attached`, in the tree at all; `hidden`, none on screen; `detached`, none
   * in the tree. Being gone must hold for `stable` ms, so a spinner that has
   * not come in yet does not count as gone. The node, or null for a state
   * that has none.
   */
  async waitFor(options: {state?: LocatorState} & WaitOptions = {}): Promise<SnapshotNode | null> {
    const found = await this.record('wait', undefined, () => this.waited(options));
    // A wait that ends is what shows the action before it took effect.
    this.host.journal?.verified(describeQuery(this.query));
    return found;
  }

  private async waited(options: {state?: LocatorState} & WaitOptions): Promise<SnapshotNode | null> {
    const {state = 'visible', timeout = this.host.polling.assertionTimeout} = options;
    const all = {...this.query, options: {...this.query.options, hidden: true}};
    const present = (snapshot: Snapshot) => resolve(all, snapshot).filter(node => state === 'attached' || state === 'detached' || node.offscreen !== true);
    const gone = state === 'hidden' || state === 'detached';
    const result = await poll(present, found => found.length > 0, {timeout, stable: this.host.polling.stable, negated: gone, feed: this.host.feed, ...this.timed()});
    if (gone) {
      if (result.pass) return null;
      const still = (found: SnapshotNode[]) => (found.length === 0 ? 'gone' : `there (${describeCandidate(found[0] as SnapshotNode)})`);
      throw this.error('ASSERTION_FAILED', `${describeQuery(this.query)} was not ${state} within ${duration(timeout)}: ${describeReadings(result, still)}`);
    }
    if (!result.pass) throw this.notFound(await this.host.feed.next(), timeout);
    return this.only(result.last) as SnapshotNode;
  }

  /** The node, now, or undefined; several is an error. */
  async node(): Promise<SnapshotNode | undefined> {
    return this.only(await this.all());
  }

  /** Every node this names, now. */
  async all(): Promise<SnapshotNode[]> {
    return resolve(this.query, await this.host.feed.next());
  }

  async count(): Promise<number> {
    return (await this.all()).length;
  }

  /** What the node is called, as a role's name is worked out; none is an error, as several is. */
  async text(): Promise<string> {
    const snapshot = await this.host.feed.next();
    const node = this.only(resolve(this.query, snapshot));
    if (!node) throw this.notFound(snapshot, 0);
    return nameOf(node, snapshot);
  }

  /** What the field holds: undefined where it holds nothing a platform reports, as a secure field does not. */
  async value(): Promise<string | undefined> {
    return (await this.node())?.value;
  }

  async isVisible(): Promise<boolean> {
    const node = await this.node();
    return node !== undefined && node.offscreen !== true;
  }

  async boundingBox(): Promise<Bounds | null> {
    return (await this.node())?.bounds ?? null;
  }
}

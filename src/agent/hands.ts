/**
 * The agent's hands on the device. Each action the model asks for is
 * resolved by the step's ref on the screen as it is now, checked against
 * the policy, sent to the driver with a limit of its own, and answered with
 * what changed since the model last looked. What it did is kept for the
 * cache, a secret by its name and a unique value as its slot.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Journal, StepEvent} from '../device/evidence.ts';
import {swipePath, targetFor} from '../device/locator.ts';
import {describeCandidate} from '../device/queries.ts';
import {scaleFactor} from '../device/screenshots.ts';
import {HarnessError} from '../harness/lib/errors.ts';
import type {HarnessCode} from '../harness/lib/errors.ts';
import {maskImage, resizeImage, scaleRect} from '../harness/lib/image.ts';
import {decodePng, encodePng} from '../harness/lib/png.ts';
import type {Bounds, Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import type {Direction, Driver, Platform, StepResult} from '../harness/lib/types.ts';
import type {RecordedAction} from './cache.ts';
import {targetOf, toSlots} from './cache.ts';
import {canFill, canNavigate, pixelsAllowed, secureMasks, taint, tainted} from './policy.ts';
import type {Redact} from './redact.ts';
import {redactor} from './redact.ts';
import type {SecretStore} from './secrets.ts';
import type {StepOf} from './step.ts';
import {endedBy} from './step.ts';
import type {ImagePart, Secret} from './types.ts';
import {diffViews, RefBook, renderView} from './view.ts';

/** What the hands act through: the device's driver and tree, its journal, and what it can do. */
export interface ActingHost {
  readonly platform: Platform;
  /** The device's driver, whose steps wait for the screen to hold still. */
  ready(): Promise<Driver>;
  /** The tree as it is now, read as the device reads it. */
  snapshot(): Promise<Snapshot>;
  /** Where the app is: the route on web. Absent where there is none to read. */
  route?(): Promise<string | undefined>;
  readonly journal?: Journal;
  readonly capabilities: ReadonlySet<string>;
  /** A folder for the screenshots taken on the way to a picture. */
  readonly scratch: string;
  /** The app's own scheme, which navigate may open. */
  readonly scheme?: string;
}

export interface HandsOptions {
  host: ActingHost;
  at: StepOf;
  /** The step's signal: an action stops waiting when it aborts. */
  signal: AbortSignal;
  secrets: SecretStore;
  /** The secrets in the step's params, the only ones type_secret may fill. */
  stepSecrets?: readonly Secret[];
  /** The step's unique values by param, which the record keeps as slots. */
  uniques?: Readonly<Record<string, string>>;
  /** Spends one of the step's actions, and throws once they are spent. */
  spend?: () => void;
  /** Where a filled secret's taint is kept: the test's. */
  taintStore?: object;
  maxObservationBytes?: number;
  screenshotMaxSide?: number;
  /** How long one action may take, in ms. */
  actionTimeout?: number;
}

/** How long one action may take before the model is told it did not finish, in ms. */
export const ACTION_TIMEOUT = 15_000;

/** The screen as the step read it. */
export interface Seen {
  /** The tree as the platform gave it. */
  platform: Snapshot;
  /** The tree under the step's refs, as the model reads it. */
  snapshot: Snapshot;
  platformRef: ReadonlyMap<string, string>;
  route?: string;
  /** The view, redacted. */
  view: string;
}

/** The node an action is on, under the step's ref and the platform's, on the screen it was found on. */
export interface Aimed {
  node: SnapshotNode;
  platformNode: SnapshotNode;
  seen: Seen;
}

/** One action, ready to send: how the journal names it, the driver call, and what the cache keeps of its input. */
interface Plan {
  event: StepEvent;
  what: string;
  /** The driver's call, or undefined where the driver has none. */
  call(driver: Driver): Promise<StepResult> | undefined;
  record: Record<string, unknown>;
  /** A look at the screen after, which throws where the action did not take. */
  check?(after: Seen): void;
}

const OPPOSITE: Record<Direction, Direction> = {up: 'down', down: 'up', left: 'right', right: 'left'};
const stateOf = (checked: SnapshotNode['checked']) => (checked === 'mixed' ? 'mixed' : checked ? 'checked' : 'unchecked');

/** The box of the whole screen: the viewport, else the largest node's bounds. */
function screenOf(snapshot: Snapshot): Bounds | undefined {
  if (snapshot.viewport) return {x: 0, y: 0, ...snapshot.viewport};
  const area = (bounds: Bounds) => bounds.width * bounds.height;
  return snapshot.nodes.reduce<Bounds | undefined>((largest, node) => (node.bounds && (!largest || area(node.bounds) > area(largest)) ? node.bounds : largest), undefined);
}

export class Hands {
  /** The actions done, for the cache, in order. */
  readonly recorded: RecordedAction[] = [];
  private readonly options: HandsOptions;
  private readonly book = new RefBook();
  private redact: Redact;
  private last: Seen | null = null;
  /** The last screenshot sent, for tap_at: its size, and tree units a pixel. */
  private shot: {width: number; height: number; toTree: number} | null = null;
  private shots = 0;

  constructor(options: HandsOptions) {
    this.options = options;
    this.redact = redactor(options.secrets.known());
  }

  /** What the model last saw, or null before it has looked. */
  get seen(): Seen | null {
    return this.last;
  }

  /** The screen as it is now, which becomes what the model last saw. */
  async observe(): Promise<Seen> {
    this.last = await this.read();
    return this.last;
  }

  /** Text with every secret value hidden, as anything the hands hand back is. */
  hide(text: string): string {
    return this.redact(text);
  }

  /**
   * A picture of the screen as the model may see it: each secure field
   * painted over, the long side at most `screenshotMaxSide`. Withheld,
   * with the reason, after a secret was filled or where a secure field has
   * no bounds to paint over.
   */
  async screenshot(): Promise<ImagePart | {withheld: string}> {
    const {host, taintStore, screenshotMaxSide = 768} = this.options;
    const seen = await this.read();
    // The step's nodes, so a reason names the ref the model knows; their bounds are the platform's.
    const verdict = pixelsAllowed({tainted: tainted(taintStore), canScreenshot: host.capabilities.has('screenshot'), nodes: seen.snapshot.nodes});
    if (!verdict.allowed) return {withheld: verdict.why};
    fs.mkdirSync(host.scratch, {recursive: true});
    this.shots += 1;
    const file = path.join(host.scratch, `agent-${process.pid}-${this.shots}.png`);
    const result = await (await host.ready()).screenshot(file);
    if (!result.ok || result.skipped) return {withheld: this.redact(result.message)};
    // The picture as taken has the secure fields in it, so it is read and gone at once.
    const taken = fs.readFileSync(file);
    fs.rmSync(file, {force: true});
    const image = decodePng(taken);
    const factor = scaleFactor(image.width, seen.platform.viewport);
    const masks = secureMasks(seen.snapshot.nodes).map(bounds => scaleRect(bounds, factor));
    const small = resizeImage(maskImage(image, masks), screenshotMaxSide);
    this.shot = {width: small.width, height: small.height, toTree: image.width / small.width / factor};
    return {type: 'image', mediaType: 'image/png', data: encodePng(small).toString('base64'), width: small.width, height: small.height};
  }

  tap(ref: string): Promise<string> {
    return this.on(ref, 'tap', {});
  }

  longPress(ref: string, durationMs?: number | null): Promise<string> {
    return this.on(ref, 'long_press', {durationMs: durationMs ?? 800});
  }

  /** Text into a field: in place of what it holds, or after it. */
  type(ref: string, text: string, replace: boolean): Promise<string> {
    return this.on(ref, 'type', {text, replace});
  }

  /** A secret of the step into a field, by its name; the value is the runner's alone. */
  typeSecret(ref: string, secret: string): Promise<string> {
    return this.on(ref, 'type_secret', {secret});
  }

  /** A checkbox, a switch or a radio set as asked, pressed only where it is not so already. */
  check(ref: string, checked: boolean): Promise<string> {
    return this.on(ref, 'check', {checked});
  }

  /** A named key where the focus is. */
  press(key: string): Promise<string> {
    return this.perform('press', undefined, {key});
  }

  /** More of the screen, or of a node, shown in a direction: down shows what is below. */
  scroll(direction: Direction, ref?: string | null): Promise<string> {
    return ref ? this.on(ref, 'scroll', {direction}) : this.perform('scroll', undefined, {direction});
  }

  /** A node scrolled into view: one the step has a ref for, or one with a text. */
  scrollTo(target: {ref?: string | null; text?: string | null}): Promise<string> {
    if (target.ref) return this.on(target.ref, 'scroll_to', {});
    if (target.text) return this.perform('scroll_to', undefined, {text: target.text});
    return Promise.reject(this.error('INVALID_ARGUMENT', 'scroll_to takes a ref or a text'));
  }

  navigate(url: string): Promise<string> {
    return this.perform('navigate', undefined, {url});
  }

  back(): Promise<string> {
    return this.perform('back', undefined, {});
  }

  dismissKeyboard(): Promise<string> {
    return this.perform('dismiss_keyboard', undefined, {});
  }

  /** A press at a point of the last screenshot, in its pixels. */
  tapAt(x: number, y: number): Promise<string> {
    if (tainted(this.options.taintStore)) return Promise.reject(this.error('POLICY_DENIED', 'a secret was filled in this test, so the pixel tools are off'));
    if (!this.shot) return Promise.reject(this.error('INVALID_ARGUMENT', 'tap_at presses a point of the last screenshot, and none has been taken'));
    const {width, height, toTree} = this.shot;
    if (x < 0 || y < 0 || x > width || y > height) return Promise.reject(this.error('INVALID_ARGUMENT', `${x},${y} is outside the last screenshot, which is ${width} by ${height}`));
    return this.perform('tap_at', undefined, {x: Math.round(x * toTree), y: Math.round(y * toTree)});
  }

  /** The node a ref names on the screen now. */
  async aim(ref: string): Promise<Aimed> {
    const seen = await this.read();
    const node = seen.snapshot.nodes.find(each => each.ref === ref);
    if (!node) throw this.error('LOCATOR_NOT_FOUND', `${ref} is not on the screen now; observe to see what is`);
    const platformNode = seen.platform.nodes.find(each => each.ref === seen.platformRef.get(ref)) as SnapshotNode;
    return {node, platformNode, seen};
  }

  /**
   * One action, on the node it is aimed at where it has one: planned, an
   * action spent, sent through the journal and the driver, and answered with
   * what changed since the model last looked. The replay sends its actions
   * here too, so a replayed step and the model's take the same path.
   */
  async perform(tool: string, aimed: Aimed | undefined, input: Record<string, unknown>): Promise<string> {
    const plan = await this.plan(tool, aimed, input);
    if (typeof plan === 'string') return plan;
    this.options.spend?.();
    const {host} = this.options;
    const before = this.last ?? aimed?.seen ?? (await this.read());
    const work = async () => {
      const pending = plan.call(await host.ready());
      if (!pending) throw this.error('UNSUPPORTED_CAPABILITY', `${tool} is not something the ${host.platform} harness can do`);
      const result = await this.limited(pending, plan.what);
      if (!result.ok) throw this.error(result.code ?? 'ACTION_FAILED', this.redact(result.message));
      if (result.skipped) throw this.error('UNSUPPORTED_CAPABILITY', this.redact(result.message));
    };
    const step = {event: plan.event, what: `agent: ${plan.what}`, ...(aimed ? {resolved: describeCandidate(aimed.platformNode)} : {})};
    await (host.journal ? host.journal.run(step, work) : work());
    const after = await this.observe();
    const changes = this.changes(before, after);
    plan.check?.(after);
    this.recorded.push({tool, ...(aimed ? {target: targetOf(aimed.node, aimed.seen.snapshot)} : {}), input: plan.record});
    return changes;
  }

  private on(ref: string, tool: string, input: Record<string, unknown>): Promise<string> {
    return this.aim(ref).then(aimed => this.perform(tool, aimed, input));
  }

  private error(code: HarnessCode, message: string): HarnessError {
    return new HarnessError(code, message, {platform: this.options.host.platform});
  }

  private async read(): Promise<Seen> {
    const {host, maxObservationBytes} = this.options;
    const platform = await host.snapshot();
    const {snapshot, platformRef} = this.book.relabel(platform);
    const route = await host.route?.();
    const view = this.redact(renderView(snapshot, {...(route ? {route} : {}), ...(maxObservationBytes ? {maxBytes: maxObservationBytes} : {})}));
    return {platform, snapshot, platformRef, ...(route ? {route} : {}), view};
  }

  private changes(before: Seen, after: Seen): string {
    const {maxObservationBytes} = this.options;
    const options = (seen: Seen) => ({...(seen.route ? {route: seen.route} : {}), ...(maxObservationBytes ? {maxBytes: maxObservationBytes} : {})});
    return this.redact(diffViews(before.snapshot, after.snapshot, {before: options(before), after: options(after)}).text);
  }

  /** A driver call, given up on after the action's limit, or when the step's signal aborts. */
  private limited(pending: Promise<StepResult>, what: string): Promise<StepResult> {
    const {signal, at, actionTimeout = ACTION_TIMEOUT} = this.options;
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', ended);
      };
      const ended = () => {
        stop();
        reject(endedBy(signal, at));
      };
      const timer = setTimeout(() => {
        stop();
        reject(this.error('ACTION_FAILED', `${what} did not finish in ${actionTimeout / 1000} s`));
      }, actionTimeout);
      if (signal.aborted) ended();
      else signal.addEventListener('abort', ended, {once: true});
      pending.then(
        value => {
          stop();
          resolve(value);
        },
        (error: unknown) => {
          stop();
          reject(error);
        },
      );
    });
  }

  /** What an action does, checked against the policy first; a string where nothing needs doing. */
  private async plan(tool: string, aimed: Aimed | undefined, input: Record<string, unknown>): Promise<Plan | string> {
    const {host, uniques = {}} = this.options;
    const on = aimed as Aimed;
    const at = () => targetFor(on.platformNode, on.seen.platform);
    const field = () => ({ref: on.platformNode.ref});
    const ref = aimed?.node.ref;
    switch (tool) {
      case 'tap':
        return {event: 'press', what: `tap ${ref}`, call: driver => driver.press(at()), record: {}};
      case 'long_press': {
        const duration = input.durationMs as number;
        return {event: 'longPress', what: `long_press ${ref}`, call: driver => driver.longPress?.(at(), {duration}), record: {durationMs: duration}};
      }
      case 'type': {
        const {text, replace} = input as {text: string; replace: boolean};
        const record = {text: toSlots(text, uniques), replace};
        const shown = JSON.stringify(this.redact(text));
        if (replace) return {event: 'fill', what: `type ${ref} ${shown}`, call: driver => driver.fill(field(), text), record};
        return {event: 'type', what: `type ${ref} ${shown} after what it holds`, call: driver => driver.press(at()).then(pressed => (pressed.ok ? driver.type(text) : pressed)), record};
      }
      case 'type_secret': {
        const name = input.secret as string;
        const {stepSecrets = [], secrets, taintStore} = this.options;
        const handle = stepSecrets.find(each => each.name === name);
        if (!handle) throw this.error('POLICY_DENIED', `the secret ${name} is not one of this step's params, and only those can be filled`);
        const verdict = canFill(on.node, handle, stepSecrets.map(each => each.name));
        if (!verdict.allowed) throw this.error('POLICY_DENIED', verdict.why);
        const value = await secrets.valueOf(name);
        // A value a function answered is new to the redactor.
        this.redact = redactor(secrets.known());
        const fill = (driver: Driver) => {
          taint(taintStore);
          return driver.fill(field(), value);
        };
        return {event: 'fill', what: `type_secret ${ref} <secret:${name}>`, call: fill, record: {secret: name}};
      }
      case 'check': {
        const want = input.checked as boolean;
        const verb = want ? 'check' : 'uncheck';
        if (on.node.checked === want) return `${ref} is ${stateOf(want)} already, so nothing was pressed`;
        if (on.node.checked === undefined) throw this.error('NOT_ACTIONABLE', `${ref} reports no checked state, so there is nothing to ${verb}`);
        const took = (after: Seen) => {
          const now = after.snapshot.nodes.find(each => each.ref === ref);
          if (now?.checked !== want) throw this.error('ACTION_FAILED', `pressed ${ref} to ${verb} it, and it ${now ? `is still ${stateOf(now.checked)}` : 'is gone'}`);
        };
        return {event: 'check', what: `check ${ref} ${want}`, call: driver => driver.press(at()), record: {checked: want}, check: took};
      }
      case 'press': {
        const key = input.key as string;
        return {event: 'key', what: `press ${key}`, call: driver => driver.key?.(key), record: {key}};
      }
      case 'scroll': {
        const direction = input.direction as Direction;
        const bounds = aimed ? aimed.platformNode.bounds : screenOf((this.last ?? (await this.read())).platform);
        if (!bounds) throw this.error('NOT_ACTIONABLE', `${ref ?? 'the screen'} has no bounds to scroll across`);
        // A finger drawn up shows what is below.
        const {from, to} = swipePath(bounds, OPPOSITE[direction]);
        return {event: 'swipe', what: `scroll ${direction}${ref ? ` ${ref}` : ''}`, call: driver => driver.swipe?.(from, to), record: {direction}};
      }
      case 'scroll_to': {
        if (aimed) {
          const direction = aimed.platformNode.bounds && aimed.platformNode.bounds.y < 0 ? 'up' : 'down';
          return {event: 'scroll', what: `scroll_to ${ref}`, call: driver => driver.scrollIntoView?.(field(), {direction}), record: {}};
        }
        const text = input.text as string;
        // A row of a list that is not drawn is not in the tree, so it is looked for below, then above.
        const find = (driver: Driver) => {
          const into = driver.scrollIntoView?.bind(driver);
          return into?.({label: text}, {direction: 'down'}).then(down => (down.ok ? down : into({label: text}, {direction: 'up'})));
        };
        return {event: 'scroll', what: `scroll_to ${JSON.stringify(this.redact(text))}`, call: find, record: {text: toSlots(text, uniques)}};
      }
      case 'navigate': {
        const url = input.url as string;
        // A route of the app's own is resolved against where it is served.
        if (!url.startsWith('/')) {
          const verdict = canNavigate(url, host.scheme);
          if (!verdict.allowed) throw this.error('POLICY_DENIED', verdict.why);
        }
        return {event: 'open', what: `navigate ${this.redact(url)}`, call: driver => driver.open(url), record: {url: toSlots(url, uniques)}};
      }
      case 'back':
        return {event: 'control', what: 'back', call: driver => driver.control?.({name: 'back'}), record: {}};
      case 'dismiss_keyboard':
        return {event: 'control', what: 'dismiss_keyboard', call: driver => driver.control?.({name: 'dismissKeyboard'}), record: {}};
      case 'tap_at': {
        const point = {x: input.x as number, y: input.y as number};
        return {event: 'press', what: `tap_at ${point.x},${point.y}`, call: driver => driver.press(point), record: point};
      }
      default:
        throw this.error('INVALID_ARGUMENT', `${tool} is not one of the agent's actions`);
    }
  }
}

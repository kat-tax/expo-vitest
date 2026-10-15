import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {HarnessError, codeOf} from '../lib/errors.ts';
import type {PatternAnswer} from '../lib/patterns.ts';
import {afterFill, afterPress, chooseFill, choosePress} from '../lib/patterns.ts';
import {desk, fileStore, refusal} from '../lib/quiet.ts';
import {kindOnWindows, withKinds} from '../lib/roles.ts';
import type {Ran} from '../lib/run.ts';
import {firstLine, powershell, prepare, run} from '../lib/run.ts';
import type {Point, Snapshot, SnapshotNode, Target} from '../lib/snapshot.ts';
import {asSelector, centreOf, describeTarget, findNode, isPoint, seenInstead} from '../lib/snapshot.ts';
import type {Availability, Driver, DriverOptions, FillOptions, LongPressOptions, PressOptions, SnapshotOptions, StepResult} from '../lib/types.ts';
import {elsewhere, failed, ok} from '../lib/types.ts';
import {metroFrom, readReact} from '../lib/metro.ts';
import type {ReactTree} from '../lib/react.ts';
import type {HostChild} from './windows-host.ts';
import {windowsHost} from './windows-host.ts';
import {CLEAR, SEND_KEYS, literal} from './windows-keys.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'windows');

/** Where a built app tends to be, when nobody said. */
const GUESSES = ['example/windows/x64/Release', 'example/windows/x64/Debug', 'windows/x64/Release', 'windows/x64/Debug'];

function findExe(root: string): string | null {
  for (const guess of GUESSES) {
    const directory = path.join(root, guess);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(directory).filter(entry => entry.endsWith('.exe'));
    } catch {
      continue;
    }
    const exe = entries.find(entry => !/^(vc_redist|WindowsAppRuntime)/i.test(entry));
    if (exe) return path.join(directory, exe);
  }
  return null;
}

function script(name: string): string {
  return path.join(SCRIPTS, name);
}

/** The tree as the host or `snapshot.ps1` writes it. */
interface RawTree {
  process: string;
  nodes?: Record<string, unknown>[];
}

/**
 * What the driver needs done on the desktop, by one of two means: the host, a
 * PowerShell process kept for the driver's life that reads the tree in one
 * cached request, or a PowerShell script started for each step, which
 * `HARNESS_WINDOWS_HOST=0` picks. Each throws with the reason when a step
 * fails, and the driver words the result.
 */
interface Backend {
  readonly description: string;
  /**
   * Whether this is the host, which keeps the newest snapshot to act on and
   * can hold a press, move the pointer alone and give the focus. A script per
   * step can do none of those, so they are skipped on it.
   */
  readonly host: boolean;
  /** Whether the app has a window; throws only when the means itself cannot run. */
  hasWindow(): Promise<boolean>;
  snapshot(interactive: boolean): Promise<RawTree>;
  raise(): Promise<string>;
  /** A press at a point in the window's own pixels. */
  click(point: Point): Promise<string>;
  /** A press held at a point for `ms`; null where the means cannot hold one. */
  hold(point: Point, ms: number): Promise<string | null>;
  /** The pointer moved to a point, without a press; null where the means cannot. */
  move(point: Point): Promise<string | null>;
  keys(keys: string): Promise<string>;
  screen(out: string): Promise<string>;
  idle(): Promise<number | null>;
  /**
   * A control of the newest snapshot driven through a UI Automation pattern,
   * with whether its state was seen to change. Null where the means has no
   * patterns to offer or the call failed: the press then uses the pointer.
   */
  act(ref: string, way: 'invoke' | 'toggle' | 'select' | 'scrollInto'): Promise<PatternAnswer | null>;
  /** The keyboard focus given to a control of the newest snapshot, with whether it took it; null as for `act`. */
  focus(ref: string): Promise<PatternAnswer | null>;
  /** Text set through a field's Value pattern, with what it reads back after; null as for `act`. */
  setValue(ref: string, text: string): Promise<PatternAnswer | null>;
  close(): Promise<void>;
}

function startHost(): HostChild {
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script('host.ps1'), '-Source', script('host.cs')], {windowsHide: true});
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

function hostBackend(processName: string): Backend {
  const host = windowsHost({start: startHost});
  const windowed = processName ? {process: processName} : {};
  return {
    description: 'the Windows host',
    host: true,
    async hasWindow() {
      // The first request starts the host and compiles it, which is the one slow step.
      await host.request('hello', {}, 60_000);
      try {
        await host.request('rect', {process: processName});
        return true;
      } catch (error) {
        if ((error as Error).message.startsWith('no window for')) return false;
        throw error;
      }
    },
    snapshot: interactive => host.request<RawTree>('snapshot', {process: processName, interactive, max: 400}, 30_000),
    raise: () => host.request<string>('raise', {process: processName}),
    click: point => host.request<string>('click', {...windowed, points: [[point.x, point.y]]}),
    hold: (point, ms) => host.request<string>('hold', {...windowed, x: point.x, y: point.y, ms}, 30_000),
    move: point => host.request<string>('move', {...windowed, x: point.x, y: point.y}),
    keys: keys => host.request<string>('keys', {...windowed, keys}, 30_000),
    screen: out => host.request<string>('screen', {...windowed, out}, 30_000),
    async idle() {
      // A check that fails says the desk is in use, so a broken one never lets synthetic input through.
      return host.request<number>('idle').catch(() => 0);
    },
    // A call that fails, as on a disabled control, is no answer: the press goes on with the pointer.
    act: (ref, way) => host.request<PatternAnswer>(way, {ref}).catch(() => null),
    setValue: (ref, text) => host.request<PatternAnswer>('setValue', {ref, text}).catch(() => null),
    // A control that cannot take the focus throws, and says so.
    focus: ref => host.request<PatternAnswer>('focus', {ref}),
    close: () => host.close(),
  };
}

function scriptBackend(processName: string): Backend {
  /** The script's reason, or its output when it gave none. */
  function said(ran: Ran): string {
    return firstLine(ran.stderr) || firstLine(ran.stdout);
  }
  function check(ran: Ran, otherwise?: string): string {
    if (!ran.ok) throw new Error(said(ran) || otherwise || 'the script failed');
    return firstLine(ran.stdout);
  }
  const windowed = processName ? ['-Process', processName] : [];
  return {
    description: 'a PowerShell script per step',
    host: false,
    async hasWindow() {
      const result = run('powershell', ['-NoProfile', '-Command', `@(Get-Process -Name '${processName}' -ErrorAction SilentlyContinue).Count`]);
      return Number(firstLine(result.stdout)) > 0;
    },
    async snapshot(interactive) {
      const result = powershell(script('snapshot.ps1'), ['-Process', processName, ...(interactive ? ['-Interactive'] : [])]);
      check(result);
      return JSON.parse(result.stdout) as RawTree;
    },
    async raise() {
      return check(powershell(script('raise.ps1'), ['-Process', processName]), 'could not raise the window');
    },
    async click(point) {
      return check(powershell(script('input.ps1'), ['-Points', `${point.x},${point.y}`, ...windowed]));
    },
    async keys(keys) {
      return check(powershell(script('input.ps1'), ['-Keys', keys, ...windowed]));
    },
    async screen(out) {
      return check(powershell(script('screen.ps1'), ['-Out', out, ...windowed]));
    },
    async idle() {
      const seconds = Number(firstLine(powershell(script('idle.ps1')).stdout));
      return Number.isFinite(seconds) ? seconds : null;
    },
    // A script per step keeps no snapshot to act on, so every press is synthetic.
    act: async () => null,
    setValue: async () => null,
    focus: async () => null,
    // Nor does input.ps1 hold a press or move the pointer alone.
    hold: async () => null,
    move: async () => null,
    async close() {},
  };
}

/**
 * A node with what PowerShell wrote as null left out: the node shape says a
 * field is there or not, and its absence is the finding. `bounds` keeps its
 * null, as every platform's does.
 */
function present(node: Record<string, unknown>): SnapshotNode {
  return Object.fromEntries(Object.entries(node).filter(([key, value]) => value !== null || key === 'bounds')) as unknown as SnapshotNode;
}

export interface WindowsDriver extends Driver {
  /** Brings the app to the front, which synthetic input needs and screenshots do not. */
  raise(): Promise<StepResult>;
}

export function isWindowsDriver(driver: Driver): driver is WindowsDriver {
  return driver.platform === 'windows' && 'raise' in driver;
}

/**
 * The Windows harness: a built app driven through the window manager, because
 * there is no remote protocol into a react-native-windows app. Screenshots are
 * the window drawing itself; presses go through a control's UI Automation
 * pattern where that is seen to work, and are synthetic input otherwise; the
 * tree comes from UI Automation, which is what Narrator reads.
 *
 * It answers `agent-device`'s shape — snapshot, press, fill — because
 * `agent-device` has no Windows backend and a test should not have to care
 * which of the two is underneath.
 *
 * Synthetic input goes to whatever is in front. If the user is at the desk it
 * lands in their window instead, so the driver checks how long the machine
 * has been quiet before it sends any, and refuses while someone is using it
 * unless it was made with `force`.
 */
export function windowsDriver(options: DriverOptions): WindowsDriver {
  const target = options.target ?? findExe(options.root) ?? '';
  const isExe = target.toLowerCase().endsWith('.exe');
  const exe = isExe ? path.resolve(options.root, target) : '';
  const processName = isExe ? path.basename(exe, '.exe') : target;
  const backend = process.env.HARNESS_WINDOWS_HOST === '0' ? scriptBackend(processName) : hostBackend(processName);
  // Kept under .harness/ too, since each device test file makes a driver of its own.
  const quiet = desk(fileStore(path.join(options.root, '.harness', 'windows-desk.json')));

  async function snapshot(snapshotOptions: SnapshotOptions = {}): Promise<Snapshot> {
    let tree: RawTree;
    try {
      tree = await backend.snapshot(Boolean(snapshotOptions.interactive));
    } catch (error) {
      throw new HarnessError('ACTION_FAILED', `could not read the tree of ${processName}: ${(error as Error).message}`, {platform: 'windows', cause: error});
    }
    return {platform: 'windows', source: tree.process, nodes: withKinds((tree.nodes ?? []).map(present), kindOnWindows)};
  }

  /**
   * What a target names, resolved against a fresh tree: the node, which the
   * host keeps until the next snapshot so a pattern can act on it, and the
   * point a synthetic press would land on.
   */
  async function pointFor(what: Target): Promise<{point: Point; note: string; node?: SnapshotNode}> {
    const selector = asSelector(what);
    if (isPoint(selector)) return {point: selector, note: `${selector.x},${selector.y}`};
    const tree = await snapshot();
    const node = findNode(tree, selector);
    if (!node) {
      const instead = seenInstead(tree, selector);
      throw new HarnessError('LOCATOR_NOT_FOUND', `nothing matches ${describeTarget(what)} in the window (${tree.nodes.length} nodes)${instead ? `; ${instead}` : ''}`, {platform: 'windows'});
    }
    const point = centreOf(node);
    if (!point) throw new HarnessError('NOT_ACTIONABLE', `${node.ref} ${node.role} ${JSON.stringify(node.name)} has no bounds to press`, {platform: 'windows'});
    return {point, note: `${node.ref} ${node.role} ${JSON.stringify(node.name)}`, node};
  }

  /**
   * The refusal of a step that sends synthetic input, while someone is using
   * the machine, or null when it may go. Asked right before the input, after
   * the target is found, so the gap a person could come back in is as short
   * as it can be.
   */
  async function refused(what: string): Promise<StepResult | null> {
    const reason = refusal(what, quiet.quiet(await backend.idle()), Boolean(options.force));
    return reason ? failed(reason) : null;
  }

  /** Synthetic input, with when it was sent, so the desk can tell it from a person's. */
  async function sending<T>(send: () => Promise<T>): Promise<T> {
    const from = Date.now();
    try {
      return await send();
    } finally {
      quiet.sent(from, Date.now());
    }
  }

  async function click(point: Point): Promise<StepResult> {
    // Synthetic input goes to the foreground window, so the app has to be it.
    // A test should not have to remember that, and a press into whatever
    // happens to be in front is the failure this whole harness exists to avoid.
    if (processName) await backend.raise().catch(() => {});
    try {
      return ok(await sending(() => backend.click(point)));
    } catch (error) {
      return failed(`press failed: ${(error as Error).message}`);
    }
  }

  async function keys(sent: string): Promise<string | Error> {
    try {
      return await sending(() => backend.keys(sent));
    } catch (error) {
      return error as Error;
    }
  }

  return {
    platform: 'windows',

    async available(): Promise<Availability> {
      if (process.platform !== 'win32') return {ready: false, reason: 'this is not a Windows machine'};
      if (!processName) return {ready: false, reason: 'no app to drive: build one (`expo-windows run`) and pass --target <exe or process name>'};
      let running: boolean;
      try {
        running = await backend.hasWindow();
      } catch (error) {
        return {ready: false, reason: `${(error as Error).message}; HARNESS_WINDOWS_HOST=0 drives the app with a PowerShell script per step instead`};
      }
      if (!running) {
        const where = exe ? path.relative(options.root, exe) : processName;
        return {ready: false, found: where, reason: `${processName} is not running${exe ? `; start ${where}` : ''}`};
      }
      return {ready: true, found: `${processName} is running, driven through ${backend.description}`};
    },

    async open(to: string): Promise<StepResult> {
      // A second launch with the link as its argument: the app's single-instance
      // check redirects it to the window already open, as React Native's `url` event.
      const url = /^[a-z]+:/i.test(to) ? to : `${options.scheme ?? processName.toLowerCase()}://${to.replace(/^\//, '')}`;
      if (!exe) return failed(`cannot open ${url}: no exe to launch (pass --target <exe>)`, 'APP_UNREACHABLE');
      const child = spawn(exe, [url], {cwd: path.dirname(exe), detached: true, stdio: 'ignore'});
      child.unref();
      return ok(`sent ${url} to ${processName}`);
    },

    snapshot,

    async press(what: Target, pressOptions: PressOptions = {}): Promise<StepResult> {
      try {
        const {point, note, node} = await pointFor(what);
        // Through the control's own pattern where it has one: no pointer, no
        // window brought to the front, no desk to wait on. It stands only
        // where it shows (`afterPress`), and the pointer presses otherwise.
        let left = '';
        const way = choosePress(node?.patterns, pressOptions.via);
        if (node && way !== 'pointer') {
          const answer = await backend.act(node.ref, way);
          const next = afterPress(answer);
          if (next === 'verified') return {...ok(`pressed ${note} through ${answer?.pattern}`), verified: true};
          if (next === 'done') return ok(`pressed ${note} through ${answer?.pattern}`);
          if (answer?.pattern) left = `its ${answer.pattern} left it as it was`;
        }
        const refusing = await refused('a press');
        if (refusing) return left ? failed(`${note}: ${left}; ${refusing.message}`) : refusing;
        const result = await click(point);
        if (!result.ok) return result;
        return ok(left ? `pressed ${note} with the pointer, since ${left}` : `pressed ${note}`);
      } catch (error) {
        return failed((error as Error).message, codeOf(error));
      }
    },

    react(): Promise<ReactTree | {unavailable: string}> {
      // A debug build's, through Metro's inspector, which react-native-windows builds into its host.
      return readReact({...metroFrom(process.env), ...(processName ? {target: processName} : {})});
    },

    async longPress(what: Target, pressOptions: LongPressOptions = {}): Promise<StepResult> {
      if (!backend.host) return elsewhere('a long press', 'windows', 'it needs the Windows host, which HARNESS_WINDOWS_HOST=0 turns off');
      try {
        const {point, note} = await pointFor(what);
        const refusing = await refused('a long press');
        if (refusing) return refusing;
        // Pointer input lands on the window at the point, so the app has to be in front.
        if (processName) await backend.raise().catch(() => {});
        const held = pressOptions.duration ?? 800;
        await sending(() => backend.hold(point, held));
        return ok(`held ${note} for ${held} ms`);
      } catch (error) {
        return failed(`long press failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    async hover(what: Target): Promise<StepResult> {
      if (!backend.host) return elsewhere('a hover', 'windows', 'it needs the Windows host, which HARNESS_WINDOWS_HOST=0 turns off');
      try {
        const {point, note} = await pointFor(what);
        const refusing = await refused('moving the pointer');
        if (refusing) return refusing;
        if (processName) await backend.raise().catch(() => {});
        await sending(() => backend.move(point));
        return ok(`hovered over ${note}`);
      } catch (error) {
        return failed(`hover failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    async focus(what: Target): Promise<StepResult> {
      if (!backend.host) return elsewhere('giving the focus', 'windows', 'it needs the Windows host, which HARNESS_WINDOWS_HOST=0 turns off');
      try {
        // Through UI Automation, which needs no quiet desk and no window in front.
        const {note, node} = await pointFor(what);
        if (!node) return failed(`a point cannot be given the focus; name a node`, 'INVALID_ARGUMENT');
        const answer = await backend.focus(node.ref);
        return answer?.changed ? {...ok(`focused ${note}`), verified: true} : failed(`${note} did not take the focus`, 'NOT_ACTIONABLE');
      } catch (error) {
        return failed(`focus failed: ${(error as Error).message}`, 'NOT_ACTIONABLE');
      }
    },

    async scrollIntoView(what: Target): Promise<StepResult> {
      if (!backend.host) return elsewhere('scrolling a control into view', 'windows', 'it needs the Windows host, which HARNESS_WINDOWS_HOST=0 turns off');
      try {
        // Through the control's ScrollItem pattern, which every react-native-windows view offers.
        const {note, node} = await pointFor(what).catch(error => {
          // A node off screen has no point to press, but can still be scrolled to.
          if ((error as {code?: string}).code !== 'NOT_ACTIONABLE') throw error;
          return {note: describeTarget(what), node: undefined as SnapshotNode | undefined};
        });
        if (node && node.offscreen !== true) return ok(`${note} was on screen already`);
        const selector = asSelector(what);
        const ref = node?.ref ?? (isPoint(selector) ? undefined : selector.ref);
        if (!ref) return failed(`${note} cannot be scrolled to: name a node`, 'INVALID_ARGUMENT');
        const answer = await backend.act(ref, 'scrollInto');
        if (answer?.pattern) return ok(`scrolled ${note} into view through ScrollItem`);
        return failed(`${note} ${answer?.unsupported ? 'has no ScrollItem pattern' : 'could not be scrolled into view'}`, 'NOT_ACTIONABLE');
      } catch (error) {
        return failed(`scrolling failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    async fill(what: Target, text: string, fillOptions: FillOptions = {}): Promise<StepResult> {
      try {
        const {point, note, node} = await pointFor(what);
        // Through the field's Value pattern, which replaces what it held, as a
        // fill does in Playwright, and reads it back; by clicking and typing
        // where the field has no Value or stayed as it was.
        let left = '';
        if (node && chooseFill(node.patterns, fillOptions.via) === 'setValue') {
          const answer = await backend.setValue(node.ref, text);
          const next = afterFill(answer);
          if (next === 'readOnly') return failed(`${note} is read-only`, 'NOT_ACTIONABLE');
          if (next === 'verified') {
            const value = answer?.value ?? text;
            return {...ok(value === text ? `filled ${note} with ${JSON.stringify(text)} through Value` : `filled ${note} through Value, which reads back ${JSON.stringify(value)}`), verified: true};
          }
          if (answer?.pattern) left = 'its Value left it as it was';
        }
        const refusing = await refused('typing');
        if (refusing) return left ? failed(`${note}: ${left}; ${refusing.message}`) : refusing;
        const pressed = await click(point);
        if (!pressed.ok) return pressed;
        const typed = await keys(CLEAR + literal(text));
        if (typed instanceof Error) return failed(`typing failed: ${typed.message}`);
        return ok(`filled ${note} with ${JSON.stringify(text)}${left ? ` by typing, since ${left}` : ''}`);
      } catch (error) {
        return failed((error as Error).message, codeOf(error));
      }
    },

    async type(text: string): Promise<StepResult> {
      const refusing = await refused('typing');
      if (refusing) return refusing;
      const typed = await keys(literal(text));
      return typed instanceof Error ? failed(`typing failed: ${typed.message}`) : ok(`typed ${JSON.stringify(text)}`);
    },

    async key(name: string): Promise<StepResult> {
      const sent = SEND_KEYS[name];
      if (!sent) return failed(`${name} is not a key the Windows harness knows how to send`, 'UNSUPPORTED_CAPABILITY');
      const refusing = await refused('a key press');
      if (refusing) return refusing;
      const typed = await keys(sent);
      return typed instanceof Error ? failed(`${name} failed: ${typed.message}`) : ok(`pressed ${name}`);
    },

    async screenshot(file: string): Promise<StepResult> {
      const out = prepare(file);
      try {
        return ok((await backend.screen(out)).replace(out, path.relative(options.root, out)));
      } catch (error) {
        return failed(`screenshot failed: ${(error as Error).message}`);
      }
    },

    async idleSeconds(): Promise<number | null> {
      return quiet.quiet(await backend.idle());
    },

    async close(): Promise<void> {
      await backend.close();
    },

    async raise(): Promise<StepResult> {
      if (!processName) return failed('no process was named to raise', 'INVALID_ARGUMENT');
      try {
        return ok(await backend.raise());
      } catch (error) {
        return failed((error as Error).message || 'could not raise the window');
      }
    },
  };
}

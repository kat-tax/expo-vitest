import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {HarnessError, codeOf} from '../lib/errors.ts';
import type {PatternAnswer} from '../lib/patterns.ts';
import {afterFill, afterPress, chooseFill, choosePress, scrollerAt} from '../lib/patterns.ts';
import {desk, fileStore, refusal} from '../lib/quiet.ts';
import {kindOnWindows, withKinds} from '../lib/roles.ts';
import {commandLine, firstLine, prepare, run} from '../lib/run.ts';
import type {Point, Snapshot, SnapshotNode, Target} from '../lib/snapshot.ts';
import {asSelector, centreOf, describeTarget, findNode, isPoint, seenInstead} from '../lib/snapshot.ts';
import {CANNOT, cannot, describeControl, lacking, needsApp} from '../lib/controls.ts';
import type {Availability, ControlRequest, ControlResult, DragOptions, Driver, DriverOptions, FillOptions, LongPressOptions, PressOptions, SnapshotOptions, StepResult} from '../lib/types.ts';
import {failed, ok} from '../lib/types.ts';
import {followConsole, metroFrom, readReact} from '../lib/metro.ts';
import type {ReactTree, StackFrame} from '../lib/react.ts';
import {framesExpression} from '../lib/react.ts';
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

/** The tree as the host writes it. */
interface RawTree {
  process: string;
  nodes?: Record<string, unknown>[];
}

/**
 * What the driver needs done on the desktop, by the host: a PowerShell
 * process kept for the driver's life, which reads the tree in one cached
 * request and keeps the newest snapshot to act on. Each throws with the
 * reason when a step fails, and the driver words the result.
 */
interface Backend {
  readonly description: string;
  /** Whether the app has a window; throws only when the host itself cannot run. */
  hasWindow(): Promise<boolean>;
  snapshot(interactive: boolean): Promise<RawTree>;
  raise(): Promise<string>;
  /** An exe started with none of the harness's handles; throws with Windows's reason where it will not start. */
  start(exe: string, args: readonly string[], cwd: string): Promise<void>;
  /** A press at a point in the window's own pixels, or `count` in quick succession, as a double click. */
  click(point: Point, count?: number): Promise<string>;
  /** A press held at a point for `ms`. */
  hold(point: Point, ms: number): Promise<string>;
  /** The pointer moved to a point, without a press. */
  move(point: Point): Promise<string>;
  /** The wheel turned at a point, for a distance in pixels; positive moves the content down or right. */
  wheel(point: Point, dx: number, dy: number): Promise<string>;
  /** A press at one point, held `hold` ms, drawn to another and let go there. */
  drag(from: Point, to: Point, hold: number): Promise<string>;
  /** A control of the newest snapshot scrolled through its Scroll pattern by a distance in pixels, as `act` answers; null where the call failed. */
  scroll(ref: string, dx: number, dy: number): Promise<PatternAnswer | null>;
  keys(keys: string): Promise<string>;
  screen(out: string): Promise<string>;
  idle(): Promise<number>;
  /**
   * A control of the newest snapshot driven through a UI Automation pattern,
   * with whether its state was seen to change. Null where the call failed:
   * the press then uses the pointer.
   */
  act(ref: string, way: 'invoke' | 'toggle' | 'select' | 'scrollInto'): Promise<PatternAnswer | null>;
  /** The keyboard focus given to a control of the newest snapshot, with whether it took it. */
  focus(ref: string): Promise<PatternAnswer>;
  /** Text set through a field's Value pattern, with what it reads back after; null as for `act`. */
  setValue(ref: string, text: string): Promise<PatternAnswer | null>;
  /** The name of the process whose window is in front. */
  foreground(): Promise<string>;
  /** The text on the clipboard. */
  clipboard(): Promise<string>;
  /** Puts text on the clipboard. */
  setClipboard(text: string): Promise<void>;
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
    async start(exe, args, cwd) {
      await host.request('start', {exe, arguments: commandLine(args), cwd});
    },
    click: (point, count = 1) => host.request<string>('click', {...windowed, points: [[point.x, point.y]], count}),
    hold: (point, ms) => host.request<string>('hold', {...windowed, x: point.x, y: point.y, ms}, 30_000),
    move: point => host.request<string>('move', {...windowed, x: point.x, y: point.y}),
    wheel: (point, dx, dy) => host.request<string>('wheel', {...windowed, x: point.x, y: point.y, dx, dy}),
    drag: (from, to, hold) => host.request<string>('drag', {...windowed, x: from.x, y: from.y, x2: to.x, y2: to.y, ms: hold}, 30_000),
    scroll: (ref, dx, dy) => host.request<PatternAnswer>('scroll', {ref, dx, dy}).catch(() => null),
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
    foreground: () => host.request<string>('foreground'),
    clipboard: () => host.request<string>('clipboard'),
    async setClipboard(text) {
      await host.request<string>('setClipboard', {text});
    },
    close: () => host.close(),
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
  const backend = hostBackend(processName);
  // Kept under .harness/ too, since each device test file makes a driver of its own.
  const quiet = desk(fileStore(path.join(options.root, '.harness', 'windows-desk.json')));
  /** Stops following the app's console, once `onConsole` has started to. */
  let stopConsole = () => {};

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

  async function click(point: Point, count = 1): Promise<StepResult> {
    // Synthetic input goes to the foreground window, so the app has to be it.
    // A test should not have to remember that, and a press into whatever
    // happens to be in front is the failure this whole harness exists to avoid.
    if (processName) await backend.raise().catch(() => {});
    try {
      return ok(await sending(() => backend.click(point, count)));
    } catch (error) {
      return failed(`press failed: ${(error as Error).message}`);
    }
  }

  /** Whether the app shows a window within `timeout` ms, as after it was started. */
  async function windowWithin(timeout: number): Promise<boolean> {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await backend.hasWindow().catch(() => false)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  /**
   * The exe started with these arguments, as a launch or as a link handed to
   * the window already open; what Windows said where it would not start it,
   * else null. The host starts it, so the app holds none of the harness's
   * handles: one Node started would hold a Git Bash pipe the harness writes
   * to, and the pipeline would wait for the app to end.
   */
  async function startExe(args: string[]): Promise<string | null> {
    return backend.start(exe, args, path.dirname(exe)).then(
      () => null,
      (error: Error) => firstLine(error.message),
    );
  }

  /** Ends the app and everything it started, and waits for its window to go. */
  async function stopApp(): Promise<void> {
    run('taskkill', ['/IM', `${processName}.exe`, '/T', '/F']);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await backend.hasWindow().catch(() => false))) await new Promise(resolve => setTimeout(resolve, 250));
  }

  /**
   * Deletes the folder of an app just stopped. Its window goes before the
   * process lets go of its files, as its storage's database, and a delete
   * then is refused, so it is tried again, a moment apart, for a few seconds.
   * Node's own retries do not wait between tries here.
   */
  async function removeLetGo(folder: string): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        fs.rmSync(folder, {recursive: true, force: true});
        return;
      } catch (error) {
        const code = (error as {code?: string}).code;
        if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') || Date.now() > deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  /**
   * Opens a route or a link. With the app running it is a second launch with
   * the link as its argument, which the app's single-instance check hands to
   * the window already open, as React Native's `url` event. With the app not
   * running it is a fresh launch: the link, then the launch arguments, and
   * the step waits for the window.
   */
  async function openRoute(to: string): Promise<StepResult> {
    const url = /^[a-z]+:/i.test(to) ? to : `${options.scheme ?? processName.toLowerCase()}://${to.replace(/^\//, '')}`;
    if (!exe) return failed(`cannot open ${url}: no exe to launch (pass --target <exe>)`, 'APP_UNREACHABLE');
    if (!fs.existsSync(exe)) return failed(`cannot open ${url}: there is no ${path.relative(options.root, exe)} to start`, 'APP_UNREACHABLE');
    if (await backend.hasWindow().catch(() => false)) {
      const refused = await startExe([url]);
      if (refused) return failed(`could not hand ${url} to ${processName}: ${refused}`, 'APP_UNREACHABLE');
      return ok(`sent ${url} to ${processName}`);
    }
    const launchArguments = options.app?.launchArguments ?? [];
    const refused = await startExe([url, ...launchArguments]);
    if (refused) return failed(`could not start ${processName}: ${refused}`, 'APP_UNREACHABLE');
    if (!(await windowWithin(60_000))) return failed(`${processName} showed no window within 60 s of being started with ${url}`, 'APP_UNREACHABLE');
    return ok(`started ${processName} with ${url}${launchArguments.length ? `, and ${launchArguments.length} launch arguments` : ''}`);
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
        return {ready: false, reason: (error as Error).message};
      }
      if (!running) {
        const where = exe ? path.relative(options.root, exe) : processName;
        // An exe the first open or restart can start is an app this machine can drive; a process name alone is not.
        if (exe && fs.existsSync(exe)) return {ready: true, found: `${where}, not running yet: the first open or restart starts it, driven through ${backend.description}`};
        return {ready: false, found: where, reason: `${processName} is not running${exe ? `; start ${where}` : ''}`};
      }
      return {ready: true, found: `${processName} is running, driven through ${backend.description}`};
    },

    open: openRoute,

    async control(request: ControlRequest): Promise<ControlResult> {
      const lacks = lacking(request, 'windows');
      if (lacks) return lacks;
      const app = options.app ?? {};
      try {
        switch (request.name) {
          case 'restart':
          case 'clearState': {
            if (!exe) return failed(needsApp(request.name, 'windows', 'target'), 'INVALID_ARGUMENT');
            if (request.name === 'clearState' && !app.stateDir) return cannot(request, 'windows', CANNOT.windowsState);
            await stopApp();
            if (app.stateDir && request.name === 'clearState') await removeLetGo(app.stateDir);
            const started = await openRoute('/');
            if (!started.ok) return started;
            return ok(`${request.name === 'clearState' ? `deleted ${path.relative(options.root, app.stateDir as string)}, then ` : ''}${started.message}`);
          }
          case 'stopApp': {
            if (!processName) return failed(needsApp(request.name, 'windows', 'target'), 'INVALID_ARGUMENT');
            await stopApp();
            return ok(`ended ${processName}`);
          }
          case 'resumeApp': {
            // A window that is there is raised as it is; an app not running starts, as a first open starts it.
            if (!processName) return failed(needsApp(request.name, 'windows', 'target'), 'INVALID_ARGUMENT');
            if (await backend.hasWindow().catch(() => false)) return ok(`raised ${processName}: ${await backend.raise()}`);
            return openRoute('/');
          }
          case 'installApp': {
            const package_ = request.path ? path.resolve(options.root, request.path) : app.appPath;
            if (!package_) return failed(needsApp('installApp', 'windows', 'appPath'), 'INVALID_ARGUMENT');
            const lower = package_.toLowerCase();
            if (!lower.endsWith('.msix') && !lower.endsWith('.msixbundle')) return cannot(request, 'windows', CANNOT.windowsInstall);
            const quoted = `'${package_.replaceAll("'", "''")}'`;
            const ran = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Add-AppxPackage -Path ${quoted}${request.reinstall ? ' -ForceApplicationShutdown -ForceUpdateFromAnyVersion' : ''}`]);
            return ran.ok ? ok(`installed ${path.relative(options.root, package_)}`) : failed(`could not install ${package_}: ${firstLine(ran.stderr) || firstLine(ran.stdout)}`);
          }
          case 'openLink':
            return await openRoute(request.url);
          case 'foregroundApp': {
            const name = await backend.foreground();
            return {...ok(`${name} is in front`), value: name};
          }
          case 'clipboard': {
            const read = await backend.clipboard();
            return {...ok(`read ${read.length} characters from the clipboard`), value: read};
          }
          case 'setClipboard':
            await backend.setClipboard(request.text);
            return ok(`put ${request.text.length} characters on the clipboard`);
          default:
            return failed(`${request.name} is not a control the windows harness knows`, 'INVALID_ARGUMENT');
        }
      } catch (error) {
        return failed(`${describeControl(request)} failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    snapshot,

    async press(what: Target, pressOptions: PressOptions = {}): Promise<StepResult> {
      try {
        const {point, note, node} = await pointFor(what);
        // Through the control's own pattern where it has one: no pointer, no
        // window brought to the front, no desk to wait on. It stands only
        // where it shows (`afterPress`), and the pointer presses otherwise.
        let left = '';
        // A pattern presses once; a double click is the pointer's.
        const count = pressOptions.count ?? 1;
        const way = choosePress(node?.patterns, count > 1 ? 'pointer' : pressOptions.via);
        if (node && way !== 'pointer') {
          const answer = await backend.act(node.ref, way);
          const next = afterPress(answer);
          if (next === 'verified') return {...ok(`pressed ${note} through ${answer?.pattern}`), verified: true};
          if (next === 'done') return ok(`pressed ${note} through ${answer?.pattern}`);
          if (answer?.pattern) left = `its ${answer.pattern} left it as it was`;
        }
        const refusing = await refused('a press');
        if (refusing) return left ? failed(`${note}: ${left}; ${refusing.message}`) : refusing;
        const result = await click(point, count);
        if (!result.ok) return result;
        const times = count > 1 ? ` ${count} times` : '';
        return ok(left ? `pressed ${note}${times} with the pointer, since ${left}` : `pressed ${note}${times}`);
      } catch (error) {
        return failed((error as Error).message, codeOf(error));
      }
    },

    react(): Promise<ReactTree | {unavailable: string}> {
      // A debug build's, through Metro's inspector, which react-native-windows builds into its host.
      return readReact({...metroFrom(process.env), ...(processName ? {target: processName} : {})});
    },

    reactFrames(id: number): Promise<{frames: StackFrame[]} | {unavailable: string}> {
      return readReact<{frames: StackFrame[]}>({...metroFrom(process.env), ...(processName ? {target: processName} : {})}, framesExpression(id));
    },

    async longPress(what: Target, pressOptions: LongPressOptions = {}): Promise<StepResult> {
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

    async drag(from: Target, to: Target, dragOptions: DragOptions = {}): Promise<StepResult> {
      try {
        const start = await pointFor(from);
        const end = await pointFor(to);
        const refusing = await refused('a drag');
        if (refusing) return refusing;
        // Pointer input lands on the window at the point, so the app has to be in front.
        if (processName) await backend.raise().catch(() => {});
        await sending(() => backend.drag(start.point, end.point, dragOptions.hold ?? 0));
        return ok(`dragged ${start.note} to ${end.note}`);
      } catch (error) {
        return failed(`drag failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    async swipe(from: Point, to: Point): Promise<StepResult> {
      // The content moves the way the finger does: a finger drawn up moves it down.
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      try {
        // Through the Scroll pattern of what scrolls under the finger where it
        // has one, which needs no pointer and no quiet desk; the wheel otherwise.
        const scroller = scrollerAt((await snapshot()).nodes, from);
        if (scroller) {
          const answer = await backend.scroll(scroller.ref, dx, dy);
          if (answer && !answer.unsupported) return ok(`scrolled ${scroller.ref} ${scroller.role} by ${dx},${dy} through its Scroll pattern${answer.changed ? '' : ', which was at its end already'}`);
        }
        const refusing = await refused('turning the wheel');
        if (refusing) return refusing;
        // Wheel input goes to the window under the pointer, so the app has to be in front.
        if (processName) await backend.raise().catch(() => {});
        return ok(await sending(() => backend.wheel(from, dx, dy)));
      } catch (error) {
        return failed(`swipe failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    async hover(what: Target): Promise<StepResult> {
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
      try {
        // Through UI Automation, which needs no quiet desk and no window in front.
        const {note, node} = await pointFor(what);
        if (!node) return failed(`a point cannot be given the focus; name a node`, 'INVALID_ARGUMENT');
        const answer = await backend.focus(node.ref);
        return answer.changed ? {...ok(`focused ${note}`), verified: true} : failed(`${note} did not take the focus`, 'NOT_ACTIONABLE');
      } catch (error) {
        return failed(`focus failed: ${(error as Error).message}`, 'NOT_ACTIONABLE');
      }
    },

    async scrollIntoView(what: Target): Promise<StepResult> {
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

    onConsole(listener: (level: string, text: string) => void): () => void {
      // A debug build's, through Metro's inspector, from the page the process names alone.
      const following = followConsole({...metroFrom(process.env), ...(processName ? {target: processName} : {})}, listener);
      stopConsole = () => following.stop();
      return stopConsole;
    },

    async close(): Promise<void> {
      stopConsole();
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

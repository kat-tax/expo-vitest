import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {HarnessError, codeOf} from '../lib/errors.ts';
import type {Ran} from '../lib/run.ts';
import {firstLine, powershell, prepare, run} from '../lib/run.ts';
import type {Point, Snapshot, SnapshotNode, Target} from '../lib/snapshot.ts';
import {asSelector, centreOf, describeTarget, findNode, isPoint} from '../lib/snapshot.ts';
import type {Availability, Driver, DriverOptions, SnapshotOptions, StepResult} from '../lib/types.ts';
import {failed, ok} from '../lib/types.ts';
import type {HostChild} from './windows-host.ts';
import {windowsHost} from './windows-host.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'windows');

/** Where a built app tends to be, when nobody said. */
const GUESSES = ['example/windows/x64/Release', 'example/windows/x64/Debug', 'windows/x64/Release', 'windows/x64/Debug'];

/**
 * DOM key names, which is what a test writes, in the spelling `SendKeys` takes.
 * Only the keys a composite role's pattern uses: anything else is refused by
 * name rather than passed through, because `SendKeys` reads a bare letter as
 * text and `{` as the start of a token of its own.
 */
const SEND_KEYS: Record<string, string> = {
  ArrowDown: '{DOWN}',
  ArrowUp: '{UP}',
  ArrowLeft: '{LEFT}',
  ArrowRight: '{RIGHT}',
  Home: '{HOME}',
  End: '{END}',
  Tab: '{TAB}',
  Enter: '{ENTER}',
  Escape: '{ESC}',
};

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
  /** Whether the app has a window; throws only when the means itself cannot run. */
  hasWindow(): Promise<boolean>;
  snapshot(interactive: boolean): Promise<RawTree>;
  raise(): Promise<string>;
  /** A press at a point in the window's own pixels. */
  click(point: Point): Promise<string>;
  keys(keys: string): Promise<string>;
  screen(out: string): Promise<string>;
  idle(): Promise<number | null>;
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
    click: point => host.request<string>('click', {...windowed, points: [[point.x, point.y]]}),
    keys: keys => host.request<string>('keys', {keys}, 30_000),
    screen: out => host.request<string>('screen', {...windowed, out}, 30_000),
    async idle() {
      // A check that fails says the desk is in use, so a broken one never lets synthetic input through.
      return host.request<number>('idle').catch(() => 0);
    },
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
      return check(powershell(script('input.ps1'), ['-Keys', keys]));
    },
    async screen(out) {
      return check(powershell(script('screen.ps1'), ['-Out', out, ...windowed]));
    },
    async idle() {
      const seconds = Number(firstLine(powershell(script('idle.ps1')).stdout));
      return Number.isFinite(seconds) ? seconds : null;
    },
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
 * there is no remote protocol into a react-native-windows app. Screenshots come
 * from the screen, presses from synthetic input, and the tree from UI
 * Automation, which is what Narrator reads.
 *
 * It answers `agent-device`'s shape — snapshot, press, fill — because
 * `agent-device` has no Windows backend and a test should not have to care
 * which of the two is underneath.
 *
 * Synthetic input goes to whatever is in front. If the user is at the desk it
 * lands in their window instead, so the CLI checks how long the machine has
 * been idle before pressing anything.
 */
export function windowsDriver(options: DriverOptions): WindowsDriver {
  const target = options.target ?? findExe(options.root) ?? '';
  const isExe = target.toLowerCase().endsWith('.exe');
  const exe = isExe ? path.resolve(options.root, target) : '';
  const processName = isExe ? path.basename(exe, '.exe') : target;
  const backend = process.env.HARNESS_WINDOWS_HOST === '0' ? scriptBackend(processName) : hostBackend(processName);

  async function snapshot(snapshotOptions: SnapshotOptions = {}): Promise<Snapshot> {
    let tree: RawTree;
    try {
      tree = await backend.snapshot(Boolean(snapshotOptions.interactive));
    } catch (error) {
      throw new HarnessError('ACTION_FAILED', `could not read the tree of ${processName}: ${(error as Error).message}`, {platform: 'windows', cause: error});
    }
    return {platform: 'windows', source: tree.process, nodes: (tree.nodes ?? []).map(present)};
  }

  /** The point a target names, resolved against a fresh tree. */
  async function pointFor(what: Target): Promise<{point: Point; note: string}> {
    const selector = asSelector(what);
    if (isPoint(selector)) return {point: selector, note: `${selector.x},${selector.y}`};
    const tree = await snapshot();
    const node = findNode(tree, selector);
    if (!node) throw new HarnessError('LOCATOR_NOT_FOUND', `nothing matches ${describeTarget(what)} in the window (${tree.nodes.length} nodes)`, {platform: 'windows'});
    const point = centreOf(node);
    if (!point) throw new HarnessError('NOT_ACTIONABLE', `${node.ref} ${node.role} ${JSON.stringify(node.name)} has no bounds to press`, {platform: 'windows'});
    return {point, note: `${node.ref} ${node.role} ${JSON.stringify(node.name)}`};
  }

  async function click(point: Point): Promise<StepResult> {
    // Synthetic input goes to the foreground window, so the app has to be it.
    // A test should not have to remember that, and a press into whatever
    // happens to be in front is the failure this whole harness exists to avoid.
    if (processName) await backend.raise().catch(() => {});
    try {
      return ok(await backend.click(point));
    } catch (error) {
      return failed(`press failed: ${(error as Error).message}`);
    }
  }

  async function keys(sent: string): Promise<string | Error> {
    try {
      return await backend.keys(sent);
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

    async press(what: Target): Promise<StepResult> {
      try {
        const {point, note} = await pointFor(what);
        const result = await click(point);
        return result.ok ? ok(`pressed ${note}`) : result;
      } catch (error) {
        return failed((error as Error).message, codeOf(error));
      }
    },

    async fill(what: Target, text: string): Promise<StepResult> {
      try {
        const {point, note} = await pointFor(what);
        const pressed = await click(point);
        if (!pressed.ok) return pressed;
        const typed = await keys(text);
        return typed instanceof Error ? failed(`typing failed: ${typed.message}`) : ok(`filled ${note} with ${JSON.stringify(text)}`);
      } catch (error) {
        return failed((error as Error).message, codeOf(error));
      }
    },

    async type(text: string): Promise<StepResult> {
      const typed = await keys(text);
      return typed instanceof Error ? failed(`typing failed: ${typed.message}`) : ok(`typed ${JSON.stringify(text)}`);
    },

    async key(name: string): Promise<StepResult> {
      const sent = SEND_KEYS[name];
      if (!sent) return failed(`${name} is not a key the Windows harness knows how to send`, 'UNSUPPORTED_CAPABILITY');
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

    idleSeconds(): Promise<number | null> {
      return backend.idle();
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

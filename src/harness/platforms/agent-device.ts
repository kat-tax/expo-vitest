import path from 'node:path';
import {HarnessError, codeOf} from '../lib/errors.ts';
import {prepare} from '../lib/run.ts';
import type {Point, Snapshot, SnapshotNode, Target} from '../lib/snapshot.ts';
import {asSelector, centreOf, describeTarget, findNode, isPoint} from '../lib/snapshot.ts';
import type {Availability, Driver, DriverOptions, FillOptions, LongPressOptions, Platform, PressOptions, ScrollIntoViewOptions, SnapshotOptions, StepResult} from '../lib/types.ts';
import {failed, ok} from '../lib/types.ts';
import {metroFrom, readReact} from '../lib/metro.ts';
import type {ReactTree} from '../lib/react.ts';
import {nodesFrom, openTarget, toAgentTarget, toSnapshotNodes, waitFrom} from './agent-device-mapping.ts';
import type {AgentDeviceTransport} from './agent-device-transport.ts';
import {transportFor} from './agent-device-transport.ts';

/** What `agent-device` calls the platforms we care about. */
const PLATFORM_NAMES: Partial<Record<Platform, string>> = {ios: 'ios', android: 'android', web: 'web'};

/**
 * `agent-device` (callstack) driving iOS, Android and its own web backend. It
 * does far more than this adapter asks of it — video, logs, traces, network,
 * React profiles — but the harness only needs the shape every platform shares,
 * so a test written once runs on Windows too, where `agent-device` has no
 * backend at all.
 *
 * Installed separately (`npm i -g agent-device`); `available()` says so when
 * it is missing rather than failing a step.
 */
export function agentDeviceDriver(platform: Platform, options: DriverOptions): Driver {
  const name = PLATFORM_NAMES[platform] ?? platform;
  let connecting: Promise<AgentDeviceTransport> | null = null;

  /** The transport, chosen on first use and kept until `close()`. */
  function transport(): Promise<AgentDeviceTransport> {
    connecting ??= transportFor({platform: name, harnessPlatform: platform, root: options.root, device: options.target});
    return connecting;
  }

  /** A step, answered rather than thrown: what it did, or what went wrong and what kind of failure it was. */
  async function step(done: string, failing: string, work: (current: AgentDeviceTransport) => Promise<void>): Promise<StepResult> {
    try {
      await work(await transport());
      return ok(done);
    } catch (error) {
      return failed(`${failing}: ${(error as Error).message}`, codeOf(error));
    }
  }

  async function snapshot(snapshotOptions: SnapshotOptions = {}): Promise<Snapshot> {
    const payload = await (await transport()).snapshot(Boolean(snapshotOptions.interactive));
    return {platform, source: options.target ?? name, nodes: toSnapshotNodes(nodesFrom(payload), platform === 'ios' ? 'ios' : 'android')};
  }

  /**
   * The node a ref or a selector names, read off a fresh tree, for a step
   * agent-device takes only as a point or a selector. The screen has not
   * changed since the ref was read, so the new tree numbers it the same.
   */
  async function nodeOf(what: Target): Promise<SnapshotNode> {
    const tree = await snapshot({interactive: false});
    const selector = asSelector(what);
    const node = isPoint(selector) ? undefined : findNode(tree, selector);
    if (!node) throw new HarnessError('LOCATOR_NOT_FOUND', `nothing matches ${describeTarget(what)} on the ${platform} screen (${tree.nodes.length} nodes)`, {platform});
    return node;
  }

  return {
    platform,
    // agent-device waits for the screen itself after a press or a fill
    // (`--settle`), so the harness hands it the times rather than reading a
    // device that takes a second a read.
    settles: true,

    async available(): Promise<Availability> {
      try {
        const current = await transport();
        return {ready: true, found: `${await current.capabilities()}, through ${current.description}`};
      } catch (error) {
        return {ready: false, reason: (error as Error).message};
      }
    },

    async open(to: string): Promise<StepResult> {
      const where = openTarget(to, options.scheme);
      if (!where) return failed(`cannot open ${to}: a route needs the app's URI scheme (pass --scheme, or set HARNESS_SCHEME)`, 'INVALID_ARGUMENT');
      try {
        await (await transport()).open(where);
        return ok(`opened ${'url' in where ? where.url : where.app}`);
      } catch (error) {
        return failed(`could not open ${to}: ${(error as Error).message}`, codeOf(error, 'APP_UNREACHABLE'));
      }
    },

    snapshot,

    press(what: Target, pressOptions: PressOptions = {}): Promise<StepResult> {
      return step(`pressed ${describeTarget(what)}`, 'press failed', current => current.press(what, waitFrom(pressOptions)));
    },

    fill(what: Target, text: string, fillOptions: FillOptions = {}): Promise<StepResult> {
      return step(`filled ${describeTarget(what)}`, 'fill failed', current => current.fill(what, text, waitFrom(fillOptions)));
    },

    longPress(what: Target, pressOptions: LongPressOptions = {}): Promise<StepResult> {
      return step(`held ${describeTarget(what)}`, 'long press failed', current => current.longPress(what, pressOptions.duration, waitFrom(pressOptions)));
    },

    async focus(what: Target): Promise<StepResult> {
      try {
        const selector = asSelector(what);
        const point = isPoint(selector) ? selector : centreOf(await nodeOf(selector));
        if (!point) return failed(`${describeTarget(what)} has no bounds to give the focus at`, 'NOT_ACTIONABLE');
        await (await transport()).focus(point);
        return ok(`focused ${describeTarget(what)}`);
      } catch (error) {
        return failed(`focus failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    async scrollIntoView(what: Target, scrollOptions: ScrollIntoViewOptions = {}): Promise<StepResult> {
      try {
        // agent-device scrolls until a selector is on screen, not a ref, and
        // may scroll once before it looks, so a node on screen is left. A
        // selector may name what is not in the tree yet, as a row of a list
        // that is not drawn, which agent-device finds as it scrolls.
        const selector = asSelector(what);
        const tree = await snapshot({interactive: false});
        const node = isPoint(selector) ? undefined : findNode(tree, selector);
        if (node && node.offscreen !== true) return ok(`${describeTarget(what)} was on screen already`);
        const named = node && (node.testId ? `id="${node.testId}"` : node.name ? `label="${node.name}"` : null);
        const until = isPoint(selector) || selector.ref ? named : toAgentTarget(selector);
        if (!until) return failed(`${describeTarget(what)} ${node ? 'has no testID or name to scroll to' : 'is not on the screen'}`, node ? 'NOT_ACTIONABLE' : 'LOCATOR_NOT_FOUND');
        await (await transport()).scrollUntil(scrollOptions.direction ?? 'down', until, waitFrom(scrollOptions));
        return ok(`scrolled until ${until} was on screen`);
      } catch (error) {
        return failed(`scrolling failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    react(): Promise<ReactTree | {unavailable: string}> {
      // A development build's, through Metro's inspector, where it is let.
      return readReact({...metroFrom(process.env), ...(options.target ? {target: options.target} : {})});
    },

    swipe(from: Point, to: Point): Promise<StepResult> {
      return step(`swiped from ${from.x},${from.y} to ${to.x},${to.y}`, 'swipe failed', current => current.swipe(from, to));
    },

    type(text: string): Promise<StepResult> {
      return step(`typed ${JSON.stringify(text)}`, 'typing failed', current => current.type(text));
    },

    async screenshot(file: string): Promise<StepResult> {
      const out = prepare(file);
      return step(`saved ${path.relative(options.root, out)}`, 'screenshot failed', current => current.screenshot(out));
    },

    async idleSeconds(): Promise<number | null> {
      // A device or an emulator is not this machine's desktop.
      return null;
    },

    async close(): Promise<void> {
      const closing = connecting;
      connecting = null;
      await (await closing?.catch(() => null))?.close();
    },
  };
}

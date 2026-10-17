import fs from 'node:fs';
import path from 'node:path';
import {HarnessError, codeOf} from '../lib/errors.ts';
import {firstLine, prepare} from '../lib/run.ts';
import type {Point, Snapshot, SnapshotNode, Target} from '../lib/snapshot.ts';
import {asSelector, centreOf, describeTarget, findNode, follow, isPoint, seenInstead} from '../lib/snapshot.ts';
import {cannot, describeControl, lacking, needsApp, otherSensor} from '../lib/controls.ts';
import type {Availability, ControlRequest, ControlResult, DragOptions, Driver, DriverOptions, FillOptions, HostedDevice, LongPressOptions, Platform, PressOptions, ScrollIntoViewOptions, SnapshotOptions, StepResult, StepTiming} from '../lib/types.ts';
import {failed, ok} from '../lib/types.ts';
import {followConsole, metroFrom, readReact} from '../lib/metro.ts';
import type {ReactTree, StackFrame} from '../lib/react.ts';
import {framesExpression} from '../lib/react.ts';
import {clipboardText, connectArgs, foregroundOf, middleToPress, NO_TOUCH_POINT, nodesFrom, openInQuestion, openTarget, readsAlike, STILL_MOVING, toAgentTarget, toSnapshotNodes, viewportFrom, waitFrom} from './agent-device-mapping.ts';
import type {Wait} from './agent-device-mapping.ts';
import type {AgentDeviceTransport} from './agent-device-transport.ts';
import {transportFor} from './agent-device-transport.ts';

/** What `agent-device` calls the platforms we care about. */
const PLATFORM_NAMES: Partial<Record<Platform, string>> = {ios: 'ios', android: 'android', web: 'web'};

/** How many times a step is tried on a target agent-device refuses as still moving. */
const RESTING_TRIES = 3;

/** How long iOS is given to ask "Open in …?" after a url is opened, which on a simulator just started can come seconds after. */
const OPEN_IN_MS = 10_000;

/**
 * `agent-device` (callstack) driving iOS, Android and its own web backend. It
 * does far more than this adapter asks of it — video, logs, traces, network,
 * React profiles — but the harness only needs the shape every platform shares,
 * so a test written once runs on Windows too, where `agent-device` has no
 * backend at all.
 *
 * A dependency of this package, or the one `HARNESS_AGENT_DEVICE` names;
 * `available()` says so when it does not load rather than failing a step.
 */
export function agentDeviceDriver(platform: Platform, options: DriverOptions): Driver {
  const name = PLATFORM_NAMES[platform] ?? platform;
  let connecting: Promise<AgentDeviceTransport> | null = null;
  /** Stops following the app's console, once `onConsole` has started to. */
  let stopConsole = () => {};

  /** The transport, chosen on first use and kept until `close()`. */
  function transport(): Promise<AgentDeviceTransport> {
    connecting ??= transportFor({
      platform: name,
      harnessPlatform: platform,
      root: options.root,
      device: options.target,
      ...(options.session ? {session: options.session} : {}),
      ...(options.actionTimeout ? {stepTimeout: options.actionTimeout} : {}),
    });
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

  /**
   * The screen let hold still after a step that takes no `--settle`, as
   * typing and a key do not, by agent-device's `wait stable`, where the step
   * was handed a settle. What it says where the screen did not hold still,
   * which fails no step, as a press's own settle fails none.
   */
  async function stillAfter(current: AgentDeviceTransport, wait: Wait | undefined): Promise<string> {
    if (!wait) return '';
    try {
      await current.settle(wait);
      return '';
    } catch (error) {
      return `; the screen did not hold still: ${firstLine((error as Error).message)}`;
    }
  }

  /** The tree read last, whose refs agent-device resolves a ref against until the next read. */
  let lastTree: Snapshot | null = null;

  async function snapshot(snapshotOptions: SnapshotOptions = {}): Promise<Snapshot> {
    const payload = await (await transport()).snapshot(Boolean(snapshotOptions.interactive));
    const viewport = viewportFrom(payload);
    lastTree = {platform, source: options.target ?? name, nodes: toSnapshotNodes(nodesFrom(payload), platform === 'ios' ? 'ios' : 'android'), ...(viewport ? {viewport} : {})};
    return lastTree;
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
    if (!node) {
      const instead = isPoint(selector) ? '' : seenInstead(tree, selector);
      throw new HarnessError('LOCATOR_NOT_FOUND', `nothing matches ${describeTarget(what)} on the ${platform} screen (${tree.nodes.length} nodes)${instead ? `; ${instead}` : ''}`, {platform});
    }
    return node;
  }

  /**
   * A target as agent-device is given it. One it reads as the harness does
   * goes as it is (`readsAlike`). Any other is found in a fresh tree by the
   * harness's own rules, as web and Windows find it, and the step is done on
   * that node's ref, which agent-device keeps until its next read.
   */
  async function resolved(what: Target): Promise<Target> {
    return readsAlike(what) ? what : {ref: (await nodeOf(what)).ref};
  }

  /** A step on what a target names, failed as the step itself is where nothing does. */
  async function resolving(what: Target, failing: string, work: (at: Target) => Promise<StepResult>): Promise<StepResult> {
    let at: Target;
    try {
      at = await resolved(what);
    } catch (error) {
      return failed(`${failing}: ${(error as Error).message}`, codeOf(error));
    }
    return work(at);
  }

  /**
   * After a url is opened on iOS: iOS asks "Open in “<app>”?" before it
   * hands a link to the app the link's scheme names, and waits, so the
   * question is answered Open, as a person following the link does. What
   * the step then says, or nothing where no question came.
   */
  async function answeredOpenIn(current: AgentDeviceTransport): Promise<string> {
    if (platform !== 'ios') return '';
    const until = Date.now() + OPEN_IN_MS;
    for (;;) {
      const tree = await snapshot({interactive: false}).catch(() => null);
      const question = tree ? openInQuestion(tree) : undefined;
      if (question) {
        // agent-device answers the question itself with its accept, where it
        // opened the app; its Open button is pressed where that fails, by its
        // label, since the accept, as a device action, retires the ref.
        const answered = `, and answered Open to ${JSON.stringify(question.name)}`;
        try {
          await current.command({command: 'alert', action: 'accept'});
          return answered;
        } catch (error) {
          await current.press({label: 'Open'});
          return `${answered} with its button, since the alert's accept failed: ${firstLine((error as Error).message)}`;
        }
      }
      if (Date.now() >= until) return '';
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  /**
   * A step on a target, done again where agent-device refuses the target as
   * still moving (`STILL_MOVING`). A ref it refused names a node of a tree it
   * has read past, so the tree is read again, which also gives the motion
   * time to end, and the step is done on the node where that tree has it.
   * Answers the step's result and the target it was last done on.
   */
  async function atRest(what: Target, work: (at: Target) => Promise<StepResult>): Promise<{result: StepResult; at: Target}> {
    let at = what;
    let result = await work(at);
    for (let tries = 1; tries < RESTING_TRIES && !result.ok && STILL_MOVING.test(result.message); tries++) {
      const before = lastTree;
      const selector = asSelector(at);
      const node = before && !isPoint(selector) && selector.ref ? findNode(before, selector) : undefined;
      let tree: Snapshot;
      try {
        tree = await snapshot({interactive: false});
      } catch {
        break;
      }
      if (before && node) {
        const now = follow(node, before, tree);
        if (!now) break;
        at = {ref: now.ref};
      }
      result = await work(at);
      if (result.ok) result = {...result, message: `${result.message}, once it had come to rest`};
    }
    return {result, at};
  }

  /**
   * A press or a hold, given at the node's middle where agent-device finds no
   * point of the node's own to press its ref at (`middleToPress`). The node
   * is found in the tree read last, where its ref came from: a tree read
   * afresh numbers its nodes anew, and the same ref could be another node.
   */
  async function pressing(what: Target, done: string, failing: string, work: (current: AgentDeviceTransport, at: Target) => Promise<void>): Promise<StepResult> {
    const {result: first, at} = await atRest(what, target => step(done, failing, current => work(current, target)));
    if (first.ok || !NO_TOUCH_POINT.test(first.message) || !lastTree) return first;
    const selector = asSelector(at);
    const node = isPoint(selector) ? undefined : findNode(lastTree, selector);
    const middle = node ? middleToPress(lastTree, node) : null;
    return middle ? step(`${done} at its middle`, failing, current => work(current, middle)) : first;
  }

  /** The file the recording in progress is written to, until it is stopped. */
  let recordingTo: string | null = null;

  /** The app a location is for: on an iOS simulator the app's own, and on Android the device's, which takes none. */
  const locationApp = (bundleId?: string): {app?: string} => (platform === 'ios' && bundleId ? {app: bundleId} : {});

  return {
    platform,
    // agent-device waits for the screen itself after a press or a fill
    // (`--settle`), so the harness hands it the times rather than reading a
    // device that takes a second a read.
    settles: true,

    async available(): Promise<Availability> {
      try {
        const current = await transport();
        const {line, device} = await current.capabilities();
        return {ready: true, found: `${line}, through ${current.description}`, ...(device ? {device} : {})};
      } catch (error) {
        return {ready: false, reason: (error as Error).message};
      }
    },

    async open(to: string): Promise<StepResult> {
      const where = openTarget(to, options.scheme);
      if (!where) return failed(`cannot open ${to}: a route needs the app's URI scheme (pass --scheme, or set HARNESS_SCHEME)`, 'INVALID_ARGUMENT');
      try {
        const current = await transport();
        await current.open(where);
        return ok(`opened ${'url' in where ? where.url + (await answeredOpenIn(current)) : where.app}`);
      } catch (error) {
        return failed(`could not open ${to}: ${(error as Error).message}`, codeOf(error, 'APP_UNREACHABLE'));
      }
    },

    snapshot,

    press(what: Target, pressOptions: PressOptions = {}): Promise<StepResult> {
      const times = (pressOptions.count ?? 1) > 1 ? ` ${pressOptions.count} times` : '';
      return resolving(what, 'press failed', at => pressing(at, `pressed ${describeTarget(what)}${times}`, 'press failed', (current, target) => current.press(target, waitFrom(pressOptions), pressOptions.count)));
    },

    fill(what: Target, text: string, fillOptions: FillOptions = {}): Promise<StepResult> {
      const filling = (at: Target) => step(`filled ${describeTarget(what)}`, 'fill failed', current => current.fill(at, text, waitFrom(fillOptions)));
      return resolving(what, 'fill failed', async at => (await atRest(at, filling)).result);
    },

    longPress(what: Target, pressOptions: LongPressOptions = {}): Promise<StepResult> {
      return resolving(what, 'long press failed', at => pressing(at, `held ${describeTarget(what)}`, 'long press failed', (current, target) => current.longPress(target, pressOptions.duration, waitFrom(pressOptions))));
    },

    async drag(from: Target, to: Target, dragOptions: DragOptions = {}): Promise<StepResult> {
      try {
        let ends = [await resolved(from), await resolved(to)];
        // agent-device drags between two nodes it finds, or pans between two points, so a point at either end makes both points.
        if (ends.some(end => isPoint(asSelector(end)))) {
          ends = await Promise.all(
            ends.map(async end => {
              const selector = asSelector(end);
              const point = isPoint(selector) ? selector : centreOf(await nodeOf(selector));
              if (!point) throw new HarnessError('NOT_ACTIONABLE', `${describeTarget(end)} has no bounds to drag from or to`, {platform});
              return point;
            }),
          );
        }
        await (await transport()).drag(ends[0] as Target, ends[1] as Target, dragOptions.hold);
        return ok(`dragged ${describeTarget(from)} to ${describeTarget(to)}${dragOptions.hold ? `, held ${dragOptions.hold} ms first` : ''}`);
      } catch (error) {
        return failed(`drag failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    /** A named key where the focus is: Enter, agent-device's one, the keyboard's own return key; any other is skipped. */
    async key(keyName: string, keyOptions: StepTiming = {}): Promise<StepResult> {
      if (keyName !== 'Enter') return {ok: true, skipped: true, message: `agent-device sends Enter alone on ${platform}, not ${keyName}`};
      try {
        const current = await transport();
        await current.command({command: 'keyboard', action: 'enter'});
        return ok(`pressed Enter${await stillAfter(current, waitFrom(keyOptions))}`);
      } catch (error) {
        return failed(`Enter failed: ${(error as Error).message}`, codeOf(error));
      }
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
      return readReact({...metroFrom(process.env), ...(options.app?.bundleId ? {app: options.app.bundleId} : {}), ...(options.target ? {target: options.target} : {})});
    },

    reactFrames(id: number): Promise<{frames: StackFrame[]} | {unavailable: string}> {
      return readReact<{frames: StackFrame[]}>({...metroFrom(process.env), ...(options.app?.bundleId ? {app: options.app.bundleId} : {}), ...(options.target ? {target: options.target} : {})}, framesExpression(id));
    },

    swipe(from: Point, to: Point): Promise<StepResult> {
      return step(`swiped from ${from.x},${from.y} to ${to.x},${to.y}`, 'swipe failed', current => current.swipe(from, to));
    },

    pinch(at: Point, scale: number): Promise<StepResult> {
      return step(`pinched to ${scale} times at ${at.x},${at.y}`, 'pinch failed', current => current.pinch(at, scale));
    },

    async type(text: string, typeOptions: StepTiming = {}): Promise<StepResult> {
      try {
        const current = await transport();
        await current.type(text);
        return ok(`typed ${JSON.stringify(text)}${await stillAfter(current, waitFrom(typeOptions))}`);
      } catch (error) {
        return failed(`typing failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    async screenshot(file: string): Promise<StepResult> {
      const out = prepare(file);
      return step(`saved ${path.relative(options.root, out)}`, 'screenshot failed', current => current.screenshot(out, options.statusBar));
    },

    async connect(hosted: HostedDevice): Promise<StepResult> {
      try {
        await (await transport()).run(connectArgs(hosted.provider, hosted.options));
        return ok(`connected to ${hosted.provider}; the device is allocated at the first command that needs it`);
      } catch (error) {
        return failed(`could not connect to ${hosted.provider}: ${firstLine((error as Error).message)}`, codeOf(error, 'DRIVER_UNAVAILABLE'));
      }
    },

    async disconnect(): Promise<StepResult> {
      try {
        await (await transport()).run(['disconnect']);
        return ok('released the hosted device');
      } catch (error) {
        return failed(`could not release the hosted device: ${firstLine((error as Error).message)}`, codeOf(error, 'ACTION_FAILED'));
      }
    },

    async attach(): Promise<StepResult> {
      try {
        await (await transport()).attach();
        return ok(`holds ${options.target ?? 'the device'} in session ${options.session ?? 'default'}`);
      } catch (error) {
        return failed(`could not hold ${options.target ?? 'the device'}: ${firstLine((error as Error).message)}`, codeOf(error, 'DRIVER_UNAVAILABLE'));
      }
    },

    async releaseStale(): Promise<StepResult> {
      try {
        await (await transport()).run(['device', 'release', '--stale']);
        return ok('released the claims of owners that are gone');
      } catch (error) {
        return failed(`could not release stale claims: ${firstLine((error as Error).message)}`, codeOf(error, 'ACTION_FAILED'));
      }
    },

    async video(action: 'start' | 'stop', file?: string): Promise<ControlResult> {
      try {
        const current = await transport();
        if (action === 'start') {
          recordingTo = prepare(path.join(options.root, '.harness', 'video-raw', `${platform}-${Date.now()}.mp4`));
          await current.record('start', recordingTo);
          return ok('recording the screen');
        }
        const raw = recordingTo;
        recordingTo = null;
        if (!raw) return ok('nothing was being recorded');
        await current.record('stop');
        if (file) fs.copyFileSync(raw, prepare(file));
        // agent-device writes files of its own beside a recording, such as the gestures in it, and they go with it.
        const stem = path.basename(raw, '.mp4');
        for (const name of fs.readdirSync(path.dirname(raw))) {
          if (name === `${stem}.mp4` || name.startsWith(`${stem}.`)) fs.rmSync(path.join(path.dirname(raw), name), {force: true});
        }
        return file ? {...ok(`saved ${path.relative(options.root, file)}`), value: file} : ok('threw the recording away');
      } catch (error) {
        return failed(`the recording failed: ${firstLine((error as Error).message)}`, codeOf(error));
      }
    },

    async control(request: ControlRequest): Promise<ControlResult> {
      const lacks = lacking(request, platform);
      if (lacks) return lacks;
      const app = options.app ?? {};
      try {
        const current = await transport();
        switch (request.name) {
          case 'restart':
          case 'clearState': {
            if (!app.bundleId) return failed(needsApp(request.name, platform, 'bundleId'), 'INVALID_ARGUMENT');
            // Cleared first, since clearing an app's state takes its permissions too, then set before it starts, so no prompt asks.
            if (request.name === 'clearState') await current.setting({setting: 'clear-app-state', app: app.bundleId});
            const permissions = Object.entries(app.permissions ?? {});
            for (const [permission, state] of permissions) await current.setting({setting: 'permission', state, permission, app: app.bundleId});
            const launchArguments = app.launchArguments ?? [];
            await current.launch(app.bundleId, true, launchArguments);
            const given = [launchArguments.length ? `${launchArguments.length} launch arguments` : '', permissions.length ? `${permissions.length} permissions set` : ''].filter(Boolean);
            return ok(`${request.name === 'clearState' ? 'cleared and restarted' : 'restarted'} ${app.bundleId}${given.length ? `, with ${given.join(' and ')}` : ''}`);
          }
          case 'stopApp':
            if (!app.bundleId) return failed(needsApp(request.name, platform, 'bundleId'), 'INVALID_ARGUMENT');
            await current.closeApp(app.bundleId);
            return ok(`ended ${app.bundleId}`);
          case 'back':
            await current.back();
            return ok('went back');
          case 'home':
            await current.home();
            return ok('went to the home screen');
          case 'installApp': {
            const appPath = request.path ? path.resolve(options.root, request.path) : app.appPath;
            if (!appPath) return failed(needsApp('installApp', platform, 'appPath'), 'INVALID_ARGUMENT');
            if (request.reinstall && !app.bundleId) return failed(needsApp('installApp', platform, 'bundleId'), 'INVALID_ARGUMENT');
            await current.install(app.bundleId, appPath, Boolean(request.reinstall));
            return ok(`${request.reinstall ? 'reinstalled' : 'installed'} ${path.relative(options.root, appPath)}`);
          }
          case 'openLink':
            await current.open({url: request.url});
            return ok(`opened ${request.url}${await answeredOpenIn(current)}`);
          case 'foregroundApp': {
            const front = foregroundOf(await current.appState());
            return front ? {...ok(`${front.said} is in front`), value: front.app} : failed('agent-device did not say which app is in front');
          }
          case 'setAppearance':
            await current.setting({setting: 'appearance', state: request.mode});
            return ok(`set the appearance to ${request.mode}`);
          case 'setOrientation':
            await current.command({command: 'orientation', orientation: request.orientation});
            return ok(`turned the device to ${request.orientation}`);
          case 'setNetwork':
            // agent-device turns Wi-Fi on and off, so an emulator on mobile data alone stays online.
            await current.setting({setting: 'wifi', state: request.online ? 'on' : 'off'});
            return ok(`turned Wi-Fi ${request.online ? 'on' : 'off'}`);
          case 'setAirplaneMode':
            await current.setting({setting: 'airplane', state: request.on ? 'on' : 'off'});
            return ok(`turned airplane mode ${request.on ? 'on' : 'off'}`);
          case 'setPermission':
            if (!app.bundleId) return failed(needsApp('setPermission', platform, 'bundleId'), 'INVALID_ARGUMENT');
            await current.setting({setting: 'permission', state: request.state, permission: request.permission, app: app.bundleId});
            return ok(`set ${request.permission} to ${request.state} for ${app.bundleId}`);
          case 'setLocation':
            await current.setting({setting: 'location', state: 'set', latitude: request.latitude, longitude: request.longitude, ...locationApp(app.bundleId)});
            return ok(`put the device at ${request.latitude},${request.longitude}`);
          case 'clearLocation':
            await current.setting({setting: 'location', state: 'off', ...locationApp(app.bundleId)});
            return ok('turned the location off');
          case 'setBiometrics': {
            const other = otherSensor(platform, request.sensor);
            if (other) return cannot(request, platform, other);
            await current.setting(request.sensor === 'fingerprint' ? {setting: 'fingerprint', state: request.result} : {setting: request.sensor, state: request.result});
            return ok(`answered ${request.sensor} with a ${request.result}`);
          }
          case 'enrollBiometrics': {
            const other = otherSensor(platform, request.sensor);
            if (other) return cannot(request, platform, other);
            await current.setting({setting: request.sensor, state: request.enrolled ? 'enroll' : 'unenroll'});
            return ok(`${request.enrolled ? 'enrolled' : 'unenrolled'} ${request.sensor}`);
          }
          case 'fold':
            await current.command({command: 'fold', pose: request.pose});
            return ok(`put the device in the ${request.pose} pose`);
          case 'clipboard': {
            const text = clipboardText(await current.command({command: 'clipboard', action: 'read'}));
            return text === null ? failed('agent-device did not answer with the clipboard') : {...ok(`read ${text.length} characters from the clipboard`), value: text};
          }
          case 'setClipboard':
            await current.command({command: 'clipboard', action: 'write', text: request.text});
            return ok(`put ${request.text.length} characters on the clipboard`);
          case 'dismissKeyboard':
            await current.command({command: 'keyboard', action: 'dismiss'});
            return ok('dismissed the keyboard');
          case 'alert':
            await current.command({command: 'alert', action: request.action});
            return ok(`${request.action === 'accept' ? 'accepted' : 'dismissed'} the alert`);
        }
      } catch (error) {
        return failed(`${describeControl(request)} failed: ${(error as Error).message}`, codeOf(error));
      }
    },

    async idleSeconds(): Promise<number | null> {
      // A device or an emulator is not this machine's desktop.
      return null;
    },

    onConsole(listener: (level: string, text: string) => void): () => void {
      // A development build's, through Metro, from its own page alone, as the React tree is read.
      const following = followConsole({...metroFrom(process.env), ...(options.app?.bundleId ? {app: options.app.bundleId} : {}), ...(options.target ? {target: options.target} : {})}, listener);
      stopConsole = () => following.stop();
      return stopConsole;
    },

    async close(): Promise<void> {
      stopConsole();
      const closing = connecting;
      connecting = null;
      await (await closing?.catch(() => null))?.close();
    },
  };
}

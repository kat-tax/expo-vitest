import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {HarnessError, codeOf} from '../lib/errors.ts';
import {firstLine, numbered, prepare} from '../lib/run.ts';
import type {Bounds, Point, Snapshot, SnapshotNode, Target} from '../lib/snapshot.ts';
import {kindOnWeb} from '../lib/roles.ts';
import {asSelector, describeTarget, findNode, isPoint, narrow, seenInstead} from '../lib/snapshot.ts';
import {CANNOT, cannot, describeControl, lacking, webGrants} from '../lib/controls.ts';
import type {Availability, ControlRequest, ControlResult, DialogAnswer, Driver, DriverOptions, LongPressOptions, OptionChoice, PressOptions, SnapshotOptions, StepResult, WebCookie, WebRoute} from '../lib/types.ts';
import {failed, ok} from '../lib/types.ts';
import type {BrowserName} from './web-browsers.ts';
import {BROWSERS, GRANTS, HEADED_NEEDS_FULL, TITLES, browserLines, browserRoots, buildOf, candidates, grantsIn, installHint, isShell, launchOptions, modeFrom, playwrightBases, noClipboard} from './web-browsers.ts';
import type {ReactTree} from '../lib/react.ts';
import {walkExpression} from '../lib/react.ts';
import {COLLECT} from './web-collect.ts';

const DEFAULT_URL = 'http://localhost:8081';

/** The builds of Chromium a launch can fall back on, of those `playwright-core install` left, newest first. */
function browsers(headed: boolean): string[] {
  const found: string[] = [];
  for (const root of browserRoots(process.env)) {
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    found.push(...candidates(root, entries, headed).filter(file => fs.existsSync(file)));
  }
  return found;
}

/**
 * Runs in every document before the page's own scripts: a counter moved on by
 * every change a snapshot could show, so the driver can tell a page that has
 * not changed since its last read from one that has. A style, a class, a text
 * and a node added or removed are all mutations; focus and scroll are not, so
 * they have listeners of their own.
 */
const INIT = `(() => {
  if (window.__harness) return;
  const state = {generation: 1};
  const bump = () => { state.generation += 1; };
  const observe = () => new MutationObserver(bump).observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, {once: true});
  for (const type of ['focusin', 'focusout', 'resize', 'scroll', 'transitionend', 'animationend']) window.addEventListener(type, bump, true);
  window.__harness = state;
  // React's DevTools hook, the least a renderer needs to register with it,
  // so the React tree can be read: React looks for it as it loads, and only
  // then. One already there, as a DevTools extension's, is left as it is.
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    const renderers = new Map();
    const roots = new Map();
    let next = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers,
      supportsFiber: true,
      inject(renderer) { next += 1; renderers.set(next, renderer); roots.set(next, new Set()); return next; },
      onCommitFiberRoot(id, root) {
        const kept = roots.get(id);
        if (!kept) return;
        if (root.current && root.current.memoizedState && root.current.memoizedState.element == null) kept.delete(root);
        else kept.add(root);
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
      getFiberRoots(id) { return roots.get(id) || new Set(); },
    };
  }
})();`;

/**
 * Runs in the page: where a press at a point of a node would land, when that
 * is not the node or something inside it, as when an overlay is over it.
 * Answers the ref of the nearest node the last read named there, or the tag.
 */
const LANDS = `(([id, x, y]) => {
  const refs = window.__harnessRefs;
  const target = refs && refs.elements.get(id) && refs.elements.get(id).deref();
  const top = document.elementFromPoint(x, y);
  if (!target || !top || target === top || target.contains(top)) return null;
  for (let element = top; element; element = element.parentElement) {
    const found = refs.ids.get(element);
    if (found !== undefined && refs.elements.has(found)) return {ref: '@e' + found};
  }
  return {tag: top.tagName.toLowerCase()};
})`;

/**
 * Runs in the page: gives the element a ref names the focus, or, where its
 * middle is outside the viewport, scrolls it to the middle of the screen.
 * Answers whether the element is still there, whether it took the focus or
 * was scrolled, and where it is now.
 */
const ON_ELEMENT = `(([id, what]) => {
  const refs = window.__harnessRefs;
  const element = refs && refs.elements.get(id) && refs.elements.get(id).deref();
  if (!element) return {there: false};
  if (what === 'focus') {
    element.focus();
    return {there: true, focused: document.activeElement === element};
  }
  const box = element.getBoundingClientRect();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const outside = x < 0 || y < 0 || x >= innerWidth || y >= innerHeight;
  if (outside) element.scrollIntoView({block: 'center', inline: 'center'});
  const now = element.getBoundingClientRect();
  return {there: true, scrolled: outside, box: {x: now.x, y: now.y, width: now.width, height: now.height}};
})`;

/**
 * Runs in the page: where the content of the frame a CSS selector names
 * starts, inside its border and padding, which is where the frame's own
 * coordinates start. Null where nothing matches.
 */
const FRAME_BOX = `((selector) => {
  const element = document.querySelector(selector);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {x: box.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), y: box.y + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)};
})`;

/** Runs in the page, or a frame: the element a ref's number names, while it is there. */
const ELEMENT = (id: number) => `(() => { const refs = window.__harnessRefs; const held = refs && refs.elements.get(${id}); return held ? held.deref() : null; })()`;

/** The label and value of each option of the select a ref is, or null where it is no select. */
const OPTIONS = (id: number) => `(() => { const element = ${ELEMENT(id)}; return element instanceof HTMLSelectElement ? Array.from(element.options, option => ({label: option.label, value: option.value})) : null; })()`;

/** How long a long press is held when a test does not say, in ms: what a person holds for a context menu. */
const HOLD_MS = 800;

/** How long a read stands while the page's counter has not moved: a box can move without a mutation, as when an image loads. */
const KEEP_MS = 2000;

/**
 * The web harness: a real Chromium over the app's web build, which is the DOM
 * it renders rather than a React Native emulation of it. One browser is
 * kept for the whole run, so a sequence of steps shares a page the way a person
 * using the app would.
 *
 * Snapshots carry the same refs as every other platform, and a press finds its
 * element by that ref rather than by a coordinate.
 */
export function webDriver(options: DriverOptions): Driver {
  // Which browser, or a Chromium at an endpoint; HARNESS_HEADED opens a window to watch, and HARNESS_SLOWMO slows each operation.
  const mode = modeFrom(process.env, {browser: options.browser, cdp: options.cdp});
  /** Who hears the page's console, from the page's first open. */
  const listeners = new Set<(level: string, text: string) => void>();
  // The project's own playwright-core where it has one, else this package's.
  const requires = playwrightBases(options.root, fileURLToPath(import.meta.url)).map(base => createRequire(base));
  const base = options.url ?? DEFAULT_URL;
  /** The size every page opens at. */
  const VIEWPORT = {width: 1280, height: 900};
  /** How long a navigation may take before the page is taken not to be there. */
  const navigation = options.actionTimeout ?? 30_000;
  let browser: Browser | null = null;
  let page: Page | null = null;

  interface Browser {
    newContext(o?: unknown): Promise<Context>;
    close(): Promise<void>;
  }
  interface Context {
    newPage(): Promise<Page>;
    close(): Promise<void>;
    route(pattern: string, handler: (route: Route) => unknown): Promise<void>;
    unroute(pattern: string, handler?: (route: Route) => unknown): Promise<void>;
    cookies(): Promise<WebCookie[]>;
    addCookies(cookies: WebCookie[]): Promise<void>;
    clearCookies(): Promise<void>;
    setOffline(offline: boolean): Promise<void>;
    grantPermissions(permissions: string[]): Promise<void>;
    clearPermissions(): Promise<void>;
    setGeolocation(where: {latitude: number; longitude: number} | null): Promise<void>;
  }
  interface Dialog {
    accept(): Promise<void>;
    dismiss(): Promise<void>;
    type(): string;
    message(): string;
  }
  interface Route {
    request(): {url(): string; method(): string; headers(): Record<string, string>; postData(): string | null};
    fulfill(response: unknown): Promise<void>;
    continue(): Promise<void>;
    abort(): Promise<void>;
  }
  interface ElementHandle {
    contentFrame(): Promise<Frame | null>;
    selectOption(values: {label?: string; value?: string; index?: number}): Promise<string[]>;
    setInputFiles(files: string[]): Promise<void>;
    dispose(): Promise<void>;
  }
  interface JSHandle {
    asElement(): ElementHandle | null;
    dispose(): Promise<void>;
  }
  interface Frame {
    evaluate<T>(fn: string): Promise<T>;
    evaluateHandle(fn: string): Promise<JSHandle>;
  }
  interface Download {
    suggestedFilename(): string;
    saveAs(path: string): Promise<void>;
  }
  /** What the next dialog the page opens is answered with, where a test said; Playwright decides one as it opens. */
  let nextDialog: 'accept' | 'dismiss' | null = null;
  /** How every dialog is answered, where a test said, until it says otherwise. */
  let dialogs: DialogAnswer | null = null;
  /** The routes a test made, which each new context is given too, until they are taken off. */
  const routes: {pattern: string; handler: (route: Route) => unknown}[] = [];
  /** The frames a test asked for, by selector: the refs of frame n are `@f<n>e…`. */
  const frames: string[] = [];

  interface Locator {
    click(o?: unknown): Promise<void>;
    fill(text: string): Promise<void>;
    count(): Promise<number>;
  }
  interface Page {
    addInitScript(script: string): Promise<void>;
    goto(url: string, o?: unknown): Promise<unknown>;
    screenshot(o: {path: string; fullPage?: boolean; animations?: 'disabled'; caret?: 'hide'}): Promise<unknown>;
    mouse: {click(x: number, y: number, o?: {button?: 'left' | 'right'; clickCount?: number}): Promise<void>; move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void>; wheel(deltaX: number, deltaY: number): Promise<void>};
    $(selector: string): Promise<ElementHandle | null>;
    evaluateHandle(fn: string): Promise<JSHandle>;
    waitForEvent(event: 'download', o?: {timeout?: number}): Promise<Download>;
    keyboard: {type(text: string): Promise<void>; press(key: string): Promise<void>};
    locator(selector: string): Locator;
    evaluate<T>(fn: string): Promise<T>;
    on(event: 'console', listener: (message: {type(): string; text(): string}) => void): void;
    on(event: 'pageerror', listener: (error: Error) => void): void;
    on(event: 'dialog', listener: (dialog: Dialog) => void): void;
    goBack(o?: unknown): Promise<unknown>;
    url(): string;
    title(): Promise<string>;
    context(): Context;
    emulateMedia(o: {colorScheme: 'light' | 'dark'}): Promise<void>;
    // From playwright-core 1.59; an older one has none.
    screencast?: {start(o: {path: string; size?: {width: number; height: number}}): Promise<unknown>; stop(): Promise<void>};
    isClosed(): boolean;
    viewportSize(): {width: number; height: number} | null;
    setViewportSize(size: {width: number; height: number}): Promise<void>;
  }

  interface BrowserType {
    launch(o?: unknown): Promise<Browser>;
    connectOverCDP(endpoint: string, o?: unknown): Promise<Browser>;
    executablePath(): string;
  }

  function playwright() {
    for (const require of requires) {
      try {
        return require('playwright-core') as Record<BrowserName, BrowserType>;
      } catch {
        // The next place it may be.
      }
    }
    return null;
  }

  async function launch(): Promise<Browser> {
    const driver = playwright();
    if (!driver) throw new HarnessError('DRIVER_UNAVAILABLE', 'playwright-core did not load: it comes with expo-vitest, so install expo-vitest again', {platform: 'web'});
    if (mode.invalid) throw new HarnessError('INVALID_ARGUMENT', mode.invalid, {platform: 'web'});
    if (mode.cdp) {
      // The browser is someone else's. The run opens contexts of its own in it, and closing them leaves the browser and its own tabs as they were.
      try {
        return await driver.chromium.connectOverCDP(mode.cdp, {timeout: navigation, ...(mode.slowMo ? {slowMo: mode.slowMo} : {})});
      } catch (error) {
        throw new HarnessError('DRIVER_UNAVAILABLE', `no Chromium answered over CDP at ${mode.cdp}: ${firstLine((error as Error).message)}`, {platform: 'web'});
      }
    }
    const reasons: string[] = [];
    // Only Chromium has other builds to fall back on: Firefox and WebKit work with the version that installed them alone.
    for (const executablePath of [undefined, ...(mode.browser === 'chromium' ? browsers(mode.headed) : [])]) {
      try {
        return await driver[mode.browser].launch(launchOptions(mode, executablePath));
      } catch (error) {
        reasons.push(firstLine((error as Error).message));
      }
    }
    throw new HarnessError('DRIVER_UNAVAILABLE', `no ${TITLES[mode.browser]} to drive (${reasons[0] ?? 'unknown reason'}); ${installHint(mode.browser)}`, {platform: 'web'});
  }

  /** The build of each browser that is installed, where one is: the one playwright-core expects, or for Chromium any it can fall back on. */
  function installed(driver: Record<BrowserName, BrowserType>): Partial<Record<BrowserName, string>> {
    const builds: Partial<Record<BrowserName, string>> = {};
    for (const name of BROWSERS) {
      let file = '';
      try {
        file = driver[name].executablePath();
      } catch {
        // A browser type that cannot say where its build would be has none.
      }
      if (file && fs.existsSync(file)) builds[name] = buildOf(file);
    }
    const fallback = browsers(false)[0];
    if (!builds.chromium && fallback) builds.chromium = buildOf(fallback);
    return builds;
  }

  /** The recording in progress: the page it is on, the file each page it has been on is written to, in order, and why it stopped short. */
  let recording: {page: Page | null; parts: string[]; failure?: string} | null = null;

  /** The recording carried onto a page. A page's screencast ends with the page, so each page is a part of its own. */
  async function record(next: Page): Promise<void> {
    if (!recording) return;
    const screencast = next.screencast;
    if (!screencast) {
      recording.failure = 'this playwright-core has no page.screencast to record with; 1.59 and later have it';
      return;
    }
    const part = prepare(path.join(options.root, '.harness', 'video-raw', `web-${process.pid}-${Date.now()}-${recording.parts.length + 1}.webm`));
    try {
      await screencast.start({path: part, size: next.viewportSize() ?? VIEWPORT});
      recording.page = next;
      recording.parts.push(part);
    } catch (error) {
      // The test goes on without a recording, and the stop says why there is none. Playwright counts a start that failed as started until it is stopped.
      await screencast.stop().catch(() => {});
      const reason = firstLine((error as Error).message);
      recording.failure = /ffmpeg/i.test(reason) ? `${reason}; ${installHint('ffmpeg')}` : reason;
    }
  }

  /** The part of the recording on a page about to be thrown away, written out while the page is still there. */
  async function endPart(old: Page | null): Promise<void> {
    if (!recording || !old || recording.page !== old) return;
    recording.page = null;
    await old.screencast?.stop().catch(() => {});
  }

  /** A page in a context of its own, which keeps nothing from before: no cookies, no storage, only the permissions the app is granted. */
  async function freshPage(launched: Browser): Promise<Page> {
    // A browser refuses a context whose grants it does not know, so the ones it would refuse are passed over, as the warm-up says.
    const {granted} = grantsIn(mode.browser, webGrants(options.app?.permissions));
    const context = await launched.newContext({viewport: VIEWPORT, ...(granted.length ? {permissions: granted} : {})});
    const fresh = await context.newPage();
    await fresh.addInitScript(INIT);
    fresh.on('console', message => {
      for (const listener of listeners) listener(message.type(), message.text());
    });
    fresh.on('pageerror', error => {
      for (const listener of listeners) listener('uncaught', error.message);
    });
    fresh.on('dialog', dialog => {
      // A test's word for the next dialog wins over its answer for every one, and with neither a dialog is dismissed.
      const once = nextDialog;
      nextDialog = null;
      const always = dialogs;
      void (async () => {
        const answer = once ?? (typeof always === 'function' ? await always({type: dialog.type(), message: dialog.message()}) : always) ?? 'dismiss';
        await (answer === 'accept' ? dialog.accept() : dialog.dismiss());
      })().catch(() => {});
    });
    for (const route of routes) await context.route(route.pattern, route.handler);
    return fresh;
  }

  async function open(): Promise<Page> {
    if (page) return page;
    browser ??= await launch();
    page = await freshPage(browser);
    await record(page);
    return page;
  }

  /** The page thrown away with its context, and a fresh one at the app's base. */
  async function relaunch(): Promise<StepResult> {
    const old = page;
    page = null;
    lastRead = null;
    await endPart(old);
    await old?.context().close();
    const current = await open();
    try {
      await current.goto(base, {waitUntil: 'load', timeout: navigation});
    } catch (error) {
      return failed(`could not open ${base}: ${firstLine((error as Error).message)}`, 'APP_UNREACHABLE');
    }
    return ok(`a new browser context, at ${base}`);
  }

  /** A node as the page's script answers it, with what the kind is worked out from. */
  type Collected = SnapshotNode & {ariaRole?: string; leaf?: boolean};

  /** The last tree read, with the page's counter when it was read; it stands while the counter does, for up to KEEP_MS. */
  let lastRead: {origin: number; generation: number; at: number; nodes: SnapshotNode[]} | null = null;

  /** The tree now: the last read, when the page says nothing has changed since, or a new one. */
  async function collect(): Promise<SnapshotNode[]> {
    const current = await open();
    const last = lastRead && Date.now() - lastRead.at < KEEP_MS ? {origin: lastRead.origin, generation: lastRead.generation} : null;
    type Read = {same: true} | {same?: undefined; origin: number; generation: number; nodes: Collected[]};
    const read = (): Promise<Read> => current.evaluate<Read>(`(${COLLECT})(${JSON.stringify(last)})`);
    let answer: Read;
    try {
      answer = await read();
    } catch (error) {
      // A press on a link navigates, which throws away the context the script
      // was going to run in. The page that replaced it is the one being asked
      // about, so let it arrive and ask again.
      if (!/context was destroyed|Execution context/i.test((error as Error).message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
      answer = await read();
    }
    if (answer.same && lastRead) return [...lastRead.nodes];
    if (answer.same) throw new Error('the page answered an unchanged tree to a first read');
    // The page says which ARIA role each node has; the kind is the harness's word for it.
    const nodes = answer.nodes.map(({ariaRole, leaf, ...node}) => {
      const kind = kindOnWeb(ariaRole, Boolean(leaf));
      return kind ? {...node, kind} : node;
    });
    lastRead = {origin: answer.origin, generation: answer.generation, at: Date.now(), nodes};
    return [...nodes];
  }

  function target(to: string): string {
    return /^[a-z]+:\/\//i.test(to) ? to : new URL(to.startsWith('/') ? to : `/${to}`, base).toString();
  }

  async function frameSnapshot(frame: number): Promise<Snapshot> {
    const nodes = await collectFrame(frame);
    const viewport = (await open()).viewportSize();
    return {platform: 'web', source: `${base} ${frames[frame - 1] ?? ''}`, nodes, ...(viewport ? {viewport} : {})};
  }

  async function snapshot(snapshotOptions: SnapshotOptions = {}): Promise<Snapshot> {
    const nodes = await collect();
    const viewport = (await open()).viewportSize();
    return {
      platform: 'web',
      source: base,
      nodes: snapshotOptions.interactive ? narrow(nodes, node => node.interactive && !node.offscreen) : nodes,
      ...(viewport ? {viewport} : {}),
    };
  }

  /**
   * Where a target is, resolved against the tree now. A press goes to the
   * middle of the node's box, which is what every other platform presses by,
   * so the harness reads the same everywhere. It must reach the node: where
   * something else is over that point, such as an overlay, the press would
   * land on that instead, and the step says what it is rather than press it.
   */
  /** The node a selector names in a fresh read, and the tree it is in, or the error that there is none. */
  async function nodeFor(what: Target): Promise<{node: SnapshotNode; tree: Snapshot}> {
    const selector = asSelector(what);
    // A ref in a frame is found in the frame's tree.
    const frame = !isPoint(selector) && selector.ref ? refOf(selector.ref).frame : 0;
    const tree = frame ? await frameSnapshot(frame) : await snapshot();
    const node = isPoint(selector) ? undefined : findNode(tree, selector);
    if (!node) {
      const instead = isPoint(selector) ? '' : seenInstead(tree, selector);
      throw new HarnessError('LOCATOR_NOT_FOUND', `nothing matches ${describeTarget(what)} on the page (${tree.nodes.length} nodes)${instead ? `; ${instead}` : ''}`, {platform: 'web'});
    }
    return {node, tree};
  }

  /** Which frame a ref is in, 0 for the page itself, and the element's number there. */
  function refOf(ref: string): {frame: number; id: number} {
    const match = /^@(?:f(\d+))?e(\d+)$/.exec(ref);
    return {frame: match?.[1] ? Number(match[1]) : 0, id: match ? Number(match[2]) : -1};
  }

  /** Where the refs of a frame live, the page's own for frame 0, and where the frame's coordinates start on the page. */
  async function realm(frame: number): Promise<{evaluate<T>(source: string): Promise<T>; evaluateHandle(source: string): Promise<JSHandle>; offset: Point}> {
    const current = await open();
    if (frame === 0) return {evaluate: source => current.evaluate(source), evaluateHandle: source => current.evaluateHandle(source), offset: {x: 0, y: 0}};
    const selector = frames[frame - 1] ?? '';
    const element = await current.$(selector);
    const content = await element?.contentFrame();
    const offset = await current.evaluate<Point | null>(`(${FRAME_BOX})(${JSON.stringify(selector)})`);
    if (!content || !offset) throw new HarnessError('LOCATOR_NOT_FOUND', `no frame on the page matches ${selector}`, {platform: 'web'});
    return {evaluate: source => content.evaluate(source), evaluateHandle: source => content.evaluateHandle(source), offset};
  }

  /** A frame's tree, read afresh each time, its refs naming the frame and its boxes moved to where the frame is on the page. */
  async function collectFrame(frame: number): Promise<SnapshotNode[]> {
    const {evaluate, offset} = await realm(frame);
    const answer = await evaluate<{nodes: Collected[]}>(`(${COLLECT})(null)`);
    const named = (ref: string) => ref.replace(/^@e/, `@f${frame}e`);
    return answer.nodes.map(({ariaRole, leaf, ...node}) => {
      const kind = kindOnWeb(ariaRole, Boolean(leaf));
      const moved: SnapshotNode = {
        ...node,
        ref: named(node.ref),
        ...(node.parent ? {parent: named(node.parent)} : {}),
        ...(node.bounds ? {bounds: {...node.bounds, x: node.bounds.x + offset.x, y: node.bounds.y + offset.y}} : {}),
      };
      return kind ? {...moved, kind} : moved;
    });
  }

  /** The element a node is, as Playwright holds it, for what only Playwright does to one; null where it has gone. */
  async function handleOf(node: SnapshotNode): Promise<ElementHandle | null> {
    const {frame, id} = refOf(node.ref);
    const held = await (await realm(frame)).evaluateHandle(ELEMENT(id));
    return held.asElement();
  }

  /** Does something in the page, or the frame, to the element a node is, or says the node has gone. Its box is the page's. */
  async function onElement(node: SnapshotNode, what: 'focus' | 'scroll'): Promise<{there: boolean; focused?: boolean; scrolled?: boolean; box?: Bounds}> {
    const {frame, id} = refOf(node.ref);
    const {evaluate, offset} = await realm(frame);
    // A scroll moves boxes without a mutation, so the next read starts again.
    lastRead = null;
    const done = await evaluate<{there: boolean; focused?: boolean; scrolled?: boolean; box?: Bounds}>(`(${ON_ELEMENT})(${JSON.stringify([id, what])})`);
    return done.box ? {...done, box: {...done.box, x: done.box.x + offset.x, y: done.box.y + offset.y}} : done;
  }

  async function pointFor(what: Target): Promise<{point: Point; note: string}> {
    const selector = asSelector(what);
    if (isPoint(selector)) return {point: selector, note: `${selector.x},${selector.y}`};
    const {node, tree} = await nodeFor(selector);
    const note = `${node.ref} ${node.role} ${JSON.stringify(node.name)}`;
    if (!node.bounds || node.bounds.width === 0) throw new HarnessError('NOT_ACTIONABLE', `${note} is not on screen to press`, {platform: 'web'});
    // A press outside the viewport lands on nothing, so a node below the fold
    // is scrolled to first, as Playwright scrolls one before it clicks.
    const shown = await onElement(node, 'scroll');
    if (!shown.there) throw new HarnessError('LOCATOR_NOT_FOUND', `${note} has gone from the page`, {platform: 'web'});
    const box = shown.box ?? node.bounds;
    const point = {x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2)};
    // Where the press lands is asked of the frame the node is in, at the frame's own coordinates.
    const {frame, id} = refOf(node.ref);
    const {evaluate, offset} = await realm(frame);
    const lands = await evaluate<{ref?: string; tag?: string} | null>(`(${LANDS})(${JSON.stringify([id, point.x - offset.x, point.y - offset.y])})`);
    if (lands) {
      const landed = lands.ref && frame ? lands.ref.replace(/^@e/, `@f${frame}e`) : lands.ref;
      const other = tree.nodes.find(each => each.ref === landed);
      const what = other ? `${other.ref} ${other.role} ${JSON.stringify(other.name)}` : `a <${lands.tag}>`;
      throw new HarnessError('NOT_ACTIONABLE', `${note} is covered: a press at ${point.x},${point.y} would land on ${what}`, {platform: 'web'});
    }
    return {point, note};
  }

  return {
    platform: 'web',

    async available(): Promise<Availability> {
      const driver = playwright();
      if (!driver) return {ready: false, reason: 'playwright-core did not load: it comes with expo-vitest, so install expo-vitest again'};
      if (mode.invalid) return {ready: false, reason: mode.invalid};
      const slower = mode.slowMo ? `, ${mode.slowMo} ms slower each operation` : '';
      // An endpoint is reached at the first step: asking now would be a session of a hosted browser's for nothing.
      if (mode.cdp) return {ready: true, found: `the Chromium at ${mode.cdp}, over CDP${slower}`, ...(mode.passedOver ? {notes: mode.passedOver.map(clause => `passed over ${clause}`)} : {})};
      const builds = installed(driver);
      const details = browserLines(builds, mode.browser);
      const windowed = mode.headed ? ', in a window' : '';
      const {refused} = grantsIn(mode.browser, webGrants(options.app?.permissions));
      const notes = refused.length ? {notes: [`passed over ${refused.join(' and ')} in app.web.permissions, which ${TITLES[mode.browser]} does not grant a page`]} : {};
      if (mode.browser !== 'chromium') {
        const build = builds[mode.browser];
        if (!build) return {ready: false, reason: `${TITLES[mode.browser]} is not installed; ${installHint(mode.browser)}`, details};
        return {ready: true, found: `${TITLES[mode.browser]} at ${build}${windowed}${slower}`, details, ...notes};
      }
      const found = browsers(mode.headed);
      // Playwright may find a browser of its own, so only a shell and no full browser is a sure no.
      if (mode.headed && found.length === 0 && browsers(false).some(isShell)) return {ready: false, reason: HEADED_NEEDS_FULL, details};
      const where = found[0] ? `Chromium at ${buildOf(found[0])}` : 'Chromium through playwright';
      return {ready: true, found: `${where}${windowed}${slower}`, details};
    },

    async open(to: string): Promise<StepResult> {
      const current = await open();
      const url = target(to);
      // Whatever an action does to the page, the next read starts again.
      lastRead = null;
      try {
        await current.goto(url, {waitUntil: 'load', timeout: navigation});
      } catch (error) {
        // A server that is not up, or a page that never finishes loading: the
        // app is not there to drive, which is a different fix from a step failing.
        return failed(`could not open ${url}: ${firstLine((error as Error).message)}`, 'APP_UNREACHABLE');
      }
      return ok(`opened ${url}`);
    },

    snapshot,

    async video(action: 'start' | 'stop', file?: string): Promise<ControlResult> {
      if (action === 'start') {
        if (recording) return ok('already recording');
        // The page goes on as it was: a page already open is recorded from now, and otherwise the first page the test opens is.
        recording = {page: null, parts: []};
        if (page) await record(page);
        const failure = recording.failure;
        if (!failure) return ok('recording the page');
        recording = null;
        return failed(`the recording could not start: ${failure}`);
      }
      const done = recording;
      recording = null;
      if (!done) return ok('nothing was being recorded');
      try {
        if (done.page && !done.page.isClosed()) await done.page.screencast?.stop();
      } catch (error) {
        done.failure ??= firstLine((error as Error).message);
      }
      const parts = done.parts.filter(part => fs.existsSync(part));
      if (!file || parts.length === 0) {
        for (const part of done.parts) fs.rmSync(part, {force: true});
        if (done.failure) return failed(`the recording failed: ${done.failure}`);
        return ok(file ? 'the test opened no page to record' : 'threw the recording away');
      }
      // The first page's part is the file, and each page after it is beside it, numbered.
      parts.forEach((part, index) => {
        fs.copyFileSync(part, prepare(numbered(file, index + 1)));
        fs.rmSync(part, {force: true});
      });
      return {...ok(`saved ${path.relative(options.root, file)}${parts.length > 1 ? ` and ${parts.length - 1} more beside it` : ''}`), value: file};
    },

    async control(request: ControlRequest): Promise<ControlResult> {
      const lacks = lacking(request, 'web');
      if (lacks) return lacks;
      try {
        switch (request.name) {
          case 'restart':
            return await relaunch();
          case 'clearState': {
            const result = await relaunch();
            return result.ok ? ok(`cleared: ${result.message}, with no cookies or storage kept`) : result;
          }
          case 'back': {
            const current = await open();
            lastRead = null;
            const went = await current.goBack({waitUntil: 'load', timeout: navigation});
            return ok(went ? `went back to ${current.url()}` : 'there was no page to go back to');
          }
          case 'openLink': {
            if (!/^https?:/i.test(request.url)) return cannot(request, 'web', CANNOT.webLink);
            const current = await open();
            lastRead = null;
            await current.goto(request.url, {waitUntil: 'load', timeout: navigation});
            return ok(`opened ${request.url}`);
          }
          case 'foregroundApp': {
            const current = await open();
            const url = current.url();
            return {...ok(`${JSON.stringify(await current.title())} at ${url}`), value: url};
          }
          case 'setAppearance': {
            const current = await open();
            lastRead = null;
            await current.emulateMedia({colorScheme: request.mode});
            return ok(`set the page's colour scheme to ${request.mode}`);
          }
          case 'setOrientation': {
            // A browser has no orientation, but its viewport turns: the long side across or down.
            const current = await open();
            const size = current.viewportSize() ?? {width: 1280, height: 900};
            const long = Math.max(size.width, size.height);
            const short = Math.min(size.width, size.height);
            const portrait = request.orientation.startsWith('portrait');
            lastRead = null;
            await current.setViewportSize(portrait ? {width: short, height: long} : {width: long, height: short});
            return ok(`turned the viewport to ${portrait ? `${short} by ${long}` : `${long} by ${short}`}`);
          }
          case 'setNetwork': {
            const current = await open();
            await current.context().setOffline(!request.online);
            return ok(`took the page ${request.online ? 'online' : 'offline'}`);
          }
          case 'setPermission': {
            if (request.state === 'deny') return cannot(request, 'web', CANNOT.webDeny);
            const current = await open();
            if (request.state === 'reset') {
              await current.context().clearPermissions();
              return ok('cleared every permission the browser context was granted');
            }
            const [granted] = webGrants({[request.permission]: 'grant'});
            if (!granted) return cannot(request, 'web', CANNOT.webPermission);
            if (!GRANTS[mode.browser].includes(granted)) return failed(`${TITLES[mode.browser]} does not grant a page ${granted}`);
            await current.context().grantPermissions([granted]);
            return ok(`granted ${granted}`);
          }
          case 'setLocation': {
            const current = await open();
            await current.context().grantPermissions(['geolocation']);
            await current.context().setGeolocation({latitude: request.latitude, longitude: request.longitude});
            return ok(`put the page at ${request.latitude},${request.longitude}`);
          }
          case 'clearLocation': {
            const current = await open();
            await current.context().setGeolocation(null);
            return ok('the page has no location to read now');
          }
          case 'clipboard': {
            const elsewhere = noClipboard(mode.browser);
            if (elsewhere) return failed(elsewhere);
            const current = await open();
            await current.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            const read = await current.evaluate<string>('navigator.clipboard.readText()');
            return {...ok(`read ${read.length} characters from the clipboard`), value: read};
          }
          case 'setClipboard': {
            const elsewhere = noClipboard(mode.browser);
            if (elsewhere) return failed(elsewhere);
            const current = await open();
            await current.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            await current.evaluate(`navigator.clipboard.writeText(${JSON.stringify(request.text)})`);
            return ok(`put ${request.text.length} characters on the clipboard`);
          }
          case 'dismissKeyboard': {
            const current = await open();
            lastRead = null;
            await current.evaluate('document.activeElement instanceof HTMLElement && document.activeElement.blur()');
            return ok('took the focus off what had it');
          }
          case 'alert':
            nextDialog = request.action;
            return ok(`the next dialog will be ${request.action === 'accept' ? 'accepted' : 'dismissed'}`);
          default:
            return failed(`${request.name} is not a control the web harness knows`, 'INVALID_ARGUMENT');
        }
      } catch (error) {
        return failed(`${describeControl(request)} failed: ${firstLine((error as Error).message)}`, codeOf(error));
      }
    },

    async press(what: Target, pressOptions: PressOptions = {}): Promise<StepResult> {
      try {
        const {point, note} = await pointFor(what);
        const current = await open();
        lastRead = null;
        // A click count of 2 is a double click, as the browser counts one: a `dblclick` after the second.
        const count = pressOptions.count ?? 1;
        await current.mouse.click(point.x, point.y, {clickCount: count});
        return ok(`pressed ${note}${count > 1 ? ` ${count} times` : ''}`);
      } catch (error) {
        return failed((error as Error).message.split('\n')[0] ?? 'press failed', codeOf(error));
      }
    },

    async fill(what: Target, text: string): Promise<StepResult> {
      try {
        const {point, note} = await pointFor(what);
        const current = await open();
        lastRead = null;
        await current.mouse.click(point.x, point.y);
        // What the field held goes first, so a fill replaces it, as it does
        // through agent-device and a Windows field's Value pattern. The
        // browser is this machine's, so its own key selects all.
        await current.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await current.keyboard.press('Backspace');
        await current.keyboard.type(text);
        return ok(`filled ${note} with ${JSON.stringify(text)}`);
      } catch (error) {
        return failed((error as Error).message.split('\n')[0] ?? 'fill failed', codeOf(error));
      }
    },

    async type(text: string): Promise<StepResult> {
      const current = await open();
      lastRead = null;
      await current.keyboard.type(text);
      return ok(`typed ${text.length} characters`);
    },

    async longPress(what: Target, pressOptions: LongPressOptions = {}): Promise<StepResult> {
      const held = pressOptions.duration ?? HOLD_MS;
      try {
        const {point, note} = await pointFor(what);
        const current = await open();
        lastRead = null;
        await current.mouse.move(point.x, point.y);
        await current.mouse.down();
        await new Promise(resolve => setTimeout(resolve, held));
        await current.mouse.up();
        return ok(`held ${note} for ${held} ms`);
      } catch (error) {
        return failed((error as Error).message.split('\n')[0] ?? 'long press failed', codeOf(error));
      }
    },

    async hover(what: Target): Promise<StepResult> {
      try {
        const {point, note} = await pointFor(what);
        const current = await open();
        lastRead = null;
        await current.mouse.move(point.x, point.y);
        return ok(`hovered over ${note}`);
      } catch (error) {
        return failed((error as Error).message.split('\n')[0] ?? 'hover failed', codeOf(error));
      }
    },

    async focus(what: Target): Promise<StepResult> {
      try {
        const {node} = await nodeFor(what);
        const note = `${node.ref} ${node.role} ${JSON.stringify(node.name)}`;
        const done = await onElement(node, 'focus');
        if (!done.there) return failed(`${note} has gone from the page`, 'LOCATOR_NOT_FOUND');
        return done.focused ? {...ok(`focused ${note}`), verified: true} : failed(`${note} does not take the focus`, 'NOT_ACTIONABLE');
      } catch (error) {
        return failed((error as Error).message.split('\n')[0] ?? 'focus failed', codeOf(error));
      }
    },

    async scrollIntoView(what: Target): Promise<StepResult> {
      try {
        const {node} = await nodeFor(what);
        const note = `${node.ref} ${node.role} ${JSON.stringify(node.name)}`;
        const done = await onElement(node, 'scroll');
        if (!done.there) return failed(`${note} has gone from the page`, 'LOCATOR_NOT_FOUND');
        return ok(done.scrolled ? `scrolled ${note} into view` : `${note} was in view already`);
      } catch (error) {
        return failed((error as Error).message.split('\n')[0] ?? 'scrolling failed', codeOf(error));
      }
    },

    web: {
      async route(pattern: string, handler: (route: WebRoute) => unknown): Promise<() => Promise<void>> {
        const listener = async (route: Route) => {
          const request = route.request();
          let answered = false;
          const once = (answer: () => Promise<void>) => () => {
            answered = true;
            return answer();
          };
          const given: WebRoute = {
            request: {url: request.url(), method: request.method(), headers: request.headers(), body: request.postData()},
            fulfill: response => once(() => route.fulfill(response))(),
            continue: once(() => route.continue()),
            abort: once(() => route.abort()),
          };
          try {
            await handler(given);
            if (!answered) await route.continue();
          } catch (error) {
            // A handler that throws leaves the request with no answer, so it fails, and the console says why.
            for (const each of listeners) each('error', `the route for ${pattern} threw: ${firstLine((error as Error).message)}`);
            if (!answered) await route.abort().catch(() => {});
          }
        };
        const entry = {pattern, handler: listener};
        routes.push(entry);
        await (await open()).context().route(pattern, listener);
        return async () => {
          const at = routes.indexOf(entry);
          if (at >= 0) routes.splice(at, 1);
          await page?.context().unroute(pattern, listener).catch(() => {});
        };
      },

      onDialog(answer: DialogAnswer): () => void {
        dialogs = answer;
        return () => {
          if (dialogs === answer) dialogs = null;
        };
      },

      async evaluate<T>(expression: string): Promise<T> {
        lastRead = null;
        return (await open()).evaluate<T>(expression);
      },

      async setViewport(size: {width: number; height: number}): Promise<void> {
        lastRead = null;
        await (await open()).setViewportSize(size);
      },

      async cookies(): Promise<WebCookie[]> {
        return (await open()).context().cookies();
      },

      async setCookies(cookies: WebCookie[]): Promise<void> {
        await (await open()).context().addCookies(cookies);
      },

      async clearCookies(): Promise<void> {
        await (await open()).context().clearCookies();
      },

      async download(trigger: () => Promise<unknown>, file: (suggested: string) => string): Promise<string> {
        const current = await open();
        const [download] = await Promise.all([current.waitForEvent('download', {timeout: navigation}), trigger()]);
        const kept = prepare(file(download.suggestedFilename()));
        await download.saveAs(kept);
        return kept;
      },

      async selectOption(what: Target, option: OptionChoice): Promise<StepResult> {
        try {
          const {node} = await nodeFor(what);
          const note = `${node.ref} ${node.role} ${JSON.stringify(node.name)}`;
          const wanted = typeof option === 'string' ? {label: option} : option;
          // Playwright waits out its whole timeout for an option the select
          // lacks, and then says only that it timed out. The select is there,
          // so the answer is at once, with what it offers.
          const {frame, id} = refOf(node.ref);
          const offered = await (await realm(frame)).evaluate<{label: string; value: string}[] | null>(OPTIONS(id));
          const has = (each: {label: string; value: string}, at: number) => ('index' in wanted ? at === wanted.index : 'value' in wanted ? each.value === wanted.value : each.label === wanted.label);
          if (offered && !offered.some(has)) {
            const named = offered.map(each => JSON.stringify(each.label)).join(', ');
            return failed(`${note} has no option ${JSON.stringify(option)}; its options are ${named || 'none'}`, 'ACTION_FAILED');
          }
          const element = await handleOf(node);
          if (!element) return failed(`${note} has gone from the page`, 'LOCATOR_NOT_FOUND');
          lastRead = null;
          const chosen = await element.selectOption(wanted);
          await element.dispose();
          return ok(`chose ${JSON.stringify(chosen[0])} in ${note}`);
        } catch (error) {
          return failed(firstLine((error as Error).message), codeOf(error));
        }
      },

      async setInputFiles(what: Target, files: string[]): Promise<StepResult> {
        try {
          const {node} = await nodeFor(what);
          const note = `${node.ref} ${node.role} ${JSON.stringify(node.name)}`;
          const element = await handleOf(node);
          if (!element) return failed(`${note} has gone from the page`, 'LOCATOR_NOT_FOUND');
          lastRead = null;
          await element.setInputFiles(files);
          await element.dispose();
          return ok(`gave ${note} ${files.length === 1 ? '1 file' : `${files.length} files`}`);
        } catch (error) {
          return failed(firstLine((error as Error).message), codeOf(error));
        }
      },

      async secondaryTap(what: Target): Promise<StepResult> {
        try {
          const {point, note} = await pointFor(what);
          const current = await open();
          lastRead = null;
          await current.mouse.click(point.x, point.y, {button: 'right'});
          return ok(`pressed ${note} with the secondary button`);
        } catch (error) {
          return failed(firstLine((error as Error).message), codeOf(error));
        }
      },

      frame(selector: string): number {
        const known = frames.indexOf(selector);
        if (known >= 0) return known + 1;
        frames.push(selector);
        return frames.length;
      },

      frameSnapshot,
    },

    onConsole(listener: (level: string, text: string) => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async react(): Promise<ReactTree | {unavailable: string}> {
      // The page is the runtime on web, so the walk runs in it, through the
      // hook the init script installed, after a read of the tree, which
      // gives the page the refs a React node is matched to.
      await collect();
      const current = await open();
      return current.evaluate<ReactTree | {unavailable: string}>(walkExpression());
    },

    async swipe(from: Point, to: Point): Promise<StepResult> {
      // A page scrolls under a wheel, not under a mouse drawn across it,
      // which would select text: a finger drawn up turns the wheel down.
      const current = await open();
      lastRead = null;
      await current.mouse.move(from.x, from.y);
      await current.mouse.wheel(from.x - to.x, from.y - to.y);
      return ok(`swiped from ${from.x},${from.y} to ${to.x},${to.y}`);
    },

    async key(name: string): Promise<StepResult> {
      const current = await open();
      lastRead = null;
      await current.keyboard.press(name);
      return ok(`pressed ${name}`);
    },

    async screenshot(file: string): Promise<StepResult> {
      const current = await open();
      const out = prepare(file);
      // Animations stopped at their end and the caret hidden, so two pictures of the same screen are the same.
      await current.screenshot({path: out, animations: 'disabled', caret: 'hide'});
      return ok(`saved ${path.relative(options.root, out)}`);
    },

    async idleSeconds(): Promise<number | null> {
      // A headless browser has no user to be idle.
      return null;
    },

    async close(): Promise<void> {
      await browser?.close().catch(() => {});
      // A recording the browser's close cut short is not kept.
      for (const part of recording?.parts ?? []) fs.rmSync(part, {force: true});
      browser = null;
      page = null;
      recording = null;
      lastRead = null;
    },
  };
}

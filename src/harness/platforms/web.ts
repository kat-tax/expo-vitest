import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {HarnessError, codeOf} from '../lib/errors.ts';
import {firstLine, prepare} from '../lib/run.ts';
import type {Point, Snapshot, SnapshotNode, Target} from '../lib/snapshot.ts';
import {asSelector, describeTarget, findNode, isPoint, narrow, seenInstead} from '../lib/snapshot.ts';
import type {Availability, Driver, DriverOptions, SnapshotOptions, StepResult} from '../lib/types.ts';
import {failed, ok} from '../lib/types.ts';

const DEFAULT_URL = 'http://localhost:8081';

/** Where a `playwright install` leaves the headless shell, when playwright cannot find it itself. */
function shells(): string[] {
  const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
  const roots = [path.join(home, 'ms-playwright'), path.join(home, 'Library', 'Caches', 'ms-playwright'), path.join(home, '.cache', 'ms-playwright')];
  const found: string[] = [];
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root).filter(entry => entry.startsWith('chromium_headless_shell-') || entry.startsWith('chromium-'));
    } catch {
      continue;
    }
    entries.sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)));
    for (const entry of entries) {
      for (const relative of [
        path.join('chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
        path.join('chrome-win', 'headless_shell.exe'),
        path.join('chrome-win', 'chrome.exe'),
        path.join('chrome-headless-shell-mac', 'chrome-headless-shell'),
        path.join('chrome-linux', 'headless_shell'),
        path.join('chrome-linux', 'chrome'),
      ]) {
        const file = path.join(root, entry, relative);
        if (fs.existsSync(file)) found.push(file);
      }
    }
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
})();`;

/**
 * Runs in the page: reads every interesting element's role, name and box, and
 * gives it a ref. Given the counter of the last read, it answers `same` when
 * nothing has changed since, and the driver keeps what it read then.
 */
const COLLECT = `((last) => {
  const state = window.__harness;
  const origin = performance.timeOrigin;
  if (last && state && last.origin === origin && last.generation === state.generation) return {same: true};
  // A ref lasts as long as its element does in this document, so a node keeps
  // its ref while the page changes around it, and a ref from an earlier
  // snapshot still names its element if that is still there. Nothing is
  // written to the page: the app may be watching it.
  const refs = window.__harnessRefs || (window.__harnessRefs = {ids: new WeakMap(), next: 0, elements: new Map()});
  const idOf = (element) => {
    let id = refs.ids.get(element);
    if (id === undefined) { id = ++refs.next; refs.ids.set(element, id); }
    return id;
  };
  const elements = new Map();
  // What can be acted on, plus the leaves that carry text — the same two kinds
  // UI Automation reports on Windows, so a test finds a label on either. A
  // container's text is its children's, so only leaves are taken; that keeps
  // the tree small enough to read and to put in front of a model.
  const selector = '[role],button,a,input,select,textarea,h1,h2,h3,h4,dialog,[popover],[tabindex],p,li,td,label,span,div';
  const ACTIONABLE = new Set(['button', 'link', 'a', 'menuitem', 'menuitemcheckbox', 'checkbox', 'switch', 'tab', 'textbox', 'input', 'select', 'textarea', 'slider', 'option', 'radio']);
  const depthOf = (node) => { let d = 0; for (let p = node.parentElement; p; p = p.parentElement) d++; return d; };
  // The refs given out by this collect, so a node's parent is the nearest
  // ancestor kept now.
  const kept = new Map();
  const parentOf = (node) => { for (let p = node.parentElement; p; p = p.parentElement) if (kept.has(p)) return kept.get(p); return undefined; };
  const nodes = [];
  const PLAIN = new Set(['P', 'LI', 'TD', 'LABEL', 'SPAN', 'DIV']);
  // An element's text, as a screen reader reads it: what is inside it, less
  // what is hidden from one, with a space where the text passes from one
  // element to another. react-native-web puts each line of a Pressable in a
  // div of its own with nothing between them, and joined bare they would run
  // together.
  const textOf = (root) => {
    let text = '';
    let previous = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const hidden = node.parentElement && node.parentElement.closest('[aria-hidden="true"]');
      if (hidden && hidden !== root && root.contains(hidden)) continue;
      text += (previous && previous !== node.parentElement ? ' ' : '') + node.data;
      previous = node.parentElement;
    }
    return text.replace(/\\s+/g, ' ').trim();
  };
  for (const element of document.querySelectorAll(selector)) {
    const box = element.getBoundingClientRect();
    const role = element.getAttribute('role') ?? element.tagName.toLowerCase();
    // react-native-web draws a Pressable with no role as a div that takes the
    // focus (tabindex 0), or, disabled, one marked aria-disabled: a control
    // all the same, named by the text inside it.
    const pressable = PLAIN.has(element.tagName) && !element.hasAttribute('role') &&
      ((element.hasAttribute('tabindex') && element.tabIndex >= 0) || element.getAttribute('aria-disabled') === 'true' || element.isContentEditable);
    // A plain container earns a place only when it is the leaf holding the text.
    if (PLAIN.has(element.tagName) && !element.hasAttribute('role') && !pressable && (element.childElementCount > 0 || !(element.textContent ?? '').trim())) continue;
    // The accessible name, in the order a screen reader works it out. The last
    // two steps are not optional niceties: a checkbox is an empty <input> with
    // no text of its own, and it takes its name from the <label> wrapped round
    // it — reading textContent alone reports it as nameless and fails an
    // accessibility assertion that is actually being met.
    let name = element.getAttribute('aria-label') ?? '';
    if (!name) {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        name = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      }
    }
    if (!name && element.labels && element.labels.length > 0) {
      name = [...element.labels].map((each) => each.textContent ?? '').join(' ').replace(/\\s+/g, ' ').trim();
    }
    if (!name) name = textOf(element);
    name = name.slice(0, 80);
    const id = idOf(element);
    const ref = '@e' + id;
    elements.set(id, new WeakRef(element));
    // Elements come in document order, so an ancestor is always kept before
    // anything inside it.
    const parent = parentOf(element);
    kept.set(element, ref);
    // react-native-web writes testID as data-testid, and an app's own DOM
    // components write it directly, so both arrive here the same way.
    const testId = element.getAttribute('data-testid');
    nodes.push({
      ref,
      ...(parent ? {parent} : null),
      role,
      name,
      ...(testId ? {testId} : null),
      depth: depthOf(element),
      interactive: pressable || ACTIONABLE.has(role) || ACTIONABLE.has(element.tagName.toLowerCase()),
      focused: document.activeElement === element,
      // react-native-web disables with aria-disabled, not the attribute.
      enabled: !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true',
      offscreen: box.width === 0 || box.height === 0,
      bounds: {x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height)},
    });
  }
  // The elements this read named, for a press to find the one it points at.
  refs.elements = elements;
  return {origin, generation: state ? state.generation : -1, nodes};
})`;

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
  const require = createRequire(path.join(options.root, 'package.json'));
  const base = options.url ?? DEFAULT_URL;
  let browser: {newPage(o?: unknown): Promise<Page>; close(): Promise<void>} | null = null;
  let page: Page | null = null;

  interface Locator {
    click(o?: unknown): Promise<void>;
    fill(text: string): Promise<void>;
    count(): Promise<number>;
  }
  interface Page {
    addInitScript(script: string): Promise<void>;
    goto(url: string, o?: unknown): Promise<unknown>;
    screenshot(o: {path: string; fullPage?: boolean}): Promise<unknown>;
    mouse: {click(x: number, y: number): Promise<void>};
    keyboard: {type(text: string): Promise<void>; press(key: string): Promise<void>};
    locator(selector: string): Locator;
    evaluate<T>(fn: string): Promise<T>;
  }

  function playwright() {
    try {
      return require('playwright-core') as {chromium: {launch(o?: unknown): Promise<typeof browser>}};
    } catch {
      return null;
    }
  }

  async function open(): Promise<Page> {
    if (page) return page;
    const driver = playwright();
    if (!driver) throw new HarnessError('DRIVER_UNAVAILABLE', 'playwright-core is not installed in this project', {platform: 'web'});
    let launched: typeof browser = null;
    const reasons: string[] = [];
    for (const executablePath of [undefined, ...shells()]) {
      try {
        launched = await driver.chromium.launch(executablePath ? {headless: true, executablePath} : {headless: true});
        break;
      } catch (error) {
        reasons.push((error as Error).message.split('\n')[0] ?? '');
      }
    }
    if (!launched) throw new HarnessError('DRIVER_UNAVAILABLE', `no Chromium to drive (${reasons[0] ?? 'unknown reason'}); run \`bunx playwright install chromium\``, {platform: 'web'});
    browser = launched;
    page = await launched.newPage({viewport: {width: 1280, height: 900}});
    await page.addInitScript(INIT);
    return page;
  }

  /** The last tree read, with the page's counter when it was read; it stands while the counter does, for up to KEEP_MS. */
  let lastRead: {origin: number; generation: number; at: number; nodes: SnapshotNode[]} | null = null;

  /** The tree now: the last read, when the page says nothing has changed since, or a new one. */
  async function collect(): Promise<SnapshotNode[]> {
    const current = await open();
    const last = lastRead && Date.now() - lastRead.at < KEEP_MS ? {origin: lastRead.origin, generation: lastRead.generation} : null;
    type Read = {same: true} | {same?: undefined; origin: number; generation: number; nodes: SnapshotNode[]};
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
    lastRead = {origin: answer.origin, generation: answer.generation, at: Date.now(), nodes: answer.nodes};
    return [...answer.nodes];
  }

  function target(to: string): string {
    return /^[a-z]+:\/\//i.test(to) ? to : new URL(to.startsWith('/') ? to : `/${to}`, base).toString();
  }

  async function snapshot(snapshotOptions: SnapshotOptions = {}): Promise<Snapshot> {
    const nodes = await collect();
    return {
      platform: 'web',
      source: base,
      nodes: snapshotOptions.interactive ? narrow(nodes, node => node.interactive && !node.offscreen) : nodes,
    };
  }

  /**
   * Where a target is, resolved against the tree now. A press goes to the
   * middle of the node's box, which is what every other platform presses by,
   * so the harness reads the same everywhere. It must reach the node: where
   * something else is over that point, such as an overlay, the press would
   * land on that instead, and the step says what it is rather than press it.
   */
  async function pointFor(what: Target): Promise<{point: Point; note: string}> {
    const selector = asSelector(what);
    if (isPoint(selector)) return {point: selector, note: `${selector.x},${selector.y}`};
    const tree = await snapshot();
    const node = findNode(tree, selector);
    if (!node) {
      const instead = seenInstead(tree, selector);
      throw new HarnessError('LOCATOR_NOT_FOUND', `nothing matches ${describeTarget(what)} on the page (${tree.nodes.length} nodes)${instead ? `; ${instead}` : ''}`, {platform: 'web'});
    }
    const note = `${node.ref} ${node.role} ${JSON.stringify(node.name)}`;
    if (!node.bounds || node.bounds.width === 0) throw new HarnessError('NOT_ACTIONABLE', `${note} is not on screen to press`, {platform: 'web'});
    const point = {x: Math.round(node.bounds.x + node.bounds.width / 2), y: Math.round(node.bounds.y + node.bounds.height / 2)};
    const current = await open();
    const lands = await current.evaluate<{ref?: string; tag?: string} | null>(`(${LANDS})(${JSON.stringify([Number(node.ref.slice(2)), point.x, point.y])})`);
    if (lands) {
      const other = tree.nodes.find(each => each.ref === lands.ref);
      const what = other ? `${other.ref} ${other.role} ${JSON.stringify(other.name)}` : `a <${lands.tag}>`;
      throw new HarnessError('NOT_ACTIONABLE', `${note} is covered: a press at ${point.x},${point.y} would land on ${what}`, {platform: 'web'});
    }
    return {point, note};
  }

  return {
    platform: 'web',

    async available(): Promise<Availability> {
      if (!playwright()) return {ready: false, reason: 'playwright-core is not installed; add it to this project'};
      const shell = shells()[0];
      return {ready: true, found: shell ? `Chromium at ${path.basename(path.dirname(shell))}` : 'Chromium through playwright'};
    },

    async open(to: string): Promise<StepResult> {
      const current = await open();
      const url = target(to);
      // Whatever an action does to the page, the next read starts again.
      lastRead = null;
      try {
        await current.goto(url, {waitUntil: 'load', timeout: 30_000});
      } catch (error) {
        // A server that is not up, or a page that never finishes loading: the
        // app is not there to drive, which is a different fix from a step failing.
        return failed(`could not open ${url}: ${firstLine((error as Error).message)}`, 'APP_UNREACHABLE');
      }
      return ok(`opened ${url}`);
    },

    snapshot,

    async press(what: Target): Promise<StepResult> {
      try {
        const {point, note} = await pointFor(what);
        const current = await open();
        lastRead = null;
        await current.mouse.click(point.x, point.y);
        return ok(`pressed ${note}`);
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

    async key(name: string): Promise<StepResult> {
      const current = await open();
      lastRead = null;
      await current.keyboard.press(name);
      return ok(`pressed ${name}`);
    },

    async screenshot(file: string): Promise<StepResult> {
      const current = await open();
      const out = prepare(file);
      await current.screenshot({path: out});
      return ok(`saved ${path.relative(options.root, out)}`);
    },

    async idleSeconds(): Promise<number | null> {
      // A headless browser has no user to be idle.
      return null;
    },

    async close(): Promise<void> {
      await browser?.close().catch(() => {});
      browser = null;
      page = null;
      lastRead = null;
    },
  };
}

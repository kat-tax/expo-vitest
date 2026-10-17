/**
 * A unit test's surface on web: what Testing Library rendered into jsdom,
 * read by the script the web driver runs in a browser (`COLLECT`), told
 * that nothing is laid out, and acted on through user-event, as a person's
 * pointer and keyboard would act.
 */
import {act, render} from '@testing-library/react';
import {PointerEventsCheckLevel, userEvent} from '@testing-library/user-event';
import type {Surface} from '../device/surface.ts';
import {HarnessError, codeOf} from '../harness/lib/errors.ts';
import {kindOnWeb} from '../harness/lib/roles.ts';
import type {Snapshot, SnapshotNode, Target} from '../harness/lib/snapshot.ts';
import {asSelector, describeTarget, findNode, isPoint, narrow, seenInstead} from '../harness/lib/snapshot.ts';
import type {Driver, SnapshotOptions, StepResult} from '../harness/lib/types.ts';
import {elsewhere, failed, ok} from '../harness/lib/types.ts';
import {COLLECT} from '../harness/platforms/web-collect.ts';
import {openRoute} from './route.ts';

/** A node as the page's script answers it, with what the kind is worked out from. */
type Collected = SnapshotNode & {ariaRole?: string; leaf?: boolean};

/** Where the page's script keeps each element it gave a ref, by the ref's number. */
interface Refs {
  elements: Map<number, WeakRef<Element>>;
}

/** Text user-event types as it is: `{` and `[` open a key's name for it, and twice over is the character. */
function literal(text: string): string {
  return text.replace(/[{[]/g, '$&$&');
}

export function webSurface(): Surface {
  // The tree says what may be pressed, so user-event is not asked to judge it by a style jsdom works out without a stylesheet's cascade.
  const user = userEvent.setup({delay: null, pointerEventsCheck: PointerEventsCheckLevel.Never});

  function collect(): SnapshotNode[] {
    // The script is a function's source, which a page is given as text, and so is jsdom here.
    const read = new Function(`return (${COLLECT})(null, {layout: false})`)() as {nodes: Collected[]};
    return read.nodes.map(({ariaRole, leaf, ...node}) => {
      const kind = kindOnWeb(ariaRole, Boolean(leaf));
      return kind ? {...node, kind} : node;
    });
  }

  async function snapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
    const nodes = collect();
    return {platform: 'web', source: 'what the test rendered', nodes: options.interactive ? narrow(nodes, node => node.interactive && !node.offscreen) : nodes};
  }

  /** The element a target names: by its ref, which lasts as long as the element does, or by a selector in a fresh read. */
  async function target(what: Target): Promise<Element> {
    const selector = asSelector(what);
    if (isPoint(selector)) throw new HarnessError('UNSUPPORTED_CAPABILITY', 'a unit test draws nothing to press a point of; name the node', {platform: 'web'});
    let ref = selector.ref;
    if (!ref) {
      const tree = await snapshot();
      const node = findNode(tree, selector);
      if (!node) {
        const instead = seenInstead(tree, selector);
        throw new HarnessError('LOCATOR_NOT_FOUND', `nothing matches ${describeTarget(what)} in what the test rendered (${tree.nodes.length} nodes)${instead ? `; ${instead}` : ''}`, {platform: 'web'});
      }
      ref = node.ref;
    }
    const refs = (globalThis as {__harnessRefs?: Refs}).__harnessRefs;
    const element = refs?.elements.get(Number(ref.replace(/^@e/, '')))?.deref();
    if (!element || !element.isConnected) throw new HarnessError('LOCATOR_NOT_FOUND', `${ref} is gone from what the test rendered; read the tree again`, {platform: 'web'});
    return element;
  }

  /** A step, answered rather than thrown, as every driver's is. */
  async function step(done: string, failing: string, work: () => Promise<void>): Promise<StepResult> {
    try {
      await work();
      return ok(done);
    } catch (error) {
      return failed(`${failing}: ${(error as Error).message}`, codeOf(error));
    }
  }

  const driver: Driver = {
    platform: 'web',
    available: async () => ({ready: true, found: 'what the test rendered, as web, through Testing Library in jsdom'}),
    open: route => step(`opened ${route}`, `could not open ${route}`, () => openRoute(route, act)),
    snapshot,
    // Clicks on one target in a row are counted, as a browser counts them: a `dblclick` comes after the second.
    press: (what, options = {}) => step(`pressed ${describeTarget(what)}`, 'press failed', async () => user.pointer({keys: '[MouseLeft]'.repeat(options.count ?? 1), target: await target(what)})),
    fill: (what, text) =>
      step(`filled ${describeTarget(what)}`, 'fill failed', async () => {
        const element = await target(what);
        await user.clear(element);
        if (text) await user.type(element, literal(text));
      }),
    type: text => step(`typed ${JSON.stringify(text)}`, 'typing failed', () => user.keyboard(literal(text))),
    key: name => step(`pressed ${name}`, `${name} failed`, () => user.keyboard(`{${name}}`)),
    longPress: (what, options = {}) =>
      step(`held ${describeTarget(what)}`, 'long press failed', async () => {
        const element = await target(what);
        await user.pointer({keys: '[MouseLeft>]', target: element});
        await new Promise(resolve => setTimeout(resolve, options.duration ?? 800));
        await user.pointer({keys: '[/MouseLeft]', target: element});
      }),
    hover: what => step(`moved over ${describeTarget(what)}`, 'hover failed', async () => user.hover(await target(what))),
    focus: what =>
      step(`focused ${describeTarget(what)}`, 'focus failed', async () => {
        const element = await target(what);
        await act(() => (element as HTMLElement).focus());
      }),
    // Nothing is laid out, so everything rendered is on the screen already.
    scrollIntoView: async what => ok(`${describeTarget(what)} is on the screen already, in a unit test`),
    screenshot: async () => elsewhere('a screenshot', 'web', 'a unit test draws nothing; a device test takes one'),
    idleSeconds: async () => null,
    close: async () => {},
  };

  return {
    platform: 'web',
    driver: () => driver,
    async render(ui, options = {}) {
      const rendered = render(ui as Parameters<typeof render>[0], options as Parameters<typeof render>[1]);
      return {
        rerender: async next => rendered.rerender(next as Parameters<typeof render>[0]),
        unmount: async () => rendered.unmount(),
      };
    },
  };
}

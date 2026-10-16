/**
 * A unit test's surface on iOS, Android and Windows: the tree React Native
 * Testing Library rendered, read as a device's (`readHostTree`), and acted
 * on through its events, in the test's own process. A press fires the
 * element's press, a switch is given the value it changes to, and a fill
 * focuses a field and changes its text, as typing would leave it.
 */
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import type {Surface} from '../device/surface.ts';
import {HarnessError, codeOf} from '../harness/lib/errors.ts';
import type {Snapshot, SnapshotNode, Target} from '../harness/lib/snapshot.ts';
import {asSelector, describeTarget, findNode, isPoint, narrow, seenInstead} from '../harness/lib/snapshot.ts';
import type {Driver, Platform, SnapshotOptions, StepResult} from '../harness/lib/types.ts';
import {elsewhere, failed, ok} from '../harness/lib/types.ts';
import type {HostElement} from './native-tree.ts';
import {readHostTree, switchedOn} from './native-tree.ts';
import {openRoute} from './route.ts';

type Instance = Parameters<typeof fireEvent.press>[0];

export function nativeSurface(platform: Platform): Surface {
  /** The tree read last, whose refs a step names until the next read. */
  let last: Snapshot | null = null;
  let elements = new Map<string, HostElement>();
  /** The field a fill or a focus left the focus in, which typing and a key go to. */
  let focused: HostElement | null = null;

  /** What the test rendered, or null before it rendered anything. */
  function container(): HostElement | null {
    try {
      return screen.container as unknown as HostElement;
    } catch {
      return null;
    }
  }

  async function snapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
    const read = readHostTree(container(), focused);
    elements = read.elements;
    last = {platform, source: 'what the test rendered', nodes: read.nodes};
    return options.interactive ? {...last, nodes: narrow(read.nodes, node => node.interactive)} : last;
  }

  /** The element a target names: by a ref of the tree read last, or by a selector in a fresh one. */
  async function target(what: Target): Promise<{element: HostElement; node: SnapshotNode}> {
    const selector = asSelector(what);
    if (isPoint(selector)) throw new HarnessError('UNSUPPORTED_CAPABILITY', 'a unit test draws nothing to press a point of; name the node', {platform});
    if (selector.ref && last) {
      const node = last.nodes.find(each => each.ref === selector.ref);
      const element = elements.get(selector.ref);
      if (node && element) return {element, node};
    }
    const tree = await snapshot();
    const node = findNode(tree, selector);
    const element = node && elements.get(node.ref);
    if (!node || !element) {
      const instead = seenInstead(tree, selector);
      throw new HarnessError('LOCATOR_NOT_FOUND', `nothing matches ${describeTarget(what)} in what the test rendered (${tree.nodes.length} nodes)${instead ? `; ${instead}` : ''}`, {platform});
    }
    return {element, node};
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

  /** Moves the focus to a field, as a press on it would, and away from the one that had it. */
  async function focus(element: HostElement): Promise<void> {
    if (focused === element) return;
    if (focused) await fireEvent(focused as unknown as Instance, 'blur');
    focused = element;
    await fireEvent(element as unknown as Instance, 'focus');
  }

  const isField = (node: SnapshotNode) => node.kind === 'textbox' || node.kind === 'searchbox';
  /** What a field holds now, from the props React Native hands it. */
  const textOf = (element: HostElement): string => String(element.props.value ?? element.props.text ?? element.props.defaultValue ?? '');

  const driver: Driver = {
    platform,
    available: async () => ({ready: true, found: `what the test rendered, as ${platform}, through React Native Testing Library`}),
    open: route => step(`opened ${route}`, `could not open ${route}`, () => openRoute(route, act)),
    snapshot,
    press: what =>
      step(`pressed ${describeTarget(what)}`, 'press failed', async () => {
        const {element, node} = await target(what);
        if (isField(node)) return focus(element);
        // A switch takes no press: it is told the value it changes to, as the native side tells it.
        const on = node.kind === 'switch' ? switchedOn(element.props) : undefined;
        if (on !== undefined) {
          await fireEvent(element as unknown as Instance, 'valueChange', !on);
          return;
        }
        await fireEvent.press(element as unknown as Instance);
      }),
    fill: (what, text) =>
      step(`filled ${describeTarget(what)}`, 'fill failed', async () => {
        const {element, node} = await target(what);
        if (!isField(node)) throw new HarnessError('NOT_ACTIONABLE', `${node.ref} ${node.role} ${JSON.stringify(node.name)} is no field to fill`, {platform});
        await focus(element);
        await fireEvent.changeText(element as unknown as Instance, text);
      }),
    type: text =>
      step(`typed ${JSON.stringify(text)}`, 'typing failed', async () => {
        if (!focused) throw new HarnessError('NOT_ACTIONABLE', 'no field has the focus to type into; press or fill one first', {platform});
        await fireEvent.changeText(focused as unknown as Instance, `${textOf(focused)}${text}`);
      }),
    key: name =>
      step(`pressed ${name}`, `${name} failed`, async () => {
        if (!focused) throw new HarnessError('NOT_ACTIONABLE', `no field has the focus to press ${name} in; press or fill one first`, {platform});
        if (name === 'Enter') await fireEvent(focused as unknown as Instance, 'submitEditing', {nativeEvent: {text: textOf(focused)}});
        else await fireEvent(focused as unknown as Instance, 'keyPress', {nativeEvent: {key: name}});
      }),
    longPress: what =>
      step(`held ${describeTarget(what)}`, 'long press failed', async () => {
        await fireEvent((await target(what)).element as unknown as Instance, 'longPress');
      }),
    focus: what =>
      step(`focused ${describeTarget(what)}`, 'focus failed', async () => {
        await focus((await target(what)).element);
      }),
    // Nothing is laid out, so everything rendered is on the screen already.
    scrollIntoView: async what => ok(`${describeTarget(what)} is on the screen already, in a unit test`),
    screenshot: async () => elsewhere('a screenshot', platform, 'a unit test draws nothing; a device test takes one'),
    idleSeconds: async () => null,
    close: async () => {
      last = null;
      elements = new Map();
      focused = null;
    },
  };

  return {
    platform,
    driver: () => driver,
    async render(ui, options = {}) {
      focused = null;
      const rendered = await render(ui as Parameters<typeof render>[0], options as Parameters<typeof render>[1]);
      return {
        rerender: next => rendered.rerender(next as Parameters<typeof render>[0]),
        unmount: () => rendered.unmount(),
      };
    },
  };
}

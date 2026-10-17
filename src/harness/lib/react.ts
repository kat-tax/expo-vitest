/**
 * The React tree behind the native one: which component drew each node,
 * the chain of components above it, and the props it was given as written.
 * An iOS `accessible` container folds its children's testIDs and labels
 * away from the native tree; the React tree still has them.
 *
 * It is read from React's DevTools hook, `__REACT_DEVTOOLS_GLOBAL_HOOK__`,
 * which a development build of React Native installs and the web driver
 * installs in the page before React loads. One walk serves every runtime:
 * it is a script, run in the page on web and through Metro's inspector on a
 * device, and it sends nothing back to the app.
 */
import type {Bounds, Snapshot, SnapshotNode} from './snapshot.ts';

/** A host node of the React tree: what the platform draws, with the components above it. */
export interface ReactNode {
  /** Its place in the walk, from 1. */
  id: number;
  /** The id of the host node it sits inside. */
  parent?: number;
  /** The platform's own name for it: `div` on web, `RCTView` on a device. */
  host: string;
  /** The innermost component above it that is not one of React Native's own, such as `SaveButton`. */
  component?: string;
  /** Every named component from the root down to it, the innermost last. */
  chain: string[];
  testId?: string;
  label?: string;
  /** The text it holds directly. */
  text?: string;
  /** Where it is, in the window's own pixels, where the runtime could say. */
  bounds?: Bounds;
  /** On web, the ref the page gave the element in the native tree. */
  ref?: string;
}

export interface ReactTree {
  nodes: ReactNode[];
}

/**
 * React Native's own components, and the libraries' every app uses, which
 * are never the answer to "which component is this": the component a node
 * belongs to is the innermost one above it that is not among them.
 */
export const PRIMITIVES = [
  'View', 'Text', 'TextImpl', 'Image', 'ImageBackground', 'TextInput', 'ScrollView', 'Pressable', 'TouchableOpacity', 'TouchableHighlight',
  'TouchableWithoutFeedback', 'TouchableNativeFeedback', 'FlatList', 'SectionList', 'VirtualizedList', 'VirtualizedSectionList', 'CellRenderer',
  'SafeAreaView', 'KeyboardAvoidingView', 'Modal', 'Switch', 'ActivityIndicator', 'RefreshControl', 'StatusBar', 'Button', 'AppContainer',
  'RootTagContext', 'ScrollViewContext', 'VirtualizedListContextResetter', 'VirtualizedListCellContextProvider', 'Animated', 'AnimatedComponent',
  // react-native-web's own, inside its Text and View.
  'LocaleProvider',
];

/** The elements a page holds that draw nothing, whose text is code. */
const UNDRAWN = ['style', 'script', 'link', 'meta', 'title', 'head', 'noscript', 'template'];

/**
 * The walk, as a script run in the app's runtime, where it is handed the
 * names to pass over and answers a promise of the nodes. It keeps the
 * largest mounted root, since a second reconciler, as react-native-skia's,
 * can hold the first renderer. Bounds come from the element on web and
 * Fabric's `measureInWindow` on a device, for the nodes that carry
 * something to match by. At most `limit` nodes.
 */
export const WALK = `(async (passOver, limit, undrawn, wanted, depth) => {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.renderers) return {unavailable: 'there is no React DevTools hook in this runtime, which a production build leaves out'};
  const rootsOf = id => (hook.getFiberRoots ? Array.from(hook.getFiberRoots(id) || []) : []);
  const COMPOSITE = new Set([0, 1, 2, 11, 14, 15]);
  const HOST = new Set([5, 26, 27]);
  const skip = new Set(passOver);
  const hidden = new Set(undrawn);
  const nameOf = type => {
    if (!type) return null;
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (typeof type === 'object') return type.displayName || nameOf(type.render) || nameOf(type.type) || null;
    return null;
  };
  const walk = root => {
    const nodes = [];
    const fibers = [];
    const stack = [{fiber: root.current && root.current.child, chain: [], parent: undefined}];
    while (stack.length > 0 && nodes.length < limit) {
      const {fiber, chain, parent} = stack.pop();
      if (!fiber) continue;
      stack.push({fiber: fiber.sibling, chain, parent});
      let below = chain;
      let inside = parent;
      if (COMPOSITE.has(fiber.tag)) {
        const name = nameOf(fiber.type);
        if (name && name !== chain[chain.length - 1]) below = chain.concat(name);
      } else if (HOST.has(fiber.tag) && hidden.has(String(fiber.type))) {
        continue;
      } else if (HOST.has(fiber.tag)) {
        const props = fiber.memoizedProps || {};
        const node = {id: nodes.length + 1, host: String(fiber.type), chain};
        if (parent !== undefined) node.parent = parent;
        for (let at = chain.length - 1; at >= 0; at--) {
          if (!skip.has(chain[at])) { node.component = chain[at]; break; }
        }
        const testId = props.testID ?? props['data-testid'];
        const label = props.accessibilityLabel ?? props['aria-label'];
        if (typeof testId === 'string' && testId) node.testId = testId;
        if (typeof label === 'string' && label) node.label = label;
        // React DOM keeps a lone string child in the props, not in a text fiber; React Native keeps it in both, and the fiber is read.
        if ((typeof props.children === 'string' || typeof props.children === 'number') && !fiber.child) node.text = String(props.children);
        nodes.push(node);
        fibers.push(fiber);
        inside = node.id;
      } else if (fiber.tag === 6 && parent !== undefined) {
        const node = nodes[parent - 1];
        const text = String(fiber.memoizedProps ?? '');
        node.text = node.text ? node.text + text : text;
      }
      stack.push({fiber: fiber.child, chain: below, parent: inside});
    }
    return {nodes, fibers};
  };
  let best = {nodes: [], fibers: []};
  for (const id of hook.renderers.keys()) {
    for (const root of rootsOf(id)) {
      const walked = walk(root);
      if (walked.nodes.length > best.nodes.length) best = walked;
    }
  }
  // Where each element from the node up was written: React keeps the stack
  // of the call that made an element on a development build, and its first
  // frame past React's own call is the render that wrote it.
  if (wanted !== null) {
    const frameOf = fiber => {
      const stack = fiber._debugStack && fiber._debugStack.stack;
      if (typeof stack !== 'string') return null;
      const frames = [];
      for (const line of stack.split('\\n')) {
        const found = /^\\s*at (?:(.*?) \\()?(.+?):(\\d+):(\\d+)\\)?\\s*$/.exec(line) || /^(.*?)@(.+?):(\\d+):(\\d+)$/.exec(line.trim());
        if (found) frames.push({name: found[1] || '', file: found[2], line: Number(found[3]), column: Number(found[4])});
      }
      // The first is React's own call that made the element, whatever the
      // engine names it (Hermes names none); a wrapper of it, as
      // react-native-web's createElement, says so in its name.
      const own = frames.slice(1).find(frame => !/jsx|createElement/i.test(frame.name));
      if (!own) return null;
      return {file: own.file, line: own.line, column: own.column, ...(own.name && own.name !== 'anonymous' ? {name: own.name} : {})};
    };
    const frames = [];
    let fiber = best.fibers[wanted - 1];
    for (let up = 0; fiber && up < depth; up++, fiber = fiber.return) {
      const frame = frameOf(fiber);
      const last = frames[frames.length - 1];
      if (frame && !(last && last.file === frame.file && last.line === frame.line && last.column === frame.column)) frames.push(frame);
    }
    return {frames};
  }
  const refs = globalThis.__harnessRefs;
  const measured = best.nodes.map((node, at) => {
    const host = best.fibers[at].stateNode;
    if (!host) return null;
    if (typeof host.getBoundingClientRect === 'function') {
      const box = host.getBoundingClientRect();
      node.bounds = {x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height)};
      const ref = refs && refs.ids && refs.ids.get(host);
      if (ref !== undefined) node.ref = '@e' + ref;
      return null;
    }
    const element = host.canonical && host.canonical.publicInstance;
    if (!element || typeof element.measureInWindow !== 'function' || !(node.testId || node.label || node.text)) return null;
    return new Promise(resolve => {
      const late = setTimeout(resolve, 500);
      element.measureInWindow((x, y, width, height) => {
        clearTimeout(late);
        node.bounds = {x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height)};
        resolve();
      });
    });
  });
  await Promise.all(measured.filter(Boolean));
  return {nodes: best.nodes};
})`;

/** The walk as an expression a runtime evaluates, with its arguments written in. */
export function walkExpression(limit = 4000): string {
  return `${WALK}(${JSON.stringify(PRIMITIVES)}, ${limit}, ${JSON.stringify(UNDRAWN)}, null, 0)`;
}

/** A frame of a stack: a bundle's position as a runtime gives it, or a source's once symbolicated. */
export interface StackFrame {
  file: string;
  line: number;
  column: number;
  name?: string;
}

/** The fibers a frame walk climbs from a node at most: past a kit's components to the app's own. */
export const FRAME_DEPTH = 40;

/**
 * The walk again, for one node of it by its id: where each element from the
 * node up was written, the innermost first, on a development build. A walk
 * of a tree that has not changed since numbers its nodes the same.
 */
export function framesExpression(id: number, limit = 4000, depth = FRAME_DEPTH): string {
  return `${WALK}(${JSON.stringify(PRIMITIVES)}, ${limit}, ${JSON.stringify(UNDRAWN)}, ${id}, ${depth})`;
}

/**
 * The innermost frame in the project's own source, as a path from its root:
 * the line of the app that drew a node, past the libraries' own lines above
 * it. Null where every frame is a library's, or outside the project.
 */
export function appFrame(frames: readonly StackFrame[], root: string): string | null {
  const normal = (file: string) => file.replace(/\\/g, '/');
  const home = normal(root).replace(/\/$/, '');
  for (const frame of frames) {
    const file = normal(frame.file);
    if (file.includes('/node_modules/') || !file.toLowerCase().startsWith(`${home.toLowerCase()}/`)) continue;
    return `${file.slice(home.length + 1)}:${frame.line}:${frame.column}`;
  }
  return null;
}

/** How much two boxes cover of each other: their overlap over their union, from 0 to 1. */
export function overlap(a: Bounds, b: Bounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const shared = width * height;
  return shared / (a.width * a.height + b.width * b.height - shared);
}

/**
 * The React node behind a native one: the one the page gave the same ref,
 * on web; else the innermost with the same testID; else the innermost whose
 * box covers the same place, nine tenths or more.
 */
export function reactNodeOf(node: SnapshotNode, tree: ReactTree): ReactNode | undefined {
  const byRef = tree.nodes.find(each => each.ref === node.ref);
  if (byRef) return byRef;
  if (node.testId) {
    const named = tree.nodes.filter(each => each.testId === node.testId);
    if (named.length > 0) return named.at(-1);
  }
  if (!node.bounds) return undefined;
  let best: ReactNode | undefined;
  let score = 0.9;
  for (const each of tree.nodes) {
    const covered = each.bounds ? overlap(each.bounds, node.bounds) : 0;
    if (covered >= score) {
      best = each;
      score = covered;
    }
  }
  return best;
}

/** A snapshot with each native node given the component behind it, where one is found. */
export function withComponents(snapshot: Snapshot, tree: ReactTree): Snapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(node => {
      const behind = reactNodeOf(node, tree)?.component;
      return behind ? {...node, component: behind} : node;
    }),
  };
}

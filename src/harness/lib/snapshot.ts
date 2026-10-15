/**
 * The accessibility snapshot, in the shape `agent-device` uses: a flat list of
 * nodes, each with a ref (`@e7`) and its bounds, which a test targets instead
 * of naming coordinates. A coordinate written into a test goes stale the moment
 * the layout moves; a ref is resolved from a fresh tree every time.
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotNode {
  /** `@e1`, `@e2`, … — stable within one snapshot, not across snapshots. */
  ref: string;
  /** The platform's own word for what this is: Button, TabItem, link, menuitem. */
  role: string;
  /** The accessible name — what a screen reader says. */
  name: string;
  /**
   * The identifier the component was given in the source: React Native's
   * `testID`, which reaches `data-testid` on web and `AutomationProperties.
   * AutomationId` on Windows. Unlike the name it is not user-visible, so it
   * survives relabelling and localisation — prefer it in a test.
   */
  testId?: string;
  /** Depth in the tree, for rendering it as text. */
  depth: number;
  /**
   * The ref of the nearest node in the same snapshot that this one sits
   * inside. Absent at the top, and where the platform did not say.
   */
  parent?: string;
  /** Whether a person can act on it. */
  interactive: boolean;
  focused?: boolean;
  focusable?: boolean;
  enabled?: boolean;
  offscreen?: boolean;
  /**
   * What a screen reader says past the name and the role. Every one of these
   * is absent unless the platform reported it, so a control that sets none
   * reads differently in the tree from one that sets them — which is the
   * whole point: nothing else in a test run can see them, and a missing
   * `live` or `inSet` is invisible in a test and obvious to a user.
   *
   * Windows fills all of them (UI Automation); the other platforms fill what
   * their own trees carry.
   */
  /** The hint or description: `HelpText` on Windows, `aria-description` on web. */
  help?: string | null;
  /** `"2 of 5"` — how a position in a set is announced, rather than two numbers to pair up. */
  inSet?: string | null;
  /** Heading rank, 1–6. */
  heading?: number | null;
  /** A live region, and how urgent: `polite` or `assertive`. */
  live?: string | null;
  /** `ItemStatus` — "Busy" while something is loading. */
  status?: string | null;
  /** Whether the platform treats this as a dialog (modal semantics, and where the focus goes). */
  dialog?: boolean | null;
  /**
   * The state a control is in, each absent where the control has no such
   * state or the platform did not say, by the same rule as above: a toggle
   * that reports no state is a finding, not an off switch.
   */
  /** A checkbox, radio or switch: on, off, or `mixed` in between. */
  checked?: boolean | 'mixed';
  /** A tab, option or item: whether it is the one selected. */
  selected?: boolean;
  /** A combo box, menu button or disclosure: whether it is open. */
  expanded?: boolean;
  /** A toggle button: whether it is pressed in, or `mixed`. */
  pressed?: boolean | 'mixed';
  /** What a field holds, or a slider's value. Never set on a secure field. */
  value?: string;
  /** The hint an empty field shows. */
  placeholder?: string;
  /** A field whose text is hidden, such as a password. */
  secure?: true;
  /** In the window's own pixels from its top left; absent when the platform did not say. */
  bounds?: Bounds | null;
  /**
   * The UI Automation patterns the control implements, which drive it without
   * a pointer: `Invoke`, `Toggle`, `SelectionItem`, `Value`, `ScrollItem`,
   * `ExpandCollapse`. Windows only, through the host, and absent where there
   * are none.
   */
  patterns?: string[];
}

export interface Snapshot {
  platform: string;
  /** What was snapshotted: a process, a page, a bundle id. */
  source?: string;
  nodes: SnapshotNode[];
}

/** What a step can be pointed at. */
export type Target = string | Selector | Point;

export interface Selector {
  ref?: string;
  /** The component's own `testID`. Exact, and not the text a person reads. */
  testId?: string;
  label?: string;
  role?: string;
  /** Match the label loosely: `New` finds `New drop`. */
  contains?: string;
}

export interface Point {
  x: number;
  y: number;
}

/** The selector helpers a test writes with, the way Detox and Playwright spell them. */
export const by = {
  ref: (ref: string): Selector => ({ref}),
  /**
   * The `testID` the component was given. The steadiest way to name a thing:
   * a label is copy and changes, a ref is only good for one snapshot, and a
   * role finds every button on the screen.
   */
  testID: (testId: string): Selector => ({testId}),
  label: (label: string): Selector => ({label}),
  role: (role: string): Selector => ({role}),
  text: (contains: string): Selector => ({contains}),
};

export function isPoint(target: Target): target is Point {
  return typeof target === 'object' && 'x' in target && 'y' in target;
}

/**
 * A target written as a string: `@e3` is a ref, `label="Save"`,
 * `role=button` and `testID=new-drop` are selectors (the spelling
 * `agent-device` takes), and anything else is a label.
 */
export function parseTarget(target: string): Selector {
  if (target.startsWith('@')) return {ref: target};
  const match = /^(ref|label|role|contains|test[Ii][Dd])\s*=\s*"?([^"]*)"?$/.exec(target.trim());
  // Any spelling of testID from a command line lands on the one field name.
  if (match) return {[match[1]!.startsWith('test') ? 'testId' : (match[1] as keyof Selector)]: match[2]} as Selector;
  return {label: target};
}

export function asSelector(target: Target): Selector | Point {
  if (typeof target === 'string') return parseTarget(target);
  return target;
}

/** How a target reads in a message. */
export function describeTarget(target: Target): string {
  if (typeof target === 'string') return target;
  if (isPoint(target)) return `${target.x},${target.y}`;
  const [key, value] = Object.entries(target)[0] ?? ['', ''];
  return `${key}=${JSON.stringify(value)}`;
}

/**
 * What a tree held instead, for the message of a selector that matched
 * nothing: the names of the nodes with the role it asked for, the testIDs
 * there were, or the names of what can be acted on, a few of each. A ref
 * names a node of one snapshot, so there is nothing to suggest for it.
 */
export function seenInstead(snapshot: Snapshot, selector: Selector): string {
  const few = 5;
  const list = (values: string[]): string => {
    const unique = [...new Set(values)];
    const shown = unique.slice(0, few).map(value => JSON.stringify(value)).join(', ');
    return unique.length > few ? `${shown} and ${unique.length - few} more` : shown;
  };
  if (selector.ref) return '';
  if (selector.testId) {
    const ids = snapshot.nodes.flatMap(node => (node.testId ? [node.testId] : []));
    return ids.length > 0 ? `the testIDs there: ${list(ids)}` : 'no node has a testID';
  }
  if (selector.role) {
    const role = selector.role.toLowerCase();
    const named = snapshot.nodes.filter(node => node.role.toLowerCase() === role);
    if (named.length === 0) return `no node has role ${selector.role}`;
    return `${named.length} ${named.length === 1 ? 'node has' : 'nodes have'} role ${selector.role}: ${list(named.map(node => node.name))}`;
  }
  const names = snapshot.nodes.filter(node => node.interactive && node.name).map(node => node.name);
  return names.length > 0 ? `what can be acted on: ${list(names)}` : 'nothing there can be acted on';
}

/**
 * The node a selector names. A ref and a `testID` are exact; a label matches
 * the whole name first and then loosely, so `by.label('New')` finds `New`
 * before `New drop` and still finds `New drop` when that is all there is.
 */
export function findNode(snapshot: Snapshot, selector: Selector): SnapshotNode | undefined {
  const {nodes} = snapshot;
  if (selector.ref) return nodes.find(node => node.ref === selector.ref);
  if (selector.testId) return nodes.find(node => node.testId === selector.testId);
  const candidates = selector.role ? nodes.filter(node => node.role.toLowerCase() === selector.role?.toLowerCase()) : nodes;
  if (selector.label) {
    return (
      candidates.find(node => node.name === selector.label) ??
      candidates.find(node => node.name.toLowerCase() === selector.label?.toLowerCase()) ??
      candidates.find(node => node.name.toLowerCase().includes(selector.label!.toLowerCase()))
    );
  }
  if (selector.contains) {
    const needle = selector.contains.toLowerCase();
    return candidates.find(node => node.name.toLowerCase().includes(needle));
  }
  return candidates[0];
}

/**
 * The nodes a narrower snapshot keeps, each with `parent` naming its nearest
 * ancestor among them, so a parent left out of the narrower tree hands the
 * part on to its own.
 */
export function narrow(nodes: SnapshotNode[], keep: (node: SnapshotNode) => boolean): SnapshotNode[] {
  const parents = new Map(nodes.map(node => [node.ref, node.parent]));
  const kept = nodes.filter(keep);
  const refs = new Set(kept.map(node => node.ref));
  return kept.map(({parent, ...node}) => {
    let nearest = parent;
    // No chain is longer than the tree; a longer one goes round in a circle.
    for (let hops = 0; nearest !== undefined && !refs.has(nearest); hops++) nearest = hops < nodes.length ? parents.get(nearest) : undefined;
    return nearest === undefined ? node : {...node, parent: nearest};
  });
}

/** The point to press for a node: the middle of what it covers. */
export function centreOf(node: SnapshotNode): Point | null {
  if (!node.bounds) return null;
  return {x: Math.round(node.bounds.x + node.bounds.width / 2), y: Math.round(node.bounds.y + node.bounds.height / 2)};
}

/** The tree as indented text, for a person reading a log. */
export function renderSnapshot(snapshot: Snapshot): string {
  return snapshot.nodes
    .map(node => {
      const indent = '  '.repeat(Math.min(node.depth, 12));
      const two = (value: boolean | 'mixed' | undefined, on: string, off: string) => (value === undefined ? '' : value === 'mixed' ? `${on}:mixed` : value ? on : off);
      const state = [
        node.focused && 'focused',
        node.enabled === false && 'disabled',
        node.offscreen && 'offscreen',
        two(node.checked, 'checked', 'unchecked'),
        two(node.selected, 'selected', 'unselected'),
        two(node.expanded, 'expanded', 'collapsed'),
        two(node.pressed, 'pressed', 'unpressed'),
      ]
        .filter(Boolean)
        .join(',');
      const missing = node.interactive && !node.name ? '  <- no accessible name' : '';
      // The testID is printed so a person reading the tree can copy it
      // straight into `by.testID(…)`, which is the selector that keeps working
      // when the copy changes.
      const id = node.testId ? ` #${node.testId}` : '';
      // What a screen reader adds to the name, printed only where it exists:
      // these are the properties a component either sets or silently does not,
      // and a tree is where the difference shows.
      const says = [
        node.inSet,
        node.heading && `h${node.heading}`,
        node.live && `live:${node.live}`,
        node.status && `status:${node.status}`,
        node.dialog && 'dialog',
        node.help && `help:${JSON.stringify(node.help)}`,
        node.value !== undefined && `value:${JSON.stringify(node.value)}`,
        node.placeholder && `placeholder:${JSON.stringify(node.placeholder)}`,
        node.secure && 'secure',
      ].filter(Boolean).join(' ');
      return `${indent}${node.ref} ${node.role} ${JSON.stringify(node.name)}${id}${state ? ` [${state}]` : ''}${says ? ` (${says})` : ''}${missing}`;
    })
    .join('\n');
}

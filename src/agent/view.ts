/**
 * The screen as the model reads it: a line a node, the controls first and
 * the rest after a blank line, and after an action what changed. Every node
 * is named by its ref, the id an action takes, and found again by its
 * identity, which is what it is and where, so a diff survives a ref that
 * moved. A secure field never shows its value.
 */
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';

/** The most a view may take, in bytes, before the nodes that cannot be acted on are left out. */
export const MAX_OBSERVATION_BYTES = 262_144;

export interface ViewOptions {
  /** Where the app is: the route on web, the screen elsewhere. */
  route?: string;
  maxBytes?: number;
}

/** The word a node is acted on by. */
const kindOf = (node: SnapshotNode) => node.kind ?? node.role.toLowerCase();

const two = (value: boolean | 'mixed' | undefined, on: string, off: string) => (value === undefined ? '' : value === 'mixed' ? `${on}:mixed` : value ? on : off);

/** What a node is, without its ref: the kind, the name, the test id, its states and what a screen reader adds. */
export function describeNode(node: SnapshotNode): string {
  const states = [
    node.focused && 'focused',
    node.enabled === false && 'disabled',
    node.offscreen && 'offscreen',
    two(node.checked, 'checked', 'unchecked'),
    two(node.selected, 'selected', 'unselected'),
    two(node.expanded, 'expanded', 'collapsed'),
    two(node.pressed, 'pressed', 'unpressed'),
    node.secure && 'secure',
  ].filter(Boolean);
  const says = [
    node.heading && `h${node.heading}`,
    node.inSet,
    node.live && `live:${node.live}`,
    node.status && `status:${node.status}`,
    node.dialog && 'dialog',
    node.help && `help=${JSON.stringify(node.help)}`,
    // A secure field's value is never shown, whatever the platform reported.
    !node.secure && node.value !== undefined && `value=${JSON.stringify(node.value)}`,
    node.placeholder && `placeholder=${JSON.stringify(node.placeholder)}`,
  ].filter(Boolean);
  return [kindOf(node), JSON.stringify(node.name), node.testId && `#${node.testId}`, states.length && `[${states.join(', ')}]`, ...says].filter(Boolean).join('  ');
}

/** Whether a node is worth a line: a control, or something with a name, a value or a role a screen reader announces. */
function shown(node: SnapshotNode): boolean {
  return node.interactive || node.name !== '' || node.value !== undefined || Boolean(node.heading || node.live || node.status || node.dialog);
}

/** The nodes of a view, the controls first, each group in tree order. */
function ordered(snapshot: Snapshot): {controls: SnapshotNode[]; rest: SnapshotNode[]} {
  const nodes = snapshot.nodes.filter(shown);
  return {controls: nodes.filter(node => node.interactive), rest: nodes.filter(node => !node.interactive)};
}

const header = (snapshot: Snapshot, options: ViewOptions) => [
  ...(options.route ? [`route: ${options.route}`] : []),
  ...(snapshot.viewport ? [`window: ${snapshot.viewport.width}x${snapshot.viewport.height}`] : []),
];

/**
 * The screen as text. Where it would be longer than `maxBytes`, the nodes
 * that cannot be acted on go first, from the end, then the controls off
 * screen, and a line says how many were left out.
 */
export function renderView(snapshot: Snapshot, options: ViewOptions = {}): string {
  const max = options.maxBytes ?? MAX_OBSERVATION_BYTES;
  const {controls, rest} = ordered(snapshot);
  const width = Math.max(0, ...[...controls, ...rest].map(node => node.ref.length));
  const line = (node: SnapshotNode) => `${node.ref.padEnd(width)}  ${describeNode(node)}`;
  const top = header(snapshot, options);
  // The header, the controls, the rest and the note, each a section, a blank line between two.
  const compose = (keptControls: SnapshotNode[], keptRest: SnapshotNode[], left: number) =>
    [top, keptControls.map(line), keptRest.map(line), left ? [`(${left} more nodes left out, to fit)`] : []]
      .filter(section => section.length > 0)
      .map(section => section.join('\n'))
      .join('\n\n');
  let keptControls = controls;
  let keptRest = rest;
  let text = compose(keptControls, keptRest, 0);
  while (Buffer.byteLength(text) > max && (keptRest.length || keptControls.some(node => node.offscreen))) {
    if (keptRest.length) keptRest = keptRest.slice(0, -1);
    else keptControls = keptControls.filter((node, index, all) => !node.offscreen || index !== all.findLastIndex(each => each.offscreen));
    text = compose(keptControls, keptRest, controls.length + rest.length - keptControls.length - keptRest.length);
  }
  return text;
}

/** What a node is and where, apart from its ref: its kind, name and test id, and its parent's. */
export function identityOf(node: SnapshotNode, byRef: ReadonlyMap<string, SnapshotNode>): string {
  const parent = node.parent ? byRef.get(node.parent) : undefined;
  return JSON.stringify([kindOf(node), node.name, node.testId ?? null, parent ? [kindOf(parent), parent.name] : null]);
}

/** Each shown node by its identity, a second one with the same identity numbered after the first. */
function byIdentity(snapshot: Snapshot): Map<string, SnapshotNode> {
  const byRef = new Map(snapshot.nodes.map(node => [node.ref, node]));
  const seen = new Map<string, number>();
  const identities = new Map<string, SnapshotNode>();
  for (const node of snapshot.nodes.filter(shown)) {
    const identity = identityOf(node, byRef);
    const count = seen.get(identity) ?? 0;
    seen.set(identity, count + 1);
    identities.set(`${identity}#${count}`, node);
  }
  return identities;
}

export interface ViewDiff {
  text: string;
  /** Whether the whole view was sent, since most of the screen changed. */
  whole: boolean;
  /** How many lines came, went or changed. */
  changes: number;
}

/**
 * What changed between two screens, by identity: `+` a node that came, `-`
 * one that went, `~` one whose states or value changed, each with its ref.
 * Where more than half the lines changed, the whole new view instead, which
 * keeps a navigation legible. `screen: unchanged` where nothing moved.
 */
export function diffViews(before: Snapshot, after: Snapshot, options: {before?: ViewOptions; after?: ViewOptions} = {}): ViewDiff {
  const was = byIdentity(before);
  const now = byIdentity(after);
  const lines: string[] = [];
  const route = [options.before?.route, options.after?.route];
  if (route[0] !== route[1] && route[1]) lines.push(`route: ${route[0] ?? '?'} -> ${route[1]}`);
  for (const [identity, node] of now) {
    const old = was.get(identity);
    if (!old) lines.push(`+ ${node.ref}  ${describeNode(node)}`);
    else if (describeNode(old) !== describeNode(node)) lines.push(`~ ${node.ref}  ${describeNode(node)}`);
  }
  for (const [identity, node] of was) if (!now.has(identity)) lines.push(`- ${node.ref}  ${describeNode(node)}`);
  const changes = lines.filter(line => !line.startsWith('route:')).length;
  if (changes === 0 && lines.length === 0) return {text: 'screen: unchanged', whole: false, changes: 0};
  if (changes > Math.max(was.size, now.size) / 2) return {text: renderView(after, options.after), whole: true, changes};
  return {text: lines.join('\n'), whole: false, changes};
}

/** A snapshot with a step's refs, and the platform's ref for each. */
export interface Relabeled {
  /** The snapshot as the model reads it: each node, and each parent, under the step's ref. */
  snapshot: Snapshot;
  /** The platform's ref for each of the step's, which an action is sent to. */
  platformRef: ReadonlyMap<string, string>;
}

/**
 * The refs the model knows a step's nodes by. iOS and Android number their
 * refs afresh in every snapshot, and a diff names only what changed, so a
 * ref the model read two views ago could name something else by now. Here
 * a node is known by its identity, and keeps the ref it was first shown
 * with for the rest of the step, on every platform alike. A node whose name
 * changed is another node, with a ref of its own.
 */
export class RefBook {
  private readonly refs = new Map<string, string>();

  relabel(snapshot: Snapshot): Relabeled {
    const byRef = new Map(snapshot.nodes.map(node => [node.ref, node]));
    const seen = new Map<string, number>();
    const ours = new Map<string, string>();
    for (const node of snapshot.nodes) {
      const identity = identityOf(node, byRef);
      const count = seen.get(identity) ?? 0;
      seen.set(identity, count + 1);
      const key = `${identity}#${count}`;
      const ref = this.refs.get(key) ?? `@e${this.refs.size + 1}`;
      this.refs.set(key, ref);
      ours.set(node.ref, ref);
    }
    const nodes = snapshot.nodes.map(({parent, ...node}) => {
      const above = parent === undefined ? undefined : ours.get(parent);
      return {...node, ref: ours.get(node.ref) as string, ...(above ? {parent: above} : {})};
    });
    return {snapshot: {...snapshot, nodes}, platformRef: new Map([...ours].map(([platform, step]) => [step, platform]))};
  }
}

/**
 * Which nodes of a snapshot a query names, with React Native Testing
 * Library's names and rules, so a device test reads like a component test:
 * `getByRole('button', {name: 'Save'})`, `getByText('Saved')`. Pure: a query
 * and a snapshot in, nodes out, which is what a locator and a matcher both
 * stand on.
 */
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';

/** A whole string, after normalising, or a pattern tested against it. */
export type TextMatch = string | RegExp;

export interface TextMatchOptions {
  /** `false` matches a string as a case-insensitive part of the text. `true` by default. */
  exact?: boolean;
  /** Replaces the normalising, which trims and collapses each run of whitespace to one space. */
  normalizer?: (text: string) => string;
}

export interface QueryOptions extends TextMatchOptions {
  /** Takes nodes that are off screen too. RNTL spells it `includeHiddenElements`, and both are taken. */
  hidden?: boolean;
  includeHiddenElements?: boolean;
  /** For a role: its accessible name. */
  name?: TextMatch;
  /** For a role: the heading level. */
  level?: number;
  checked?: boolean | 'mixed';
  selected?: boolean;
  expanded?: boolean;
  pressed?: boolean | 'mixed';
  disabled?: boolean;
}

/** What a query reads: role, text, label, placeholder, display value, testID, hint. */
export type Predicate = 'role' | 'text' | 'label' | 'placeholder' | 'value' | 'testId' | 'hint';

export type Refinement = {first: true} | {last: true} | {nth: number} | {hasText: TextMatch} | {has: LocatorQuery};

export interface LocatorQuery {
  predicate: Predicate;
  match: TextMatch;
  options: QueryOptions;
  /** From `within()`: the query whose one node the nodes must sit inside. */
  scope?: LocatorQuery;
  refinements: Refinement[];
  /** `getBy` wants one node, `getAllBy` at least one. */
  cardinality: 'one' | 'many';
}

export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A pattern's test from the start of the text: a global pattern otherwise starts where its last match ended. */
function tests(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

/**
 * RNTL's rule: a string matches the whole text, both normalised, or a part
 * of it in any case with `exact: false`; a pattern is tested against the
 * normalised text.
 */
export function matches(text: string | undefined | null, match: TextMatch, options: TextMatchOptions = {}): boolean {
  if (text === undefined || text === null) return false;
  const normaliser = options.normalizer ?? normalise;
  const value = normaliser(text);
  if (match instanceof RegExp) return tests(match, value);
  const wanted = normaliser(match);
  return options.exact === false ? value.toLowerCase().includes(wanted.toLowerCase()) : value === wanted;
}

/** Each node's children, worked out once per snapshot. */
const CHILDREN = new WeakMap<Snapshot, Map<SnapshotNode, SnapshotNode[]>>();

/**
 * The children of every node: through `parent` where the snapshot gives it,
 * else by depth, since every backend lists its nodes in a walk in order, so
 * a node's parent is the nearest node before it that sits higher.
 */
function childrenOf(snapshot: Snapshot): Map<SnapshotNode, SnapshotNode[]> {
  const known = CHILDREN.get(snapshot);
  if (known) return known;
  const {nodes} = snapshot;
  const children = new Map(nodes.map(node => [node, [] as SnapshotNode[]]));
  const add = (up: SnapshotNode, node: SnapshotNode) => (children.get(up) as SnapshotNode[]).push(node);
  if (nodes.some(node => node.parent !== undefined)) {
    const byRef = new Map(nodes.map(node => [node.ref, node]));
    for (const node of nodes) {
      const up = node.parent === undefined ? undefined : byRef.get(node.parent);
      if (up) add(up, node);
    }
  } else {
    const above: SnapshotNode[] = [];
    for (const node of nodes) {
      while (above.length > 0 && (above.at(-1) as SnapshotNode).depth >= node.depth) above.pop();
      const up = above.at(-1);
      if (up) add(up, node);
      above.push(node);
    }
  }
  CHILDREN.set(snapshot, children);
  return children;
}

/**
 * The nodes inside `outer`, at any depth, in the snapshot's order. Each node
 * has one parent, so the only loop a walk down can meet is a chain of
 * parents that comes back round to `outer`.
 */
export function inside(snapshot: Snapshot, outer: SnapshotNode): SnapshotNode[] {
  const children = childrenOf(snapshot);
  const found = new Set<SnapshotNode>();
  const walk = (node: SnapshotNode) => {
    for (const child of children.get(node) ?? []) {
      if (child === outer) continue;
      found.add(child);
      walk(child);
    }
  };
  walk(outer);
  return snapshot.nodes.filter(node => found.has(node));
}

const SAYS = new Set(['text', 'heading']);

/**
 * A node's own name. agent-device names a node with no label after its
 * testID, which is not a name a person reads, so on iOS and Android a name
 * that is only the testID counts as none.
 */
function ownName(node: SnapshotNode, snapshot: Snapshot): string {
  return (snapshot.platform === 'android' || snapshot.platform === 'ios') && node.testId !== undefined && node.name === node.testId ? '' : node.name;
}

/**
 * What a node is called: its own name, or, for a control with none, the
 * text inside it, joined with spaces. That is how a screen reader reads a
 * row on Android, where a pressable view's name is the text it holds, and
 * how RNTL works out a role's name. A screen reader stops only at controls,
 * so a layout's text is not its name, and a control inside a control says
 * its own text: a list that scrolls is not named after its rows.
 */
export function nameOf(node: SnapshotNode, snapshot: Snapshot): string {
  const own = ownName(node, snapshot);
  if (own || !node.interactive) return own;
  const children = childrenOf(snapshot);
  const words: string[] = [];
  // Down each branch to its first text: a text inside a text is said with it.
  const walk = (at: SnapshotNode) => {
    for (const child of children.get(at) ?? []) {
      if (child === node || child.interactive) continue;
      if (child.kind === undefined || !SAYS.has(child.kind)) walk(child);
      else {
        const said = ownName(child, snapshot);
        if (said) words.push(said);
      }
    }
  };
  walk(node);
  return words.join(' ');
}

const ROLE_STATES = ['checked', 'selected', 'expanded', 'pressed'] as const;

/** Whether a node is what the predicate names. */
function fits(node: SnapshotNode, query: LocatorQuery, snapshot: Snapshot): boolean {
  const {match, options} = query;
  switch (query.predicate) {
    case 'role': {
      const isRole =
        typeof match === 'string'
          ? node.role.toLowerCase() === match.toLowerCase() || node.kind === match.toLowerCase()
          : tests(match, node.role) || (node.kind !== undefined && tests(match, node.kind));
      if (!isRole) return false;
      if (options.name !== undefined && !matches(nameOf(node, snapshot), options.name, options)) return false;
      if (options.level !== undefined && node.heading !== options.level) return false;
      if (options.disabled !== undefined && (node.enabled === false) !== options.disabled) return false;
      return ROLE_STATES.every(state => options[state] === undefined || node[state] === options[state]);
    }
    case 'text':
      return matches(ownName(node, snapshot), match, options);
    case 'label':
      // A text's name is what it says, which is getByText's to find; leaving
      // it out keeps a button and the text inside it from both answering.
      return !(node.kind !== undefined && SAYS.has(node.kind)) && matches(nameOf(node, snapshot), match, options);
    case 'placeholder':
      return matches(node.placeholder, match, options);
    case 'value':
      return matches(node.value, match, options);
    case 'testId':
      return matches(node.testId, match, options);
    case 'hint':
      return matches(node.help, match, options);
  }
}

/**
 * The nodes a query names, in the snapshot's order: the scope first, then
 * the predicate and its options, then the refinements in the order written.
 * A scope that names no node, or several, names nothing inside it.
 */
export function resolve(query: LocatorQuery, snapshot: Snapshot, within?: SnapshotNode): SnapshotNode[] {
  let pool = within ? inside(snapshot, within) : snapshot.nodes;
  if (query.scope) {
    const outer = resolve(query.scope, snapshot, within);
    pool = outer.length === 1 ? inside(snapshot, outer[0] as SnapshotNode).filter(node => pool.includes(node)) : [];
  }
  const hidden = query.options.hidden ?? query.options.includeHiddenElements ?? false;
  let found = pool.filter(node => (hidden || node.offscreen !== true) && fits(node, query, snapshot));
  if (query.predicate === 'text') {
    // Text as a person reads it: a text or a heading where one matches, so a
    // switch labelled like the text beside it does not answer, and only where
    // none does, a control that draws its own text, as a button does on iOS.
    // Of those the innermost, so a button holding its text is found as the text.
    const texts = found.filter(node => node.kind !== undefined && SAYS.has(node.kind));
    const read = texts.length > 0 ? texts : found;
    const matched = new Set(read);
    found = read.filter(node => !inside(snapshot, node).some(each => matched.has(each)));
  }
  for (const refinement of query.refinements) {
    if ('first' in refinement) found = found.slice(0, 1);
    else if ('last' in refinement) found = found.slice(-1);
    else if ('nth' in refinement) found = found.slice(refinement.nth, refinement.nth + 1);
    else if ('hasText' in refinement) {
      // Playwright's rule: the text is anywhere in the node, its own name or a name inside it.
      found = found.filter(node => [node, ...inside(snapshot, node)].some(each => matches(ownName(each, snapshot), refinement.hasText, {exact: false})));
    } else found = found.filter(node => resolve(refinement.has, snapshot, node).length > 0);
  }
  return found;
}

/** A few values for a message, each once: `"a", "b" and 3 more`. */
function few(values: string[], quoted = true): string {
  const unique = [...new Set(values)];
  const shown = unique
    .slice(0, 5)
    .map(value => (quoted ? JSON.stringify(value) : value))
    .join(', ');
  return unique.length > 5 ? `${shown} and ${unique.length - 5} more` : shown;
}

/** The words of a name worth comparing: three letters or more, in lower case. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3);
}

/** Whether a name is like the one asked for: one holds the other, or they share a word. */
function like(name: string, wanted: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes(wanted) || (lower.length >= 3 && wanted.includes(lower)) || wordsOf(lower).some(word => wordsOf(wanted).includes(word));
}

/**
 * What the tree held instead, for a query that matched nothing: the names of
 * the nodes with the role it asked for, the names like the one it asked for,
 * or the values the field it reads has, a few of each.
 */
export function suggestions(query: LocatorQuery, snapshot: Snapshot): string {
  const {match, predicate} = query;
  const {nodes} = snapshot;
  if (predicate === 'role') {
    const named = nodes.filter(node => fits(node, {...query, options: {}}, snapshot));
    if (named.length > 0) return `${named.length} ${named.length === 1 ? 'node has' : 'nodes have'} role ${String(match)}: ${few(named.map(node => nameOf(node, snapshot)))}`;
    const kinds = nodes.flatMap(node => (node.kind ? [node.kind] : []));
    return kinds.length > 0 ? `no node has role ${String(match)}; the kinds there: ${few(kinds, false)}` : `no node has role ${String(match)}`;
  }
  if (predicate === 'text' || predicate === 'label') {
    const names = nodes.map(node => ownName(node, snapshot)).filter(Boolean);
    if (names.length === 0) return 'no node has a name';
    const near = typeof match === 'string' ? names.filter(name => like(name, match.toLowerCase())) : [];
    return near.length > 0 ? `names like it: ${few(near)}` : `the names there: ${few(names)}`;
  }
  const field = {placeholder: 'placeholder', value: 'value', testId: 'testId', hint: 'help'} as const;
  const what = {placeholder: 'placeholders', value: 'values', testId: 'testIDs', hint: 'hints'} as const;
  const values = nodes.flatMap(node => {
    const value = node[field[predicate]];
    return typeof value === 'string' && value !== '' ? [value] : [];
  });
  return values.length > 0 ? `the ${what[predicate]} there: ${few(values)}` : `no node has a ${what[predicate].slice(0, -1)}`;
}

/** Each predicate's word in RNTL's query names. */
const WORDS: Record<Predicate, string> = {role: 'Role', text: 'Text', label: 'LabelText', placeholder: 'PlaceholderText', value: 'DisplayValue', testId: 'TestId', hint: 'HintText'};

/** The query as it was written, for a message: `getByRole("button", {name: "Save"})`. */
export function describeQuery(query: LocatorQuery): string {
  const family = query.cardinality === 'one' ? 'getBy' : 'getAllBy';
  const word = WORDS[query.predicate];
  const text = (value: TextMatch) => (typeof value === 'string' ? JSON.stringify(value) : String(value));
  const options = Object.entries(query.options)
    .filter(([key, value]) => value !== undefined && key !== 'normalizer')
    .map(([key, value]) => `${key}: ${typeof value === 'string' || value instanceof RegExp ? text(value) : String(value)}`);
  const own = `${family}${word}(${text(query.match)}${options.length > 0 ? `, {${options.join(', ')}}` : ''})`;
  const refined = query.refinements
    .map(refinement => {
      if ('first' in refinement) return '.first()';
      if ('last' in refinement) return '.last()';
      if ('nth' in refinement) return `.nth(${refinement.nth})`;
      if ('hasText' in refinement) return `.filter({hasText: ${text(refinement.hasText)}})`;
      return `.filter({has: ${describeQuery(refinement.has)}})`;
    })
    .join('');
  return query.scope ? `within(${describeQuery(query.scope)}).${own}${refined}` : `${own}${refined}`;
}

/** A node as a candidate in a message: its ref, kind or role, name, testID and where it is. */
export function describeCandidate(node: SnapshotNode): string {
  const at = node.bounds ? `  at ${node.bounds.x},${node.bounds.y}` : '';
  return `${node.ref.padEnd(5)} ${node.kind ?? node.role} ${JSON.stringify(node.name)}${node.testId ? ` #${node.testId}` : ''}${at}`;
}

/** Why a query that wanted one node cannot act on several, and the ways out. */
export function ambiguity(query: LocatorQuery, nodes: SnapshotNode[]): string {
  return (
    `${describeQuery(query)} matches ${nodes.length} nodes; narrow it with first(), nth() or filter(), or use getAllBy${WORDS[query.predicate]}:\n` +
    nodes.map(node => `  ${describeCandidate(node)}`).join('\n')
  );
}

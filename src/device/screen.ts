/**
 * React Native Testing Library's queries, over the device's tree: seven
 * predicates, each in RNTL's six families, with RNTL's names and rules.
 *
 * | Family | Matches | Returns | Fails |
 * | --- | --- | --- | --- |
 * | `getBy*` | one | a `Locator`, lazy | when acted on or read: none after waiting, or several |
 * | `getAllBy*` | at least one | a `Locator` | none after waiting |
 * | `queryBy*` | none or one | the node or null, at once | several |
 * | `queryAllBy*` | any | the nodes, at once | never |
 * | `findBy*` | one | the node, waited for | none or several after the timeout |
 * | `findAllBy*` | at least one | the nodes, waited for | none after the timeout |
 *
 * `query*` and `find*` give nodes, as RNTL gives elements, because what a
 * test does with them is read them. A `getBy*` locator costs nothing until
 * it is acted on or asserted.
 */
import {HarnessError} from '../harness/lib/errors.ts';
import type {SnapshotNode} from '../harness/lib/snapshot.ts';
import type {LocatorHost} from './locator.ts';
import {Locator} from './locator.ts';
import {duration, poll} from './polling.ts';
import type {LocatorQuery, Predicate, QueryOptions, TextMatch, TextMatchOptions} from './queries.ts';
import {ambiguity, describeQuery, resolve, suggestions} from './queries.ts';

/** RNTL's word for each predicate, as its query names spell it. */
const PREDICATES = {Role: 'role', Text: 'text', LabelText: 'label', PlaceholderText: 'placeholder', DisplayValue: 'value', TestId: 'testId', HintText: 'hint'} as const satisfies Record<string, Predicate>;

type Word = keyof typeof PREDICATES;

/** What any query but a role takes: how its text is matched, and whether nodes off screen count. */
export interface TextQueryOptions extends TextMatchOptions {
  hidden?: boolean;
  includeHiddenElements?: boolean;
}

/** What a role takes besides: its name, a heading's level, and the state the control is in. */
export type RoleQueryOptions = QueryOptions;

/** How long a `findBy*` waits, in ms, over `assertionTimeout`, and a fixed gap between its readings in place of the growing one. */
export interface FindOptions {
  timeout?: number;
  interval?: number;
}

type OptionsOf<W extends Word> = W extends 'Role' ? RoleQueryOptions : TextQueryOptions;

/** The forty-two queries, `getByRole` to `findAllByHintText`. */
export type Queries = {[W in Word as `getBy${W}`]: (match: TextMatch, options?: OptionsOf<W>) => Locator} & {
  [W in Word as `getAllBy${W}`]: (match: TextMatch, options?: OptionsOf<W>) => Locator;
} & {[W in Word as `queryBy${W}`]: (match: TextMatch, options?: OptionsOf<W>) => Promise<SnapshotNode | null>} & {
  [W in Word as `queryAllBy${W}`]: (match: TextMatch, options?: OptionsOf<W>) => Promise<SnapshotNode[]>;
} & {[W in Word as `findBy${W}`]: (match: TextMatch, options?: OptionsOf<W>, wait?: FindOptions) => Promise<SnapshotNode>} & {
  [W in Word as `findAllBy${W}`]: (match: TextMatch, options?: OptionsOf<W>, wait?: FindOptions) => Promise<SnapshotNode[]>;
};

/** The queries over a device's tree, every one kept inside `scope`'s one node when there is a scope. */
export function queriesOn(host: LocatorHost, scope?: LocatorQuery): Queries {
  const error = (code: 'LOCATOR_NOT_FOUND' | 'LOCATOR_AMBIGUOUS', message: string) => new HarnessError(code, message, {platform: host.platform});

  /** Waits until the query names `enough` nodes, and says why not when it never does. */
  async function find(query: LocatorQuery, enough: (count: number) => boolean, wait: FindOptions = {}): Promise<SnapshotNode[]> {
    const timeout = wait.timeout ?? host.polling.assertionTimeout;
    const result = await poll(snapshot => ({snapshot, found: resolve(query, snapshot)}), ({found}) => enough(found.length), {
      timeout,
      stable: 0,
      negated: false,
      feed: host.feed,
      ...(host.clock ? {clock: host.clock} : {}),
      ...(wait.interval === undefined ? {} : {interval: wait.interval}),
    });
    const {snapshot, found} = result.last;
    if (result.pass) return found;
    if (found.length > 1) throw error('LOCATOR_AMBIGUOUS', `${ambiguity(query, found)}\n  and still did after ${duration(timeout)}`);
    throw error('LOCATOR_NOT_FOUND', `${describeQuery(query)} matched nothing within ${duration(timeout)}; the tree has ${snapshot.nodes.length} nodes; ${suggestions(query, snapshot)}`);
  }

  const queries: Record<string, unknown> = {};
  for (const [word, predicate] of Object.entries(PREDICATES)) {
    const query = (match: TextMatch, options: QueryOptions = {}, cardinality: 'one' | 'many' = 'one'): LocatorQuery => ({
      predicate,
      match,
      options,
      refinements: [],
      cardinality,
      ...(scope ? {scope} : {}),
    });
    queries[`getBy${word}`] = (match: TextMatch, options?: QueryOptions) => new Locator(host, query(match, options));
    queries[`getAllBy${word}`] = (match: TextMatch, options?: QueryOptions) => new Locator(host, query(match, options, 'many'));
    queries[`queryBy${word}`] = async (match: TextMatch, options?: QueryOptions) => {
      const asked = query(match, options);
      const found = resolve(asked, await host.feed.next());
      if (found.length > 1) throw error('LOCATOR_AMBIGUOUS', ambiguity(asked, found));
      return found[0] ?? null;
    };
    queries[`queryAllBy${word}`] = async (match: TextMatch, options?: QueryOptions) => resolve(query(match, options, 'many'), await host.feed.next());
    queries[`findBy${word}`] = async (match: TextMatch, options?: QueryOptions, wait?: FindOptions) => (await find(query(match, options), count => count === 1, wait))[0];
    queries[`findAllBy${word}`] = async (match: TextMatch, options?: QueryOptions, wait?: FindOptions) => find(query(match, options, 'many'), count => count > 0, wait);
  }
  return queries as Queries;
}

/**
 * The query that finds a node again: by its testID where it has one, else
 * by its role and name, off screen or not. A node is a reading of one
 * snapshot, and its ref may name another node in the next.
 */
export function queryFor(node: SnapshotNode): LocatorQuery {
  if (node.testId) return {predicate: 'testId', match: node.testId, options: {hidden: true}, refinements: [], cardinality: 'one'};
  return {predicate: 'role', match: node.role, options: {hidden: true, ...(node.name ? {name: node.name} : {})}, refinements: [], cardinality: 'one'};
}

/**
 * What `within` scopes to: a locator's query, or the query that finds a
 * node again. Told apart by shape, not by class, since a project can load
 * two copies of this package.
 */
export function scopeOf(target: Locator | SnapshotNode): LocatorQuery {
  return 'query' in target ? target.query : queryFor(target);
}

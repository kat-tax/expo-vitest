/**
 * The matchers on a locator, which wait the way Playwright's do: each reads
 * the tree until it says what the matcher asks, or until `assertionTimeout`.
 * One that waits for something to be gone, `toBeHidden` or any matcher with
 * `.not`, passes only once it has been so on every reading for `stable` ms,
 * since right after an action a single reading proves little.
 *
 * Registered by the device project's setup file, `src/device/matchers.ts`;
 * the logic is here so it can be tested without a device.
 */
import {HarnessError} from '../harness/lib/errors.ts';
import type {Selector, Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import type {Locator, LocatorHost} from './locator.ts';
import {hostOf} from './locator.ts';
import type {PollResult} from './polling.ts';
import {describeReadings, duration, poll, readingsOf} from './polling.ts';
import type {TextMatch, TextMatchOptions} from './queries.ts';
import {ambiguity, describeCandidate, describeQuery, matches, nameOf, resolve, suggestions} from './queries.ts';

/** How long a matcher waits, in ms, over `assertionTimeout`. */
export interface ExpectOptions {
  timeout?: number;
}

/** A reading: the snapshot, and the nodes the locator named in it. */
interface Reading {
  snapshot: Snapshot;
  nodes: SnapshotNode[];
}

/** What a matcher asks of the tree. */
interface Expectation {
  /** The assertion in words, after "expected <locator>": `to be visible`. */
  says: string;
  /** Takes off-screen nodes too, for a matcher about the whole tree. */
  anywhere?: boolean;
  /** Needs one node, so that several is an error at once, as for an action. */
  one?: boolean;
  passes(reading: Reading): boolean;
  /** A reading as a message says it: `"a@b"`, `disabled`, `gone`. */
  show(reading: Reading): string;
  /** A wait for something to be gone, which must hold for \`stable\`, as a negated wait must. */
  absent?: boolean;
}

/** The tree fields \`toHaveAttribute\` reads. */
export const ATTRIBUTES = ['help', 'inSet', 'heading', 'live', 'status', 'dialog', 'testId', 'placeholder', 'role', 'kind'] as const;

export type Attribute = (typeof ATTRIBUTES)[number];

function error(host: LocatorHost | undefined, code: 'INVALID_ARGUMENT' | 'LOCATOR_AMBIGUOUS', message: string): HarnessError {
  return new HarnessError(code, message, host ? {platform: host.platform} : {});
}

const quote = (match: TextMatch) => (typeof match === 'string' ? JSON.stringify(match) : String(match));

/** The one node of a reading, or undefined. */
const only = (reading: Reading) => reading.nodes[0];

/** How a node reads in a message: absent, or with what the matcher reads. */
function shown(reading: Reading, what: (node: SnapshotNode) => string): string {
  const node = only(reading);
  return node ? what(node) : 'gone';
}

/** Waits for an expectation, and answers Vitest as a matcher does. */
async function check(state: MatcherThis, received: unknown, name: string, expectation: Expectation, options: ExpectOptions = {}): Promise<{pass: boolean; message: () => string}> {
  const host = hostOf(received);
  if (!host) throw error(undefined, 'INVALID_ARGUMENT', `${name} takes a locator, such as screen.getByText("Saved"); it was given ${received === null ? 'null' : typeof received}`);
  const locator = received as Locator;
  const asked = expectation.anywhere ? {...locator.query, options: {...locator.query.options, hidden: true}} : locator.query;
  const timeout = options.timeout ?? host.polling.assertionTimeout;
  // Vitest leaves `isNot` unset, not false, on an assertion without `.not`.
  const negated = state.isNot === true;
  const want = !negated;
  // A wait for something to be gone holds for `stable`: a positive one for
  // an absence, or any negated one for a presence.
  const stable = negated !== Boolean(expectation.absent);
  const read = (snapshot: Snapshot): Reading => {
    const nodes = resolve(asked, snapshot);
    if (expectation.one && nodes.length > 1) throw error(host, 'LOCATOR_AMBIGUOUS', ambiguity(locator.query, nodes));
    return {snapshot, nodes};
  };
  const waited = () =>
    poll(read, reading => (expectation.passes(reading) === want) !== stable, {
      timeout,
      stable: host.polling.stable,
      negated: stable,
      feed: host.feed,
      ...(host.clock ? {clock: host.clock} : {}),
    });
  const what = `expect(${describeQuery(locator.query)}) ${negated ? 'not ' : ''}${expectation.says}`;
  const judged = (outcome: PollResult<Reading>) => ({
    result: outcome.pass ? ('ok' as const) : ('failed' as const),
    message: outcome.pass ? '' : `not so within ${duration(timeout)}`,
    polls: outcome.polls,
    readings: readingsOf(outcome, expectation.show),
  });
  const result = host.journal ? await host.journal.run({event: 'assert', what}, waited, judged) : await waited();
  if (result.pass) host.journal?.verified(what);
  // Vitest turns the answer round for `.not`, so the answer is whether the
  // wait got what it waited for, turned round to match.
  const pass = result.pass === want;
  return {
    pass,
    message: () => {
      const last = result.last;
      const node = only(last);
      const lines = [`expected ${describeQuery(locator.query)} ${negated ? 'not ' : ''}${expectation.says} within ${duration(timeout)}`];
      lines.push(`  ${describeReadings(result, expectation.show)}`);
      if (stable) lines.push(`  it must hold for ${duration(Math.min(host.polling.stable, timeout))} on every reading`);
      lines.push(node ? `  the node: ${describeCandidate(node)}` : `  no node matched; ${suggestions(locator.query, last.snapshot)}`);
      return lines.join('\n');
    },
  };
}

/** What Vitest gives a matcher as `this` that these read: whether it was asked with `.not`. */
type MatcherThis = {isNot?: boolean};

type Matcher = (this: MatcherThis, received: unknown, options?: ExpectOptions) => Promise<{pass: boolean; message: () => string}>;

const visible = (reading: Reading) => reading.nodes.filter(node => node.offscreen !== true);
const presence = (reading: Reading) => (visible(reading).length > 0 ? 'visible' : reading.nodes.length > 0 ? 'off screen' : 'gone');

/** A matcher of one node's state field, which passes where the field is \`true\`. */
function flag(field: 'selected' | 'expanded' | 'pressed' | 'focused', says: string, yes: string, no: string): Matcher {
  return async function (this: MatcherThis, received: unknown, options?: ExpectOptions) {
    return check(this, received, `to${says}`, {says: `to be ${yes}`, one: true, passes: reading => only(reading)?.[field] === true, show: reading => shown(reading, node => (node[field] === true ? yes : no))}, options);
  };
}

/**
 * What a matcher compares with, from what jest-dom's form lets a test pass:
 * a string or a pattern as it is, a number as its digits, nothing as
 * nothing. A list is refused, since a device field holds one value.
 */
function textMatch(name: string, received: unknown, match: unknown): TextMatch | undefined {
  if (match === undefined || match === null) return undefined;
  if (typeof match === 'string' || match instanceof RegExp) return match;
  if (typeof match === 'number' || typeof match === 'boolean') return String(match);
  throw error(hostOf(received), 'INVALID_ARGUMENT', `${name} compares with a string, a pattern or a number, not ${Array.isArray(match) ? 'a list' : typeof match}`);
}

/** Whether the one node is enabled, as a message says it. */
const enabledness = (reading: Reading) => shown(reading, node => (node.enabled === false ? 'disabled' : 'enabled'));

/** How a check box's state reads. */
const checkedState = (node: SnapshotNode) => (node.checked === undefined ? 'with no checked state' : node.checked === 'mixed' ? 'mixed' : node.checked ? 'checked' : 'unchecked');

/** What a role reads as: the platform's word, and the kind where there is one. */
const roleOf = (node: SnapshotNode) => (node.kind && node.kind !== node.role.toLowerCase() ? `${node.role}/${node.kind}` : node.role);

export const LOCATOR_MATCHERS = {
  async toBeVisible(this: MatcherThis, received: unknown, options?: ExpectOptions) {
    return check(this, received, 'toBeVisible', {
      says: 'to be visible',
      anywhere: true,
      passes: reading => {
        const shownNodes = visible(reading);
        if (shownNodes.length > 1) throw error(hostOf(received), 'LOCATOR_AMBIGUOUS', ambiguity((received as Locator).query, shownNodes));
        return shownNodes.length === 1;
      },
      show: presence,
    }, options);
  },
  async toBeHidden(this: MatcherThis, received: unknown, options?: ExpectOptions) {
    return check(this, received, 'toBeHidden', {says: 'to be hidden', anywhere: true, absent: true, passes: reading => visible(reading).length === 0, show: presence}, options);
  },
  async toBeAttached(this: MatcherThis, received: unknown, options?: ExpectOptions) {
    return check(this, received, 'toBeAttached', {says: 'to be in the tree', anywhere: true, passes: reading => reading.nodes.length > 0, show: presence}, options);
  },
  async toBeDetached(this: MatcherThis, received: unknown, options?: ExpectOptions) {
    return check(this, received, 'toBeDetached', {says: 'to be gone from the tree', anywhere: true, absent: true, passes: reading => reading.nodes.length === 0, show: presence}, options);
  },
  async toBeEnabled(this: MatcherThis, received: unknown, options?: ExpectOptions) {
    return check(this, received, 'toBeEnabled', {
      says: 'to be enabled',
      one: true,
      passes: reading => {
        const node = only(reading);
        return node !== undefined && node.enabled !== false;
      },
      show: enabledness,
    }, options);
  },
  async toBeDisabled(this: MatcherThis, received: unknown, options?: ExpectOptions) {
    return check(this, received, 'toBeDisabled', {
      says: 'to be disabled',
      one: true,
      passes: reading => only(reading)?.enabled === false,
      show: enabledness,
    }, options);
  },
  async toBeChecked(this: MatcherThis, received: unknown, value: boolean | 'mixed' = true, options?: ExpectOptions) {
    const says = value === 'mixed' ? 'to be mixed' : value ? 'to be checked' : 'to be unchecked';
    return check(this, received, 'toBeChecked', {says, one: true, passes: reading => only(reading)?.checked === value, show: reading => shown(reading, checkedState)}, options);
  },
  toBeSelected: flag('selected', 'BeSelected', 'selected', 'not selected'),
  toBeExpanded: flag('expanded', 'BeExpanded', 'expanded', 'collapsed'),
  toBePressed: flag('pressed', 'BePressed', 'pressed', 'not pressed'),
  toBeFocused: flag('focused', 'BeFocused', 'focused', 'not focused'),
  async toHaveText(this: MatcherThis, received: unknown, match: TextMatch | TextMatch[], options: ExpectOptions & TextMatchOptions = {}) {
    if (Array.isArray(match)) {
      // The list form reads every node the locator names, in the tree's order.
      return check(this, received, 'toHaveText', {
        says: `to have the texts ${JSON.stringify(match.map(String))}`,
        passes: reading => reading.nodes.length === match.length && reading.nodes.every((node, at) => matches(nameOf(node, reading.snapshot), match[at] as TextMatch, options)),
        show: reading => JSON.stringify(reading.nodes.map(node => nameOf(node, reading.snapshot))),
      }, options);
    }
    return check(this, received, 'toHaveText', {
      says: `to have text ${quote(match)}`,
      one: true,
      passes: reading => only(reading) !== undefined && matches(nameOf(only(reading) as SnapshotNode, reading.snapshot), match, options),
      show: reading => shown(reading, node => JSON.stringify(nameOf(node, reading.snapshot))),
    }, options);
  },
  async toContainText(this: MatcherThis, received: unknown, match: TextMatch, options?: ExpectOptions) {
    return check(this, received, 'toContainText', {
      says: `to contain text ${quote(match)}`,
      one: true,
      passes: reading => only(reading) !== undefined && matches(nameOf(only(reading) as SnapshotNode, reading.snapshot), match, {exact: false}),
      show: reading => shown(reading, node => JSON.stringify(nameOf(node, reading.snapshot))),
    }, options);
  },
  // `match` is any value jest-dom's form takes; left out, any value passes.
  async toHaveValue(this: MatcherThis, received: unknown, match?: unknown, options: ExpectOptions & TextMatchOptions = {}) {
    const wanted = textMatch('toHaveValue', received, match);
    return check(this, received, 'toHaveValue', {
      says: wanted === undefined ? 'to have a value' : `to have value ${quote(wanted)}`,
      one: true,
      passes: reading => (wanted === undefined ? only(reading)?.value !== undefined : matches(only(reading)?.value, wanted, options)),
      show: reading => shown(reading, node => (node.value === undefined ? 'with no value' : JSON.stringify(node.value))),
    }, options);
  },
  // Left out, the name passes as long as there is one, as in RNTL.
  async toHaveAccessibleName(this: MatcherThis, received: unknown, match?: TextMatch, options: ExpectOptions & TextMatchOptions = {}) {
    return check(this, received, 'toHaveAccessibleName', {
      says: match === undefined ? 'to have a name' : `to be named ${quote(match)}`,
      one: true,
      passes: reading => {
        const node = only(reading);
        if (!node) return false;
        const name = nameOf(node, reading.snapshot);
        return match === undefined ? name.trim() !== '' : matches(name, match, options);
      },
      show: reading => shown(reading, node => JSON.stringify(nameOf(node, reading.snapshot))),
    }, options);
  },
  async toHaveRole(this: MatcherThis, received: unknown, role: TextMatch, options?: ExpectOptions) {
    const is = (node: SnapshotNode) =>
      typeof role === 'string' ? node.role.toLowerCase() === role.toLowerCase() || node.kind === role.toLowerCase() : role.test(node.role) || (node.kind !== undefined && role.test(node.kind));
    return check(this, received, 'toHaveRole', {
      says: `to have role ${quote(role)}`,
      one: true,
      passes: reading => only(reading) !== undefined && is(only(reading) as SnapshotNode),
      show: reading => shown(reading, roleOf),
    }, options);
  },
  async toHaveCount(this: MatcherThis, received: unknown, count: number, options?: ExpectOptions) {
    return check(this, received, 'toHaveCount', {
      says: `to name ${count} node${count === 1 ? '' : 's'}`,
      // Waiting for none is waiting for something to be gone.
      absent: count === 0,
      passes: reading => reading.nodes.length === count,
      show: reading => `${reading.nodes.length}`,
    }, options);
  },
  // `name` and `match` are as loose as jest-dom's form, and are read here.
  async toHaveAttribute(this: MatcherThis, received: unknown, name: string, match?: unknown, options?: ExpectOptions) {
    if (!(ATTRIBUTES as readonly string[]).includes(name)) throw error(hostOf(received), 'INVALID_ARGUMENT', `toHaveAttribute reads ${ATTRIBUTES.join(', ')}; ${JSON.stringify(name)} is not one of them`);
    const wanted = textMatch('toHaveAttribute', received, match);
    const field = (node: SnapshotNode) => node[name as Attribute];
    return check(this, received, 'toHaveAttribute', {
      says: `to have ${name}${wanted === undefined ? '' : ` ${quote(wanted)}`}`,
      one: true,
      passes: reading => {
        const value = only(reading) ? field(only(reading) as SnapshotNode) : undefined;
        return value !== undefined && value !== null && (wanted === undefined || matches(String(value), wanted));
      },
      show: reading => shown(reading, node => (field(node) === undefined || field(node) === null ? `with no ${name}` : JSON.stringify(field(node)))),
    }, options);
  },
};

// The device matchers' types, here rather than in the setup file so that
// `expo-vitest/device`, which re-exports a type from this file, brings
// them into any program that imports it. Vitest 4 re-exports `Matchers`
// and `Assertion` from `@vitest/expect`, and an augmentation of the
// re-exporting module does not merge, so they are extended at their origin.
declare module '@vitest/expect' {
  interface Matchers<T = any> {
    toHaveElement(selector: Selector): T;
    toBeFullyLabelled(): T;
    toSupportArrowNavigation(key?: string): Promise<T>;
    toMatchScreenshot(name: string, options?: {maxRatio?: number}): Promise<T>;
    toBeHidden(options?: ExpectOptions): Promise<void>;
    toBeAttached(options?: ExpectOptions): Promise<void>;
    toBeDetached(options?: ExpectOptions): Promise<void>;
    toBeFocused(options?: ExpectOptions): Promise<void>;
    toHaveText(match: TextMatch | TextMatch[], options?: ExpectOptions & TextMatchOptions): Promise<void>;
    toContainText(match: TextMatch, options?: ExpectOptions): Promise<void>;
    toHaveCount(count: number, options?: ExpectOptions): Promise<void>;
  }
  // React Native Testing Library and jest-dom name these too, and a project
  // that loads their types gets them on `Assertion`, where they would win
  // over these on `Matchers` and take no timeout. So they are declared on
  // `Assertion` itself, each with the other sets' form first, so a
  // component test reads as it did, and the device test's form after.
  interface Assertion<T = any> {
    toBeVisible(): T;
    toBeVisible(options: ExpectOptions): Promise<void>;
    toBeEnabled(): T;
    toBeEnabled(options: ExpectOptions): Promise<void>;
    toBeDisabled(): T;
    toBeDisabled(options: ExpectOptions): Promise<void>;
    toBeChecked(): T;
    toBeChecked(value: boolean | 'mixed', options?: ExpectOptions): Promise<void>;
    toBeSelected(): T;
    toBeSelected(options: ExpectOptions): Promise<void>;
    toBeExpanded(): T;
    toBeExpanded(options: ExpectOptions): Promise<void>;
    toBePressed(): T;
    toBePressed(options: ExpectOptions): Promise<void>;
    toHaveAccessibleName(text?: TextMatch, options?: TextMatchOptions): T;
    toHaveAccessibleName(match?: TextMatch, options?: ExpectOptions & TextMatchOptions): Promise<void>;
    toHaveValue(value?: string | string[] | number | null): T;
    toHaveValue(match?: TextMatch, options?: ExpectOptions & TextMatchOptions): Promise<void>;
    toHaveRole(role: string): T;
    toHaveRole(role: TextMatch, options?: ExpectOptions): Promise<void>;
    toHaveAttribute(attr: string, value?: unknown): T;
    toHaveAttribute(name: Attribute, match: TextMatch | undefined, options: ExpectOptions): Promise<void>;
  }
}

/**
 * The replay cache. An `act` the test went on to check is written down: what
 * was done, to which control, and how the screen ended. The next run looks
 * the step up and, where the screen agrees, does it again with no model call;
 * where it stops agreeing, the model takes over from there.
 *
 * This file is the cache's logic: the key, the entry, where it is kept, the
 * lookup, and the checks a replay makes. The replay itself runs in the loop.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import type {Platform} from '../harness/lib/types.ts';
import {isSecret, isUnique} from './secrets.ts';
import type {ReplayMissReason} from './types.ts';
import {identityOf} from './view.ts';

export const CACHE_VERSION = 1;

export type CacheMode = 'off' | 'read-only' | 'read-write';

export interface CacheSettings {
  mode: CacheMode;
  /** Where entries are kept. */
  dir: string;
  /** A replay that stops agreeing fails with REPLAY_STALE, rather than handing the step to the model. */
  strict: boolean;
}

/** What the harness config's `cache` takes. */
export type CacheConfig = CacheMode | {mode?: CacheMode; dir?: string; strict?: boolean};

const MODES: readonly CacheMode[] = ['off', 'read-only', 'read-write'];

/**
 * The cache's settings: `HARNESS_CACHE` over the harness config's `cache`,
 * else `read-write` locally and `read-only` in CI, where a run should replay
 * what was recorded and record nothing of its own.
 */
export function cacheSettings(config: CacheConfig | undefined, environment: NodeJS.ProcessEnv, root: string): CacheSettings {
  const given = typeof config === 'string' ? {mode: config} : (config ?? {});
  const fromEnvironment = MODES.find(mode => mode === environment.HARNESS_CACHE);
  const mode = fromEnvironment ?? given.mode ?? (environment.CI && environment.CI !== 'false' && environment.CI !== '0' ? 'read-only' : 'read-write');
  return {mode, dir: path.resolve(root, given.dir ?? path.join('.harness', 'cache')), strict: given.strict ?? false};
}

/** JSON with every object's keys sorted and no whitespace, so equal values hash alike. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(each => canonical(each)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, each]) => each !== undefined);
    // Keys are unique, so no two compare equal.
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, each]) => `${JSON.stringify(key)}:${canonical(each)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Params as the key and an entry hold them: a secret by its name, a unique value by its slot. */
export function keyParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).map(([name, value]) => [name, isSecret(value) ? {secret: value.name} : isUnique(value) ? `{{param:${name}}}` : value]));
}

/** The unique values among the params, by name. */
export function uniquesOf(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).flatMap(([name, value]) => (isUnique(value) ? [[name, value.value]] : [])));
}

/** Typed text as an entry keeps it: each unique value as its slot, so the entry holds no run's own value. */
export function toSlots(text: string, uniques: Record<string, string>): string {
  return Object.entries(uniques).reduce((each, [name, value]) => each.split(value).join(`{{param:${name}}}`), text);
}

/** Typed text as a replay types it: each slot as this run's value. */
export function fromSlots(text: string, uniques: Record<string, string>): string {
  return text.replace(/\{\{param:([^}]+)\}\}/g, (slot, name: string) => uniques[name] ?? slot);
}

/** Whether two params share a value, so typed text could not be told to be one rather than the other. */
export function paramsCollide(params: Record<string, unknown>): boolean {
  const values = Object.values(params).map(value => (isUnique(value) ? value.value : isSecret(value) ? undefined : String(value))).filter(value => value !== undefined);
  return new Set(values).size !== values.length;
}

/** What a step's key is made of: the test, the platform, the step as written, the agent, the app and the executor. Not the model, so changing it misses nothing. */
export interface KeyParts {
  test: {file: string; title: string};
  platform: Platform;
  instruction: string;
  params: Record<string, unknown>;
  agent: {name: string; context: string};
  app: {identity: string};
  executor: {name: string; version: string};
}

export function cacheKey(parts: KeyParts): string {
  return createHash('sha256').update(canonical({...parts, params: keyParams(parts.params)})).digest('hex');
}

/** A control as an entry knows it: enough to find it again on another run, by what it is rather than by its ref. */
export interface RecordedTarget {
  kind: string;
  name: string;
  testId: string | null;
  /** The parent's kind and name, which tell two controls of one name apart. */
  parent: string[];
}

export interface RecordedAction {
  tool: string;
  target?: RecordedTarget;
  /** The tool's input without its ref: text as typed, with slots, and a secret by its name only. */
  input: Record<string, unknown>;
}

export interface CacheEntry {
  v: typeof CACHE_VERSION;
  key: string;
  test: {file: string; title: string};
  platform: Platform;
  instruction: string;
  params: Record<string, unknown>;
  agent: {name: string; contextHash: string};
  app: {identity: string};
  executor: {name: string; version: string};
  start: {route: string | null};
  actions: RecordedAction[];
  /** A mutating tool cut the recording short: what follows it is the model's again. */
  truncated?: true;
  end: {route: string | null; appeared: Pick<RecordedTarget, 'kind' | 'name'>[]; disappeared: Pick<RecordedTarget, 'kind' | 'name'>[]};
  summary: string;
  recordedAt: string;
  viewport: {width: number; height: number} | null;
}

const kindOf = (node: SnapshotNode) => node.kind ?? node.role.toLowerCase();

/** A node as an entry records it. */
export function targetOf(node: SnapshotNode, snapshot: Snapshot): RecordedTarget {
  const parent = node.parent ? snapshot.nodes.find(each => each.ref === node.parent) : undefined;
  return {kind: kindOf(node), name: node.name, testId: node.testId ?? null, parent: parent ? [kindOf(parent), parent.name] : []};
}

const ENTRY = (dir: string, key: string) => path.join(dir, `${key}.json`);

/** An entry, from where the cache keeps it. A file that is not one of this version's is `invalid-entry`. */
export function readEntry(dir: string, key: string): {entry: CacheEntry} | {miss: 'no-entry' | 'invalid-entry'} {
  let text: string;
  try {
    text = fs.readFileSync(ENTRY(dir, key), 'utf8');
  } catch {
    return {miss: 'no-entry'};
  }
  try {
    const entry = JSON.parse(text) as CacheEntry;
    if (entry.v !== CACHE_VERSION || entry.key !== key || !Array.isArray(entry.actions)) return {miss: 'invalid-entry'};
    return {entry};
  } catch {
    return {miss: 'invalid-entry'};
  }
}

/** Writes an entry under a name of its own first and renames it into place, so a crash never leaves half of one. */
export function writeEntry(dir: string, entry: CacheEntry): string {
  fs.mkdirSync(dir, {recursive: true});
  const file = ENTRY(dir, entry.key);
  const partial = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(partial, `${JSON.stringify(entry, null, 2)}\n`);
  fs.renameSync(partial, file);
  return file;
}

/**
 * What a step's lookup finds: an entry to replay, or why not. A retry of a
 * test misses, since the replay is what may have failed; an entry for
 * another app or executor is the wrong context; one a mutating tool cut
 * short before any action has nothing to replay.
 */
export function lookUp(settings: CacheSettings, key: string, context: {retry: boolean; identity: string; executor: {name: string; version: string}}): {entry: CacheEntry} | {miss: ReplayMissReason} | null {
  if (settings.mode === 'off') return null;
  if (context.retry) return {miss: 'retry'};
  const found = readEntry(settings.dir, key);
  if ('miss' in found) return found;
  const {entry} = found;
  if (entry.app.identity !== context.identity || canonical(entry.executor) !== canonical(context.executor)) return {miss: 'wrong-context'};
  if (entry.truncated && entry.actions.length === 0) return {miss: 'truncated'};
  return {entry};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{7,}$/i;

/** A route with each segment that is a number, a UUID or a hash as a wildcard, in its path and its query. */
export function routePattern(route: string): string {
  const wild = (segment: string) => (/^\d+$/.test(segment) || UUID.test(segment) || (HASH.test(segment) && /\d/.test(segment)) ? '*' : segment);
  const [pathPart = '', query] = route.split('?');
  const paths = pathPart.split('/').map(wild).join('/');
  if (query === undefined) return paths;
  return `${paths}?${query
    .split('&')
    .map(pair => {
      const [name, value] = pair.split('=');
      return value === undefined ? pair : `${name}=${wild(decodeURIComponent(value))}`;
    })
    .join('&')}`;
}

/** Whether a route is the one recorded, a number, a UUID or a hash in either standing for any. */
export function sameRoute(recorded: string | null, current: string | null): boolean {
  if (recorded === null || current === null) return recorded === current;
  return routePattern(recorded) === routePattern(current);
}

/** The node a recorded target is now: by test id where one was recorded, else by kind and name, told apart by the parent. */
export function findTarget(snapshot: Snapshot, target: RecordedTarget): {node: SnapshotNode} | {miss: 'target-not-found' | 'target-ambiguous'} {
  let found = snapshot.nodes.filter(node => (target.testId ? node.testId === target.testId : kindOf(node) === target.kind && node.name === target.name));
  if (found.length > 1 && target.parent.length) found = found.filter(node => canonical(targetOf(node, snapshot).parent) === canonical(target.parent));
  if (found.length === 0) return {miss: 'target-not-found'};
  if (found.length > 1) return {miss: 'target-ambiguous'};
  return {node: found[0] as SnapshotNode};
}

/** The most controls an entry keeps of those that came and went, for its end check. */
const END_CONTROLS = 8;

/** How a step left the screen: the route, and up to eight controls that came and eight that went. */
export function endOf(before: Snapshot, after: Snapshot, route: string | null): CacheEntry['end'] {
  const controls = (snapshot: Snapshot) => {
    const byRef = new Map(snapshot.nodes.map(node => [node.ref, node]));
    return new Map(snapshot.nodes.filter(node => node.interactive && node.name).map(node => [identityOf(node, byRef), node]));
  };
  const was = controls(before);
  const now = controls(after);
  const named = (node: SnapshotNode) => ({kind: kindOf(node), name: node.name});
  return {
    route,
    appeared: [...now].filter(([identity]) => !was.has(identity)).slice(0, END_CONTROLS).map(([, node]) => named(node)),
    disappeared: [...was].filter(([identity]) => !now.has(identity)).slice(0, END_CONTROLS).map(([, node]) => named(node)),
  };
}

/** Whether the screen ends as recorded: the route, each control that came there, and none of those that went. */
export function endMatches(snapshot: Snapshot, route: string | null, end: CacheEntry['end']): boolean {
  const has = ({kind, name}: {kind: string; name: string}) => snapshot.nodes.some(node => kindOf(node) === kind && node.name === name);
  return sameRoute(end.route, route) && end.appeared.every(has) && !end.disappeared.some(has);
}

/** The context's hash an entry keeps, so it shows which context it was recorded in without holding it. */
export function contextHash(context: string): string {
  return createHash('sha256').update(context).digest('hex').slice(0, 16);
}

/** Each entry the cache holds, newest first, as `expo-harness cache ls` prints them. */
export function listEntries(dir: string): {key: string; test: string; platform: string; instruction: string; recordedAt: string; bytes: number}[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(name => name.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .flatMap(name => {
      const file = path.join(dir, name);
      try {
        const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheEntry;
        return [{key: entry.key, test: `${entry.test.file} > ${entry.test.title}`, platform: entry.platform, instruction: entry.instruction, recordedAt: entry.recordedAt, bytes: fs.statSync(file).size}];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

/** How many entries the cache holds, and their size. */
export function cacheStats(dir: string): {entries: number; bytes: number} {
  const entries = listEntries(dir);
  return {entries: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0)};
}

/** Empties the cache; how many entries it held. */
export function clearCache(dir: string): number {
  const count = listEntries(dir).length;
  fs.rmSync(dir, {recursive: true, force: true});
  return count;
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import type {CacheEntry, KeyParts} from './cache.ts';
import {
  CACHE_VERSION,
  cacheKey,
  cacheSettings,
  cacheStats,
  canonical,
  clearCache,
  contextHash,
  endMatches,
  endOf,
  findTarget,
  fromSlots,
  keyParams,
  listEntries,
  lookUp,
  paramsCollide,
  readEntry,
  routePattern,
  sameRoute,
  targetOf,
  toSlots,
  uniquesOf,
  writeEntry,
} from './cache.ts';
import {secret, unique} from './secrets.ts';

const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;
const root = path.resolve('/app');
const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: true, ...extra});
const folders: string[] = [];
const folder = () => {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-cache-'));
  folders.push(made);
  return made;
};
afterEach(() => {
  for (const each of folders.splice(0)) fs.rmSync(each, {recursive: true, force: true});
});

const parts: KeyParts = {
  test: {file: 'device/billing.test.ts', title: 'a member upgrades to Pro'},
  platform: 'web',
  instruction: 'upgrade the workspace to the {plan} plan',
  params: {plan: 'Pro'},
  agent: {name: 'default', context: 'A billing app.'},
  app: {identity: 'http://localhost:8081'},
  executor: {name: 'builtin', version: '1'},
};

const entry = (key: string, extra: Partial<CacheEntry> = {}): CacheEntry => ({
  v: CACHE_VERSION,
  key,
  test: parts.test,
  platform: 'web',
  instruction: parts.instruction,
  params: {plan: 'Pro'},
  agent: {name: 'default', contextHash: contextHash(parts.agent.context)},
  app: {identity: 'http://localhost:8081'},
  executor: {name: 'builtin', version: '1'},
  start: {route: '/settings/billing'},
  actions: [{tool: 'tap', target: {kind: 'button', name: 'Upgrade to Pro', testId: 'upgrade-cta', parent: ['main', 'Billing']}, input: {}}],
  end: {route: '/settings/billing/confirm', appeared: [{kind: 'status', name: 'Prorated amount'}], disappeared: [{kind: 'button', name: 'Upgrade to Pro'}]},
  summary: 'Opened the upgrade dialog and confirmed.',
  recordedAt: '2026-10-13T06:24:00Z',
  viewport: {width: 1280, height: 900},
  ...extra,
});

describe("the cache's settings", () => {
  it('are the environment over the config, else read-write locally and read-only in CI', () => {
    expect(cacheSettings(undefined, env(), root)).toEqual({mode: 'read-write', dir: path.join(root, '.harness', 'cache'), strict: false});
    expect(cacheSettings(undefined, env({CI: 'true'}), root).mode).toBe('read-only');
    expect(cacheSettings(undefined, env({CI: 'false'}), root).mode).toBe('read-write');
    expect(cacheSettings(undefined, env({CI: '0'}), root).mode).toBe('read-write');
    expect(cacheSettings('off', env({CI: 'true'}), root).mode).toBe('off');
    expect(cacheSettings('read-only', env({HARNESS_CACHE: 'read-write'}), root).mode).toBe('read-write');
    expect(cacheSettings('read-only', env({HARNESS_CACHE: 'sometimes'}), root).mode).toBe('read-only');
    expect(cacheSettings({dir: 'replays', strict: true}, env(), root)).toEqual({mode: 'read-write', dir: path.join(root, 'replays'), strict: true});
  });
});

describe('a key', () => {
  it('is canonical JSON hashed, with keys sorted and no whitespace', () => {
    expect(canonical({b: 1, a: [true, null, {d: 'x', c: undefined}]})).toBe('{"a":[true,null,{"d":"x"}],"b":1}');
    expect(canonical(undefined)).toBe('null');
    expect(cacheKey(parts)).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey({...parts, params: {plan: 'Pro'}})).toBe(cacheKey(parts));
  });

  it('changes with the step, the test, the app, the agent and the executor, and not with a unique value', () => {
    const key = cacheKey(parts);
    expect(cacheKey({...parts, instruction: 'downgrade'})).not.toBe(key);
    expect(cacheKey({...parts, test: {...parts.test, title: 'other'}})).not.toBe(key);
    expect(cacheKey({...parts, agent: {...parts.agent, context: 'other'}})).not.toBe(key);
    expect(cacheKey({...parts, executor: {name: 'builtin', version: '2'}})).not.toBe(key);
    const withEmail = (value: string) => cacheKey({...parts, params: {email: unique(value)}});
    expect(withEmail('ada+1@example.com')).toBe(withEmail('ada+2@example.com'));
  });

  it('holds a secret by its name and a unique value by its slot', () => {
    expect(keyParams({password: secret('ADA_PASSWORD'), email: unique('a@b.c'), plan: 'Pro', seats: 3})).toEqual({password: {secret: 'ADA_PASSWORD'}, email: '{{param:email}}', plan: 'Pro', seats: 3});
    expect(uniquesOf({email: unique('a@b.c'), plan: 'Pro'})).toEqual({email: 'a@b.c'});
  });
});

describe('typed text', () => {
  it('keeps a unique value as its slot, and a replay fills the slot with the run\'s', () => {
    expect(toSlots('sign up as ada+1@example.com now', {email: 'ada+1@example.com'})).toBe('sign up as {{param:email}} now');
    expect(fromSlots('sign up as {{param:email}} now', {email: 'ada+2@example.com'})).toBe('sign up as ada+2@example.com now');
    expect(fromSlots('{{param:missing}}', {})).toBe('{{param:missing}}');
  });

  it('cannot be told apart where two params share a value', () => {
    expect(paramsCollide({from: 'Paris', to: 'Paris'})).toBe(true);
    expect(paramsCollide({from: 'Paris', to: 'Rome', password: secret('ADA_PASSWORD'), again: secret('ADA_PASSWORD')})).toBe(false);
    expect(paramsCollide({a: unique('x1'), b: 'x1'})).toBe(true);
    expect(paramsCollide({count: 3, label: '3'})).toBe(true);
  });
});

describe('an entry, kept and read', () => {
  it('is written under a name of its own and renamed into place, and read back', () => {
    const dir = folder();
    const key = cacheKey(parts);
    const file = writeEntry(path.join(dir, 'nested'), entry(key));
    expect(file).toBe(path.join(dir, 'nested', `${key}.json`));
    expect(fs.readdirSync(path.join(dir, 'nested'))).toEqual([`${key}.json`]);
    expect(readEntry(path.join(dir, 'nested'), key)).toEqual({entry: entry(key)});
  });

  it('is no-entry where there is none, and invalid-entry where the file is not one of this version\'s', () => {
    const dir = folder();
    expect(readEntry(dir, 'abc')).toEqual({miss: 'no-entry'});
    fs.writeFileSync(path.join(dir, 'abc.json'), '{not json');
    expect(readEntry(dir, 'abc')).toEqual({miss: 'invalid-entry'});
    fs.writeFileSync(path.join(dir, 'abc.json'), JSON.stringify({...entry('abc'), v: 0}));
    expect(readEntry(dir, 'abc')).toEqual({miss: 'invalid-entry'});
    fs.writeFileSync(path.join(dir, 'abc.json'), JSON.stringify(entry('other')));
    expect(readEntry(dir, 'abc')).toEqual({miss: 'invalid-entry'});
    fs.writeFileSync(path.join(dir, 'abc.json'), JSON.stringify({...entry('abc'), actions: 'none'}));
    expect(readEntry(dir, 'abc')).toEqual({miss: 'invalid-entry'});
  });
});

describe('a lookup', () => {
  const context = {retry: false, identity: 'http://localhost:8081', executor: {name: 'builtin', version: '1'}};
  const settings = (dir: string, mode: 'off' | 'read-only' | 'read-write' = 'read-only') => ({mode, dir, strict: false});

  it('finds the entry to replay', () => {
    const dir = folder();
    writeEntry(dir, entry('k'));
    expect(lookUp(settings(dir), 'k', context)).toEqual({entry: entry('k')});
  });

  it('is nothing at all with the cache off', () => {
    expect(lookUp(settings(folder(), 'off'), 'k', context)).toBeNull();
  });

  it('misses on a retry, with no entry, a bad one, another context, or one cut short before any action', () => {
    const dir = folder();
    expect(lookUp(settings(dir), 'k', {...context, retry: true})).toEqual({miss: 'retry'});
    expect(lookUp(settings(dir), 'k', context)).toEqual({miss: 'no-entry'});
    fs.writeFileSync(path.join(dir, 'k.json'), 'x');
    expect(lookUp(settings(dir), 'k', context)).toEqual({miss: 'invalid-entry'});
    writeEntry(dir, entry('k'));
    expect(lookUp(settings(dir), 'k', {...context, identity: 'com.example.app'})).toEqual({miss: 'wrong-context'});
    expect(lookUp(settings(dir), 'k', {...context, executor: {name: 'builtin', version: '2'}})).toEqual({miss: 'wrong-context'});
    writeEntry(dir, entry('k', {truncated: true, actions: []}));
    expect(lookUp(settings(dir), 'k', context)).toEqual({miss: 'truncated'});
    writeEntry(dir, entry('k', {truncated: true}));
    expect(lookUp(settings(dir), 'k', context)).toMatchObject({entry: {truncated: true}});
  });
});

describe('a route, for a replay', () => {
  it('has its numbers, UUIDs and hashes as wildcards, in its path and its query', () => {
    expect(routePattern('/orders/1234/items')).toBe('/orders/*/items');
    expect(routePattern('/users/0b8f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e')).toBe('/users/*');
    expect(routePattern('/build/a1b2c3d4e5')).toBe('/build/*');
    expect(routePattern('/settings/billing')).toBe('/settings/billing');
    expect(routePattern('/deadbeef')).toBe('/deadbeef');
    expect(routePattern('/search?q=shoes&page=2&flag')).toBe('/search?q=shoes&page=*&flag');
  });

  it('is the recorded one where only those differ', () => {
    expect(sameRoute('/orders/1/items', '/orders/88/items')).toBe(true);
    expect(sameRoute('/orders/1/items', '/orders/1/refunds')).toBe(false);
    expect([sameRoute(null, null), sameRoute(null, '/a'), sameRoute('/a', null)]).toEqual([true, false, false]);
  });
});

describe('a recorded control, found again', () => {
  const screen: Snapshot = {
    platform: 'web',
    nodes: [
      node('@e1', 'main', '', {interactive: false}),
      node('@e2', 'dialog', 'Payment', {interactive: false}),
      node('@e3', 'button', 'Save', {parent: '@e1'}),
      node('@e4', 'button', 'Save', {parent: '@e2'}),
      node('@e5', 'button', 'Upgrade to Pro', {testId: 'upgrade-cta', parent: '@e1'}),
      node('@e6', 'button', 'Delete'),
      node('@e7', 'button', 'Delete'),
    ],
  };

  it('is recorded by what it is and where', () => {
    expect(targetOf(screen.nodes[3] as SnapshotNode, screen)).toEqual({kind: 'button', name: 'Save', testId: null, parent: ['dialog', 'Payment']});
    expect(targetOf(screen.nodes[5] as SnapshotNode, screen)).toEqual({kind: 'button', name: 'Delete', testId: null, parent: []});
  });

  it('is found by its test id, else by kind and name, told apart by its parent', () => {
    expect(findTarget(screen, {kind: 'link', name: 'renamed', testId: 'upgrade-cta', parent: []})).toEqual({node: screen.nodes[4]});
    expect(findTarget(screen, {kind: 'button', name: 'Save', testId: null, parent: ['dialog', 'Payment']})).toEqual({node: screen.nodes[3]});
  });

  it("is told apart by its kind and name where a list's rows share its test id, and found by them where no node has the id now", () => {
    const settings: Snapshot = {
      platform: 'android',
      nodes: [
        node('@e1', 'TextView', 'Network & internet', {kind: 'text', testId: 'android:id/title', interactive: false}),
        node('@e2', 'TextView', 'Connected devices', {kind: 'text', testId: 'android:id/title', interactive: false}),
        node('@e3', 'Button', 'Done', {kind: 'button'}),
      ],
    };
    expect(findTarget(settings, {kind: 'text', name: 'Connected devices', testId: 'android:id/title', parent: []})).toEqual({node: settings.nodes[1]});
    expect(findTarget(settings, {kind: 'text', name: 'Apps', testId: 'android:id/title', parent: []})).toEqual({miss: 'target-not-found'});
    expect(findTarget(settings, {kind: 'button', name: 'Done', testId: 'done-button', parent: []})).toEqual({node: settings.nodes[2]});
  });

  it('is not found, or ambiguous, by the hand-off reasons', () => {
    expect(findTarget(screen, {kind: 'button', name: 'Cancel', testId: null, parent: []})).toEqual({miss: 'target-not-found'});
    expect(findTarget(screen, {kind: 'button', name: 'Delete', testId: null, parent: []})).toEqual({miss: 'target-ambiguous'});
    expect(findTarget(screen, {kind: 'button', name: 'Save', testId: null, parent: ['main', 'Elsewhere']})).toEqual({miss: 'target-not-found'});
  });
});

describe('how a step left the screen', () => {
  const before: Snapshot = {platform: 'web', nodes: [node('@e1', 'button', 'Upgrade to Pro'), node('@e2', 'link', 'Help')]};
  const after: Snapshot = {platform: 'web', nodes: [node('@e2', 'link', 'Help'), node('@e9', 'button', 'Confirm'), node('@e10', 'textbox', '')]};

  it('is the route and the controls that came and went', () => {
    expect(endOf(before, after, '/confirm')).toEqual({route: '/confirm', appeared: [{kind: 'button', name: 'Confirm'}], disappeared: [{kind: 'button', name: 'Upgrade to Pro'}]});
  });

  it('keeps eight of each at most', () => {
    const many: Snapshot = {platform: 'web', nodes: Array.from({length: 12}, (_, index) => node(`@e${index}`, 'button', `B${index}`))};
    expect(endOf({platform: 'web', nodes: []}, many, null).appeared).toHaveLength(8);
  });

  it('matches where the route agrees, every control that came is there, and none that went', () => {
    const end = endOf(before, after, '/confirm/12');
    expect(endMatches(after, '/confirm/40', end)).toBe(true);
    expect(endMatches(after, '/elsewhere', end)).toBe(false);
    expect(endMatches(before, '/confirm/12', end)).toBe(false);
    expect(endMatches({platform: 'web', nodes: [...after.nodes, node('@e1', 'button', 'Upgrade to Pro')]}, '/confirm/12', end)).toBe(false);
  });
});

describe('the cache folder', () => {
  it('is listed newest first, counted and emptied, a file that is no entry passed over', () => {
    const dir = folder();
    writeEntry(dir, entry('older', {recordedAt: '2026-10-01T00:00:00Z'}));
    writeEntry(dir, entry('newer', {recordedAt: '2026-10-14T00:00:00Z'}));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not an entry');
    expect(listEntries(dir).map(each => [each.key, each.test, each.platform, each.instruction])).toEqual([
      ['newer', 'device/billing.test.ts > a member upgrades to Pro', 'web', 'upgrade the workspace to the {plan} plan'],
      ['older', 'device/billing.test.ts > a member upgrades to Pro', 'web', 'upgrade the workspace to the {plan} plan'],
    ]);
    const stats = cacheStats(dir);
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(clearCache(dir)).toBe(2);
    expect(fs.existsSync(dir)).toBe(false);
    expect(listEntries(dir)).toEqual([]);
    expect(cacheStats(dir)).toEqual({entries: 0, bytes: 0});
  });

  it('keeps a context by its hash, not as it was written', () => {
    expect(contextHash('A billing app.')).toMatch(/^[0-9a-f]{16}$/);
    expect(contextHash('A billing app.')).not.toBe(contextHash('Another app.'));
  });
});

/**
 * agent-device's words in the harness's, and the harness's in agent-device's:
 * its snapshot nodes as ours, our targets in its spelling, its failures as our
 * codes, and the folders its package may be installed in. Nothing here talks
 * to a device, so each rule is pinned by a test.
 *
 * Checked against agent-device 0.21.27 on a Pixel 7 Pro:
 *
 * - The Node client and the command line's `--json` answer the same snapshot:
 *   a flat list of nodes, each with `index`, `ref` (without the `@`),
 *   `depth`, `parentIndex`, `kind`, the raw class as `type`, and `role` on iOS
 *   only.
 * - `press` and `click` take a point, a ref (`@e3`) or a selector, and a ref
 *   expires at the next action on the device.
 * - Selector keys are `id role text label value appname windowtitle visible
 *   hidden editable selected focused enabled hittable`; a testID is `id`, and
 *   no key matches loosely.
 * - A failure has a `code` and a `message`; the command line prints them as
 *   `Error (<code>): <message>`. A selector that matches nothing is
 *   `COMMAND_FAILED` with `Selector did not match: <selector>`.
 * - `press` and `fill` take `--settle` (read in its command schema): after the
 *   action, wait until the screen has been quiet for `--settle-quiet` ms, at
 *   most `--timeout` ms, and never fail the action for it.
 */
import path from 'node:path';
import type {HarnessCode} from '../lib/errors.ts';
import type {SnapshotNode, Target} from '../lib/snapshot.ts';
import {asSelector, describeTarget, isPoint} from '../lib/snapshot.ts';
import {kindOnAndroid, kindOnIos} from '../lib/roles.ts';
import {DEFAULT_TIMING} from '../lib/settle.ts';
import type {StepTiming} from '../lib/types.ts';

/** A node as agent-device reports it. */
export interface AgentNode {
  /** Where the node is in agent-device's own list, which `parentIndex` points into. */
  index?: number;
  parentIndex?: number;
  ref?: string;
  role?: string;
  type?: string;
  kind?: string;
  label?: string;
  value?: string;
  identifier?: string;
  rect?: {x?: number; y?: number; width?: number; height?: number};
  enabled?: boolean;
  focused?: boolean;
  depth?: number;
  hittable?: boolean;
  visibleToUser?: boolean;
  checked?: boolean;
  selected?: boolean;
  editable?: boolean;
  password?: boolean;
  /** The hint an empty field shows, and whether it is showing in place of the text. */
  placeholder?: string;
  hintShowing?: boolean;
}

/** Their node in our shape, so a test reads the same whichever backend answered. */
export function toSnapshotNode(node: AgentNode, index: number): SnapshotNode {
  const ref = node.ref ? (node.ref.startsWith('@') ? node.ref : `@${node.ref}`) : `@e${index + 1}`;
  const rect = node.rect;
  return {
    ref,
    // The platform's own word: the role on iOS, the class on Android. `kind`
    // is agent-device's word for both, kept for a node that has neither.
    role: node.role ?? node.type ?? node.kind ?? '',
    name: node.label ?? node.value ?? node.identifier ?? '',
    // `identifier` is the accessibility identifier, which is where React
    // Native's testID lands on both iOS and Android. It stays the last resort
    // for a name above, for a node that has nothing else to be called.
    ...(node.identifier ? {testId: node.identifier} : null),
    depth: node.depth ?? 0,
    interactive: node.hittable ?? false,
    focused: node.focused,
    enabled: node.enabled,
    offscreen: node.visibleToUser === false,
    bounds:
      rect && typeof rect.x === 'number' && typeof rect.width === 'number'
        ? {x: Math.round(rect.x), y: Math.round(rect.y ?? 0), width: Math.round(rect.width), height: Math.round(rect.height ?? 0)}
        : null,
    ...(typeof node.checked === 'boolean' ? {checked: node.checked} : null),
    // agent-device reports `selected: false` on every Android node, which
    // says nothing about whether the node can be selected at all, so only a
    // selected node carries it.
    ...(node.selected === true ? {selected: true} : null),
    ...(node.placeholder ? {placeholder: node.placeholder} : null),
    // What a field holds: never a secure field's, and nothing while Android
    // shows the hint in place of the text. Only an editable node has one, so
    // a label's text is not read as a value.
    ...(node.password ? {secure: true as const} : node.editable && node.value !== undefined ? {value: node.hintShowing ? '' : node.value} : null),
  };
}

/**
 * A snapshot's nodes in our shape, each with the ref of its parent where the
 * parent is in the same list, and its kind from what agent-device said of it
 * and of its parent. An interactive snapshot leaves most parents out, and
 * agent-device does not say whose child a missing parent was, so those nodes
 * have none rather than a guess.
 */
export function toSnapshotNodes(nodes: AgentNode[], platform: 'android' | 'ios' = 'android'): SnapshotNode[] {
  const mapped = nodes.map(toSnapshotNode);
  const byIndex = new Map<number, {node: AgentNode; ref: string}>();
  nodes.forEach((node, at) => {
    if (typeof node.index === 'number') byIndex.set(node.index, {node, ref: mapped[at]!.ref});
  });
  return mapped.map((node, at) => {
    const raw = nodes[at]!;
    const above = typeof raw.parentIndex === 'number' ? byIndex.get(raw.parentIndex) : undefined;
    const kind =
      platform === 'ios'
        ? kindOnIos(raw.role ?? raw.type ?? '', above ? (above.node.role ?? above.node.type) : undefined)
        : kindOnAndroid(raw.type ?? '', raw.kind, node.name, above?.node.type);
    return {...node, ...(above ? {parent: above.ref} : null), ...(kind ? {kind} : null)};
  });
}

/** The nodes inside whatever shape an answer came in. */
export function nodesFrom(payload: unknown): AgentNode[] {
  if (Array.isArray(payload)) return payload as AgentNode[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['nodes', 'elements', 'tree', 'snapshot', 'data', 'result']) {
      const found = nodesFrom(record[key]);
      if (found.length) return found;
    }
  }
  return [];
}

/** What the command line printed, as JSON, even when a line of prose comes first. */
export function parsePayload(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    const brace = stdout.indexOf('{');
    const bracket = stdout.indexOf('[');
    const at = brace < 0 ? bracket : bracket < 0 ? brace : Math.min(brace, bracket);
    if (at < 0) return null;
    try {
      return JSON.parse(stdout.slice(at));
    } catch {
      return null;
    }
  }
}

/** A target in the spelling agent-device's command line takes. */
export function toAgentTarget(what: Target): string {
  const selector = asSelector(what);
  if (isPoint(selector)) return `${selector.x} ${selector.y}`;
  if (selector.ref) return selector.ref;
  // The node field is `identifier`, but the selector key that matches it is `id`.
  if (selector.testId) return `id="${selector.testId}"`;
  if (selector.label) return `label="${selector.label}"`;
  if (selector.role) return `role="${selector.role}"`;
  if (selector.contains) return `label="${selector.contains}"`;
  return describeTarget(what);
}

/** A target as the command line's arguments: a point is two of them, since agent-device reads `"10 20"` as one word that names nothing. */
export function targetArgs(what: Target): string[] {
  const selector = asSelector(what);
  return isPoint(selector) ? [String(selector.x), String(selector.y)] : [toAgentTarget(selector)];
}

/** A target as the Node client takes it. */
export type ClientTarget = {x: number; y: number} | {ref: string} | {selector: string};

export function clientTarget(what: Target): ClientTarget {
  const selector = asSelector(what);
  if (isPoint(selector)) return {x: selector.x, y: selector.y};
  if (selector.ref) return {ref: selector.ref};
  return {selector: toAgentTarget(selector)};
}

/**
 * Where `open` goes. Something with a scheme is a URL, a route becomes a deep
 * link when the app's scheme is known, and anything else is an app's name or
 * id. A route with no scheme to make a link of is null: there is nothing to
 * open.
 */
export function openTarget(to: string, scheme?: string): {app: string} | {url: string} | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(to)) return {url: to};
  if (to.startsWith('/')) return scheme ? {url: `${scheme}://${to.slice(1)}`} : null;
  return {app: to};
}

/** agent-device's own wait for the screen after an action: how long it must stay quiet, and the most to wait. */
export interface Wait {
  quietMs: number;
  timeoutMs: number;
}

/** The wait a step's options ask for: a settle above 0, with its timeout or the harness's. */
export function waitFrom(options: StepTiming = {}): Wait | undefined {
  if (typeof options.settle !== 'number' || options.settle <= 0) return undefined;
  return {quietMs: options.settle, timeoutMs: options.settleTimeout ?? DEFAULT_TIMING.settleTimeout};
}

/** The wait as the Node client takes it, which is its command line's `--settle`. */
export function settleRequest(wait?: Wait): Record<string, unknown> {
  return wait ? {settle: true, settleQuietMs: wait.quietMs, timeoutMs: wait.timeoutMs} : {};
}

/** The wait as the command line takes it. */
export function settleArgs(wait?: Wait): string[] {
  return wait ? ['--settle', '--settle-quiet', String(wait.quietMs), '--timeout', String(wait.timeoutMs)] : [];
}

/** An agent-device failure, as its code and its message. */
export interface AgentFailure {
  code?: string;
  message: string;
}

/** A line the command line printed about a failure, read back into its parts. */
export function parseFailure(line: string): AgentFailure {
  const match = /^Error \(([A-Z_]+)\): (.*)$/.exec(line);
  return match ? {code: match[1], message: match[2]!} : {message: line};
}

/** A failure in the words the command line prints it in, whichever transport met it. */
export function describeFailure(failure: AgentFailure): string {
  return failure.code ? `Error (${failure.code}): ${failure.message}` : failure.message;
}

const CODES: Record<string, HarnessCode> = {
  DEVICE_NOT_FOUND: 'DRIVER_UNAVAILABLE',
  DEVICE_IN_USE: 'DRIVER_UNAVAILABLE',
  TOOL_MISSING: 'DRIVER_UNAVAILABLE',
  UNSUPPORTED_PLATFORM: 'DRIVER_UNAVAILABLE',
  UNAUTHORIZED: 'DRIVER_UNAVAILABLE',
  APP_NOT_INSTALLED: 'APP_UNREACHABLE',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_CAPABILITY',
  NOT_IMPLEMENTED: 'UNSUPPORTED_CAPABILITY',
  INVALID_ARGS: 'INVALID_ARGUMENT',
};

/** The harness's code for an agent-device failure, or `otherwise` when the failure says nothing more specific. */
export function codeFor(failure: AgentFailure, otherwise: HarnessCode): HarnessCode {
  const code = failure.code ? CODES[failure.code] : undefined;
  if (code) return code;
  if (failure.message.startsWith('Selector did not match')) return 'LOCATOR_NOT_FOUND';
  return otherwise;
}

/** What `devices.capabilities` answers, as far as `describeDevice` reads it. */
export interface Capabilities {
  device: {name: string; platform: string; kind: string; target: string; model?: string; osVersion?: string; booted?: boolean};
  availableCommands: string[];
}

/** The device agent-device would drive, in the line its command line prints for `capabilities`. */
export function describeDevice({device, availableCommands}: Capabilities): string {
  const model = device.model ? ` model="${device.model}"` : '';
  const os = device.osVersion ? ` os=${device.osVersion}` : '';
  const booted = device.booted === undefined ? '' : ` booted=${device.booted}`;
  return `${device.name} (${device.platform} ${device.kind} target=${device.target}${model}${os})${booted} supports ${availableCommands.length} commands`;
}

/** What the search for agent-device's package is given, so a test can say what the machine has. */
export interface Whereabouts {
  /** The project's folder. */
  root: string;
  env: NodeJS.ProcessEnv;
  home: string;
  exists: (file: string) => boolean;
  /** npm's global `node_modules`, asked only when nothing before it had the package. */
  npmRoot: () => string | null;
}

/**
 * The folders agent-device's package may be in, in the order they are worth
 * trying: the one `HARNESS_AGENT_DEVICE` names, the project's own install,
 * bun's global folder, then npm's, which costs a process to ask about.
 */
export function* packageFolders(where: Whereabouts): Generator<string> {
  const named = where.env.HARNESS_AGENT_DEVICE;
  if (named && named !== 'cli') {
    yield named;
    yield path.join(named, 'node_modules', 'agent-device');
  }
  for (let folder = path.resolve(where.root); ; folder = path.dirname(folder)) {
    const installed = path.join(folder, 'node_modules', 'agent-device');
    if (where.exists(path.join(installed, 'package.json'))) yield installed;
    if (path.dirname(folder) === folder) break;
  }
  yield path.join(where.home, '.bun', 'install', 'global', 'node_modules', 'agent-device');
  const npm = where.npmRoot();
  if (npm) yield path.join(npm, 'agent-device');
}

/** The parts of agent-device's manifest the loader reads. */
export interface Manifest {
  name?: string;
  version?: string;
  main?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
}

/**
 * The file the Node client is loaded from. agent-device publishes only an
 * `import` condition, so `require.resolve` cannot find it, and the manifest is
 * read instead.
 */
export function clientEntry(manifest: Manifest): string | null {
  const root = (manifest.exports as Record<string, unknown> | undefined)?.['.'] ?? manifest.exports;
  if (typeof root === 'string') return root;
  if (root && typeof root === 'object') {
    const conditions = root as Record<string, unknown>;
    for (const condition of ['import', 'default']) {
      if (typeof conditions[condition] === 'string') return conditions[condition] as string;
    }
  }
  return manifest.main ?? null;
}

/** The command line's own script, which this Node can run without the launcher a package manager put on the PATH. */
export function cliScript(manifest: Manifest): string | null {
  if (typeof manifest.bin === 'string') return manifest.bin;
  return manifest.bin?.['agent-device'] ?? null;
}

/** Opening an app by its id on the command line: relaunched where asked, with each argument a fresh launch is given. */
export function launchArgs(app: string, relaunch: boolean, launchArguments: string[]): string[] {
  return ['open', app, ...(relaunch ? ['--relaunch'] : []), ...launchArguments.flatMap(argument => ['--launch-args', argument])];
}

/** Installing a build on the command line: in place of the installed app where asked, which needs its id. */
export function installArgs(app: string | undefined, appPath: string, reinstall: boolean): string[] {
  return reinstall ? ['reinstall', app ?? '', appPath] : ['install', ...(app ? [app] : []), appPath];
}

/** An operating-system setting the harness changes through agent-device. */
export type SettingUpdate = {setting: 'permission'; state: 'grant' | 'deny' | 'reset'; permission: string; app: string} | {setting: 'clear-app-state'; app: string};

/** A setting as the command line spells it. */
export function settingArgs(update: SettingUpdate): string[] {
  if (update.setting === 'clear-app-state') return ['settings', 'clear-app-state', update.app];
  return ['settings', 'permission', update.state, update.permission, '--app', update.app];
}

/** A setting as the Node client takes it. */
export function settingRequest(update: SettingUpdate): Record<string, unknown> {
  if (update.setting === 'clear-app-state') return {setting: 'clear-app-state', state: 'clear', app: update.app};
  return {setting: 'permission', state: update.state, permission: update.permission, app: update.app};
}

/** The app in front, from agent-device's `appstate`: the package on Android, the bundle id or else the name on iOS, and in a phrase. */
export function foregroundOf(payload: unknown): {app: string; said: string} | null {
  const answer = payload && typeof payload === 'object' && 'data' in payload ? (payload as {data: unknown}).data : payload;
  if (!answer || typeof answer !== 'object') return null;
  const state = answer as Record<string, unknown>;
  const text = (key: string) => (typeof state[key] === 'string' && state[key] ? (state[key] as string) : undefined);
  const app = text('package') ?? text('appBundleId') ?? text('appName');
  if (!app) return null;
  const activity = text('activity');
  return {app, said: activity ? `${app}, on ${activity}` : app};
}

/**
 * The rules an agent step runs under, as checks over the step's state and
 * the tree: what a secret may be typed into, where the agent may go, what it
 * may give a file input, and when a picture of the screen may leave. A
 * refusal goes back to the model as `POLICY_DENIED`, with the reason.
 */
import type {Bounds, SnapshotNode} from '../harness/lib/snapshot.ts';
import {inputFiles} from '../device/web.ts';
import type {Secret} from './types.ts';

/** A rule's answer. */
export type Verdict = {allowed: true} | {allowed: false; why: string};

const ALLOWED: Verdict = {allowed: true};
const denied = (why: string): Verdict => ({allowed: false, why});

/** What a secret may be typed into. */
const FIELDS = new Set(['textbox', 'searchbox', 'combobox']);

/**
 * Whether a secret may be typed into a node: one of the step's params, into
 * an enabled text field, and a password into a password field only.
 */
export function canFill(node: SnapshotNode, handle: Secret, allowed: readonly string[]): Verdict {
  if (!allowed.includes(handle.name)) return denied(`the secret ${handle.name} is not one of this step's params, and only those can be filled`);
  const kind = node.kind ?? node.role.toLowerCase();
  if (!FIELDS.has(kind)) return denied(`${node.ref} is a ${kind}, and a secret goes into a text field only`);
  if (node.enabled === false) return denied(`${node.ref} is disabled`);
  if (handle.purpose === 'password' && !node.secure) return denied(`${handle.name} is a password, and ${node.ref} is not a password field`);
  return ALLOWED;
}

/** The schemes refused by name, since each reaches what the app does not show. */
const REFUSED = ['file:', 'data:', 'javascript:', 'view-source:', 'blob:', 'filesystem:'];

/** Whether the agent may go to a URL: http, https, about:blank, or the app's own scheme. */
export function canNavigate(url: string, appScheme?: string): Verdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return denied(`${JSON.stringify(url)} is not a URL`);
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return ALLOWED;
  if (parsed.href === 'about:blank') return ALLOWED;
  if (appScheme && parsed.protocol === `${appScheme.toLowerCase()}:`) return ALLOWED;
  if (REFUSED.includes(parsed.protocol)) return denied(`${parsed.protocol} URLs are refused, as are ${REFUSED.filter(each => each !== parsed.protocol).join(', ')}`);
  return denied(`${parsed.protocol} is not a scheme the agent may open: it takes http, https, about:blank${appScheme ? ` and ${appScheme}:` : ''}`);
}

/** Whether a file may be given to a file input: inside the project, and not hidden. */
export function canUpload(root: string, file: string): Verdict {
  try {
    inputFiles(root, [file]);
    return ALLOWED;
  } catch (error) {
    return denied((error as Error).message);
  }
}

/** Whether a node's value may be read: not a secure field's. */
export function canRead(node: SnapshotNode): Verdict {
  return node.secure ? denied(`${node.ref} is a secure field, whose value is never read`) : ALLOWED;
}

/**
 * Whether a picture of the screen may leave: not after a secret was filled in
 * this test, and not while a secure field has no bounds to paint over.
 */
export function pixelsAllowed(state: {tainted: boolean; canScreenshot: boolean; nodes: readonly SnapshotNode[]}): Verdict {
  if (state.tainted) return denied('a secret was filled in this test, so no picture of the screen leaves it');
  if (!state.canScreenshot) return denied('the platform takes no screenshot');
  const unmasked = state.nodes.find(node => node.secure && !node.bounds);
  if (unmasked) return denied(`the secure field ${unmasked.ref} has no bounds to paint over, so a picture could show it`);
  return ALLOWED;
}

/** The boxes painted over before a picture leaves: every secure field's. */
export function secureMasks(nodes: readonly SnapshotNode[]): Bounds[] {
  return nodes.flatMap(node => (node.secure && node.bounds ? [node.bounds] : []));
}

/** The names a project's tool cannot take: the agent's own tools, and those e2e keeps. */
export const RESERVED_TOOLS = [
  'tap',
  'double_tap',
  'hover',
  'select',
  'right_click',
  'home',
  'alert',
  'long_press',
  'drag',
  'open_app',
  'type',
  'type_secret',
  'press',
  'check',
  'scroll',
  'scroll_to',
  'navigate',
  'back',
  'dismiss_keyboard',
  'observe',
  'screenshot',
  'tap_at',
  'hover_at',
  'type_at',
  'complete_step',
  'locate',
  'start_recording',
  'stop_recording',
  'report_finding',
];

const TAINT = Symbol.for('expo-vitest.tainted');

/** Marks the test as one a secret was filled in, so no picture of the screen leaves it. */
export function taint(store: object = globalThis): void {
  (store as {[TAINT]?: boolean})[TAINT] = true;
}

/** Whether a secret was filled in this test. */
export function tainted(store: object = globalThis): boolean {
  return (store as {[TAINT]?: boolean})[TAINT] === true;
}

/** Clears the mark, as a test ends. */
export function clearTaint(store: object = globalThis): void {
  delete (store as {[TAINT]?: boolean})[TAINT];
}

/**
 * What a device test leaves behind when it fails: the steps it took, what
 * the screen held after each, and the screen at the end, as a picture, a
 * tree and a trace a person can read.
 *
 * The journal is the device's record of the current test. Every snapshot
 * the test takes is digested into the step that took it, so the screen
 * after each step costs no snapshot of its own, and a digest keeps what
 * nodes are, not their refs, since refs renumber per snapshot.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {ReactTree} from '../harness/lib/react.ts';
import {reactNodeOf, withComponents} from '../harness/lib/react.ts';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import {renderSnapshot} from '../harness/lib/snapshot.ts';
import {duration} from './polling.ts';

/** What kind of step it was. `verified` says an action before it was seen to take effect. */
export type StepEvent =
  | 'open'
  | 'press'
  | 'longPress'
  | 'fill'
  | 'clear'
  | 'type'
  | 'key'
  | 'check'
  | 'hover'
  | 'focus'
  | 'scroll'
  | 'swipe'
  | 'drag'
  | 'pinch'
  | 'snapshot'
  | 'screenshot'
  | 'assert'
  | 'wait'
  | 'control'
  | 'agent'
  | 'web'
  | 'step'
  | 'verified';

/** The events that change the screen, which a `verified` step can vouch for. */
const ACTIONS = new Set<StepEvent>(['open', 'press', 'longPress', 'fill', 'clear', 'type', 'key', 'check', 'hover', 'focus', 'scroll', 'swipe', 'drag', 'pinch', 'control', 'agent', 'web']);

/** What the screen held: each node as what it is, which one had the focus, and how many could be acted on. */
export interface TreeDigest {
  nodes: string[];
  focused?: string;
  interactive: number;
}

export interface Step {
  index: number;
  event: StepEvent;
  /** What was asked: the target, the query or the matcher, as written. */
  what: string;
  /** The node it came to, where there was one: `@e7 button "Settings" #settings at 24,612`. */
  resolved?: string;
  /** When it began, in ms since the test did. */
  startedAt: number;
  durationMs: number;
  result: 'ok' | 'skipped' | 'failed';
  /** What the step said, or the error. */
  message: string;
  /** For an assertion or a wait: how many times it read the tree, and the values it read, in order. */
  polls?: number;
  readings?: string[];
  /** For a `verified` step: the index of the step it vouches for. */
  verifies?: number;
  /** The screen after the step, from the last full snapshot it, or the step after it, read. */
  treeAfter?: TreeDigest;
  /** The titles of the test's own steps it was taken in, outermost first: `Check out › Pay`. */
  within?: string;
}

/** A node as a digest keeps it: what it is, by kind or role, and its testID or name. */
export function identify(node: SnapshotNode): string {
  return `${node.kind ?? node.role} ${JSON.stringify(node.testId ?? node.name)}`;
}

export function digest(snapshot: Snapshot): TreeDigest {
  const focused = snapshot.nodes.find(node => node.focused);
  return {nodes: snapshot.nodes.map(identify), ...(focused ? {focused: identify(focused)} : {}), interactive: snapshot.nodes.filter(node => node.interactive).length};
}

/** A few of a list for a line of a table: `a, b and 3 more`. */
function some(items: string[], few = 6): string {
  return items.length > few ? `${items.slice(0, few).join(', ')} and ${items.length - few} more` : items.join(', ');
}

/** What changed from one screen to the next: what came, what went, where the focus moved. */
export function diffDigests(before: TreeDigest, after: TreeDigest): string {
  const left = new Map<string, number>();
  for (const node of before.nodes) left.set(node, (left.get(node) ?? 0) + 1);
  const appeared: string[] = [];
  for (const node of after.nodes) {
    const count = left.get(node) ?? 0;
    if (count > 0) left.set(node, count - 1);
    else appeared.push(node);
  }
  const gone = [...left].flatMap(([node, count]) => Array.from({length: count}, () => node));
  const parts: string[] = [];
  if (appeared.length > 0) parts.push(`appeared ${some(appeared)}`);
  if (gone.length > 0) parts.push(`gone ${some(gone)}`);
  if (before.focused !== after.focused) parts.push(`focus ${before.focused ?? 'nowhere'} → ${after.focused ?? 'nowhere'}`);
  if (parts.length === 0) return 'unchanged';
  return `+${appeared.length} −${gone.length}: ${parts.join('; ')}`;
}

export type StepListener = (step: Step) => void;

/**
 * What the agent tells the journal of a test's secrets: how to hide their
 * values in what the evidence writes, and why no picture of the screen may
 * be kept, as after a secret was filled into a field that shows it.
 */
export interface Privacy {
  redact(text: string): string;
  /** Why no picture of the screen may be kept for this test, or undefined where one may. */
  withheld(): string | undefined;
}

/** What an agent's step leaves for the trace: what it was, how it ended, and its last turns. */
export interface AgentNote {
  /** `act`, `assert`, `waitFor` or `extract`. */
  kind: string;
  instruction: string;
  /** The agent that ran it, by name. */
  agent: string;
  /** How it ended, in a line: the verdict, the summary or the explanation, and what it cost. */
  outcome: string;
  /** Its last turns, a line each, every secret hidden. */
  turns: string[];
  /** A picture kept after its verdict, every secure field painted over, which the evidence writes as `name` beside the trace. */
  picture?: {name: string; png: Buffer};
}

/** A line the app wrote to its console, or an error it did not catch, and when, in ms since the test began. */
export interface ConsoleLine {
  level: string;
  text: string;
  at: number;
}

/** One test's record: its steps, the last full snapshot seen, and who is listening. */
export class Journal {
  steps: Step[] = [];
  /** What the app wrote to its console during the test, where the backend reads it. */
  console: ConsoleLine[] = [];
  /** The last full snapshot seen, for the tree at failure when the driver has gone. */
  last: Snapshot | null = null;
  /** The agent's steps, for the trace's Agent section. */
  agents: AgentNote[] = [];
  /** Set by the agent: what the evidence writes is redacted by it, and keeps no picture where it says none may be. */
  privacy: Privacy | undefined;
  private began = 0;
  private running: Step | null = null;
  /** The titles of the test's own steps under way, outermost first. */
  private groups: string[] = [];
  private readonly listeners = new Set<StepListener>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Starts a test's record afresh. */
  begin(): void {
    this.steps = [];
    this.console = [];
    this.last = null;
    this.agents = [];
    this.running = null;
    this.groups = [];
    this.began = this.now();
  }

  /**
   * Runs `body` as one of the test's own steps, named `title`: a step that
   * says so, recorded as it begins, with the steps taken inside it marked as
   * within it. It fails where `body` throws, which is thrown on.
   */
  async group<T>(title: string, body: () => T | Promise<T>): Promise<T> {
    const began = this.now();
    const heading = this.add({event: 'step', what: JSON.stringify(title), startedAt: began - this.began, durationMs: 0, result: 'ok', message: ''});
    this.groups.push(title);
    try {
      return await body();
    } catch (error) {
      heading.result = 'failed';
      heading.message = (error as Error).message;
      throw error;
    } finally {
      this.groups.pop();
      heading.durationMs = this.now() - began;
    }
  }

  /** The journal's clock, in ms, for a step noted once it is over. */
  time(): number {
    return this.now();
  }

  /**
   * A step recorded once it is over, from when it began by the journal's
   * clock: an agent's act, which the steps it took went through the journal
   * inside, each as its own.
   */
  note(step: {event: StepEvent; what: string; began: number; result: Step['result']; message: string}): Step {
    const {began, ...rest} = step;
    return this.add({...rest, startedAt: began - this.began, durationMs: this.now() - began});
  }

  /** A line from the app's console, kept with when it came; at most the last 500. */
  log(level: string, text: string): void {
    this.console.push({level, text, at: this.now() - this.began});
    if (this.console.length > 500) this.console.shift();
  }

  /** Calls `listener` with each step as it is recorded; the function it answers stops that. */
  onStep(listener: StepListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** A full snapshot the device read: the screen after the step under way, or after the last one where none is. */
  saw(snapshot: Snapshot): void {
    this.last = snapshot;
    const step = this.running ?? this.steps.at(-1);
    if (step && (step === this.running || !step.treeAfter)) step.treeAfter = digest(snapshot);
  }

  private add(step: Omit<Step, 'index'>): Step {
    const within = this.groups.join(' › ');
    const recorded = {index: this.steps.length + 1, ...step, ...(within ? {within} : {})};
    this.steps.push(recorded);
    for (const listener of this.listeners) listener(recorded);
    return recorded;
  }

  /**
   * Runs one step and records it, with how long it took and how it ended:
   * `failed` where `work` threw, which is thrown on, or where the outcome
   * `judge` reads says so.
   */
  async run<T>(
    step: {event: StepEvent; what: string; resolved?: string},
    work: () => Promise<T>,
    judge: (value: T) => {result: Step['result']; message: string; polls?: number; readings?: string[]} = () => ({result: 'ok', message: ''}),
  ): Promise<T> {
    const startedAt = this.now() - this.began;
    const running: Step = {index: 0, ...step, startedAt, durationMs: 0, result: 'ok', message: ''};
    this.running = running;
    try {
      const value = await work();
      this.finish(running, judge(value));
      return value;
    } catch (error) {
      this.finish(running, {result: 'failed', message: (error as Error).message});
      throw error;
    } finally {
      this.running = null;
    }
  }

  private finish(running: Step, outcome: {result: Step['result']; message: string; polls?: number; readings?: string[]}): void {
    const {index: _index, ...rest} = running;
    this.add({...rest, durationMs: this.now() - this.began - running.startedAt, ...outcome});
  }

  /**
   * Says the last action that went through was seen to take effect, by the
   * step just recorded, which an agent's cache waits for. A skipped action
   * did nothing to see.
   */
  verified(what: string): void {
    const action = this.steps.findLast(step => ACTIONS.has(step.event) && step.result === 'ok');
    if (!action) return;
    this.add({event: 'verified', what, startedAt: this.now() - this.began, durationMs: 0, result: 'ok', message: `step ${action.index} took effect`, verifies: action.index});
  }
}

/**
 * A test's folder name: its title path lower-cased, each run of anything
 * outside `[a-z0-9._-]` one `-`, at most 80 characters, then six hex
 * characters of the untouched title, so two that clean up alike never
 * share a folder.
 */
export function sanitiseTitle(titlePath: string[]): string {
  const title = titlePath.join(' › ');
  const clean = title
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  const hash = createHash('sha1').update(title).digest('hex').slice(0, 6);
  return clean ? `${clean}-${hash}` : hash;
}

/** Where a test's evidence goes: `.harness/results/<platform>/<file without its extension>/<test>/`. */
export function resultsFolder(root: string, platform: string, file: string, titlePath: string[]): string {
  const relative = path.relative(root, path.resolve(root, file)).replace(/\\/g, '/');
  const stem = relative.replace(/\.[^./]+$/, '').replace(/\.test$/, '');
  return path.join(root, '.harness', 'results', platform, ...stem.split('/').filter(part => part && part !== '..'), sanitiseTitle(titlePath));
}

/** What a trace is written from. */
export interface TraceInput {
  titlePath: string[];
  platform: string;
  file: string;
  failed: boolean;
  /** How long the test took, in ms. */
  duration: number;
  /** When it ran. */
  at: Date;
  /** The failure, as each error's message. */
  errors: string[];
  steps: Step[];
  /** The screen at the end, where there is one. */
  tree: Snapshot | null;
  /** Why there is no screenshot, where there is none. */
  noScreenshot?: string;
  /** What the app wrote to its console. */
  console?: ConsoleLine[];
  /** The agent's steps. */
  agents?: AgentNote[];
  /** The component behind the node the failing step was for, and the chain above it, where the React tree was read. */
  chain?: {node: string; component?: string; chain: string[]};
}

/** A step's line in the table: what it did to the screen, from the screen before it. */
function screenAfter(step: Step, before: TreeDigest | undefined): string {
  const tree = step.treeAfter;
  const polled = step.polls === undefined ? '' : `polled ${step.polls} time${step.polls === 1 ? '' : 's'}`;
  const change = tree ? (before ? diffDigests(before, tree) : `${tree.nodes.length} nodes`) : '';
  return [polled, change].filter(Boolean).join(', ');
}

/** A table cell's text, with its own pipes and line breaks kept from breaking the table. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The trace a person reads: the test, its failure, its steps and the screen at the end. */
export function renderTrace(input: TraceInput): string {
  const lines: string[] = [`# ${input.titlePath.join(' › ')}`, ''];
  const state = input.failed ? `failed after ${duration(input.duration)}` : `passed in ${duration(input.duration)}`;
  lines.push(`${input.platform} · ${input.file} · ${state} · ${input.at.toISOString().replace(/\.\d{3}Z$/, 'Z')}`, '');
  for (const error of input.errors) lines.push(error, '');
  lines.push('## Steps', '');
  if (input.steps.length === 0) lines.push('No steps were taken.', '');
  else {
    lines.push('| # | at | step | took | result | screen after |', '| --- | --- | --- | --- | --- | --- |');
    let before: TreeDigest | undefined;
    for (const step of input.steps) {
      const did = step.resolved ? `${step.event} ${step.what} → ${step.resolved}` : `${step.event} ${step.what}`;
      const what = step.within ? `${step.within} › ${did}` : did;
      const result = step.result === 'ok' ? 'ok' : `${step.result}${step.message ? `: ${step.message.split('\n')[0]}` : ''}`;
      lines.push(`| ${step.index} | ${(step.startedAt / 1000).toFixed(2)} s | ${cell(what)} | ${duration(step.durationMs)} | ${cell(result)} | ${cell(screenAfter(step, before))} |`);
      if (step.treeAfter) before = step.treeAfter;
    }
    lines.push('');
  }
  if (input.agents && input.agents.length > 0) {
    lines.push('## Agent', '');
    for (const step of input.agents) {
      lines.push(`### ${step.kind} ${JSON.stringify(step.instruction)} · ${step.agent}`, '', step.outcome, '');
      if (step.turns.length > 0) lines.push(...step.turns.map(turn => `    ${turn}`), '');
    }
  }
  if (input.chain) {
    // The end of the chain, nearest the node, is where the app's own components are.
    const {node, component, chain} = input.chain;
    const tail = chain.length > 12 ? ['…', ...chain.slice(-12)] : chain;
    lines.push('## Component', '', `${node} is drawn by ${component ?? 'no component of the app'}:`, '', `    ${tail.join(' › ')}`, '');
  }
  lines.push(input.failed ? '## Screen at failure' : '## Screen at the end', '');
  if (input.noScreenshot) lines.push(`Screenshot: not taken, ${input.noScreenshot}.`, '');
  if (!input.tree) lines.push('No tree was read.');
  else {
    const interactive = input.tree.nodes.filter(node => node.interactive).length;
    lines.push(`${input.tree.nodes.length} nodes, ${interactive} interactive. Full tree in tree.txt, JSON in tree.json.`, '');
    const shown = renderSnapshot(input.tree).split('\n');
    lines.push(...shown.slice(0, 40).map(line => `    ${line}`));
    if (shown.length > 40) lines.push(`    ... and ${shown.length - 40} more in tree.txt`);
  }
  if (input.console && input.console.length > 0) {
    lines.push('', '## Console', '', '| at | level | text |', '| --- | --- | --- |');
    for (const line of input.console.slice(-50)) lines.push(`| ${(line.at / 1000).toFixed(2)} s | ${line.level} | ${cell(line.text)} |`);
    if (input.console.length > 50) lines.push('', `The last 50 of ${input.console.length} lines.`);
  }
  return `${lines.join('\n')}\n`;
}

/** What the writer needs of the device: a picture, a fresh tree, and whether its driver is still there to give them. */
export interface EvidenceSource {
  platform: string;
  /** Whether the driver is still open, so a picture and a fresh tree can be had without starting another. */
  open(): boolean;
  screenshot(file: string): Promise<boolean>;
  tree(): Promise<Snapshot>;
  /** The React tree, where the backend can read it, or null. */
  react?(): Promise<ReactTree | null>;
  journal: Journal;
}

/** The node a step was for, from the ref its resolved node begins with. */
function nodeOfStep(step: Step | undefined, tree: Snapshot): SnapshotNode | undefined {
  const ref = step?.resolved?.split(/\s/)[0];
  return ref ? tree.nodes.find(node => node.ref === ref) : undefined;
}

export interface Written {
  folder: string;
  trace: string;
  screenshot?: string;
}

/**
 * Writes a test's evidence to its folder, replacing what an earlier run left
 * there: `screenshot.png`, `tree.txt`, `tree.json` and `trace.md`. A driver
 * closed by the test's own `afterEach` leaves no picture, and the tree is
 * then the last the journal kept.
 */
export async function writeEvidence(source: EvidenceSource, input: Omit<TraceInput, 'tree' | 'steps' | 'noScreenshot' | 'platform'> & {root: string}): Promise<Written> {
  const folder = resultsFolder(input.root, source.platform, input.file, input.titlePath);
  fs.rmSync(folder, {recursive: true, force: true});
  fs.mkdirSync(folder, {recursive: true});
  let tree = source.journal.last;
  let screenshot: string | undefined;
  let noScreenshot: string | undefined;
  const {privacy} = source.journal;
  const hide = (text: string) => (privacy ? privacy.redact(text) : text);
  const withheld = privacy?.withheld();
  if (source.open()) {
    const file = path.join(folder, 'screenshot.png');
    try {
      if (withheld) noScreenshot = withheld;
      else if (await source.screenshot(file)) screenshot = file;
      else noScreenshot = 'the backend could not take one';
    } catch (error) {
      noScreenshot = `taking it failed: ${(error as Error).message.split('\n')[0]}`;
    }
    tree = await source.tree().catch(() => tree);
  } else noScreenshot = 'the driver was closed';
  // The components behind the nodes, and above the one the failing step was for, where the React tree can be read.
  let chain: TraceInput['chain'];
  const react = source.open() && source.react ? await source.react().catch(() => null) : null;
  if (react && tree) {
    tree = withComponents(tree, react);
    const failing = source.journal.steps.findLast(step => step.result === 'failed' && step.resolved) ?? source.journal.steps.findLast(step => step.resolved);
    const node = nodeOfStep(failing, tree);
    const behind = node ? reactNodeOf(node, react) : undefined;
    if (node && behind) chain = {node: `${node.ref} ${node.kind ?? node.role} ${JSON.stringify(node.name)}`, ...(behind.component ? {component: behind.component} : {}), chain: behind.chain};
  }
  if (tree) {
    // A field a secret was typed into, where the field shows what it holds, has the value in the tree.
    fs.writeFileSync(path.join(folder, 'tree.txt'), `${hide(renderSnapshot(tree))}\n`);
    fs.writeFileSync(path.join(folder, 'tree.json'), `${hide(JSON.stringify(tree, null, 2))}\n`);
  }
  const trace = path.join(folder, 'trace.md');
  const {root: _root, ...rest} = input;
  fs.writeFileSync(
    trace,
    hide(renderTrace({...rest, platform: source.platform, steps: source.journal.steps, tree, console: source.journal.console, agents: source.journal.agents, ...(noScreenshot ? {noScreenshot} : {}), ...(chain ? {chain} : {})})),
  );
  // The agent's pictures go beside the trace, where its errors said they would be.
  for (const note of source.journal.agents) if (note.picture) fs.writeFileSync(path.join(folder, note.picture.name), note.picture.png);
  return {folder, trace, ...(screenshot ? {screenshot} : {})};
}

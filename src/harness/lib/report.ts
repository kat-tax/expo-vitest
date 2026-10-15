/**
 * What `expo-harness explore` leaves: `report.json`, the run as data, and
 * `report.md`, the same for a person, issues first. Each step of the run
 * keeps the tree it left and, where a picture could be kept, a screenshot,
 * and a finding cites the step it was reported after, so what it claims
 * can be checked against what the screen showed.
 */
import path from 'node:path';
import {cacheShare} from '../../agent/cost.ts';
import type {Usage} from '../../agent/types.ts';
import type {Platform} from './types.ts';

export type Severity = 'issue' | 'warning';

/** What the model reported, in its words. */
export interface Reported {
  severity: Severity;
  title: string;
  expected: string;
  observed: string;
  /** The steps that reach it from where the run began, a sentence each. */
  steps: string[];
}

/** Where the run was: the route, the tree the screen showed and its picture, from the report's folder. */
export interface Place {
  route?: string;
  tree: string;
  screenshot?: string;
}

/** A finding: what was reported, and the step it was reported after, 0 before any. */
export interface Finding extends Reported, Place {
  step: number;
}

/** One action of the run, and the screen it left. */
export interface ExploreStep extends Place {
  n: number;
  tool: string;
  /** Its input without the ref: a secret by its name, and every secret's value hidden. */
  input: Record<string, unknown>;
  /** The node it was on, as the model last saw it. */
  target?: {kind: string; name: string; testId?: string};
  /** The query that finds that node in a device test, where one finds it alone. */
  query?: string;
  ok: boolean;
  /** What it answered, in a line: what changed, or why it failed. */
  said: string;
  /** The model calls since the step before, and what they took. */
  calls: number;
  usage: Usage;
}

/** How the run ended: the model's conclusion, or the code of what stopped it. */
export type Outcome = {status: 'passed' | 'failed' | 'blocked'; summary: string} | {status: 'ended'; code: string; summary: string};

export interface ExploreReport {
  goal: string;
  platform: Platform;
  agent: string;
  models: string[];
  startedAt: string;
  durationMs: number;
  outcome: Outcome;
  start: Place;
  steps: ExploreStep[];
  findings: Finding[];
  usage: {calls: number; tokens: Usage; costUsd: number | null};
}

const pad = (n: number) => String(n).padStart(3, '0');

/** Where a step's tree goes, from the report's folder. */
export const stepFile = (n: number, tool: string) => `steps/${pad(n)}-${tool}.txt`;

/** Where a step's picture goes, from the report's folder. */
export const screenshotFile = (n: number) => `screenshots/${pad(n)}.png`;

/** The folder a run's report goes in by default: `.harness/explore/<yyyy-mm-dd-hhmmss>`, in local time. */
export function reportFolder(root: string, at: Date, under = 'explore'): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return path.join(root, '.harness', under, stamp);
}

const spaced = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What the run's model calls took: how many, the tokens in and the cache's share of them, the tokens out, and the cost. */
export function costLine(usage: ExploreReport['usage']): string {
  const {tokens} = usage;
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const cost = usage.costUsd === null ? 'cost n/a' : `$${usage.costUsd.toFixed(4)}`;
  return `${plural(usage.calls, 'model call')} · in ${spaced(prompt)} (cache ${Math.round(cacheShare(tokens) * 100)}%) · out ${spaced(tokens.output)} · ${cost}`;
}

/** An action in a line: the tool, the node it was on, and its input, a secret by its name. */
export function describeStep(step: Pick<ExploreStep, 'tool' | 'input' | 'target'>): string {
  const target = step.target ? ` ${step.target.kind} ${JSON.stringify(step.target.name)}` : '';
  const input = Object.entries(step.input).map(([key, value]) => (key === 'secret' ? `<secret:${String(value)}>` : typeof value === 'string' ? JSON.stringify(value) : `${key} ${JSON.stringify(value)}`));
  return [`${step.tool}${target}`, ...input].join(' ');
}

/** How the run ended, in a line. */
export function outcomeLine(outcome: Outcome): string {
  return outcome.status === 'ended' ? `ended by ${outcome.code}: ${outcome.summary}` : `concluded ${outcome.status}: ${outcome.summary}`;
}

/** A finding as the terminal prints it the moment it is made. */
export function findingLine(finding: Finding): string {
  return `${finding.severity === 'issue' ? '✗ issue' : '! warning'} after step ${finding.step}: ${finding.title}`;
}

/** A step as the terminal prints it under HARNESS_DEBUG: what it did and answered, and its calls and tokens. */
export function stepLine(step: ExploreStep): string {
  const prompt = step.usage.input + step.usage.cacheRead + step.usage.cacheWrite;
  return `${step.ok ? '·' : '✗'} ${step.n} ${describeStep(step)}: ${step.said} · ${plural(step.calls, 'call')} · in ${spaced(prompt)} out ${spaced(step.usage.output)}`;
}

/**
 * The exit code: 1 where an issue was reported; else 2 where the run could
 * not explore, as when it was blocked or something other than its budget
 * or its time stopped it; else 0.
 */
export function exitCodeOf(report: Pick<ExploreReport, 'findings' | 'outcome'>): 0 | 1 | 2 {
  if (report.findings.some(finding => finding.severity === 'issue')) return 1;
  const {outcome} = report;
  if (outcome.status === 'blocked') return 2;
  if (outcome.status === 'ended' && outcome.code !== 'STEP_BUDGET_EXHAUSTED' && outcome.code !== 'STEP_TIMEOUT') return 2;
  return 0;
}

/** Text in a table's cell: on one line, with its bars escaped. */
const cell = (text: string) => text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

/** Where the screen was, as links into the report's folder. */
function placeOf(place: Place): string {
  const links = [`[tree](${place.tree})`, ...(place.screenshot ? [`[screenshot](${place.screenshot})`] : [])].join(' · ');
  return place.route ? `on \`${place.route}\`: ${links}` : links;
}

function findingSection(finding: Finding, number: number, steps: readonly ExploreStep[]): string {
  const step = steps.find(each => each.n === finding.step);
  const after = step ? `After step ${step.n}, \`${describeStep(step)}\`` : 'Before any step';
  const repro = finding.steps.length > 0 ? finding.steps.map((each, index) => `${index + 1}. ${each}`).join('\n') : 'None given.';
  return [`### ${number}. ${finding.title}`, '', `Expected: ${finding.expected}`, '', `Observed: ${finding.observed}`, '', 'Steps to reproduce:', '', repro, '', `${after}, ${placeOf(finding)}`].join('\n');
}

/** `report.md`: the run in a line, how it ended, the issues, then the warnings, then every step. */
export function renderReport(report: ExploreReport): string {
  const issues = report.findings.filter(finding => finding.severity === 'issue');
  const warnings = report.findings.filter(finding => finding.severity === 'warning');
  const ordered = [...issues, ...warnings];
  const header = [report.platform, `agent ${report.agent}`, report.startedAt, `${(report.durationMs / 1000).toFixed(1)} s`, plural(report.steps.length, 'step'), costLine(report.usage)].join(' · ');
  const lines = [`# Explore: ${report.goal}`, '', header, '', `The run ${outcomeLine(report.outcome)}`, ''];
  if (ordered.length === 0) lines.push('## Findings', '', 'None: the run reported nothing off.', '');
  const section = (title: string, list: Finding[]) => {
    if (list.length === 0) return;
    lines.push(`## ${title}`, '');
    for (const finding of list) lines.push(findingSection(finding, ordered.indexOf(finding) + 1, report.steps), '');
  };
  section('Issues', issues);
  section('Warnings', warnings);
  lines.push('## Steps', '', '| # | action | answered | screen |', '| --- | --- | --- | --- |', `| 0 | start | | ${placeOf(report.start)} |`);
  // The action in code, where <secret:NAME> is not read as a link, and the answer as text, its angle brackets as they are.
  for (const step of report.steps) lines.push(`| ${step.n} | \`${cell(describeStep(step))}\` | ${step.ok ? '' : 'failed: '}${cell(step.said).replace(/</g, '&lt;')} | ${placeOf(step)} |`);
  return `${lines.join('\n')}\n`;
}

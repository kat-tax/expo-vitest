/**
 * A bug bash's logic: the feature map read and checked, the charters it
 * makes, every charter's findings merged with their duplicates named, a
 * skeleton test for each issue, each finding's verdict from the run of its
 * skeleton, and the report. A finding counts as a bug only when its
 * skeleton fails its check, so a model's claim is never the last word.
 */
import path from 'node:path';
import {addUsage, NO_USAGE} from '../../agent/cost.ts';
import {HarnessError} from './errors.ts';
import type {ExploreReport, ExploreStep, Finding, Place} from './report.ts';
import {costLine, describeStep, outcomeLine} from './report.ts';

/** An area of the app: its name, which names files, its goals, and the agent that explores it. */
export interface FeatureArea {
  name: string;
  goals?: string[];
  agent?: string;
}

export interface FeatureMap {
  areas: FeatureArea[];
  /** What an area without goals is explored as, a charter each. */
  postures?: string[];
}

/** The postures a charter takes where the map names none: e2e's five. */
export const POSTURES = ['first-time user', 'numbers and copy', 'edge input', 'state after reload', 'error paths'];

const AREA_NAME = /^[a-z0-9][a-z0-9-]*$/;
const AREA_KEYS = ['name', 'goals', 'agent'];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const words = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(each => typeof each === 'string' && each.trim() !== '');

/** The feature map in a file's text, checked: the first thing wrong is an INVALID_CONFIG that names it. */
export function readFeatureMap(text: string, file: string): FeatureMap {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new HarnessError('INVALID_CONFIG', `${file} is not JSON: ${(error as Error).message}`);
  }
  const wrong = (what: string) => new HarnessError('INVALID_CONFIG', `${file}: ${what}`);
  if (!isObject(value) || !Array.isArray(value.areas) || value.areas.length === 0) throw wrong('areas takes a list of areas, each {name, goals, agent}');
  for (const key of Object.keys(value)) if (key !== 'areas' && key !== 'postures') throw wrong(`${key} is not something a feature map takes; it takes areas and postures`);
  if (value.postures !== undefined && !words(value.postures)) throw wrong('postures takes a list of postures in words');
  const names = new Set<string>();
  value.areas.forEach((area: unknown, index) => {
    const at = `areas[${index}]`;
    if (!isObject(area)) throw wrong(`${at} takes an object: {name, goals, agent}`);
    for (const key of Object.keys(area)) if (!AREA_KEYS.includes(key)) throw wrong(`${at}.${key} is not something an area takes; it takes ${AREA_KEYS.join(', ')}`);
    if (typeof area.name !== 'string' || !AREA_NAME.test(area.name)) throw wrong(`${at}.name takes lower-case letters, digits and -, since it names files`);
    if (names.has(area.name)) throw wrong(`two areas are called ${area.name}`);
    names.add(area.name);
    if (area.goals !== undefined && !words(area.goals)) throw wrong(`${at}.goals takes a list of goals in words`);
    if (area.agent !== undefined && (typeof area.agent !== 'string' || area.agent === '')) throw wrong(`${at}.agent takes the name of one of the harness config's agents`);
  });
  return value as unknown as FeatureMap;
}

/** One explore of a bug bash: its area, its place in the area, its goal, its agent, and its folder in the run's. */
export interface Charter {
  area: string;
  n: number;
  goal: string;
  agent?: string;
  folder: string;
}

/** Each area's goals as charters, or one charter a posture for an area with none. */
export function chartersOf(map: FeatureMap): Charter[] {
  return map.areas.flatMap(area => {
    const goals = area.goals ? area.goals.map(goal => `In ${area.name}: ${goal}`) : (map.postures ?? POSTURES).map(posture => `Explore ${area.name}. Posture: ${posture}.`);
    return goals.map((goal, index) => ({area: area.name, n: index + 1, goal, ...(area.agent ? {agent: area.agent} : {}), folder: `${area.name}-${index + 1}`}));
  });
}

/** A finding as the bug bash keeps it: whose it was, the run's start and its steps up to it. */
export interface Found extends Finding {
  area: string;
  /** The charter's folder, as `checkout-2`. */
  charter: string;
  start: Place;
  /** The run's steps, up to the one it was reported after. */
  actions: ExploreStep[];
}

/** A finding after the merge: the ones dropped as the same, by charter and title. */
export interface Merged extends Found {
  duplicates: {charter: string; title: string}[];
}

/** Every finding of a charter's report, with the steps that led to it. */
export function foundIn(charter: Charter, report: Pick<ExploreReport, 'findings' | 'steps' | 'start'>): Found[] {
  return report.findings.map(finding => ({...finding, area: charter.area, charter: charter.folder, start: report.start, actions: report.steps.filter(step => step.n <= finding.step)}));
}

const normal = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Whether two findings are one: the same route and title, or the same first three steps. */
function same(a: Found, b: Found): boolean {
  if ((a.route ?? '') === (b.route ?? '') && normal(a.title) === normal(b.title)) return true;
  const first = (found: Found) => found.steps.slice(0, 3).map(normal).join('\n');
  return a.steps.length >= 3 && b.steps.length >= 3 && first(a) === first(b);
}

/** The findings with each duplicate dropped onto the first like it, which names it. */
export function merge(found: readonly Found[]): Merged[] {
  const kept: Merged[] = [];
  for (const each of found) {
    const twin = kept.find(other => same(other, each));
    if (twin) twin.duplicates.push({charter: each.charter, title: each.title});
    else kept.push({...each, duplicates: []});
  }
  return kept;
}

/** A title as a file name: its first words, lower case, joined by -. */
export function slugOf(title: string): string {
  const parts = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let slug = '';
  for (const part of parts) {
    if (slug && slug.length + part.length + 1 > 48) break;
    slug = slug ? `${slug}-${part}` : part.slice(0, 48);
  }
  return slug || 'finding';
}

/** Where an issue's skeleton goes, from the project root: `device/bug-bash/<area>-<slug>.test.ts`, numbered where one is taken. */
export function skeletonPath(found: Pick<Found, 'area' | 'title'>, taken: Set<string>): string {
  const base = `${found.area}-${slugOf(found.title)}`;
  let name = `device/bug-bash/${base}.test.ts`;
  for (let n = 2; taken.has(name); n++) name = `device/bug-bash/${base}-${n}.test.ts`;
  taken.add(name);
  return name;
}

const OPPOSITE: Record<string, string> = {up: 'down', down: 'up', left: 'right', right: 'left'};
const quoted = (value: unknown) => JSON.stringify(String(value));
/** Text for a comment: on one line. */
const line = (text: string) => text.replace(/\s*\n\s*/g, ' ');

/** A step as a device test writes it, or a comment where a test does it otherwise. */
export function actionLine(step: ExploreStep): string {
  const {input, query} = step;
  const said = `// step ${step.n}, ${line(describeStep(step))}`;
  if (!step.ok) return `${said}, failed in the explore: ${line(step.said)}`;
  if (step.target && !query) return `${said}: no query finds that node alone`;
  switch (step.tool) {
    case 'tap':
      return `await ${query}.press();`;
    case 'long_press':
      return `await ${query}.longPress();`;
    case 'type':
      return `await ${query}.${input.replace === false ? 'type' : 'fill'}(${quoted(input.text)});`;
    case 'type_secret':
      return `await agent.act(${quoted(`fill the ${step.target?.kind} ${JSON.stringify(step.target?.name)} with {value}`)}, {params: {value: secret(${quoted(input.secret)})}});`;
    case 'check':
      return `await ${query}.${input.checked === false ? 'uncheck' : 'check'}();`;
    case 'press':
      return `await device.key(${quoted(input.key)});`;
    case 'scroll':
      // A finger drawn up shows what is below, as the agent's scroll does.
      return query ? `await ${query}.swipe(${quoted(OPPOSITE[String(input.direction)])});` : `${said}: a test scrolls the node that scrolls, with swipe`;
    case 'scroll_to':
      return query ? `await ${query}.scrollIntoView();` : `await screen.getByText(${quoted(input.text)}).scrollIntoView();`;
    case 'navigate':
      return String(input.url).startsWith('/') ? `await device.open(${quoted(input.url)});` : `await device.openLink(${quoted(input.url)});`;
    case 'back':
      return 'await device.back();';
    case 'dismiss_keyboard':
      return 'await device.dismissKeyboard();';
    case 'tap_at':
      return `${said}: a point of a screenshot, which a test finds by the node there`;
    default:
      return `${said}: the project's tool, which a test calls for itself`;
  }
}

/**
 * An issue's skeleton: the explore's steps up to it as a device test writes
 * them, then the expectation in the agent's words, which its judge checks.
 * The describe is skipped unless HARNESS_BUGBASH is set, so a normal run
 * passes it by.
 */
export function skeletonOf(found: Found, platform: string, date: string): string {
  const body = found.actions.map(actionLine);
  const secrets = found.actions.some(step => step.ok && step.tool === 'type_secret');
  const repro = found.steps.map((each, index) => `//   ${index + 1}. ${line(each)}`);
  return [
    `// Found by expo-harness bug-bash on ${date} in ${found.area}, by the charter ${found.charter}.`,
    `// Expected: ${line(found.expected)}`,
    `// Observed: ${line(found.observed)}`,
    ...(repro.length > 0 ? ['// The steps, as the explore told them:', ...repro] : []),
    `import {agent${secrets ? ', secret' : ''}} from 'expo-vitest/agent';`,
    "import {device, onlyOn, screen} from 'expo-vitest';",
    "import {describe, it} from 'vitest';",
    '',
    `describe.skipIf(!process.env.HARNESS_BUGBASH)(${quoted(`[bugbash] ${found.area}: ${line(found.title)}`)}, () => {`,
    `  onlyOn([${quoted(platform)}], () => {`,
    `    it(${quoted(line(found.expected))}, async () => {`,
    `      await device.open(${quoted(found.start.route ?? '/')});`,
    ...body.map(each => `      ${each}`),
    "      // Review: the expectation in the agent's words. Where a matcher says the same, it is the faster check.",
    `      await agent.assert(${quoted(line(found.expected))});`,
    '    });',
    '  });',
    '});',
    '',
  ].join('\n');
}

/** A test's outcome in the confirmation run, as the bug bash's reporter writes it. */
export interface RunRecord {
  project: string;
  file: string;
  state: 'passed' | 'failed' | 'skipped' | 'pending';
  error?: {code?: string; message: string};
}

/** confirmed: its check failed; rejected: it passed; unverified: it failed before its check; unchecked: it did not run. */
export type Verdict = {status: 'confirmed' | 'rejected' | 'unverified' | 'unchecked'; reason: string};

/** What the run of an issue's skeleton says of it: a bug where its check failed, rejected where it passed, else not verified. */
export function verdictOf(records: readonly RunRecord[], skeleton: string): Verdict {
  const ran = records.filter(record => record.file === skeleton && record.state !== 'skipped');
  const record = ran.find(each => each.state === 'failed') ?? ran[0];
  if (!record) return {status: 'unchecked', reason: 'its skeleton did not run'};
  if (record.state === 'passed') return {status: 'rejected', reason: 'its skeleton passed: the app did what was expected'};
  const error = record.error ?? {message: 'it did not finish'};
  if (error.code === 'ASSERTION_FAILED') return {status: 'confirmed', reason: `its skeleton failed its check: ${line(error.message)}`};
  return {status: 'unverified', reason: `its skeleton failed before its check, ${error.code ?? 'without a code'}: ${line(error.message)}`};
}

/** A charter's run, as the report lists it. */
export interface CharterRun {
  charter: Charter;
  /** Its report, or what kept it from exploring. */
  report?: ExploreReport;
  error?: string;
}

/** An issue and what became of it. */
export interface Judged {
  found: Merged;
  skeleton?: string;
  verdict: Verdict;
}

export interface BugBash {
  map: string;
  platform: string;
  parallel: number;
  startedAt: string;
  durationMs: number;
  runs: CharterRun[];
  issues: Judged[];
  warnings: Merged[];
  usage: ExploreReport['usage'];
}

/** What every charter's model calls took together; the cost unknown where one's is. */
export function totalUsage(runs: readonly CharterRun[]): ExploreReport['usage'] {
  return runs.reduce<ExploreReport['usage']>((sum, {report}) => {
    if (!report) return sum;
    const {usage} = report;
    return {calls: sum.calls + usage.calls, tokens: addUsage(sum.tokens, usage.tokens), costUsd: sum.costUsd === null || usage.costUsd === null ? null : sum.costUsd + usage.costUsd};
  }, {calls: 0, tokens: NO_USAGE, costUsd: 0});
}

/** A finding's section: what it says, its steps, where it was found, and what its skeleton showed. */
function section(found: Merged, number: number, judged?: Judged): string {
  const repro = found.steps.length > 0 ? found.steps.map((each, index) => `${index + 1}. ${each}`).join('\n') : 'None given.';
  const report = path.posix.join(found.charter, 'report.md');
  const also = found.duplicates.length > 0 ? `, and by ${found.duplicates.map(each => `${each.charter} as ${JSON.stringify(each.title)}`).join(', ')}` : '';
  const lines = [`### ${number}. ${found.area}: ${found.title}`, '', `Expected: ${found.expected}`, '', `Observed: ${found.observed}`, '', 'Steps to reproduce:', '', repro, '', `Found by ${found.charter} after step ${found.step} ([report](${report}), [tree](${path.posix.join(found.charter, found.tree)}))${also}.`];
  if (judged) lines.push('', judged.skeleton ? `\`${judged.skeleton}\`: ${judged.verdict.reason}.` : `${judged.verdict.reason}.`);
  return lines.join('\n');
}

/** `report.md`: the confirmed bugs, the risks it could not verify, the rejected findings with why, the warnings, then the charters. */
export function renderBugBash(run: BugBash): string {
  const header = [run.platform, `${run.runs.length} ${run.runs.length === 1 ? 'charter' : 'charters'}, ${run.parallel} at a time`, run.startedAt, `${(run.durationMs / 1000).toFixed(1)} s`, costLine(run.usage)].join(' · ');
  const lines = [`# Bug bash: ${run.map}`, '', header, ''];
  let number = 0;
  const group = (title: string, empty: string, list: Judged[]) => {
    lines.push(`## ${title}`, '');
    if (list.length === 0) lines.push(empty, '');
    for (const judged of list) lines.push(section(judged.found, (number += 1), judged), '');
  };
  group('Confirmed bugs', 'None.', run.issues.filter(each => each.verdict.status === 'confirmed'));
  group('Risks it could not verify', 'None.', run.issues.filter(each => each.verdict.status === 'unverified' || each.verdict.status === 'unchecked'));
  group('Rejected', 'None.', run.issues.filter(each => each.verdict.status === 'rejected'));
  lines.push('## Warnings', '');
  if (run.warnings.length === 0) lines.push('None.', '');
  for (const warning of run.warnings) lines.push(section(warning, (number += 1)), '');
  lines.push('## Charters', '', '| charter | goal | how it ended | findings | cost |', '| --- | --- | --- | --- | --- |');
  for (const {charter, report, error} of run.runs) {
    const cell = (text: string) => text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
    const findings = report ? `${report.findings.length}` : '';
    lines.push(`| [${charter.folder}](${charter.folder}/report.md) | ${cell(charter.goal)} | ${cell(report ? outcomeLine(report.outcome) : `could not explore: ${error}`)} | ${findings} | ${report ? costLine(report.usage) : ''} |`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The exit code: 2 where no charter could explore; 1 where a bug was
 * confirmed, or an issue's skeleton did not run, so it may be one; else 0.
 */
export function bugBashExit(run: Pick<BugBash, 'runs' | 'issues'>): 0 | 1 | 2 {
  if (run.runs.every(each => !each.report)) return 2;
  return run.issues.some(each => each.verdict.status === 'confirmed' || each.verdict.status === 'unchecked') ? 1 : 0;
}

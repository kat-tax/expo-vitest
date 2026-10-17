/**
 * An explore: the agent's loop with a goal in place of a test's step. The
 * model plans a step at a time toward the goal, reports what is off with
 * report_finding, and reads an action that failed rather than stopping at
 * it. Each action leaves the tree it left behind, and a picture where one
 * may be kept, in the report's folder as the run goes, and a finding cites
 * the step it was reported after. The host is given, so the whole of it
 * runs in the unit tests against a fake device and a scripted model.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {ResolvedAgent} from '../../agent/config.ts';
import {createStepContext} from '../../agent/context.ts';
import {actingSystem} from '../../agent/executors.ts';
import type {ActingHost, Seen} from '../../agent/hands.ts';
import type {LoopTool} from '../../agent/loop.ts';
import {grammarLoopTools, projectTool, runLoop} from '../../agent/loop.ts';
import type {SecretStore} from '../../agent/secrets.ts';
import {secret} from '../../agent/secrets.ts';
import type {StepOf} from '../../agent/step.ts';
import {stepSignal, withAgentOptions} from '../../agent/step.ts';
import {toolsOn} from '../../agent/tools.ts';
import type {Message, ToolSpec, Usage} from '../../agent/types.ts';
import {AgentError, isAgentError} from '../../agent/types.ts';
import {describeQuery, queryFor} from '../../device/queries.ts';
import {isHarnessError} from '../lib/errors.ts';
import type {ExploreReport, ExploreStep, Finding, Outcome, Place, Reported} from '../lib/report.ts';
import {screenshotFile, stepFile} from '../lib/report.ts';
import {renderSnapshot} from '../lib/snapshot.ts';

/** The frozen part of the exploring prompt, the same on every call of every run, so the provider caches it. */
export const EXPLORE_PROMPT = [
  'You explore an app to find what is wrong with it. You are given a goal, such as "explore the checkout like a first-time buyer", and a budget of actions, and no test to pass.',
  '',
  'The screen comes as a view: a line a node, its ref, its kind, its name in quotes, its test id after #, its states in brackets, and its value where it has one, the controls first and the rest after a blank line. A ref such as @e7 names the same node for the rest of the run. After each action you get what changed: + a node that came, - one that went, ~ one whose states or value changed; the whole view where most of the screen changed; or "screen: unchanged".',
  '',
  'Plan one step at a time toward the goal, and try what the posture it names asks of you: the path a first-time user takes, the numbers and the copy, edge input such as an empty, long or negative value, the state after a reload, the paths where something goes wrong. Read what each action changed before you take the next, and call observe when what you have is not enough to go on.',
  '',
  'Report each thing that is off with report_finding as soon as the screen has shown it to you: an issue where the app does what a person would call a bug, such as a wrong total, a control that does nothing, a crash or an error it should not show; a warning for a rough edge or a risk, such as copy that reads wrong or a control with no name. Give the steps that reach it from where the run began, a sentence each, what you expected, and what the screen showed instead. Report what you saw, not what you suspect, and each thing once.',
  '',
  'An action that fails is something to read, not the end of the run: try another way, or report it where the app is at fault.',
  '',
  'A secret shows as <secret:NAME>. Fill it with type_secret, never with type: the runner types the value, and you never see it.',
  '',
  'Do nothing that cannot be undone outside the app: nothing bought, deleted or sent for real, and no account changed that the goal does not name.',
  '',
  'End the run with complete_step, called on its own, once the goal is explored or the budget is nearly spent: passed with a summary of what you tried and what you found, failed where the app broke so that you could not explore, blocked where you cannot go on, as at a login the run gave you no secret for. A message from the system may come between turns, about a budget, a repeated call or actions that keep failing: follow it.',
].join('\n');

/** The tool a finding is reported with. */
export const REPORT_FINDING: ToolSpec = {
  name: 'report_finding',
  description: 'Report something off that the screen showed you: an issue where the app does what a person would call a bug, a warning for a rough edge or a risk. It is kept with the screen your last action left.',
  inputSchema: {
    type: 'object',
    properties: {
      severity: {type: 'string', enum: ['issue', 'warning']},
      title: {type: 'string', description: 'What is off, in a line.'},
      expected: {type: 'string', description: 'What a person would expect the app to do.'},
      observed: {type: 'string', description: 'What the screen showed instead.'},
      steps: {type: 'array', items: {type: 'string'}, description: 'The steps that reach it from where the run began, a sentence each.'},
    },
    required: ['severity', 'title', 'expected', 'observed', 'steps'],
    additionalProperties: false,
  },
  strict: true,
};

export interface ExploreOptions {
  host: ActingHost;
  agent: ResolvedAgent;
  goal: string;
  /** The actions it may take. */
  maxSteps: number;
  /** In ms. */
  timeout: number;
  secrets: SecretStore;
  /** The report's folder, where each step's tree and picture go as the run goes. */
  out: string;
  /** Where the run's taint is kept: its own, so runs side by side keep theirs apart. */
  taintStore?: object;
  /** Ends the run early, as a person's Ctrl+C does. */
  signal?: AbortSignal;
  /** The long side of a picture the report keeps, in pixels: 1280. */
  pictureMaxSide?: number;
  onFinding?(finding: Finding): void;
  onStep?(step: ExploreStep): void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
/** A time as the first turn gives it, in minutes from one, else in seconds. */
const inWords = (ms: number) => (ms >= 60_000 ? plural(Math.round(ms / 60_000), 'minute') : plural(Math.max(1, Math.round(ms / 1000)), 'second'));
const minus = (a: Usage, b: Usage): Usage => ({input: a.input - b.input, output: a.output - b.output, cacheRead: a.cacheRead - b.cacheRead, cacheWrite: a.cacheWrite - b.cacheWrite});
/** An error in the words a step's answer gives it: its code, then what went wrong. */
const said = (error: unknown) => (isAgentError(error) ? `${error.code}: ${error.explanation}` : isHarnessError(error) ? `${error.code}: ${error.message}` : `the tool failed: ${(error as Error).message}`);

/** The first turn: the goal, the budget, the secrets by name, and the screen. */
export function exploreTurn(goal: string, limits: {actions: number; timeout: number}, secrets: readonly {name: string; purpose: string}[], view: string): Message {
  const lines = [`Goal: ${goal}`, '', `You have ${plural(limits.actions, 'action')} and ${inWords(limits.timeout)} to explore with. The run ends when you call complete_step, or when they are spent.`];
  if (secrets.length > 0) lines.push('', 'Secrets you may fill with type_secret, by name:', ...secrets.map(each => `- ${each.name}: ${each.purpose === 'password' ? 'a password' : 'a secret'}, <secret:${each.name}>`));
  return {role: 'user', content: [{type: 'text', text: lines.join('\n')}, {type: 'text', text: `The screen now:\n${view}`}]};
}

/** Runs one explore to its end, and answers its report. A harness failure ends the run, and is its outcome. */
export async function runExplore(options: ExploreOptions): Promise<ExploreReport> {
  const {host, agent, goal, secrets, out} = options;
  const at: StepOf = {step: 'act', instruction: goal};
  if (!agent.model) throw new AgentError('MODEL_UNAVAILABLE', `the agent ${agent.name} has no model; give it one under agents in the harness config`, at);
  const started = Date.now();
  const signal = stepSignal(at, options.timeout, options.signal);
  // Every secret the config has may be filled, as in an MCP session.
  const params = Object.fromEntries(secrets.names().map(name => [name, secret(name)]));
  const made = createStepContext({
    step: {kind: 'act', instruction: goal, params, index: 0},
    target: {platform: host.platform, verbs: [...host.capabilities], pixels: host.capabilities.has('screenshot'), app: host.scheme ? {scheme: host.scheme} : {}},
    hands: {host, at, signal: signal.signal, secrets, stepSecrets: Object.values(params), taintStore: options.taintStore ?? {}, maxObservationBytes: agent.maxObservationBytes, screenshotMaxSide: agent.screenshotMaxSide},
    model: withAgentOptions(agent.model, agent, at),
    agentContext: agent.context,
    limits: {modelCalls: agent.maxModelCalls, actions: options.maxSteps},
    deadline: started + options.timeout,
  });
  const {context, hands} = made;
  const steps: ExploreStep[] = [];
  const findings: Finding[] = [];
  let since = {calls: 0, usage: made.record().usage};

  /** The screen the model last saw, as a step leaves it: its tree, and a picture where one may be kept. */
  const keep = async (n: number, name: string): Promise<Place> => {
    const seen = hands.seen as Seen;
    const tree = stepFile(n, name);
    fs.mkdirSync(path.join(out, 'steps'), {recursive: true});
    fs.writeFileSync(path.join(out, tree), `${hands.hide(renderSnapshot(seen.snapshot))}\n`);
    const place: Place = {...(seen.route ? {route: seen.route} : {}), tree};
    const picture = await hands.picture(options.pictureMaxSide ?? 1280).catch((error: unknown) => ({withheld: (error as Error).message}));
    if ('withheld' in picture) return place;
    const screenshot = screenshotFile(n);
    fs.mkdirSync(path.join(out, 'screenshots'), {recursive: true});
    fs.writeFileSync(path.join(out, screenshot), Buffer.from(picture.data, 'base64'));
    return {...place, screenshot};
  };

  /** A step: the action as the model asked for it, the node it was on as the model last saw it, what it answered, and the screen it left. */
  const keepStep = async (tool: string, input: Record<string, unknown>, before: Seen, ok: boolean, answer: string) => {
    const {ref, ...rest} = input;
    const node = before.snapshot.nodes.find(each => each.ref === ref);
    const query = node ? queryFor(node, before.snapshot) : null;
    const n = steps.length + 1;
    const place = await keep(n, tool);
    const record = made.record();
    const step: ExploreStep = {
      n,
      tool,
      input: Object.fromEntries(Object.entries(rest).flatMap(([key, value]) => (value === null ? [] : [[key, typeof value === 'string' ? hands.hide(value) : value]]))),
      ...(node ? {target: {kind: node.kind ?? node.role, name: hands.hide(node.name), ...(node.testId ? {testId: node.testId} : {})}} : {}),
      ...(query ? {query: `screen.${hands.hide(describeQuery(query))}`} : {}),
      ok,
      said: hands.hide(answer.split('\n')[0] as string),
      ...place,
      calls: record.modelCalls - since.calls,
      usage: minus(record.usage, since.usage),
    };
    since = {calls: record.modelCalls, usage: record.usage};
    steps.push(step);
    options.onStep?.(step);
  };

  /** An acting tool, each call of it kept as a step, whether it worked or not, unless the budget refused it before it was sent. */
  const recorded = (tool: LoopTool): LoopTool => ({
    ...tool,
    async run(input) {
      const given = input as Record<string, unknown>;
      const before = hands.seen as Seen;
      try {
        // An action answers in text: what changed on the screen.
        const answer = (await tool.run(input)) as string;
        await keepStep(tool.spec.name, given, before, true, answer);
        return answer;
      } catch (error) {
        if (!isHarnessError(error) || error.code !== 'STEP_BUDGET_EXHAUSTED') await keepStep(tool.spec.name, given, before, false, said(error));
        throw error;
      }
    },
  });

  const first = await context.observe();
  const start = await keep(0, 'start');
  const report: LoopTool = {
    spec: REPORT_FINDING,
    acts: false,
    async run(input) {
      const given = input as Reported;
      const last = steps.at(-1);
      const place = last ? {...(last.route ? {route: last.route} : {}), tree: last.tree, ...(last.screenshot ? {screenshot: last.screenshot} : {})} : start;
      const finding: Finding = {
        severity: given.severity,
        title: hands.hide(given.title),
        expected: hands.hide(given.expected),
        observed: hands.hide(given.observed),
        steps: given.steps.map(each => hands.hide(each)),
        step: steps.length,
        ...place,
      };
      findings.push(finding);
      options.onFinding?.(finding);
      return `kept as finding ${findings.length}, with the screen after step ${steps.length}`;
    },
  };
  const purposes = Object.values(params).map(each => ({name: each.name, purpose: each.purpose}));
  let outcome: Outcome;
  try {
    const ended = await runLoop(context, {
      system: actingSystem(EXPLORE_PROMPT, agent.context, agent.system),
      prompt: [exploreTurn(goal, {actions: options.maxSteps, timeout: options.timeout}, purposes, first.text)],
      tools: [...grammarLoopTools(context).map(tool => (tool.acts === false ? tool : recorded(tool))), ...toolsOn(agent.tools, host.platform).map(tool => (tool.mutates ? recorded(projectTool(context, tool)) : projectTool(context, tool))), report],
    });
    outcome = {status: ended.status, summary: hands.hide(ended.summary)};
  } catch (error) {
    if (!isHarnessError(error)) throw error;
    outcome = {status: 'ended', code: error.code, summary: hands.hide(isAgentError(error) ? error.explanation : error.message)};
  } finally {
    signal.dispose();
  }
  const record = made.record();
  fs.writeFileSync(path.join(out, 'transcript.txt'), `${record.transcript.join('\n')}\n`);
  return {
    goal: hands.hide(goal),
    platform: host.platform,
    agent: agent.name,
    models: [...new Set(record.models)],
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    outcome,
    start,
    steps,
    findings,
    usage: {calls: record.modelCalls, tokens: record.usage, costUsd: record.costUsd ?? null},
  };
}

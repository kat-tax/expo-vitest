/**
 * The judgments: `assert`, `waitFor` and `extract`. Each reads the agent's
 * context, the statement and the screen now, never the steps before it, so
 * a verdict is about the screen and not about what the agent meant to do.
 * An answer the step cannot use gets one repair call, with what was wrong.
 */
import type {Snapshot} from '../harness/lib/snapshot.ts';
import {addUsage, NO_USAGE} from './cost.ts';
import type {StepOf} from './step.ts';
import {assistantTurn, callModel, endedBy, sleep} from './step.ts';
import {checkJson} from './tools.ts';
import type {AgentStepKind, Completion, CompletionRequest, ImagePart, JsonSchema, Message, Model, StandardSchemaV1, SystemBlock, ToolSpec, Usage} from './types.ts';
import {AgentError, isAgentError} from './types.ts';
import {diffViews} from './view.ts';

const VIEW_GUIDE =
  'The screen comes as a view: a line a node, its ref, its kind, its name in quotes, its test id after #, its states in brackets, and its value where it has one, the controls first and the rest after a blank line. A picture of the screen may come with it, or in its place.';

/** The judge's own words, the same on every call, so they stay in the provider's cache. */
export const JUDGE_PROMPT = [
  "You judge a statement about an app's screen, from what the screen shows now and nothing else.",
  VIEW_GUIDE,
  'Judge only what is shown. Where the screen does not show enough to say, the verdict is inconclusive, never a guess.',
  'Answer by calling the verdict tool once.',
].join('\n');

/** What extract reads, in place of the verdict tool. */
export const EXTRACT_PROMPT = [
  "You read a value off an app's screen, from what the screen shows now and nothing else.",
  VIEW_GUIDE,
  'Answer with one JSON object and nothing else: found is whether the screen shows the value, value is the value, or null where it is not shown, and explanation says where on the screen it is, or why it is not there.',
  'Never make a value up: where the screen does not show it, found is false.',
].join('\n');

export const VERDICT_TOOL: ToolSpec = {
  name: 'verdict',
  description: 'Give the verdict on the statement.',
  inputSchema: {
    type: 'object',
    properties: {
      verdict: {type: 'string', enum: ['pass', 'fail', 'inconclusive']},
      explanation: {type: 'string', description: 'What on the screen the verdict rests on, in a sentence or two.'},
    },
    required: ['verdict', 'explanation'],
    additionalProperties: false,
  },
  strict: true,
};

/** A look at the screen: the snapshot, the view the model reads of it, and a picture where one is sent. */
export interface Look {
  snapshot: Snapshot;
  /** The screen as the model reads it, redacted. */
  view: string;
  /** Where the app is: the route on web, the screen elsewhere. */
  route?: string;
  image?: ImagePart;
}

/** What a judgment reads and asks with. */
export interface JudgeInput {
  kind: Exclude<AgentStepKind, 'act'>;
  /** The assertion, the condition, or what to extract, as the test wrote it. */
  statement: string;
  look: Look;
  /** The picture alone, without the view. */
  imageOnly?: boolean;
  /** The agent's context, which every call reads. */
  context?: string;
  model: Model;
  effort?: CompletionRequest['effort'];
  /** The step's signal, from `stepSignal`. */
  signal: AbortSignal;
}

export interface Judged<T> {
  value: T;
  explanation: string;
  calls: number;
  usage: Usage;
  /** The models that answered, which a fallback may have changed. */
  models: string[];
}

export type Verdict = 'pass' | 'fail' | 'inconclusive';

const stepOf = (input: Pick<JudgeInput, 'kind' | 'statement'>): StepOf => ({step: input.kind, instruction: input.statement});

const systemOf = (prompt: string, context?: string): SystemBlock[] => [{text: prompt}, {text: context ? `About the app:\n${context}` : 'About the app: nothing more is known.', cache: true}];

const LABELS = {assert: 'Statement', waitFor: 'Condition', extract: 'Read'} as const;

/** The judgment's question as one user turn: the statement, then the view, then the picture. */
function question(input: JudgeInput): Message {
  const {view, image} = input.look;
  return {
    role: 'user',
    content: [{type: 'text', text: `${LABELS[input.kind]}: ${input.statement}`}, ...(input.imageOnly ? [] : [{type: 'text' as const, text: `The screen now:\n${view}`}]), ...(image ? [image] : [])],
  };
}

/** The turn that asks again: each tool call answered with what was wrong, or the words alone where the model called none. */
function repairTurn(completion: Completion, wrong: string): Message {
  if (!completion.toolCalls.length) return {role: 'user', content: [{type: 'text', text: `That answer could not be used: ${wrong}. Answer again.`}]};
  return {role: 'user', content: completion.toolCalls.map(call => ({type: 'tool_result' as const, toolUseId: call.id, content: [{type: 'text' as const, text: `${wrong}. Answer again.`}], isError: true}))};
}

type Reading<T> = {value: T; explanation: string} | {wrong: string};

/**
 * Asks, and asks once more with what was wrong where the answer cannot be
 * used, while the calls allow. The repair is appended to the first turn,
 * never edited into it.
 */
async function ask<T>(
  input: JudgeInput,
  first: Pick<CompletionRequest, 'system' | 'messages' | 'tools' | 'format'>,
  read: (completion: Completion) => Reading<T> | Promise<Reading<T>>,
  maxCalls = 2,
): Promise<Judged<T>> {
  const messages: Message[] = [...first.messages];
  let usage: Usage = NO_USAGE;
  const models: string[] = [];
  for (let calls = 1; ; calls++) {
    const completion = await callModel(input.model, {...first, messages, effort: input.effort ?? 'low', signal: input.signal}, stepOf(input));
    usage = addUsage(usage, completion.usage);
    models.push(completion.model);
    const reading = await read(completion);
    if (!('wrong' in reading)) return {...reading, calls, usage, models};
    if (calls >= maxCalls) throw new AgentError('MODEL_OUTPUT_INVALID', `the model's answer could not be used${calls > 1 ? ', even after a repair' : ''}: ${reading.wrong}`, stepOf(input));
    messages.push(assistantTurn(completion), repairTurn(completion, reading.wrong));
  }
}

/** A verdict on a statement about the screen: pass, fail or inconclusive, with what it rests on. */
export function judge(input: JudgeInput, maxCalls = 2): Promise<Judged<Verdict>> {
  const first = {system: systemOf(JUDGE_PROMPT, input.context), messages: [question(input)], tools: [VERDICT_TOOL]};
  return ask<Verdict>(
    input,
    first,
    completion => {
      const call = completion.toolCalls.find(each => each.name === 'verdict');
      if (!call) return {wrong: 'it called no verdict tool, and the verdict tool is the answer'};
      const issues = checkJson(VERDICT_TOOL.inputSchema, call.input);
      if (issues.length) return {wrong: issues.join('; ')};
      const {verdict, explanation} = call.input as {verdict: Verdict; explanation: string};
      return {value: verdict, explanation};
    },
    maxCalls,
  );
}

/** The error a verdict fails its step with: fail is ASSERTION_FAILED, inconclusive is ASSERTION_INCONCLUSIVE. None where it passed. */
export function verdictError(at: StepOf, judged: Judged<Verdict>, screenshot?: string): AgentError | undefined {
  if (judged.value === 'pass') return undefined;
  return new AgentError(judged.value === 'fail' ? 'ASSERTION_FAILED' : 'ASSERTION_INCONCLUSIVE', judged.explanation, {...at, ...(screenshot ? {screenshot} : {})});
}

/** Whether the screen changed since the last look judged, by identity, so a ref that moved is not a change and a text that changed is. */
export function viewChanged(last: Look | null, now: Look): boolean {
  return last === null || last.route !== now.route || diffViews(last.snapshot, now.snapshot).changes > 0;
}

export interface WaitInput extends Omit<JudgeInput, 'kind' | 'look'> {
  /** A fresh look at the screen. */
  look: () => Promise<Look>;
  /** How long between two looks, in ms. */
  interval: number;
  /** Model calls, the repairs among them. */
  maxModelCalls: number;
}

/**
 * Looks at the screen every `interval` until the judge says the condition
 * holds. The judge is called only when the screen changed since the look it
 * last judged, so a screen that sits still costs nothing. The step's timeout
 * is ASSERTION_FAILED, with what the last verdict rested on.
 */
export async function waitFor(input: WaitInput): Promise<Judged<Verdict>> {
  const at: StepOf = {step: 'waitFor', instruction: input.statement};
  let judged: Judged<Verdict> = {value: 'inconclusive', explanation: 'the screen was never judged', calls: 0, usage: NO_USAGE, models: []};
  let judgedLook: Look | null = null;
  const timedOut = (error: unknown) =>
    isAgentError(error) && error.code === 'STEP_TIMEOUT' ? new AgentError('ASSERTION_FAILED', `${error.explanation}, and the condition did not hold: ${judged.explanation}`, {...at, cause: error}) : error;
  for (;;) {
    const ended = endedBy(input.signal, at);
    if (ended) throw timedOut(ended);
    const started = Date.now();
    const look = await input.look();
    if (viewChanged(judgedLook, look)) {
      const left = input.maxModelCalls - judged.calls;
      if (left <= 0) throw new AgentError('STEP_BUDGET_EXHAUSTED', `it made ${judged.calls} model calls, its budget, and the condition did not hold: ${judged.explanation}`, at);
      let now: Judged<Verdict>;
      try {
        now = await judge({...input, kind: 'waitFor', look}, Math.min(2, left));
      } catch (error) {
        throw timedOut(error);
      }
      judged = {...now, calls: judged.calls + now.calls, usage: addUsage(judged.usage, now.usage), models: [...judged.models, ...now.models]};
      if (now.value === 'pass') return judged;
      judgedLook = look;
    }
    // The next look comes an interval after this one began, or at once where the judge took longer.
    const wait = input.interval - (Date.now() - started);
    if (wait > 0) await sleep(wait, input.signal);
  }
}

/** What the model answers for extract: whether the screen shows the value, the value, and where. */
const envelopeOf = (value: JsonSchema): JsonSchema => ({
  type: 'object',
  properties: {found: {type: 'boolean'}, value, explanation: {type: 'string'}},
  required: ['found', 'value', 'explanation'],
  additionalProperties: false,
});

/** A Standard Schema's issues as one line, each with its path. */
const issuesOf = (issues: readonly {message: string; path?: readonly unknown[]}[]) =>
  issues
    .map(issue => {
      const path = (issue.path ?? []).map(part => String(typeof part === 'object' && part !== null ? (part as {key: unknown}).key : part));
      return path.length ? `$.value.${path.join('.')}: ${issue.message}` : `$.value: ${issue.message}`;
    })
    .join('; ');

/** JSON from a reply, which a model without a format may fence. */
const unfence = (text: string) => text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');

type Extracted<T> = {found: false} | {found: true; value: T};

/** A Standard Schema's JSON Schema, where it gives one it can express. Zod's cannot express a transform, and throws; the value is then asked for as JSON in text. */
function formatOf(standard: StandardSchemaV1['~standard']): JsonSchema | undefined {
  try {
    return standard.jsonSchema?.output({target: 'draft-07'});
  } catch {
    return undefined;
  }
}

/**
 * A value read off the screen, as the schema allows. A JSON Schema, or a
 * Standard Schema that gives one, goes to the provider as the answer's
 * format; any other Standard Schema is asked for as JSON in text. Either
 * way the value is checked here, by `~standard.validate` or the checker. A
 * value the screen does not show is ASSERTION_INCONCLUSIVE, never a
 * placeholder.
 */
export async function extract<T>(input: Omit<JudgeInput, 'kind'> & {schema: StandardSchemaV1<T> | JsonSchema}): Promise<Judged<T>> {
  const at: StepOf = {step: 'extract', instruction: input.statement};
  const standard = input.schema ? (input.schema as Partial<StandardSchemaV1<T>>)['~standard'] : undefined;
  if (!standard && (typeof input.schema !== 'object' || input.schema === null)) throw new AgentError('INVALID_ARGUMENT', 'its schema is neither a Standard Schema nor a JSON Schema object', at);
  const json = standard ? formatOf(standard) : (input.schema as JsonSchema);
  const asked: JudgeInput = {...input, kind: 'extract'};
  const first = {
    system: systemOf(EXTRACT_PROMPT, input.context),
    messages: [question(asked)],
    tools: [],
    ...(json ? {format: envelopeOf({anyOf: [json, {type: 'null'}]})} : {}),
  };
  const judged = await ask<Extracted<T>>(asked, first, async completion => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(unfence(completion.text));
    } catch {
      return {wrong: 'it is not JSON'};
    }
    const issues = checkJson(envelopeOf({}), parsed);
    if (issues.length) return {wrong: issues.join('; ')};
    const answer = parsed as {found: boolean; value: unknown; explanation: string};
    if (!answer.found) return {value: {found: false}, explanation: answer.explanation};
    if (standard) {
      const result = await standard.validate(answer.value);
      return result.issues ? {wrong: issuesOf(result.issues)} : {value: {found: true, value: result.value}, explanation: answer.explanation};
    }
    const wrong = checkJson(json as JsonSchema, answer.value, '$.value');
    return wrong.length ? {wrong: wrong.join('; ')} : {value: {found: true, value: answer.value as T}, explanation: answer.explanation};
  });
  if (!judged.value.found) throw new AgentError('ASSERTION_INCONCLUSIVE', judged.explanation, at);
  return {...judged, value: judged.value.value};
}

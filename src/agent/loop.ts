/**
 * The loop an `act` runs: turns of the model, each tool call in a turn run
 * in order and answered, until the model calls complete_step. The history
 * only grows, as the provider's cache and the thinking blocks bound to it
 * need: the provider's own turn is appended as it came, then the results,
 * then the loop's own word where it has one, and no turn already sent is
 * ever edited.
 */
import {HarnessError, isHarnessError} from '../harness/lib/errors.ts';
import type {Direction} from '../harness/lib/types.ts';
import type {RecordedAction} from './cache.ts';
import {canonical} from './cache.ts';
import type {StepContext, StepOutcome} from './context.ts';
import {isSecret, isUnique} from './secrets.ts';
import type {StepOf} from './step.ts';
import {assistantTurn, callModel, endedBy} from './step.ts';
import type {Tool, ToolContext} from './tools.ts';
import {checkJson, grammarTools} from './tools.ts';
import type {AgentErrorCode, Completion, CompletionRequest, ImagePart, Message, StandardSchemaV1, SystemBlock, TextPart, ToolResultPart, ToolSpec} from './types.ts';
import {AgentError, isAgentCode, isAgentError, isBlockedCode} from './types.ts';

/** The frozen part of the acting prompt, the same on every call of every run, so the provider caches it. */
export const CORE_PROMPT = [
  'You operate an app to carry out one step of a test: an instruction a person wrote, such as "add the blue shirt to the cart".',
  '',
  'The screen comes as a view: a line a node, its ref, its kind, its name in quotes, its test id after #, its states in brackets, and its value where it has one, the controls first and the rest after a blank line. A ref such as @e7 names the same node for the rest of the step. After each action you get what changed: + a node that came, - one that went, ~ one whose states or value changed; the whole view where most of the screen changed; or "screen: unchanged".',
  '',
  'Act with the tools, and read what an action changed before you take the next. Call observe when what you have is not enough to go on, and screenshot, where it is offered, for what the view cannot say, such as a colour.',
  '',
  'A secret param shows as <secret:NAME>. Fill it with type_secret, never with type: the runner types the value, and you never see it.',
  '',
  'Do what the instruction says and nothing more: nothing bought, deleted or sent that it did not ask for.',
  '',
  'End the step with complete_step, called on its own once you have seen the screen show the outcome: passed where the instruction is done, failed where the app does not do what it asks, blocked where you cannot go on, as when the app wants a login the step gave no secret for, with the code that says why. A message from the system may come between turns, about a budget, a repeated call or actions that keep failing: follow it.',
].join('\n');

/** The most the model may write in a turn, unless the agent says otherwise; the adapter's own default too. */
export const DEFAULT_MAX_TOKENS = 16_000;

/** What the loop offers the model: a tool's spec, and what a call of it does. */
export interface LoopTool {
  spec: ToolSpec;
  /** Runs a call, answering the result's text or parts. What it throws goes back as an error result, unless it ends the step. */
  run(input: unknown): Promise<string | readonly (TextPart | ImagePart)[]>;
  /** Whether a call that fails counts toward the failures in a row. */
  acts?: boolean;
}

export interface LoopSpec {
  system: readonly SystemBlock[];
  /** The turns the model starts from: the first user turn, as a rule. */
  prompt: readonly Message[];
  /** The tools offered, complete_step aside, which the loop adds. */
  tools: readonly LoopTool[];
  effort?: CompletionRequest['effort'];
  maxTokens?: number;
  /** Model calls, which may only lower the step's own budget. */
  maxModelCalls?: number;
  /** The messages to send for a call, from the history as it stands. */
  prepareMessages?(messages: readonly Message[]): readonly Message[];
}

/** The tool that ends a step, as the grammar has it. */
export const COMPLETE_STEP = grammarTools({capabilities: new Set(), secrets: [], pixels: false}).find(tool => tool.name === 'complete_step') as ToolSpec;

/** The codes that end the step when an action throws them, rather than going back to the model. */
const ENDS_STEP = new Set(['STEP_BUDGET_EXHAUSTED', 'STEP_TIMEOUT', 'CANCELLED', 'SECRET_UNAVAILABLE', 'DRIVER_UNAVAILABLE']);

const NO_TOOL = 'You called no tool. Call complete_step to end the step, or another tool to go on.';
const UNCHANGED = 'screen: unchanged';

const text = (value: string): TextPart => ({type: 'text', text: value});
const failed = (id: string, message: string): ToolResultPart => ({type: 'tool_result', toolUseId: id, content: [text(message)], isError: true});
/** An error as the model reads it: its code and what went wrong, without the step it is in, which the model knows. */
const messageOf = (error: unknown) => {
  if (isAgentError(error)) return `${error.code}: ${error.explanation}`;
  if (isHarnessError(error)) return `${error.code}: ${error.message}`;
  return `the tool failed: ${error instanceof Error ? error.message : String(error)}`;
};

/** Whether an error ends the step, rather than going back to the model as what the call did. */
export function endsTheStep(error: unknown): error is HarnessError {
  return isHarnessError(error) && ENDS_STEP.has(error.code);
}

/** An error that ends the step, as the step's own, or null for one that goes back to the model. */
function ending(error: unknown, at: StepOf): Error | null {
  if (!endsTheStep(error)) return null;
  if (isAgentError(error) || !isAgentCode(error.code)) return error;
  return new AgentError(error.code, error.message, {...at, blocked: isBlockedCode(error.code), cause: error});
}

/**
 * Runs a step's turns until the model concludes. Each call goes to the
 * step's model, which counts it; a tool input cut off at the token limit is
 * asked for once more with twice the room. A turn that calls no tool is
 * answered with a request for one, and a second such turn in a row ends the
 * step with STEP_NO_CONCLUSION.
 */
export async function runLoop(ctx: StepContext, spec: LoopSpec): Promise<StepOutcome> {
  const at: StepOf = {step: ctx.step.kind, instruction: ctx.step.instruction};
  const {model} = ctx;
  if (!model) throw new AgentError('MODEL_UNAVAILABLE', 'the agent has no model; give it one under agents in the harness config', at);
  const tools = new Map(spec.tools.filter(tool => tool.spec.name !== COMPLETE_STEP.name).map(tool => [tool.spec.name, tool]));
  const specs = [...[...tools.values()].map(tool => tool.spec), COMPLETE_STEP].sort((a, b) => a.name.localeCompare(b.name));
  const messages: Message[] = [...spec.prompt];
  const maxTokens = spec.maxTokens ?? DEFAULT_MAX_TOKENS;
  let calls = 0;
  let silent = 0;
  let failures = 0;
  let nudgedFailures = 0;
  let nudgedEnd = false;
  let previous = null as {key: string; unchanged: boolean} | null;

  const decide = async (): Promise<Completion> => {
    const ended = endedBy(ctx.signal, at);
    if (ended) throw ended;
    const limit = spec.maxModelCalls;
    if (limit !== undefined && calls >= limit) throw new AgentError('STEP_BUDGET_EXHAUSTED', `it made ${limit} model calls, the executor's budget`, at);
    calls += 1;
    const sent = spec.prepareMessages ? spec.prepareMessages(messages) : [...messages];
    const request: CompletionRequest = {system: spec.system, messages: sent, tools: specs, effort: spec.effort ?? 'medium', maxTokens, signal: ctx.signal};
    const first = await callModel(model, request, at);
    if (first.stopReason !== 'max_tokens' || first.toolCalls.length === 0) return first;
    // A tool's input cut off at the limit: the same turn once more, with twice the room. The cut turn was never sent back, so nothing is edited.
    const again = await callModel(model, {...request, maxTokens: maxTokens * 2}, at);
    if (again.stopReason === 'max_tokens' && again.toolCalls.length > 0) throw new AgentError('MODEL_OUTPUT_INVALID', `the model's tool input was cut off at the token limit twice, the second time at ${maxTokens * 2}`, at);
    return again;
  };

  try {
    for (;;) {
      const completion = await decide();
      messages.push(assistantTurn(completion));
      if (completion.text) ctx.attachTranscript(`model: ${completion.text}`);
      if (completion.toolCalls.length === 0) {
        silent += 1;
        if (silent >= 2) throw new AgentError('STEP_NO_CONCLUSION', 'the model ended two turns in a row without calling a tool, and never called complete_step', at);
        // After the assistant's own turn the next message is the user's, so this is said in one.
        messages.push({role: 'user', content: [text(NO_TOOL)]});
        continue;
      }
      silent = 0;
      const results: ToolResultPart[] = [];
      const nudges: string[] = [];
      for (const [index, call] of completion.toolCalls.entries()) {
        if (call.name === COMPLETE_STEP.name) {
          const issues = checkJson(COMPLETE_STEP.inputSchema, call.input);
          const conclusion = call.input as {status: StepOutcome['status']; summary: string; errorCode: AgentErrorCode | null};
          if (issues.length > 0) results.push(failed(call.id, `INVALID_ARGUMENT: ${issues.join('; ')}`));
          else if (conclusion.status === 'passed' && index > 0) results.push(failed(call.id, 'complete_step passed is called on its own, once you have seen what your other calls did'));
          else {
            ctx.attachTranscript(`complete_step ${conclusion.status}: ${conclusion.summary}`);
            return {status: conclusion.status, summary: conclusion.summary, ...(conclusion.errorCode ? {errorCode: conclusion.errorCode} : {})};
          }
          continue;
        }
        const key = `${call.name} ${canonical(call.input)}`;
        if (previous?.key === key && previous.unchanged) nudges.push(`You called ${call.name} with the same input as the call before, and that call changed nothing on the screen. Do something else, or call complete_step.`);
        const tool = tools.get(call.name);
        let result: ToolResultPart;
        if (!tool) result = failed(call.id, `INVALID_ARGUMENT: there is no tool called ${call.name}`);
        else {
          const issues = checkJson(tool.spec.inputSchema, call.input);
          if (issues.length > 0) result = failed(call.id, `INVALID_ARGUMENT: ${issues.join('; ')}`);
          else {
            try {
              const answer = await tool.run(call.input);
              result = {type: 'tool_result', toolUseId: call.id, content: typeof answer === 'string' ? [text(answer)] : answer};
            } catch (error) {
              const ends = ending(error, at);
              if (ends) throw ends;
              result = failed(call.id, messageOf(error));
            }
          }
        }
        results.push(result);
        const said = result.content.find(part => part.type === 'text')?.text ?? '';
        ctx.attachTranscript(`${call.name} ${canonical(call.input)} -> ${said.split('\n')[0]}`);
        previous = {key, unchanged: result.isError === true || said === UNCHANGED};
        if (result.isError && tool?.acts !== false) failures += 1;
        else if (!result.isError) failures = 0;
      }
      messages.push({role: 'user', content: results});
      if (failures < 3) nudgedFailures = 0;
      if (failures >= 5 && nudgedFailures < 5) {
        nudges.push(`Your last ${failures} actions failed. Call complete_step now, failed or blocked, with what you found.`);
        nudgedFailures = 5;
      } else if (failures >= 3 && nudgedFailures < 3) {
        nudges.push(`Your last ${failures} actions failed. Change your approach: observe the screen again, or try another way to the same end.`);
        nudgedFailures = 3;
      }
      const left = nearEnd(ctx, spec.maxModelCalls === undefined ? undefined : spec.maxModelCalls - calls);
      if (left && !nudgedEnd) {
        nudges.push(`The step is nearly out of time or budget: ${left}. Call complete_step now, with what the screen shows.`);
        nudgedEnd = true;
      }
      // A system message follows the user's, which holds the results, and the model's next turn follows it.
      if (nudges.length > 0) messages.push({role: 'system', content: nudges.join('\n')});
    }
  } finally {
    ctx.attachTurns(messages);
  }
}

/** What is nearly spent, in words, where the step is within three calls or actions of a budget or 15 s of its deadline. */
function nearEnd(ctx: StepContext, executorCallsLeft?: number): string | null {
  const {modelCalls, actions} = ctx.budgets;
  const callsLeft = Math.min(modelCalls.limit - modelCalls.used, executorCallsLeft ?? Number.POSITIVE_INFINITY);
  const actionsLeft = actions.limit - actions.used;
  const msLeft = ctx.deadline - Date.now();
  const near = [
    callsLeft <= 3 && `${callsLeft} model calls left`,
    actionsLeft <= 3 && `${actionsLeft} actions left`,
    msLeft <= 15_000 && `${Math.max(0, Math.round(msLeft / 1000))} s left`,
  ].filter(Boolean);
  return near.length > 0 ? near.join(', ') : null;
}

/** A param as the model reads it: a secret by its name, a unique value as itself. */
function shown(value: unknown): string {
  if (isSecret(value)) return `<secret:${value.name}>`;
  if (isUnique(value)) return value.value;
  return String(value);
}

/** The instruction with each {param} hole filled as the model reads it. */
export function fillHoles(instruction: string, params: Readonly<Record<string, unknown>>): string {
  return instruction.replace(/\{(\w+)\}/g, (hole, name: string) => (name in params ? shown(params[name]) : hole));
}

/** A recorded action in a line, as the model reads what a replay did. */
function describeAction(action: RecordedAction): string {
  const target = action.target ? ` ${action.target.kind} ${JSON.stringify(action.target.name)}` : '';
  const input = Object.keys(action.input).length > 0 ? ` ${canonical(action.input)}` : '';
  return `- ${action.tool}${target}${input}`;
}

/**
 * The first turn of an act: the instruction with its holes filled, the
 * params, the test's steps before this one, what a replay did already, and
 * the screen.
 */
export function firstTurn(ctx: StepContext, view: string): Message {
  const {instruction, params} = ctx.step;
  const lines = [`Instruction: ${fillHoles(instruction, params)}`];
  const entries = Object.entries(params);
  if (entries.length > 0) {
    lines.push('', 'Params:', ...entries.map(([name, value]) => `- ${name}: ${shown(value)}${isSecret(value) ? `, a ${value.purpose === 'password' ? 'password' : 'secret'}: fill it with type_secret` : ''}`));
  }
  if (ctx.ledger.length > 0) lines.push('', 'The steps of this test before this one:', ...ctx.ledger.map((step, index) => `${index + 1}. ${step.kind} ${JSON.stringify(step.instruction)}: ${step.status}. ${step.summary}`));
  const replayed = ctx.replayedPrefix;
  if (replayed) {
    lines.push('', 'A replay of this step from the cache did these already:', ...replayed.actions.map(describeAction), `It stopped there (${replayed.reason}). Go on from the screen as it is now, without doing them again.`);
  }
  return {role: 'user', content: [text(lines.join('\n')), text(`The screen now:\n${view}`)]};
}

/** A Standard Schema's issues, as one line. */
const issuesOf = (issues: readonly {message: string}[]) => issues.map(issue => issue.message).join('; ');

/** A project's tool as the loop offers it: its input validated by its own schema, run through the step's budgets. */
export function projectTool(ctx: StepContext, tool: Tool): LoopTool {
  return {
    spec: {name: tool.name, description: tool.description, inputSchema: tool.inputSchema, strict: tool.strict},
    async run(input) {
      const standard = (tool.schema as Partial<StandardSchemaV1>)['~standard'];
      let value = input;
      if (standard) {
        const result = await standard.validate(input);
        if (result.issues) throw new HarnessError('INVALID_ARGUMENT', issuesOf(result.issues));
        value = result.value;
      }
      const context: ToolContext = {platform: ctx.target.platform, app: ctx.target.app, observe: async () => (await ctx.observe()).text, signal: ctx.signal};
      const answer = await ctx.budgets.runTool({name: tool.name, mutates: tool.mutates === true}, async () => tool.execute(value, context));
      return typeof answer === 'string' ? answer : answer === undefined ? 'done' : JSON.stringify(answer);
    },
  };
}

/** The grammar's tools on this step, each over the step's own actions. */
export function grammarLoopTools(ctx: StepContext): LoopTool[] {
  const secrets = Object.values(ctx.step.params).filter(isSecret).map(each => each.name);
  const {actions} = ctx;
  type Input = Record<string, unknown> & {ref: string};
  const runs: Record<string, (input: Input) => Promise<string | readonly (TextPart | ImagePart)[]>> = {
    tap: ({ref}) => actions.tap(ref),
    double_tap: ({ref}) => actions.doubleTap(ref),
    hover: ({ref}) => actions.hover(ref),
    select: ({ref, option}) => actions.select(ref, option as string),
    right_click: ({ref}) => actions.rightClick(ref),
    check: ({ref, checked}) => actions.check(ref, checked as boolean),
    long_press: ({ref, durationMs}) => actions.longPress(ref, durationMs as number | null),
    drag: ({ref, to}) => actions.drag(ref, to as string),
    type: ({ref, text: typed, replace}) => actions.type(ref, typed as string, replace as boolean),
    type_secret: ({ref, secret}) => actions.typeSecret(ref, secret as string),
    press: ({key}) => actions.press(key as string),
    scroll: ({direction, ref}) => actions.scroll(direction as Direction, ref),
    scroll_to: ({ref, text: label}) => actions.scrollTo({ref, text: label as string | null}),
    navigate: ({url}) => actions.navigate(url as string),
    back: () => actions.back(),
    dismiss_keyboard: () => actions.dismissKeyboard(),
    home: () => actions.home(),
    alert: ({action}) => actions.alert(action as 'accept' | 'dismiss'),
    tap_at: ({x, y}) => actions.tapAt(x as number, y as number),
    hover_at: ({x, y}) => actions.hoverAt(x as number, y as number),
    type_at: ({x, y, text: typed}) => actions.typeAt(x as number, y as number, typed as string),
    observe: async () => (await ctx.observe()).text,
    screenshot: async () => {
      const pixels = (await ctx.observe({pixels: true})).pixels as ImagePart | {withheld: string};
      if ('withheld' in pixels) throw new HarnessError('POLICY_DENIED', pixels.withheld);
      ctx.attachScreenshot('screenshot', pixels);
      return [text(`The screen, ${pixels.width} by ${pixels.height} pixels.`), pixels];
    },
  };
  return grammarTools({capabilities: new Set(ctx.target.verbs), secrets, pixels: ctx.target.pixels})
    .filter(spec => spec.name !== COMPLETE_STEP.name)
    .map(spec => ({spec, run: input => (runs[spec.name] as (input: Input) => ReturnType<LoopTool['run']>)(input as Input), acts: spec.name !== 'observe' && spec.name !== 'screenshot'}));
}

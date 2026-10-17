/**
 * A step's context: what an executor gets to run one step with. Its
 * actions are the hands', authorised, counted and recorded the same way for
 * the built-in loop and for any other executor, so none can go around the
 * policy, and its model counts each call against the step's budget.
 */
import type {Snapshot} from '../harness/lib/snapshot.ts';
import type {Platform} from '../harness/lib/types.ts';
import type {RecordedAction} from './cache.ts';
import {addUsage, costOf, NO_USAGE} from './cost.ts';
import {Hands} from './hands.ts';
import type {HandsOptions} from './hands.ts';
import type {AgentErrorCode, AgentStepKind, ImagePart, Message, Model, ReplayHandOffReason, TextPart, ToolResultPart, Usage} from './types.ts';
import {AgentError} from './types.ts';

/** How much of a limit a step has used. */
export interface Budget {
  readonly limit: number;
  readonly used: number;
}

/** A step of the test that came before, as the next step's first turn names it. */
export interface CompletedStep {
  kind: AgentStepKind;
  instruction: string;
  status: 'passed' | 'failed' | 'blocked';
  summary: string;
}

/** The screen, as the step reads it. */
export interface Observation {
  /** The view, redacted. */
  text: string;
  /** The tree under the step's refs. */
  tree: Snapshot;
  /** A picture, where one was asked for, or why none may leave. */
  pixels?: ImagePart | {withheld: string};
}

/** The hands' actions, each answering what changed on the screen. */
export type AuthorisedActions = Pick<
  Hands,
  | 'tap'
  | 'doubleTap'
  | 'longPress'
  | 'drag'
  | 'hover'
  | 'select'
  | 'rightClick'
  | 'upload'
  | 'type'
  | 'typeSecret'
  | 'press'
  | 'check'
  | 'scroll'
  | 'scrollTo'
  | 'navigate'
  | 'back'
  | 'home'
  | 'alert'
  | 'dismissKeyboard'
  | 'tapAt'
  | 'hoverAt'
  | 'typeAt'
>;

/** How an executor ends a step. */
export interface StepOutcome {
  status: 'passed' | 'failed' | 'blocked';
  summary: string;
  errorCode?: AgentErrorCode;
}

export interface StepContext {
  readonly step: {kind: AgentStepKind; instruction: string; params: Readonly<Record<string, unknown>>; index: number};
  /** What the step runs on: the platform, what it can do, whether a picture may leave, and the app. */
  readonly target: {platform: Platform; verbs: readonly string[]; pixels: boolean; app: {url?: string; scheme?: string}};
  observe(options?: {pixels?: boolean}): Promise<Observation>;
  readonly actions: AuthorisedActions;
  /** The step's model, each call counted against its budget. */
  readonly model?: Model;
  /** The agent's context, which every call reads. */
  readonly agentContext: string;
  /** The files the agent may hand a page with `upload`, by their paths from the project root. */
  readonly uploads?: readonly string[];
  /** The steps of this test so far. */
  readonly ledger: readonly CompletedStep[];
  readonly budgets: {
    readonly modelCalls: Budget;
    readonly actions: Budget;
    /** Runs a project's tool: a mutating one spends an action, ends what a replay can repeat, and may not look at the screen. */
    runTool<T>(meta: {name: string; mutates: boolean}, run: () => Promise<T>): Promise<T>;
  };
  readonly signal: AbortSignal;
  /** When the step must end, in ms since 1970. */
  readonly deadline: number;
  /** What a replay did before it handed the step over, and why it stopped; undefined where none ran. */
  readonly replayedPrefix: {actions: readonly RecordedAction[]; reason: ReplayHandOffReason} | undefined;
  attachTranscript(text: string): void;
  attachTurns(turns: readonly Message[]): void;
  attachScreenshot(label: string, image: ImagePart): void;
}

/** What a step did, for the result, the cost line, the cache and the evidence. */
export interface StepRecord {
  modelCalls: number;
  actions: number;
  usage: Usage;
  /** Dollars, from the price table; undefined where a model that answered is not in it. */
  costUsd: number | undefined;
  models: string[];
  recorded: readonly RecordedAction[];
  /** Where in `recorded` the first mutating tool ran, past which a replay cannot go. */
  truncatedAt?: number;
  transcript: string[];
  turns: readonly Message[];
  screenshots: {label: string; image: ImagePart}[];
}

export interface ContextOptions {
  step: StepContext['step'];
  target: StepContext['target'];
  /** What the hands are made with; their actions are spent against the step's budget. */
  hands: Omit<HandsOptions, 'spend'>;
  model?: Model;
  agentContext?: string;
  ledger?: readonly CompletedStep[];
  limits: {modelCalls: number; actions: number};
  deadline: number;
  /** The files the agent may hand a page, by their paths from the project root, and where each is. */
  uploads?: ReadonlyMap<string, string>;
}

/**
 * A step's context, what it did so far, and its hands, which a replay acts
 * through before the step is handed on with what it did.
 */
export function createStepContext(options: ContextOptions): {context: StepContext; record(): StepRecord; hands: Hands; handOff(prefix: NonNullable<StepContext['replayedPrefix']>): void} {
  const {at, signal} = options.hands;
  const modelCalls = {limit: options.limits.modelCalls, used: 0};
  const actions = {limit: options.limits.actions, used: 0};
  const spend = () => {
    if (actions.used >= actions.limit) throw new AgentError('STEP_BUDGET_EXHAUSTED', `it took ${actions.limit} actions, its budget`, at);
    actions.used += 1;
  };
  const hands = new Hands({...options.hands, spend, ...(options.uploads ? {uploads: options.uploads} : {})});
  let usage: Usage = NO_USAGE;
  let costUsd: number | undefined = 0;
  const models: string[] = [];
  let truncatedAt: number | undefined;
  let mutating = 0;
  const transcript: string[] = [];
  let turns: readonly Message[] = [];
  const screenshots: {label: string; image: ImagePart}[] = [];
  let replayedPrefix: StepContext['replayedPrefix'];

  // What leaves for the model is redacted as it is first sent, and kept, so a turn reads the same in every request after it.
  const cleaned = new WeakMap<Message, Message>();
  const hidePart = <Part extends TextPart | ImagePart | ToolResultPart>(part: Part): Part => {
    if (part.type === 'text') return {...part, text: hands.hide(part.text)};
    if (part.type === 'tool_result') return {...part, content: part.content.map(hidePart)};
    return part;
  };
  const clean = (message: Message): Message => {
    if (message.role === 'assistant') return message;
    const known = cleaned.get(message);
    if (known) return known;
    const done: Message = message.role === 'system' ? {role: 'system', content: hands.hide(message.content)} : {role: 'user', content: message.content.map(hidePart)};
    cleaned.set(message, done);
    return done;
  };

  const inner = options.model;
  const model: Model | undefined = inner && {
    id: inner.id,
    async complete(request) {
      if (modelCalls.used >= modelCalls.limit) throw new AgentError('STEP_BUDGET_EXHAUSTED', `it made ${modelCalls.limit} model calls, its budget`, at);
      modelCalls.used += 1;
      const completion = await inner.complete({...request, system: request.system.map(block => ({...block, text: hands.hide(block.text)})), messages: request.messages.map(clean)});
      usage = addUsage(usage, completion.usage);
      const cost = costOf(completion.model, completion.usage);
      costUsd = costUsd === undefined || cost === undefined ? undefined : costUsd + cost;
      models.push(completion.model);
      return completion;
    },
  };

  const context: StepContext = {
    step: options.step,
    target: options.target,
    async observe(asked = {}) {
      if (mutating > 0) throw new AgentError('POLICY_DENIED', 'a tool that changes the app may not look at the screen: look in a call of its own', at);
      const seen = await hands.observe();
      const pixels = asked.pixels ? await hands.screenshot() : undefined;
      return {text: seen.view, tree: seen.snapshot, ...(pixels ? {pixels} : {})};
    },
    actions: {
      tap: ref => hands.tap(ref),
      doubleTap: ref => hands.doubleTap(ref),
      longPress: (ref, durationMs) => hands.longPress(ref, durationMs),
      drag: (ref, to) => hands.drag(ref, to),
      hover: ref => hands.hover(ref),
      select: (ref, option) => hands.select(ref, option),
      rightClick: ref => hands.rightClick(ref),
      upload: (ref, file) => hands.upload(ref, file),
      type: (ref, text, replace) => hands.type(ref, text, replace),
      typeSecret: (ref, name) => hands.typeSecret(ref, name),
      press: key => hands.press(key),
      check: (ref, checked) => hands.check(ref, checked),
      scroll: (direction, ref) => hands.scroll(direction, ref),
      scrollTo: target => hands.scrollTo(target),
      navigate: url => hands.navigate(url),
      back: () => hands.back(),
      home: () => hands.home(),
      alert: action => hands.alert(action),
      dismissKeyboard: () => hands.dismissKeyboard(),
      tapAt: (x, y) => hands.tapAt(x, y),
      hoverAt: (x, y) => hands.hoverAt(x, y),
      typeAt: (x, y, text) => hands.typeAt(x, y, text),
    },
    ...(model ? {model} : {}),
    agentContext: options.agentContext ?? '',
    ...(options.uploads && options.uploads.size > 0 ? {uploads: [...options.uploads.keys()]} : {}),
    ledger: options.ledger ?? [],
    budgets: {
      modelCalls,
      actions,
      async runTool(meta, run) {
        if (!meta.mutates) return run();
        spend();
        truncatedAt ??= hands.recorded.length;
        mutating += 1;
        try {
          return await run();
        } finally {
          mutating -= 1;
        }
      },
    },
    signal,
    deadline: options.deadline,
    get replayedPrefix() {
      return replayedPrefix;
    },
    attachTranscript: text => void transcript.push(hands.hide(text)),
    attachTurns: given => void (turns = given),
    attachScreenshot: (label, image) => void screenshots.push({label, image}),
  };

  return {
    context,
    hands,
    handOff: prefix => void (replayedPrefix = prefix),
    record: () => ({
      modelCalls: modelCalls.used,
      actions: actions.used,
      usage,
      costUsd,
      models,
      recorded: hands.recorded,
      ...(truncatedAt === undefined ? {} : {truncatedAt}),
      transcript,
      turns,
      screenshots,
    }),
  };
}

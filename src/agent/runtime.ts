/**
 * The agent's runtime: the four calls over a device, each a step with its
 * own signal and its agent resolved, the screen read and redacted, the
 * cache looked up, replayed and recorded, and what the step cost said. The
 * device is a host it is given, so the whole of it runs in the unit tests
 * against a fake one; `expo-vitest/agent` gives it the device the test
 * file shares.
 */
import fs from 'node:fs';
import path from 'node:path';
import {format} from 'node:util';
import type {AgentNote, Journal, StepEvent} from '../device/evidence.ts';
import {resultsFolder} from '../device/evidence.ts';
import {isHarnessError} from '../harness/lib/errors.ts';
import type {CacheEntry, CacheSettings, RecordedAction} from './cache.ts';
import {CACHE_VERSION, cacheKey, cacheSettings, canonical, contextHash, endMatches, endOf, findTarget, fromSlots, keyParams, lookUp, paramsCollide, sameRoute, uniquesOf, writeEntry} from './cache.ts';
import type {HarnessAgents, ResolvedAgent} from './config.ts';
import {resolveAgent} from './config.ts';
import type {CompletedStep, StepOutcome} from './context.ts';
import {createStepContext} from './context.ts';
import {addUsage, cacheShare, costOf, NO_USAGE} from './cost.ts';
import {builtinExecutor, outcomeError} from './executors.ts';
import type {ActingHost, Aimed, HandsOptions} from './hands.ts';
import {Hands} from './hands.ts';
import type {Judged, Look, Verdict} from './judge.ts';
import {extract as extractValue, judge, verdictError, waitFor as waitUntil} from './judge.ts';
import {endsTheStep} from './loop.ts';
import {clearTaint, tainted} from './policy.ts';
import type {Redact} from './redact.ts';
import {redactor} from './redact.ts';
import {isSecret, SecretStore} from './secrets.ts';
import type {StepOf} from './step.ts';
import {stepSignal} from './step.ts';
import {toolsOn} from './tools.ts';
import type {
  ActOptions,
  ActResult,
  AgentStepKind,
  AssertOptions,
  CompletionRequest,
  ExtractOptions,
  ImagePart,
  Infer,
  JsonSchema,
  Model,
  ReplayHandOffReason,
  StandardSchemaV1,
  StepCacheInfo,
  Usage,
  VisionMode,
  WaitForOptions,
} from './types.ts';
import {AgentError, isAgentCode, isAgentError} from './types.ts';

/** What the runtime acts through: the device's hands' host, its journal, and what identifies the app. */
export interface AgentHost extends ActingHost {
  readonly journal: Journal;
  /** What the cache knows the app by: its bundle id, else its url. */
  readonly identity: string;
  readonly url?: string;
  /** The project's root, where `.harness/` is. */
  readonly root: string;
}

/** The test a step runs in. */
export interface TestOf {
  /** Its file, from the root, with forward slashes. */
  file: string;
  /** Its title path: its suites, then its name. */
  titlePath: string[];
  /** Which attempt this is: 0 for the first, more on a retry. */
  retry: number;
  /** The test's own signal, which aborts when it times out or the run is cancelled. */
  signal?: AbortSignal;
}

export interface RuntimeOptions {
  host: AgentHost;
  harness?: HarnessAgents | null;
  environment?: NodeJS.ProcessEnv;
  /** The test that is running. */
  test(): TestOf;
  /** Where the debug line and the runtime's notes go: stderr. */
  write?(text: string): void;
}

/** What a step's calls cost, as it goes. */
interface Meter {
  calls: number;
  usage: Usage;
  costUsd: number | undefined;
}

const ms = (value: number) => `${(value / 1000).toFixed(1)} s`;
const spaced = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const dollars = (cost: number | undefined) => (cost === undefined ? 'cost n/a' : `$${cost.toFixed(4)}`);

/**
 * The line `HARNESS_DEBUG` prints after each step: what it was, where, how
 * long it took, its calls and actions, the tokens and the share the cache
 * gave, what it cost, and how the cache served it.
 */
export function debugLine(step: {kind: AgentStepKind; instruction: string; platform: string; ms: number; calls: number; actions?: number; usage: Usage; costUsd: number | undefined; mode?: string}): string {
  const {usage} = step;
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
  return [
    'agent',
    step.kind,
    JSON.stringify(step.instruction),
    step.platform,
    ms(step.ms),
    plural(step.calls, 'call'),
    ...(step.actions === undefined ? [] : [plural(step.actions, 'action')]),
    `in ${spaced(prompt)} (cache ${Math.round(cacheShare(usage) * 100)}%)`,
    `out ${spaced(usage.output)}`,
    dollars(step.costUsd),
    ...(step.mode ? [step.mode] : []),
  ].join('  ');
}

/** An image part as the AI trace keeps it: its size, not its bytes. */
const imageShape = (part: ImagePart) => ({type: 'image', bytes: Buffer.byteLength(part.data, 'base64'), width: part.width, height: part.height});

/** A request as the AI trace keeps it: every text redacted, every image a size, the tools by name. */
export function traceRequest(request: CompletionRequest, redact: Redact): Record<string, unknown> {
  const part = (each: {type: string} & Record<string, unknown>): unknown => {
    if (each.type === 'image') return imageShape(each as unknown as ImagePart);
    if (each.type === 'text') return {type: 'text', text: redact(each.text as string)};
    if (each.type === 'tool_result') return {...each, content: (each.content as ({type: string} & Record<string, unknown>)[]).map(part)};
    // The one kind left is a tool call, whose input is the model's and can hold what it typed.
    return {...each, input: JSON.parse(redact(JSON.stringify(each.input ?? null)))};
  };
  return {
    system: request.system.map(block => redact(block.text)),
    messages: request.messages.map(message => (message.role === 'system' ? {role: 'system', content: redact(message.content)} : {role: message.role, content: (message.content as unknown as ({type: string} & Record<string, unknown>)[]).map(part)})),
    tools: request.tools.map(tool => tool.name),
  };
}

/** Whether an environment variable is set to something other than off. */
const on = (value: string | undefined) => Boolean(value) && value !== '0' && value !== 'false';

/** Anything a step threw, as its AgentError: the step's own as it is, a harness failure by its code, anything else ACTION_FAILED. */
function asAgentError(error: unknown, at: StepOf): AgentError {
  if (isAgentError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = isHarnessError(error) && isAgentCode(error.code) ? error.code : 'ACTION_FAILED';
  return new AgentError(code, message, {...at, cause: error});
}

/** A recorded input as a replay sends it: each slot with this run's value. */
const slotted = (input: Record<string, unknown>, uniques: Record<string, string>) => Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? fromSlots(value, uniques) : value]));

/** How deep the console's redaction is installed, and how to take it off. */
const consoleState: {depth: number; restore: (() => void) | null} = {depth: 0, restore: null};

/**
 * Hides every secret value in what is written to the console and to stdout
 * and stderr while `work` runs, and puts them back as they were after. Once
 * however many steps nest.
 */
export async function withRedactedOutput<T>(redact: () => Redact, work: () => Promise<T>): Promise<T> {
  consoleState.depth += 1;
  if (consoleState.depth === 1) {
    const kept = {log: console.log, info: console.info, warn: console.warn, error: console.error, out: process.stdout.write, err: process.stderr.write};
    const hidden =
      (write: (...args: unknown[]) => void) =>
      (...args: unknown[]) =>
        write(redact()(format(...args)));
    console.log = hidden(kept.log);
    console.info = hidden(kept.info);
    console.warn = hidden(kept.warn);
    console.error = hidden(kept.error);
    const stream = (stream: NodeJS.WriteStream, write: typeof process.stdout.write) =>
      ((chunk: unknown, ...rest: unknown[]) => (write as (...args: unknown[]) => boolean).call(stream, typeof chunk === 'string' ? redact()(chunk) : chunk, ...rest)) as typeof process.stdout.write;
    process.stdout.write = stream(process.stdout, kept.out);
    process.stderr.write = stream(process.stderr, kept.err);
    consoleState.restore = () => {
      Object.assign(console, {log: kept.log, info: kept.info, warn: kept.warn, error: kept.error});
      process.stdout.write = kept.out;
      process.stderr.write = kept.err;
    };
  }
  try {
    return await work();
  } finally {
    consoleState.depth -= 1;
    if (consoleState.depth === 0) {
      consoleState.restore?.();
      consoleState.restore = null;
    }
  }
}

const limitOf = (given: unknown, limit: number, what: string, at: StepOf): number => {
  if (given === undefined) return limit;
  if (typeof given !== 'number' || !Number.isInteger(given) || given < 1) throw new AgentError('INVALID_ARGUMENT', `${what} is ${String(given)}; it takes a whole number, 1 or more`, at);
  // An option may only lower the agent's own limit.
  return Math.min(given, limit);
};

const timeOf = (given: unknown, fallback: number, at: StepOf): number => {
  if (given === undefined) return fallback;
  if (typeof given !== 'number' || !Number.isFinite(given) || given <= 0) throw new AgentError('INVALID_ARGUMENT', `timeout is ${String(given)}; it takes a number of ms, more than 0`, at);
  return given;
};

/** The words a step was given, which must be words. */
function wordsOf(kind: AgentStepKind, given: unknown, what: string): string {
  if (typeof given === 'string' && given.trim()) return given;
  throw new AgentError('INVALID_ARGUMENT', `${kind} takes ${what}, in words`, {step: kind, instruction: String(given)});
}

export class AgentRuntime {
  readonly secrets: SecretStore;
  readonly cache: CacheSettings;
  private readonly host: AgentHost;
  private readonly harness: HarnessAgents;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly testOf: () => TestOf;
  private readonly write: (text: string) => void;
  private ledger: CompletedStep[] = [];
  private pending: {entry: CacheEntry; info: StepCacheInfo}[] = [];
  private pictures = 0;
  private index = 0;
  private hide: {known: number; redact: Redact} | null = null;

  constructor(options: RuntimeOptions) {
    this.host = options.host;
    this.harness = options.harness ?? {};
    this.environment = options.environment ?? process.env;
    this.testOf = options.test;
    this.write = options.write ?? (text => void process.stderr.write(text));
    this.secrets = new SecretStore(this.harness.secrets, this.environment);
    this.cache = cacheSettings(this.harness.cache, this.environment, this.host.root);
    // An act is recorded at the first check after it that passes.
    this.host.journal.onStep(step => {
      if (step.event === 'verified') this.recordPending();
    });
  }

  /** A test begins: its own ledger, nothing pending, nothing tainted. */
  begin(): void {
    this.ledger = [];
    this.pending = [];
    this.pictures = 0;
    this.index = 0;
    clearTaint();
  }

  /** A test ends: an act still pending was never seen to work, so it is not recorded, and its result says so. */
  end(): void {
    for (const {info} of this.pending) info.notRecorded = 'no-verification';
    this.pending = [];
  }

  /** Every secret value hidden, by the values known now, which a function's answer adds to. */
  private redact(): Redact {
    const known = this.secrets.known();
    if (!this.hide || this.hide.known !== known.length) this.hide = {known: known.length, redact: redactor(known)};
    return this.hide.redact;
  }

  /** Runs a step's work with the output redacted, where there are secrets to hide. */
  private guarded<T>(work: () => Promise<T>): Promise<T> {
    const configured = Object.keys(this.harness.secrets ?? {}).length > 0 || this.secrets.known().length > 0;
    return configured ? withRedactedOutput(() => this.redact(), work) : work();
  }

  private recordPending(): void {
    const ready = this.pending;
    this.pending = [];
    for (const {entry} of ready) {
      try {
        writeEntry(this.cache.dir, entry);
      } catch (error) {
        this.write(`expo-vitest: the cache entry for ${JSON.stringify(entry.instruction)} could not be written: ${(error as Error).message}\n`);
      }
    }
  }

  private agentFor(name: string | undefined, at: StepOf): ResolvedAgent {
    try {
      return resolveAgent(this.harness.agents, name ?? 'default');
    } catch (error) {
      throw new AgentError('INVALID_ARGUMENT', (error as Error).message, at);
    }
  }

  private handsOptions(at: StepOf, signal: AbortSignal, agent: ResolvedAgent, params: Record<string, unknown> = {}): Omit<HandsOptions, 'spend'> {
    return {host: this.host, at, signal, secrets: this.secrets, stepSecrets: Object.values(params).filter(isSecret), uniques: uniquesOf(params), maxObservationBytes: agent.maxObservationBytes, screenshotMaxSide: agent.screenshotMaxSide};
  }

  /** A model whose calls are counted on a meter, and kept in the AI trace under `HARNESS_AI_TRACE`. */
  private metered(model: Model, meter: Meter, step: {kind: AgentStepKind; index: number}, test: TestOf): Model {
    const tracing = on(this.environment.HARNESS_AI_TRACE);
    return {
      id: model.id,
      complete: async request => {
        const started = Date.now();
        const completion = await model.complete(request);
        meter.calls += 1;
        meter.usage = addUsage(meter.usage, completion.usage);
        const cost = costOf(completion.model, completion.usage);
        meter.costUsd = meter.costUsd === undefined || cost === undefined ? undefined : meter.costUsd + cost;
        if (tracing) {
          const redact = this.redact();
          const record = {
            at: new Date(started).toISOString(),
            test: [test.file, ...test.titlePath].join(' > '),
            step: {...step, turn: meter.calls},
            model: completion.model,
            request: traceRequest(request, redact),
            response: {stopReason: completion.stopReason, text: redact(completion.text), toolCalls: completion.toolCalls.map(call => ({name: call.name, input: JSON.parse(redact(JSON.stringify(call.input ?? null)))}))},
            usage: completion.usage,
            ...(cost === undefined ? {} : {costUsd: cost}),
            durationMs: Date.now() - started,
          };
          const file = path.join(this.host.root, '.harness', 'ai-trace.jsonl');
          fs.mkdirSync(path.dirname(file), {recursive: true});
          // A line a call, appended, so the workers of a run share the file without a lock.
          fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
        }
        return completion;
      },
    };
  }

  /** What a step leaves: its line in the journal's Agent section, the ledger's account, and the debug line. */
  private report(step: {kind: AgentStepKind; instruction: string; agent: string; status: CompletedStep['status']; summary: string; started: number; meter: Meter; actions?: number; mode?: string; turns?: string[]; picture?: AgentNote['picture']}): void {
    const {kind, instruction, meter} = step;
    this.ledger.push({kind, instruction, status: step.status, summary: step.summary});
    const costs = [plural(meter.calls, 'call'), ...(step.actions === undefined ? [] : [plural(step.actions, 'action')]), dollars(meter.costUsd), ...(step.mode ? [step.mode] : [])].join(' · ');
    this.host.journal.agents.push({kind, instruction, agent: step.agent, outcome: `${step.status}: ${step.summary} · ${costs}`, turns: step.turns ?? [], ...(step.picture ? {picture: step.picture} : {})});
    if (on(this.environment.HARNESS_DEBUG)) {
      this.write(`${debugLine({kind, instruction, platform: this.host.platform, ms: Date.now() - step.started, calls: meter.calls, ...(step.actions === undefined ? {} : {actions: step.actions}), usage: meter.usage, costUsd: meter.costUsd, ...(step.mode ? {mode: step.mode} : {})})}\n`);
    }
  }

  /**
   * An act: the instruction carried out by the agent's executor, or replayed
   * from the cache where a verified run of it was recorded, the model taking
   * over from where a replay stopped agreeing. A passing act is recorded at
   * the first check after it that passes.
   */
  async act(instruction: string, options: ActOptions = {}, name?: string): Promise<ActResult> {
    const words = wordsOf('act', instruction, 'an instruction: what to do');
    const at: StepOf = {step: 'act', instruction: words};
    const agent = this.agentFor(options.agent ?? name, at);
    const params = options.params ?? {};
    for (const each of Object.values(params)) {
      if (isSecret(each) && !this.secrets.has(each.name)) {
        throw new AgentError('SECRET_UNAVAILABLE', `the secret ${each.name} has no value: set HARNESS_SECRET_${each.name}, or give it under secrets in the harness config`, {...at, blocked: true});
      }
    }
    const limits = {modelCalls: limitOf(options.maxModelCalls, agent.maxModelCalls, 'maxModelCalls', at), actions: limitOf(options.maxSteps, agent.maxSteps, 'maxSteps', at)};
    const timeout = timeOf(options.timeout, agent.timeout, at);
    const test = this.testOf();
    const step = stepSignal(at, timeout, test.signal);
    const began = this.host.journal.time();
    const started = Date.now();
    const meter: Meter = {calls: 0, usage: NO_USAGE, costUsd: 0};
    const index = this.index;
    this.index += 1;
    const executor = agent.executor ?? builtinExecutor({...(agent.system ? {system: agent.system} : {}), tools: toolsOn(agent.tools, this.host.platform)});
    const made = createStepContext({
      step: {kind: 'act', instruction: words, params, index},
      target: {
        platform: this.host.platform,
        verbs: [...this.host.capabilities],
        pixels: !tainted() && this.host.capabilities.has('screenshot'),
        app: {...(this.host.url ? {url: this.host.url} : {}), ...(this.host.scheme ? {scheme: this.host.scheme} : {})},
      },
      hands: this.handsOptions(at, step.signal, agent, params),
      ...(agent.model ? {model: this.metered(agent.model, meter, {kind: 'act', index}, test)} : {}),
      agentContext: agent.context,
      ledger: [...this.ledger],
      limits,
      deadline: started + timeout,
    });
    let info: StepCacheInfo | undefined;
    let finished = false;
    const finish = (status: CompletedStep['status'], summary: string, result: 'ok' | 'failed') => {
      finished = true;
      const record = made.record();
      if (info) info.totalActions = info.mode === 'self-finalized' ? info.totalActions : record.recorded.length;
      this.host.journal.note({event: 'agent', what: `act ${JSON.stringify(words)}`, began, result, message: `${status}: ${summary}`});
      this.report({kind: 'act', instruction: words, agent: agent.name, status, summary, started, meter, actions: record.actions, ...(info ? {mode: info.mode} : {}), turns: record.transcript.slice(-8)});
      return record;
    };
    try {
      return await this.guarded(async () => {
        const before = await this.host.snapshot();
        const route = (await this.host.route?.()) ?? null;
        const caching = executor.cache !== 'off';
        const key = cacheKey({
          test: {file: test.file, title: test.titlePath.join(' > ')},
          platform: this.host.platform,
          instruction: words,
          params,
          agent: {name: agent.name, context: agent.context},
          app: {identity: this.host.identity},
          executor: {name: executor.name, version: executor.version},
        });
        const found = caching ? lookUp(this.cache, key, {retry: test.retry > 0, identity: this.host.identity, executor: {name: executor.name, version: executor.version}}) : null;
        let outcome: StepOutcome;
        if (found && 'entry' in found) {
          const replay = await this.replay(found.entry, made.hands, route, uniquesOf(params));
          if (!replay.reason) {
            info = {mode: 'self-finalized', replayedActions: replay.done.length, totalActions: found.entry.actions.length};
            outcome = {status: 'passed', summary: found.entry.summary};
          } else {
            if (this.cache.strict) {
              throw new AgentError('REPLAY_STALE', `its replay from the cache stopped after ${replay.done.length} of ${found.entry.actions.length} actions (${replay.reason}), and a strict cache hands no step to the model`, at);
            }
            info = {mode: 'agent-concluded', reason: replay.reason, replayedActions: replay.done.length, totalActions: 0};
            made.handOff({actions: replay.done, reason: replay.reason});
            outcome = await executor.runStep(made.context);
          }
        } else {
          if (found) info = {mode: 'missed', reason: found.miss, replayedActions: 0, totalActions: 0};
          outcome = await executor.runStep(made.context);
        }
        const failure = outcomeError(outcome, at);
        const record = finish(outcome.status, outcome.summary, failure ? 'failed' : 'ok');
        if (failure) throw failure;
        if (info && info.mode !== 'self-finalized' && this.cache.mode === 'read-write' && !this.cache.strict) {
          if (paramsCollide(params)) info.notRecorded = 'param-collision';
          else if (record.truncatedAt === 0) info.notRecorded = 'mutating-tool';
          else {
            const after = await this.host.snapshot();
            const entry: CacheEntry = {
              v: CACHE_VERSION,
              key,
              test: {file: test.file, title: test.titlePath.join(' > ')},
              platform: this.host.platform,
              instruction: words,
              params: keyParams(params),
              agent: {name: agent.name, contextHash: contextHash(agent.context)},
              app: {identity: this.host.identity},
              executor: {name: executor.name, version: executor.version},
              start: {route},
              actions: record.recorded.slice(0, record.truncatedAt ?? record.recorded.length),
              ...(record.truncatedAt === undefined ? {} : {truncated: true as const}),
              end: endOf(before, after, (await this.host.route?.()) ?? null),
              summary: outcome.summary,
              recordedAt: new Date().toISOString(),
              viewport: before.viewport ?? null,
            };
            this.pending.push({entry, info});
          }
        }
        return {summary: outcome.summary, ...(info ? {cache: info} : {}), modelCalls: record.modelCalls, actions: record.actions, ...(record.costUsd === undefined ? {} : {costUsd: record.costUsd})};
      });
    } catch (error) {
      const failed = asAgentError(error, at);
      // An outcome that did not pass was reported as the step finished; anything thrown is reported here.
      if (!finished) finish(failed.blocked ? 'blocked' : 'failed', failed.explanation, 'failed');
      throw failed;
    } finally {
      step.dispose();
    }
  }

  /**
   * A replay of an entry's actions through the step's own hands: the start
   * route, then each action's target found again by what it is, then the end
   * checks. The first that does not agree stops it, with the reason.
   */
  private async replay(entry: CacheEntry, hands: Hands, route: string | null, uniques: Record<string, string>): Promise<{done: RecordedAction[]; reason?: ReplayHandOffReason}> {
    const done: RecordedAction[] = [];
    if (!sameRoute(entry.start.route, route)) return {done, reason: 'end-mismatch'};
    for (const action of entry.actions) {
      if (action.tool === 'tap_at' && canonical((await this.host.snapshot()).viewport ?? null) !== canonical(entry.viewport)) return {done, reason: 'viewport-changed'};
      let aimed: Aimed | undefined;
      if (action.target) {
        const found = findTarget((await hands.observe()).snapshot, action.target);
        if ('miss' in found) return {done, reason: found.miss};
        aimed = await hands.aim(found.node.ref);
      }
      try {
        await hands.perform(action.tool, aimed, slotted(action.input, uniques));
      } catch (error) {
        if (endsTheStep(error)) throw error;
        return {done, reason: 'action-failed'};
      }
      done.push(action);
    }
    // What a mutating tool did, and all after it, is the model's to do again.
    if (entry.truncated) return {done, reason: 'gap'};
    const now = (await hands.observe()).snapshot;
    if (!endMatches(now, (await this.host.route?.()) ?? null, entry.end)) return {done, reason: 'end-mismatch'};
    return {done};
  }

  /** The screen for a judgment: the view, and a picture where vision asks for one and one may leave. */
  private async look(hands: Hands, vision: VisionMode | undefined, at: StepOf): Promise<Look> {
    const seen = await hands.observe();
    let image: ImagePart | undefined;
    if (vision) {
      const pixels = await hands.screenshot();
      if ('withheld' in pixels) {
        if (vision === 'only') throw new AgentError('POLICY_DENIED', `vision 'only' sends a picture of the screen alone, and none may leave: ${pixels.withheld}`, at);
      } else image = pixels;
    }
    return {snapshot: seen.snapshot, view: seen.view, ...(seen.route ? {route: seen.route} : {}), ...(image ? {image} : {})};
  }

  /** What every judgment starts from: its words, its agent and judge, its signal, its hands and its meter. */
  private judgment(kind: Exclude<AgentStepKind, 'act'>, given: unknown, what: string, options: {agent?: string; timeout?: number}, name: string | undefined) {
    const words = wordsOf(kind, given, what);
    const at: StepOf = {step: kind, instruction: words};
    const agent = this.agentFor(options.agent ?? name, at);
    if (!agent.judge) throw new AgentError('MODEL_UNAVAILABLE', `the agent ${agent.name} has no model to judge with; give it a model, or a judge, under agents in the harness config`, at);
    const timeout = timeOf(options.timeout, agent.judgmentTimeout, at);
    const test = this.testOf();
    const step = stepSignal(at, timeout, test.signal);
    const meter: Meter = {calls: 0, usage: NO_USAGE, costUsd: 0};
    const index = this.index;
    this.index += 1;
    const model = this.metered(agent.judge, meter, {kind, index}, test);
    const hands = new Hands(this.handsOptions(at, step.signal, agent));
    return {words, at, agent, step, meter, model, hands, test, started: Date.now()};
  }

  /**
   * A judgment run through the journal as a step of its kind and reported
   * however it ends. An assert or a waitFor that passes is a check that
   * held, which the journal is told, and an act pending before it recorded.
   */
  private async judged<T>(event: StepEvent, made: ReturnType<AgentRuntime['judgment']>, kind: Exclude<AgentStepKind, 'act'>, work: () => Promise<{value: T; summary: string; passed: boolean; error?: AgentError; picture?: AgentNote['picture']}>): Promise<T> {
    const {words, at, agent, step, meter, started} = made;
    let reported = false;
    try {
      const done = await this.host.journal.run({event, what: `agent: ${kind} ${JSON.stringify(words)}`}, () =>
        this.guarded(async () => {
          const outcome = await work();
          reported = true;
          this.report({kind, instruction: words, agent: agent.name, status: outcome.passed ? 'passed' : 'failed', summary: outcome.summary, started, meter, ...(outcome.picture ? {picture: outcome.picture} : {})});
          if (outcome.error) throw outcome.error;
          return outcome.value;
        }),
      );
      if (kind !== 'extract') this.host.journal.verified(`agent.${kind}(${JSON.stringify(words)})`);
      return done;
    } catch (error) {
      const failed = asAgentError(error, at);
      if (!reported) this.report({kind, instruction: words, agent: agent.name, status: failed.blocked ? 'blocked' : 'failed', summary: failed.explanation, started, meter});
      throw failed;
    } finally {
      step.dispose();
    }
  }

  /** An assertion about the screen, judged from what it shows now; a screenshot kept as evidence after the verdict, where one may be. */
  async assert(assertion: string, options: AssertOptions = {}, name?: string): Promise<void> {
    const made = this.judgment('assert', assertion, 'an assertion: what the screen should show', options, name);
    await this.judged('assert', made, 'assert', async () => {
      const look = await this.look(made.hands, options.vision, made.at);
      const verdict = await judge({kind: 'assert', statement: made.words, look, imageOnly: options.vision === 'only', context: made.agent.context, model: made.model, signal: made.step.signal});
      const picture = options.screenshot === false ? undefined : await this.keep(made.hands);
      const kept = picture ? path.join(resultsFolder(this.host.root, this.host.platform, made.test.file, made.test.titlePath), picture.name) : undefined;
      const error = verdictError(made.at, verdict, kept);
      return {value: undefined, summary: `${verdict.value}: ${verdict.explanation}`, passed: !error, ...(error ? {error} : {}), ...(picture ? {picture} : {})};
    });
  }

  /** A picture of the screen to keep as evidence, every secure field painted over, where one may be taken. */
  private async keep(hands: Hands): Promise<AgentNote['picture'] | undefined> {
    const pixels = await hands.screenshot();
    if ('withheld' in pixels) return undefined;
    this.pictures += 1;
    return {name: `agent-${this.pictures}.png`, png: Buffer.from(pixels.data, 'base64')};
  }

  /** A condition waited for: the screen looked at every interval, and judged only when it changed. */
  async waitFor(condition: string, options: WaitForOptions = {}, name?: string): Promise<void> {
    const made = this.judgment('waitFor', condition, 'a condition: what to wait for', options, name);
    await this.judged('wait', made, 'waitFor', async () => {
      const interval = options.interval ?? 3000;
      if (typeof interval !== 'number' || interval < 100 || interval > 60_000) throw new AgentError('INVALID_ARGUMENT', `interval is ${String(interval)}; it takes a number of ms from 100 to 60 000`, made.at);
      const maxModelCalls = limitOf(options.maxModelCalls, made.agent.maxModelCalls, 'maxModelCalls', made.at);
      const verdict: Judged<Verdict> = await waitUntil({
        statement: made.words,
        look: () => this.look(made.hands, options.vision, made.at),
        imageOnly: options.vision === 'only',
        context: made.agent.context,
        model: made.model,
        signal: made.step.signal,
        interval,
        maxModelCalls,
      });
      return {value: undefined, summary: `${verdict.value}: ${verdict.explanation}`, passed: true};
    });
  }

  /** A value read off the screen, as the schema allows; data the screen does not show is ASSERTION_INCONCLUSIVE. */
  async extract<S extends StandardSchemaV1 | JsonSchema>(instruction: string, options: ExtractOptions<S>, name?: string): Promise<Infer<S>> {
    const made = this.judgment('extract', instruction, 'what to read off the screen', options, name);
    return this.judged('assert', made, 'extract', async () => {
      const look = await this.look(made.hands, options.vision, made.at);
      const read = await extractValue({statement: made.words, look, imageOnly: options.vision === 'only', context: made.agent.context, model: made.model, signal: made.step.signal, schema: (options as {schema: StandardSchemaV1<Infer<S>> | JsonSchema}).schema});
      return {value: read.value as Infer<S>, summary: `read: ${made.hands.hide(JSON.stringify(read.value))}`, passed: true};
    });
  }
}

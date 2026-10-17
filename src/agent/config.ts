/**
 * The agent's part of the harness config: `agents`, `secrets` and `cache`,
 * checked when the file loads, so a mistake is named before a test runs,
 * and an entry resolved for a step with its defaults. An entry does not
 * inherit from `default`: each says all it means.
 */
import {HarnessError} from '../harness/lib/errors.ts';
import type {CacheConfig} from './cache.ts';
import type {StepExecutor} from './executors.ts';
import type {SecretSource} from './secrets.ts';
import {SECRET_FLOOR} from './secrets.ts';
import type {Tool} from './tools.ts';
import {isTool} from './tools.ts';
import type {Model} from './types.ts';

export interface AgentConfig {
  /** The model it acts with. */
  model?: Model;
  /** The model its judgments use: the model's own judge where it has one, else the model. */
  judge?: Model;
  /** Instructions the acting loop alone reads. */
  system?: string;
  /** What the app is, which every call reads, the judgments' too. At most 16 384 bytes. */
  context?: string;
  /** The project's tools. */
  tools?: readonly Tool[];
  /** An executor of the project's own, in place of the built-in loop. */
  executor?: StepExecutor;
  /** The actions an act may take, 1 to 100: 25. */
  maxSteps?: number;
  /** The model calls an act or a waitFor may make, 1 to 100: 25. */
  maxModelCalls?: number;
  /** How long an act may take, in ms: 120 000. */
  timeout?: number;
  /** How long an assert, a waitFor or an extract may take, in ms: 30 000. */
  judgmentTimeout?: number;
  /** The most a view of the screen may take, in bytes: 262 144. */
  maxObservationBytes?: number;
  /** The long side of a screenshot the model sees, in pixels: 768. */
  screenshotMaxSide?: number;
  /**
   * The most a model call may read, in tokens, what the provider cached
   * included. Once one call has read that many, the step makes no other,
   * since an act's conversation only grows: STEP_BUDGET_EXHAUSTED. No limit
   * but the model's own unless set.
   */
  maxInputTokens?: number;
  /** Options for the model's provider, by the provider's name, sent with every call it makes: `{anthropic: {metadata: {user_id: 'ci'}}}`. */
  providerOptions?: ProviderOptions;
  /**
   * Files of the project the model may hand a page's file input, with
   * `upload`, by their paths from the project root. None unless given,
   * so a model never chooses a file of its own.
   */
  uploads?: readonly string[];
}

/** Options for a model's provider, by the provider's name, which its adapter reads its own key of. */
export type ProviderOptions = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** The harness config's keys for the agent. */
export interface HarnessAgents {
  /** The agents by name; `default` runs a step that names none. */
  agents?: Record<string, AgentConfig>;
  /** The secrets' values by name, or functions that answer them; `HARNESS_SECRET_<NAME>` beats both. */
  secrets?: SecretSource;
  /** Whether a verified act is recorded and replayed: `read-write` locally and `read-only` in CI unless set. */
  cache?: CacheConfig;
}

export const AGENT_DEFAULTS = {maxSteps: 25, maxModelCalls: 25, timeout: 120_000, judgmentTimeout: 30_000, maxObservationBytes: 262_144, screenshotMaxSide: 768};
/** The most an agent's context may take, in bytes, since every call reads it. */
export const MAX_CONTEXT_BYTES = 16_384;

const AGENT_KEYS = ['model', 'judge', 'system', 'context', 'tools', 'executor', 'maxSteps', 'maxModelCalls', 'timeout', 'judgmentTimeout', 'maxObservationBytes', 'screenshotMaxSide', 'maxInputTokens', 'providerOptions', 'uploads'];
const AGENT_NAME = /^[A-Za-z][\w-]*$/;
const SECRET_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const MODES = ['off', 'read-only', 'read-write'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether something is a model: an id, and a function to complete with. */
export function isModel(value: unknown): value is Model {
  return isObject(value) && typeof value.id === 'string' && typeof value.complete === 'function';
}

const isExecutor = (value: unknown): value is StepExecutor => isObject(value) && typeof value.name === 'string' && typeof value.version === 'string' && typeof value.runStep === 'function';
const whole = (value: unknown, least: number, most = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most;

/** A value as a message names it. */
function shown(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return 'a function';
  if (isObject(value)) return 'an object';
  return String(value);
}

/** What an agent's field should have been, or null where it is that. */
const CHECKS: Record<string, (value: unknown) => string | null> = {
  model: value => (isModel(value) ? null : 'a model: an object with an id and a complete function, as anthropic() answers'),
  judge: value => (isModel(value) ? null : 'a model: an object with an id and a complete function, as anthropic() answers'),
  system: value => (typeof value === 'string' ? null : 'a string'),
  context: value => (typeof value !== 'string' ? 'a string' : Buffer.byteLength(value) > MAX_CONTEXT_BYTES ? `at most ${MAX_CONTEXT_BYTES} bytes, since every call reads it` : null),
  tools: value => (Array.isArray(value) && value.every(isTool) ? null : 'a list of tools made with defineTool'),
  executor: value => (isExecutor(value) ? null : 'an executor: an object with a name, a version and a runStep function'),
  maxSteps: value => (whole(value, 1, 100) ? null : 'a whole number from 1 to 100'),
  maxModelCalls: value => (whole(value, 1, 100) ? null : 'a whole number from 1 to 100'),
  timeout: value => (whole(value, 1) ? null : 'a whole number of ms, 1 or more'),
  judgmentTimeout: value => (whole(value, 1) ? null : 'a whole number of ms, 1 or more'),
  maxObservationBytes: value => (whole(value, 1024) ? null : 'a whole number of bytes, 1024 or more'),
  screenshotMaxSide: value => (whole(value, 64, 4096) ? null : 'a whole number of pixels from 64 to 4096'),
  maxInputTokens: value => (whole(value, 1) ? null : 'a whole number of tokens, 1 or more'),
  providerOptions: value => (isObject(value) && Object.values(value).every(isObject) ? null : "an object of each provider's options by its name, such as {anthropic: {metadata: {user_id: 'ci'}}}"),
  uploads: value => (Array.isArray(value) && value.every(each => typeof each === 'string' && each !== '') ? null : "a list of files' paths from the project root"),
};

/**
 * The agent's keys of a loaded harness config, checked: each agent's
 * fields, each secret's value, and the cache's mode. The first that is
 * wrong is an INVALID_CONFIG that names it.
 */
export function checkAgentKeys(config: HarnessAgents, file: string): void {
  const wrong = (at: string, value: unknown, takes: string) => new HarnessError('INVALID_CONFIG', `${file}: ${at} is ${shown(value)}; it takes ${takes}`);
  const {agents, secrets, cache} = config;
  if (agents !== undefined) {
    if (!isObject(agents)) throw wrong('agents', agents, 'an object of agents by name');
    for (const [name, entry] of Object.entries(agents)) {
      if (!AGENT_NAME.test(name)) throw new HarnessError('INVALID_CONFIG', `${file}: agents.${name} is not a name an agent can have: a letter, then letters, digits, _ and -`);
      if (!isObject(entry)) throw wrong(`agents.${name}`, entry, 'an object');
      for (const [key, value] of Object.entries(entry)) {
        const check = CHECKS[key];
        if (!check) throw new HarnessError('INVALID_CONFIG', `${file}: agents.${name}.${key} is not something an agent takes; it takes ${AGENT_KEYS.join(', ')}`);
        const takes = value === undefined ? null : check(value);
        if (takes) throw wrong(`agents.${name}.${key}`, value, takes);
      }
      if (entry.executor !== undefined && (entry.system !== undefined || entry.tools !== undefined)) {
        throw new HarnessError('INVALID_CONFIG', `${file}: agents.${name} has an executor, which brings its own prompt and tools; give it system and tools, or the executor, not both`);
      }
    }
  }
  if (secrets !== undefined) {
    if (!isObject(secrets)) throw wrong('secrets', secrets, 'an object of secrets by name');
    for (const [name, value] of Object.entries(secrets)) {
      if (!SECRET_NAME.test(name)) throw new HarnessError('INVALID_CONFIG', `${file}: secrets.${name} is not a secret's name: a letter, then letters, digits and underscores`);
      if (value !== undefined && typeof value !== 'string' && typeof value !== 'function') throw wrong(`secrets.${name}`, value, 'a string, or a function that answers one');
      if (typeof value === 'string' && value.length < SECRET_FLOOR) {
        throw new HarnessError('INVALID_CONFIG', `${file}: secrets.${name} is shorter than ${SECRET_FLOOR} characters, so hiding it would hide ordinary words too`);
      }
    }
  }
  if (cache !== undefined) {
    const mode = isObject(cache) ? cache.mode : cache;
    const fits = (typeof cache === 'string' && MODES.includes(cache)) || (isObject(cache) && Object.keys(cache).every(key => ['mode', 'dir', 'strict'].includes(key)) && (mode === undefined || MODES.includes(mode as string)) && (cache.dir === undefined || typeof cache.dir === 'string') && (cache.strict === undefined || typeof cache.strict === 'boolean'));
    if (!fits) throw wrong('cache', cache, "'off', 'read-only' or 'read-write', or {mode, dir, strict}");
  }
}

/** An agent as a step runs it: its fields, and the defaults of what it leaves out. */
export interface ResolvedAgent {
  name: string;
  model?: Model;
  judge?: Model;
  system?: string;
  context: string;
  tools: readonly Tool[];
  executor?: StepExecutor;
  maxSteps: number;
  maxModelCalls: number;
  timeout: number;
  judgmentTimeout: number;
  maxObservationBytes: number;
  screenshotMaxSide: number;
  maxInputTokens?: number;
  providerOptions?: ProviderOptions;
  uploads?: readonly string[];
}

/**
 * The agent a step runs with, by name. Its judge is the one it names, else
 * its model's own judge, as `anthropic()` gives one, else its model. With
 * no `agents` at all, `default` is an agent with no model, and a step that
 * needs one says so; with agents, a name they have not got, `default`
 * among them, is INVALID_ARGUMENT.
 */
export function resolveAgent(agents: Record<string, AgentConfig> | undefined, name: string): ResolvedAgent {
  const entry = agents?.[name];
  if (!entry && (name !== 'default' || agents !== undefined)) {
    const names = Object.keys(agents ?? {});
    throw new HarnessError('INVALID_ARGUMENT', `there is no agent called ${name}; the harness config's agents are ${names.length > 0 ? names.join(', ') : 'none'}`);
  }
  const {model, judge, system, context, tools, executor, ...limits} = entry ?? {};
  const own = (model as {judge?: unknown} | undefined)?.judge;
  const judging = judge ?? (isModel(own) ? own : model);
  return {
    name,
    ...(model ? {model} : {}),
    ...(judging ? {judge: judging} : {}),
    ...(system ? {system} : {}),
    context: context ?? '',
    tools: tools ?? [],
    ...(executor ? {executor} : {}),
    ...AGENT_DEFAULTS,
    ...Object.fromEntries(Object.entries(limits).filter(([, value]) => value !== undefined)),
  };
}

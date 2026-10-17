/**
 * The agent's public shapes: the four calls' options and results, the model
 * interface a provider implements, and `AgentError`, which every call throws.
 */
import {HarnessError, isHarnessError} from '../harness/lib/errors.ts';
import type {Platform} from '../harness/lib/types.ts';

export type AgentStepKind = 'act' | 'assert' | 'waitFor' | 'extract';

/** `true` adds a screenshot to what the model reads, `'only'` sends the screenshot alone. */
export type VisionMode = boolean | 'only';

/** The codes an agent step fails with, e2e's, with the same meanings. */
export const AGENT_CODES = [
  'ASSERTION_FAILED',
  'ASSERTION_INCONCLUSIVE',
  'ACTION_FAILED',
  'LOCATOR_NOT_FOUND',
  'LOCATOR_AMBIGUOUS',
  'STEP_BUDGET_EXHAUSTED',
  'STEP_TIMEOUT',
  'STEP_NO_CONCLUSION',
  'CONTEXT_OVERFLOW',
  'MODEL_UNAVAILABLE',
  'MODEL_PROVIDER_FAILED',
  'MODEL_OUTPUT_INVALID',
  'POLICY_DENIED',
  'SECRET_UNAVAILABLE',
  'AUTOMATION_UNSUPPORTED',
  'UNSUPPORTED_CAPABILITY',
  'INVALID_ARGUMENT',
  'REPLAY_STALE',
  'CANCELLED',
  'APP_NOT_OPEN',
  'AUTHENTICATION_FAILED',
] as const;
export type AgentErrorCode = (typeof AGENT_CODES)[number];

/** The codes a step ends with when it could not go on, rather than finding the app wrong. */
export const BLOCKED_CODES = ['AUTOMATION_UNSUPPORTED', 'AUTHENTICATION_FAILED', 'APP_NOT_OPEN', 'SECRET_UNAVAILABLE', 'POLICY_DENIED', 'UNSUPPORTED_CAPABILITY'] as const;
export type BlockedCode = (typeof BLOCKED_CODES)[number];

export function isAgentCode(value: unknown): value is AgentErrorCode {
  return (AGENT_CODES as readonly unknown[]).includes(value);
}

export function isBlockedCode(value: unknown): value is BlockedCode {
  return (BLOCKED_CODES as readonly unknown[]).includes(value);
}

/**
 * What an agent step throws. A `HarnessError`, so a test that catches those
 * catches these, with the step it came from, the model's explanation where
 * it gave one, and whether the step was blocked rather than failed.
 */
export class AgentError extends HarnessError {
  /** What went wrong, in a sentence a person can act on. */
  readonly explanation: string;
  /** Whether the step could not go on, as when the app asked for a login the test gave no secret for. */
  readonly blocked: boolean;
  readonly step: AgentStepKind;
  /** The step's instruction, assertion or condition, as the test wrote it. */
  readonly instruction: string;
  /** A screenshot kept when the step ended, where one was. */
  declare readonly screenshot?: string;

  constructor(
    code: AgentErrorCode,
    explanation: string,
    options: {step: AgentStepKind; instruction: string; blocked?: boolean; screenshot?: string; platform?: Platform; cause?: unknown},
  ) {
    super(code, `agent.${options.step}(${JSON.stringify(options.instruction)}): ${explanation}`, {
      ...(options.platform ? {platform: options.platform} : {}),
      ...(options.cause === undefined ? {} : {cause: options.cause}),
    });
    this.explanation = explanation;
    this.blocked = options.blocked ?? false;
    this.step = options.step;
    this.instruction = options.instruction;
    if (options.screenshot) this.screenshot = options.screenshot;
  }
}

/** Whether something thrown is an agent step's failure. By its fields, as `isHarnessError` goes by its name, since two copies of this package hold two classes. */
export function isAgentError(error: unknown): error is AgentError {
  if (!isHarnessError(error)) return false;
  const {explanation, blocked, step} = error as Partial<AgentError>;
  return typeof explanation === 'string' && typeof blocked === 'boolean' && typeof step === 'string';
}

/** A JSON Schema, as a plain object. */
export type JsonSchema = Record<string, unknown>;

/** A Standard Schema v1 validator: Zod, Valibot, ArkType and the rest. */
export interface StandardSchemaV1<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: {readonly input: unknown; readonly output: Output};
    /** Standard JSON Schema: the validator's JSON Schema, where it can say. */
    readonly jsonSchema?: {output(options: {target: string}): JsonSchema};
  };
}
export type StandardResult<Output> =
  | {readonly value: Output; readonly issues?: undefined}
  | {readonly issues: readonly {readonly message: string; readonly path?: readonly (PropertyKey | {readonly key: PropertyKey})[]}[]};

/** What `extract` answers for a schema: the validator's output, or what JSON Schema allows. */
export type Infer<S> = S extends StandardSchemaV1<infer Output> ? Output : unknown;

/** A secret's handle: its name and what it is for. Its value is the runner's alone, and no property holds it. */
export interface Secret {
  readonly kind: 'secret';
  readonly name: string;
  /** A password goes into a password field only. */
  readonly purpose: 'password' | 'generic';
}

/** A value the test makes new each run, such as an email address, which a replay fills in afresh. */
export interface Unique {
  readonly kind: 'unique';
  readonly value: string;
}

export interface AgentOption {
  /** A name under `agents` in harness.config.ts. The block's agent, then `default`, when absent. */
  agent?: string;
}

export interface ActOptions extends AgentOption {
  params?: Record<string, string | number | boolean | Secret | Unique>;
  /** In ms. 120 000 unless the agent says otherwise. */
  timeout?: number;
  /** Action steps. 25, and an option may only lower the agent's value. */
  maxSteps?: number;
  /** Model calls. 25, and an option may only lower it. */
  maxModelCalls?: number;
}

export interface AssertOptions extends AgentOption {
  vision?: VisionMode;
  /** In ms. 30 000 unless the agent's `judgmentTimeout` says otherwise. */
  timeout?: number;
  /** A screenshot kept as evidence after the verdict. On unless pixels are withheld. */
  screenshot?: boolean;
}

export interface WaitForOptions extends AgentOption {
  vision?: VisionMode;
  timeout?: number;
  /** How often the screen is looked at, 100 to 60 000 ms, 3 000 by default. */
  interval?: number;
  maxModelCalls?: number;
}

export interface ExtractOptions<S> extends AgentOption {
  /** A Standard Schema v1 validator, or a JSON Schema object. */
  schema: S;
  vision?: VisionMode;
  timeout?: number;
}

/** Why a step's lookup found nothing to replay. */
export type ReplayMissReason = 'retry' | 'no-entry' | 'invalid-entry' | 'truncated' | 'wrong-context';
/** Why a replay stopped and handed the rest of the step to the model. */
export type ReplayHandOffReason = 'gap' | 'target-not-found' | 'target-ambiguous' | 'viewport-changed' | 'action-failed' | 'action-uncertain' | 'end-mismatch';

export interface StepCacheInfo {
  /** Replayed to the end with no model call, finished by the model after a hand-off, or not replayed. */
  mode: 'self-finalized' | 'agent-concluded' | 'missed';
  reason?: ReplayMissReason | ReplayHandOffReason;
  notRecorded?: 'param-collision' | 'mutating-tool' | 'no-verification';
  replayedActions: number;
  totalActions: number;
}

export interface ActResult {
  summary: string;
  cache?: StepCacheInfo;
  modelCalls: number;
  /** Actions performed, as e2e counts them: the model's actions and the mutating tool calls. */
  actions: number;
  /** Dollars for this step, from the price table, absent where a model it used is not in the table. */
  costUsd?: number;
}

// The model interface, provider neutral.

export interface SystemBlock {
  text: string;
  /** Where a provider that caches places a breakpoint. */
  cache?: boolean;
}
export interface TextPart {
  type: 'text';
  text: string;
}
export interface ImagePart {
  type: 'image';
  mediaType: 'image/png';
  /** Base64. */
  data: string;
  width: number;
  height: number;
}
export interface ToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultPart {
  type: 'tool_result';
  toolUseId: string;
  content: readonly (TextPart | ImagePart)[];
  isError?: boolean;
}
export type Message =
  | {role: 'user'; content: readonly (TextPart | ImagePart | ToolResultPart)[]}
  | {role: 'assistant'; content: readonly (TextPart | ToolUsePart)[]; raw?: unknown}
  | {role: 'system'; content: string};

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Whether the schema is strict, so a provider may hold the model to it. */
  strict?: boolean;
}

export interface CompletionRequest {
  /** The stable blocks first, the volatile last. */
  system: readonly SystemBlock[];
  messages: readonly Message[];
  tools: readonly ToolSpec[];
  /** For extract: the model answers with JSON this schema allows, instead of calling a tool. */
  format?: JsonSchema;
  /** `low` for judgments, `medium` for acting, unless the agent says otherwise. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  /** The agent's options for the model's provider, by the provider's name: an adapter reads its own key, and passes it on in its request. */
  providerOptions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  signal: AbortSignal;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Completion {
  text: string;
  toolCalls: readonly {id: string; name: string; input: unknown}[];
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  usage: Usage;
  /** The model that answered, which a fallback may have changed. */
  model: string;
  /** The provider's own assistant turn, which the loop sends back as it came. */
  raw?: unknown;
  /** Why the provider stopped, in its own words, where it says: a refusal's category. */
  detail?: string;
}

/** A model: any provider, as an object with one method. */
export interface Model {
  readonly id: string;
  complete(request: CompletionRequest): Promise<Completion>;
}

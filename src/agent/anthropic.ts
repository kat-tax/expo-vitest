/**
 * The Claude adapter: a `Model` over `@anthropic-ai/sdk`, an optional peer
 * this package does not depend on, loaded from the project under test at
 * the first call. The request and the reply are pure functions of each
 * other's shapes, so what is sent is pinned by the unit tests without a
 * network call; the SDK only carries it.
 */
import {createRequire} from 'node:module';
import path from 'node:path';
import {HarnessError} from '../harness/lib/errors.ts';
import type {Completion, CompletionRequest, ImagePart, JsonSchema, Message, Model, TextPart, ToolResultPart} from './types.ts';

export type Effort = NonNullable<CompletionRequest['effort']>;

/** The model an agent acts with unless it names another. */
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** The most a turn may write, its thinking included, unless the agent says otherwise. */
export const DEFAULT_MAX_TOKENS = 16_000;
/** The beta the `fallbacks: 'default'` form of server-side fallback needs. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Models with no server-side fallback: a declined request stays declined, and the parameter would only cost a check. */
const NO_FALLBACK = new Set(['claude-haiku-5-5']);
/** Models that take no system message within the conversation, where a nudge goes in the user's turn instead. */
const NO_SYSTEM_ROLE = new Set(['claude-haiku-5-5', 'claude-sonnet-5']);

export interface AnthropicOptions {
  /** `claude-opus-5-5` unless named. */
  model?: string;
  /** How hard the acting model thinks: what the step asks, `medium` by default. */
  effort?: Effort;
  /** The judgments' model: a model's name, or a `Model` of any provider. The same model unless named. */
  judge?: string | Model;
  /** How hard the judge thinks: `low` unless set. */
  judgeEffort?: Effort;
  /** Anthropic's server-side fallback, which reruns a declined request on another model in the same call: `'default'`, or false for none. */
  fallbacks?: 'default' | false;
  /** The most a turn may write, its thinking included. */
  maxTokens?: number;
  /** A client of the SDK's own, in place of `new Anthropic()`. */
  client?: unknown;
}

/** A Claude model, and the model its judgments use. */
export interface ClaudeModel extends Model {
  readonly judge: Model;
}

/** What the adapter needs of the SDK's client. */
interface Client {
  beta: {messages: {create(body: Record<string, unknown>, options: {signal: AbortSignal}): Promise<Reply>}};
}

/** The parts of a reply the adapter reads. */
export interface Reply {
  model: string;
  content: readonly ({type: string} & Record<string, unknown>)[];
  stop_reason: string | null;
  stop_details?: {category?: string | null; explanation?: string | null} | null;
  usage: {input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null};
}

/** How one request is made. */
export interface RequestSettings {
  model: string;
  effort: Effort;
  maxTokens: number;
  fallbacks: boolean;
  /** Whether the model takes a system message within the conversation. */
  systemRole: boolean;
}

/** The constraints structured outputs do not take; what is sent leaves them out, and the step checks the value itself. */
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties'];

/**
 * A schema as a strict tool or structured outputs take it: every object
 * closed with `additionalProperties: false`, and the constraints they do
 * not take left out, all the way down.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED.includes(key)) continue;
    if ((key === 'properties' || key === '$defs' || key === 'definitions') && typeof value === 'object' && value !== null) {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, JsonSchema>).map(([name, each]) => [name, strictSchema(each)]));
    } else if (key === 'items' && typeof value === 'object' && value !== null && !Array.isArray(value)) out[key] = strictSchema(value as JsonSchema);
    else if ((key === 'anyOf' || key === 'allOf' || key === 'oneOf' || key === 'prefixItems') && Array.isArray(value)) out[key] = (value as JsonSchema[]).map(strictSchema);
    else out[key] = value;
  }
  if (out.type === 'object' || 'properties' in out) out.additionalProperties = false;
  return out;
}

const imageOf = (part: ImagePart) => ({type: 'image', source: {type: 'base64', media_type: part.mediaType, data: part.data}});
const textOf = (part: TextPart) => ({type: 'text', text: part.text});
const reminder = (content: string) => ({type: 'text', text: `<system-reminder>\n${content}\n</system-reminder>`});

function userPart(part: TextPart | ImagePart | ToolResultPart): Record<string, unknown> {
  if (part.type === 'text') return textOf(part);
  if (part.type === 'image') return imageOf(part);
  return {type: 'tool_result', tool_use_id: part.toolUseId, content: part.content.map(each => (each.type === 'text' ? textOf(each) : imageOf(each))), ...(part.isError ? {is_error: true} : {})};
}

/**
 * The messages as the API takes them. The provider's own assistant turn is
 * sent as it came, thinking blocks and all. A system message follows the
 * user's turn it came after; on a model that takes none, it goes at the end
 * of that turn as a reminder, the same way every time, so the prefix is the
 * same from one request to the next.
 */
export function messagesOf(messages: readonly Message[], systemRole: boolean): {role: string; content: unknown}[] {
  const out: {role: string; content: unknown}[] = [];
  for (const message of messages) {
    const last = out.at(-1);
    if (message.role === 'system') {
      if (last?.role === 'user' && systemRole) out.push({role: 'system', content: message.content});
      else if (last?.role === 'user') last.content = [...(last.content as unknown[]), reminder(message.content)];
      else out.push({role: 'user', content: [reminder(message.content)]});
    } else if (message.role === 'assistant') {
      out.push({role: 'assistant', content: message.raw ?? message.content.map(part => (part.type === 'text' ? textOf(part) : {type: 'tool_use', id: part.id, name: part.name, input: part.input}))});
    } else out.push({role: 'user', content: message.content.map(userPart)});
  }
  return out;
}

/**
 * The request, as `client.beta.messages.create` takes it. No `thinking`:
 * on these models it is always on, and effort is the control. Tools in
 * name order and the system blocks byte for byte the same between turns,
 * with a breakpoint on the last system block and the automatic one on the
 * tail, so the cached prefix grows with the conversation. `tool_choice` is
 * `auto`: forced tool use is a 400 on these models.
 */
export function buildRequest(request: CompletionRequest, settings: RequestSettings): Record<string, unknown> {
  const tools = [...request.tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(tool => ({name: tool.name, description: tool.description, input_schema: tool.strict ? strictSchema(tool.inputSchema) : tool.inputSchema, ...(tool.strict ? {strict: true} : {})}));
  return {
    model: settings.model,
    max_tokens: settings.maxTokens,
    ...(settings.fallbacks ? {betas: [FALLBACK_BETA], fallbacks: 'default'} : {}),
    output_config: {effort: settings.effort, ...(request.format ? {format: {type: 'json_schema', schema: strictSchema(request.format)}} : {})},
    system: request.system.map(block => ({type: 'text', text: block.text, ...(block.cache ? {cache_control: {type: 'ephemeral'}} : {})})),
    ...(tools.length > 0 ? {tools, tool_choice: {type: 'auto'}} : {}),
    messages: messagesOf(request.messages, settings.systemRole),
    cache_control: {type: 'ephemeral'},
  };
}

const STOPS: Record<string, Completion['stopReason']> = {end_turn: 'end', stop_sequence: 'end', tool_use: 'tool_use', max_tokens: 'max_tokens', refusal: 'refusal'};

/**
 * A reply as a completion. The stop reason is read before the content, and
 * the content by block type, never by place, since a reply can begin with
 * thinking blocks whose text is empty. The model is the one that answered,
 * which after a server-side fallback is the substitute, so its price is
 * the one that applies.
 */
export function parseCompletion(reply: Reply): Completion {
  const stopReason = STOPS[reply.stop_reason ?? ''] ?? 'other';
  const blocks = reply.content;
  const text = blocks.flatMap(block => (block.type === 'text' ? [block.text as string] : [])).join('');
  const toolCalls = blocks.flatMap(block => (block.type === 'tool_use' ? [{id: block.id as string, name: block.name as string, input: block.input}] : []));
  const declined = stopReason === 'refusal' ? [reply.stop_details?.category, reply.stop_details?.explanation].filter(Boolean).join(': ') : '';
  const {usage} = reply;
  return {
    text,
    toolCalls,
    stopReason,
    usage: {input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0},
    model: reply.model,
    raw: blocks,
    ...(declined ? {detail: declined} : {}),
  };
}

/** Where a 400 says the request is more than the model can read. */
const OVERFLOW = /prompt is too long|context window|context length/i;

/** An SDK error as the step's: by its HTTP status, as the SDK's classes are told apart. */
export function failureOf(error: unknown, model: string): HarnessError {
  const status = (error as {status?: unknown} | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403) return new HarnessError('MODEL_UNAVAILABLE', `the Claude API refused this account (${status}): ${message}; set ANTHROPIC_API_KEY, or sign in with ant auth login`, {cause: error});
  if (status === 404) return new HarnessError('MODEL_UNAVAILABLE', `${model} is not a model this account can use (404): ${message}`, {cause: error});
  if (status === 413 || (status === 400 && OVERFLOW.test(message))) return new HarnessError('CONTEXT_OVERFLOW', `the request is more than ${model} can read: ${message}`, {cause: error});
  return new HarnessError('MODEL_PROVIDER_FAILED', typeof status === 'number' ? `the Claude API answered ${status}: ${message}` : `the Claude API could not be reached: ${message}`, {cause: error});
}

/** The SDK's client, from the project under test. */
function sdkClient(): Client {
  const root = path.resolve(process.env.HARNESS_ROOT ?? process.cwd());
  let sdk: {default?: new () => Client};
  try {
    sdk = createRequire(path.join(root, 'package.json'))('@anthropic-ai/sdk') as {default?: new () => Client};
  } catch {
    throw new HarnessError('MODEL_UNAVAILABLE', '@anthropic-ai/sdk is not installed in this project; add it with npm install --save-dev @anthropic-ai/sdk');
  }
  const Anthropic = sdk.default ?? (sdk as unknown as new () => Client);
  try {
    return new Anthropic();
  } catch (error) {
    throw new HarnessError('MODEL_UNAVAILABLE', `the Claude API client could not be made: ${(error as Error).message}`, {cause: error});
  }
}

const status400 = (error: unknown, pattern: RegExp) => (error as {status?: unknown} | null)?.status === 400 && pattern.test(error instanceof Error ? error.message : '');

/** One Claude model, over a client the judge shares. */
function claude(id: string, settings: {effort?: Effort; fallback: Effort; fallbacks: boolean; maxTokens?: number; client: () => Client}): Model {
  // What the API told this run it does not take, kept for the rest of it.
  let fallbacks = settings.fallbacks && !NO_FALLBACK.has(id);
  let systemRole = !NO_SYSTEM_ROLE.has(id);
  return {
    id,
    async complete(request) {
      const client = settings.client();
      for (;;) {
        const body = buildRequest(request, {model: id, effort: settings.effort ?? request.effort ?? settings.fallback, maxTokens: request.maxTokens ?? settings.maxTokens ?? DEFAULT_MAX_TOKENS, fallbacks, systemRole});
        try {
          return parseCompletion(await client.beta.messages.create(body, {signal: request.signal}));
        } catch (error) {
          if (request.signal.aborted) throw error;
          if (systemRole && status400(error, /role 'system' is not supported/)) systemRole = false;
          else if (fallbacks && status400(error, /fallback/i)) {
            fallbacks = false;
            process.stderr.write(`expo-vitest: the Claude API here takes no server-side fallback, so ${id} runs without one; a declined step is not rerun on another model\n`);
          } else throw failureOf(error, id);
        }
      }
    },
  };
}

/**
 * A Claude model for the agent, and its judge. Credentials come through
 * the SDK's own chain: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an
 * `ant auth login` profile. A declined request is rerun server-side on
 * Anthropic's recommended substitute unless `fallbacks` is false.
 */
export function anthropic(options: AnthropicOptions = {}): ClaudeModel {
  let made: Client | undefined;
  const client = () => (made ??= (options.client as Client | undefined) ?? sdkClient());
  const shared = {fallbacks: options.fallbacks !== false, ...(options.maxTokens ? {maxTokens: options.maxTokens} : {}), client};
  const acting = claude(options.model ?? DEFAULT_MODEL, {...shared, ...(options.effort ? {effort: options.effort} : {}), fallback: 'medium'});
  const judge =
    typeof options.judge === 'object' ? options.judge : claude(options.judge ?? acting.id, {...shared, ...(options.judgeEffort ? {effort: options.judgeEffort} : {}), fallback: 'low'});
  return {...acting, judge};
}

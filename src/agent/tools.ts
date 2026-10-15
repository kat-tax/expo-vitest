/**
 * The tools the model acts with. The grammar's are offered only where the
 * device can do what each does, so the model is never told of a step the
 * platform cannot take. A project adds its own with `defineTool`. Every
 * schema is strict: no property beyond those named, each one required, an
 * optional one typed as a union with null.
 */
import {HarnessError} from '../harness/lib/errors.ts';
import type {Platform} from '../harness/lib/types.ts';
import {RESERVED_TOOLS} from './policy.ts';
import type {JsonSchema, StandardSchemaV1, ToolSpec} from './types.ts';
import {AGENT_CODES} from './types.ts';

const string = (description: string): JsonSchema => ({type: 'string', description});
const orNull = (schema: JsonSchema): JsonSchema => ({anyOf: [schema, {type: 'null'}]});
/** A strict object: every property required, nothing else allowed. */
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
const ref = string('The ref of a node in the newest view, as @e7.');

/** What the grammar's tools need offered: what the device can do, the secrets of the step, and whether a picture may leave. */
export interface GrammarOptions {
  capabilities: ReadonlySet<string>;
  /** The names of the secrets in the step's params, which type_secret may fill. */
  secrets: readonly string[];
  pixels: boolean;
}

/** The grammar's tools this step may use, sorted by name, as a request wants them for its cached prefix. */
export function grammarTools(options: GrammarOptions): ToolSpec[] {
  const can = (capability: string) => options.capabilities.has(capability);
  const tools: ToolSpec[] = [];
  const add = (name: string, description: string, properties: Record<string, JsonSchema>) => tools.push({name, description, inputSchema: object(properties), strict: true});
  if (can('press')) {
    add('tap', 'Press the node a ref names.', {ref});
    add('check', 'Set a checkbox, a switch or a radio the ref names to checked or not, pressing it only where it is not so already.', {ref, checked: {type: 'boolean'}});
  }
  if (can('longPress')) add('long_press', 'Press and hold the node a ref names.', {ref, durationMs: orNull({type: 'integer', description: 'How long to hold, in ms; 800 when null.'})});
  if (can('fill')) add('type', 'Put text into the field a ref names: in place of what it holds where replace is true, after it otherwise.', {ref, text: string('What to type.'), replace: {type: 'boolean'}});
  if (can('fill') && options.secrets.length > 0) {
    add('type_secret', 'Fill the field a ref names with a secret of the step, by its name. The runner types the value; you never see it.', {ref, secret: {type: 'string', enum: [...options.secrets]}});
  }
  if (can('key')) add('press', 'Send a named key where the focus is: Enter, Tab, Escape, ArrowDown and the rest.', {key: string('The key, as Enter or ArrowDown.')});
  if (can('swipe')) {
    add('scroll', 'Scroll the screen, or the node a ref names, in a direction.', {direction: {type: 'string', enum: ['up', 'down', 'left', 'right']}, ref: orNull(ref)});
    add('scroll_to', 'Scroll until a node is in view: the node a ref names, or one with this text.', {ref: orNull(ref), text: orNull(string('Text on the node to bring into view.'))});
  }
  if (can('open')) add('navigate', "Open a URL, or a route of the app's, as /settings.", {url: string('An http or https URL, about:blank, a route, or a link in the app\'s own scheme.')});
  if (can('back')) add('back', 'Go back, as the back button does.', {});
  if (can('dismissKeyboard')) add('dismiss_keyboard', 'Close the on-screen keyboard.', {});
  add('observe', 'Read the whole screen again, when the last view or diff is not enough to go on.', {});
  if (options.pixels) {
    add('screenshot', 'See a picture of the screen, for what the view cannot say, such as a colour or an image.', {});
    if (can('press')) add('tap_at', 'Press a point of the last screenshot, for what the view has no node for.', {x: {type: 'number'}, y: {type: 'number'}});
  }
  add('complete_step', 'End the step: passed where the instruction is done and you checked it, failed where the app does not do it, blocked where you could not go on.', {
    status: {type: 'string', enum: ['passed', 'failed', 'blocked']},
    summary: string('What you did and what the screen shows now, in a sentence or two.'),
    errorCode: orNull({type: 'string', enum: [...AGENT_CODES], description: 'Why, for a failed or blocked step.'}),
  });
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

/** What a project's tool is given besides its input. */
export interface ToolContext {
  platform: Platform;
  app: {url?: string; scheme?: string};
  /** The screen as the model reads it. A mutating tool may not look: observation and side effects go in separate calls. */
  observe(): Promise<string>;
  signal: AbortSignal;
}

export interface ToolDefinition<Input> {
  name: string;
  description: string;
  /** A JSON Schema, or a Standard Schema that gives one, as Zod 4's does. */
  schema: JsonSchema | StandardSchemaV1<Input>;
  /** Whether it changes the app's state. A mutating call spends an action, and ends what a replay can repeat. */
  mutates?: boolean;
  /** The platforms it is offered on; every one when absent. */
  platforms?: readonly Platform[];
  execute(input: Input, context: ToolContext): unknown;
}

export interface Tool<Input = unknown> extends ToolDefinition<Input> {
  readonly kind: 'tool';
  readonly inputSchema: JsonSchema;
  /** Whether the schema is strict, so a provider may hold the model to it. */
  readonly strict: boolean;
}

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** A project's tool, checked: a name of its own, a schema the model can be given. */
export function defineTool<Input>(definition: ToolDefinition<Input>): Tool<Input> {
  const {name} = definition;
  if (!TOOL_NAME.test(name)) throw new HarnessError('INVALID_ARGUMENT', `${JSON.stringify(name)} is not a tool's name: lower case letters, digits and underscores, starting with a letter, 64 at most`);
  if (RESERVED_TOOLS.includes(name)) throw new HarnessError('INVALID_ARGUMENT', `${name} is the name of one of the agent's own tools; give the tool another`);
  if (!definition.description?.trim()) throw new HarnessError('INVALID_ARGUMENT', `the tool ${name} has no description, which is how the model knows when to call it`);
  const inputSchema = jsonSchemaOf(definition.schema, `the tool ${name}`);
  return Object.freeze({...definition, kind: 'tool' as const, inputSchema, strict: isStrict(inputSchema)});
}

export function isTool(value: unknown): value is Tool {
  return typeof value === 'object' && value !== null && (value as {kind?: unknown}).kind === 'tool' && typeof (value as {execute?: unknown}).execute === 'function';
}

/** A schema as JSON Schema: a plain one as it is, a Standard Schema's by its own account. ArkType's are functions, with the standard on them. */
export function jsonSchemaOf(schema: unknown, whose: string): JsonSchema {
  const standard = schema ? (schema as Partial<StandardSchemaV1>)['~standard'] : undefined;
  if (!standard) {
    if (typeof schema !== 'object' || schema === null) throw new HarnessError('INVALID_ARGUMENT', `${whose}'s schema is neither a Standard Schema nor a JSON Schema object`);
    return schema as JsonSchema;
  }
  if (standard.jsonSchema) return standard.jsonSchema.output({target: 'draft-07'});
  throw new HarnessError('INVALID_ARGUMENT', `${whose}'s schema is a Standard Schema that gives no JSON Schema; give it one, or a JSON Schema object`);
}

/** Whether a schema is strict at its top: an object, nothing beyond its properties, each one required. */
export function isStrict(schema: JsonSchema): boolean {
  if (schema.type !== 'object' || schema.additionalProperties !== false) return false;
  const properties = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {});
  const required = (schema.required as unknown[] | undefined) ?? [];
  return properties.every(property => required.includes(property));
}

/** The project's tools offered on a platform. */
export function toolsOn(tools: readonly Tool[], platform: Platform): Tool[] {
  return tools.filter(tool => !tool.platforms || tool.platforms.includes(platform));
}

const typeOf = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);

/**
 * What is wrong with a value against a JSON Schema: the part of the
 * standard a tool's input and an extracted value need, the types, `enum`,
 * `const`, `required`, `properties`, `additionalProperties: false`, `items`
 * and `anyOf`. Empty where it fits.
 */
export function checkJson(schema: JsonSchema, value: unknown, at = '$'): string[] {
  if (Array.isArray(schema.anyOf)) {
    const fits = (schema.anyOf as JsonSchema[]).some(each => checkJson(each, value, at).length === 0);
    return fits ? [] : [`${at} fits none of the shapes it may take`];
  }
  const issues: string[] = [];
  const type = schema.type as string | string[] | undefined;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    const actual = typeOf(value);
    const fits = types.some(each => each === actual || (each === 'number' && actual === 'integer'));
    if (!fits) return [`${at} is ${actual === 'object' ? 'an object' : actual === 'array' ? 'an array' : actual}, where ${types.join(' or ')} is wanted`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(each => JSON.stringify(each) === JSON.stringify(value))) issues.push(`${at} is ${JSON.stringify(value)}, not one of ${schema.enum.map(each => JSON.stringify(each)).join(', ')}`);
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) issues.push(`${at} is ${JSON.stringify(value)}, not ${JSON.stringify(schema.const)}`);
  if (typeOf(value) === 'object') {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const name of (schema.required as string[] | undefined) ?? []) if (!(name in record)) issues.push(`${at}.${name} is missing`);
    for (const [name, each] of Object.entries(record)) {
      if (properties[name]) issues.push(...checkJson(properties[name], each, `${at}.${name}`));
      else if (schema.additionalProperties === false) issues.push(`${at}.${name} is not a property it takes`);
    }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((each, index) => issues.push(...checkJson(schema.items as JsonSchema, each, `${at}[${index}]`)));
  }
  return issues;
}

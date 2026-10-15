/**
 * What an MCP session's `call` runs: the agent's own tools, over a step
 * context that lasts the session, so a coding agent acts by the rules the
 * agent acts by. A node's ref stays its own for the session, a secret is
 * typed by the runner and hidden in every answer, a picture stops after a
 * secret is filled, and a tool the platform cannot offer is not in the
 * catalog. Each answer is text a model reads.
 */
import {describeQuery, resolve} from '../../device/queries.ts';
import type {LocatorQuery, Predicate} from '../../device/queries.ts';
import {createStepContext} from '../../agent/context.ts';
import type {ActingHost} from '../../agent/hands.ts';
import type {LoopTool} from '../../agent/loop.ts';
import {grammarLoopTools, projectTool} from '../../agent/loop.ts';
import {tainted} from '../../agent/policy.ts';
import type {SecretStore} from '../../agent/secrets.ts';
import {secret} from '../../agent/secrets.ts';
import type {Tool} from '../../agent/tools.ts';
import {checkJson} from '../../agent/tools.ts';
import type {JsonSchema} from '../../agent/types.ts';
import type {Snapshot} from '../lib/snapshot.ts';

/** A tool as `tools` lists it. */
export interface Listed {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** What a tool answers, as MCP's tools/call result has it. */
export interface ToolAnswer {
  content: ({type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string})[];
  isError?: true;
  structuredContent?: Record<string, unknown>;
}

export interface Catalog {
  /** The tools, in name order. */
  list(): Listed[];
  /** Runs one, its failure an answer the model reads rather than a thrown error. */
  call(name: string, args: unknown): Promise<ToolAnswer>;
  /** The screen, for open_session. */
  observe(): Promise<{text: string; tree: Snapshot}>;
}

export interface CatalogOptions {
  host: ActingHost;
  secrets: SecretStore;
  /** The project's tools, for the session's platform. */
  tools?: readonly Tool[];
  signal: AbortSignal;
  /** Where the session's taint is kept: its own. */
  taintStore?: object;
}

const text = (value: string): ToolAnswer => ({content: [{type: 'text', text: value}]});
const failure = (code: string, message: string): ToolAnswer => ({content: [{type: 'text', text: `${code}: ${message}`}], isError: true});

const PREDICATES: readonly Predicate[] = ['role', 'text', 'label', 'placeholder', 'testId'];

/** `locate`: the nodes a device test's query finds, and the screen.* call to write for one. */
const LOCATE: Listed = {
  name: 'locate',
  description: 'Find nodes as a device test finds them, and the screen.* call that finds one: give one of role, text, label, placeholder or testId, and name with a role.',
  inputSchema: {
    type: 'object',
    properties: {
      role: {type: 'string'},
      text: {type: 'string'},
      label: {type: 'string'},
      placeholder: {type: 'string'},
      testId: {type: 'string'},
      name: {type: 'string', description: "With role: the node's accessible name."},
    },
    additionalProperties: false,
  },
};

/** Where a query finds several nodes, the call that finds each one alone: by its test id where each has its own, by its name where those differ, else by its place. */
export function narrowings(query: LocatorQuery, found: readonly {testId?: string; name: string}[]): string[] {
  const one = {...query, cardinality: 'one' as const};
  const unique = (values: readonly (string | undefined)[]) => values.every(value => value) && new Set(values).size === values.length;
  if (unique(found.map(each => each.testId))) return found.map(each => `screen.getByTestId(${JSON.stringify(each.testId)})`);
  if (query.predicate === 'role' && query.options.name === undefined && unique(found.map(each => each.name))) return found.map(each => `screen.${describeQuery({...one, options: {name: each.name}})}`);
  return found.map((_, index) => `screen.${describeQuery({...one, refinements: [{nth: index}]})}`);
}

/** The nodes a `locate` finds, and what to write: the call for one, the calls that tell several apart, or the names near a miss. */
export function locate(args: Record<string, unknown>, tree: Snapshot): Record<string, unknown> {
  const given = PREDICATES.filter(predicate => typeof args[predicate] === 'string');
  if (given.length !== 1) throw Object.assign(new Error(`locate takes one of ${PREDICATES.join(', ')}, not ${given.length > 0 ? given.join(' and ') : 'none'}`), {code: 'INVALID_ARGUMENT'});
  const predicate = given[0] as Predicate;
  if (args.name !== undefined && predicate !== 'role') throw Object.assign(new Error('locate takes name with a role alone'), {code: 'INVALID_ARGUMENT'});
  const query: LocatorQuery = {predicate, match: args[predicate] as string, options: args.name === undefined ? {} : {name: args.name as string}, refinements: [], cardinality: 'many'};
  const found = resolve(query, tree);
  const matches = found.map(node => ({ref: node.ref, kind: node.kind ?? node.role, name: node.name, ...(node.testId ? {testId: node.testId} : {})}));
  if (found.length === 1) return {count: 1, suggestion: `screen.${describeQuery({...query, cardinality: 'one'})}`, matches};
  if (found.length > 1) return {count: found.length, suggestions: narrowings(query, found), matches};
  // The names there, that a typo is one turn from.
  const wanted = String(query.match).toLowerCase();
  const near = [...new Set(tree.nodes.map(node => node.name).filter(name => name && (name.toLowerCase().includes(wanted) || wanted.includes(name.toLowerCase()))))].slice(0, 6);
  return {count: 0, ...(near.length > 0 ? {near} : {}), matches};
}

/**
 * A strict schema's input as a caller may give it: an optional property, one
 * that may be null, left out, is null, so `{ref}` is a whole long_press.
 */
export function filled(schema: JsonSchema, args: unknown): unknown {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return args;
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const nullable = (each: JsonSchema) => Array.isArray(each.anyOf) && (each.anyOf as JsonSchema[]).some(option => option.type === 'null');
  return Object.fromEntries([...Object.entries(properties).flatMap(([name, each]) => (name in args || !nullable(each) ? [] : [[name, null]])), ...Object.entries(args)]);
}

/** A session's catalog, over its hands. */
export function createCatalog(options: CatalogOptions): Catalog {
  const {host, secrets, signal} = options;
  const taintStore = options.taintStore ?? {};
  // Every secret the config has, which the session's params hold, so type_secret may fill each.
  const params = Object.fromEntries(secrets.names().map(name => [name, secret(name)]));
  const at = {step: 'act' as const, instruction: 'an MCP session'};
  const {context, hands} = createStepContext({
    step: {kind: 'act', instruction: at.instruction, params, index: 0},
    target: {platform: host.platform, verbs: [...host.capabilities], pixels: host.capabilities.has('screenshot'), app: host.scheme ? {scheme: host.scheme} : {}},
    hands: {host, at, signal, secrets, stepSecrets: Object.values(params), taintStore},
    limits: {modelCalls: 0, actions: Number.MAX_SAFE_INTEGER},
    deadline: Number.POSITIVE_INFINITY,
  });
  const loopTools: LoopTool[] = [...grammarLoopTools(context), ...(options.tools ?? []).map(tool => projectTool(context, tool))];
  const byName = new Map(loopTools.map(tool => [tool.spec.name, tool]));
  const listed: Listed[] = [...loopTools.map(({spec}) => ({name: spec.name, description: spec.description, inputSchema: spec.inputSchema})), LOCATE].sort((a, b) => a.name.localeCompare(b.name));

  /** An error as the model reads it, a node gone and a picture after a secret by e2e's names for them. */
  const answerFor = (error: unknown): ToolAnswer => {
    const message = hands.hide(error instanceof Error ? error.message : String(error));
    const given = (error as {code?: unknown} | null)?.code;
    const code = typeof given === 'string' ? given : 'TOOL_FAILED';
    if (code === 'LOCATOR_NOT_FOUND' && /is not on the screen now/.test(message)) return failure('NODE_STALE', message);
    if (code === 'POLICY_DENIED' && tainted(taintStore)) return failure('PIXEL_TAINTED', message);
    // An agent's error names the step it is in, which a session has none of.
    return failure(code, message.replace(/^agent\.act\("an MCP session"\): /, ''));
  };

  return {
    list: () => listed,
    async observe() {
      const seen = await context.observe();
      return {text: seen.text, tree: seen.tree};
    },
    async call(name, args) {
      try {
        if (name === LOCATE.name) {
          const found = locate((args ?? {}) as Record<string, unknown>, (await context.observe()).tree);
          return {...text(hands.hide(JSON.stringify(found))), structuredContent: found};
        }
        const tool = byName.get(name);
        if (!tool) return failure('UNKNOWN_TOOL', `there is no tool called ${name}; the tools are ${listed.map(each => each.name).join(', ')}`);
        const input = filled(tool.spec.inputSchema, args ?? {});
        const issues = checkJson(tool.spec.inputSchema, input);
        if (issues.length > 0) return failure('INVALID_ARGUMENT', issues.join('; '));
        const answer = await tool.run(input);
        if (typeof answer === 'string') return text(hands.hide(answer));
        return {content: answer.map(part => (part.type === 'text' ? {type: 'text' as const, text: hands.hide(part.text)} : {type: 'image' as const, data: part.data, mimeType: part.mediaType}))};
      } catch (error) {
        return answerFor(error);
      }
    },
  };
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {anthropic, buildRequest, DEFAULT_MAX_TOKENS, DEFAULT_MODEL, FALLBACK_BETA, failureOf, messagesOf, parseCompletion, strictSchema} from './anthropic.ts';
import type {Reply, RequestSettings} from './anthropic.ts';
import type {CompletionRequest, ImagePart, Message, Model, ToolSpec} from './types.ts';

const signal = new AbortController().signal;
const image: ImagePart = {type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=', width: 768, height: 432};
const strict = (properties: Record<string, unknown>) => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
const tap: ToolSpec = {name: 'tap', description: 'Press the node a ref names.', inputSchema: strict({ref: {type: 'string'}}), strict: true};
const observe: ToolSpec = {name: 'observe', description: 'Read the whole screen again.', inputSchema: strict({}), strict: true};
const seed: ToolSpec = {name: 'seed_cart', description: 'Seed the cart.', inputSchema: {type: 'object', properties: {sku: {type: 'string'}}}};
const settings: RequestSettings = {model: 'claude-opus-5-5', effort: 'medium', maxTokens: 16_000, fallbacks: true, systemRole: true};

const reply = (extra: Partial<Reply> = {}): Reply => ({model: 'claude-opus-5-5', content: [{type: 'text', text: 'Done.'}], stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 2}, ...extra});

describe('the request', () => {
  it('is the shape the adapter sends, field for field', () => {
    const request: CompletionRequest = {
      system: [{text: 'core'}, {text: 'About the app:\nA shop.', cache: true}],
      messages: [{role: 'user', content: [{type: 'text', text: 'Instruction: buy a shirt'}]}],
      tools: [tap, seed, observe],
      effort: 'low',
      maxTokens: 8000,
      signal,
    };
    expect(buildRequest(request, settings)).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16_000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: {effort: 'medium'},
      system: [
        {type: 'text', text: 'core'},
        {type: 'text', text: 'About the app:\nA shop.', cache_control: {type: 'ephemeral'}},
      ],
      tools: [
        {name: 'observe', description: 'Read the whole screen again.', input_schema: strict({}), strict: true},
        {name: 'seed_cart', description: 'Seed the cart.', input_schema: {type: 'object', properties: {sku: {type: 'string'}}}},
        {name: 'tap', description: 'Press the node a ref names.', input_schema: strict({ref: {type: 'string'}}), strict: true},
      ],
      tool_choice: {type: 'auto'},
      messages: [{role: 'user', content: [{type: 'text', text: 'Instruction: buy a shirt'}]}],
      cache_control: {type: 'ephemeral'},
    });
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
  });

  it('asks for the format as a closed JSON Schema, and offers no tools where there are none', () => {
    const body = buildRequest({system: [], messages: [], tools: [], format: {type: 'object', properties: {total: {type: 'number', minimum: 0}}, required: ['total']}, signal}, {...settings, fallbacks: false});
    expect(body.output_config).toEqual({effort: 'medium', format: {type: 'json_schema', schema: {type: 'object', properties: {total: {type: 'number'}}, required: ['total'], additionalProperties: false}}});
    expect(['tools' in body, 'tool_choice' in body, 'betas' in body, 'fallbacks' in body]).toEqual([false, false, false, false]);
  });
});

describe('a schema made strict', () => {
  it('closes every object, all the way down, and leaves out the constraints the API does not take', () => {
    expect(
      strictSchema({
        type: 'object',
        properties: {
          name: {type: 'string', minLength: 1, maxLength: 80},
          tags: {type: 'array', items: {type: 'object', properties: {label: {type: 'string'}}}, minItems: 1},
          size: {anyOf: [{type: 'integer', minimum: 1, maximum: 9}, {type: 'null'}]},
          pair: {type: 'array', prefixItems: [{type: 'string'}, {type: 'number', multipleOf: 2}], items: false},
          tuple: {type: 'array', items: [{type: 'string'}]},
        },
        $defs: {money: {properties: {cents: {type: 'integer', exclusiveMinimum: 0}}}},
        additionalProperties: true,
      }),
    ).toEqual({
      type: 'object',
      properties: {
        name: {type: 'string'},
        tags: {type: 'array', items: {type: 'object', properties: {label: {type: 'string'}}, additionalProperties: false}},
        size: {anyOf: [{type: 'integer'}, {type: 'null'}]},
        pair: {type: 'array', prefixItems: [{type: 'string'}, {type: 'number'}], items: false},
        tuple: {type: 'array', items: [{type: 'string'}]},
      },
      $defs: {money: {properties: {cents: {type: 'integer'}}, additionalProperties: false}},
      additionalProperties: false,
    });
  });
});

describe('the messages', () => {
  const history: Message[] = [
    {role: 'user', content: [{type: 'text', text: 'Instruction: sign in'}, image]},
    {role: 'assistant', content: [{type: 'tool_use', id: 'toolu_1', name: 'screenshot', input: {}}], raw: [{type: 'thinking', thinking: '', signature: 'sig'}, {type: 'tool_use', id: 'toolu_1', name: 'screenshot', input: {}}]},
    {role: 'user', content: [{type: 'tool_result', toolUseId: 'toolu_1', content: [{type: 'text', text: 'The screen.'}, image]}]},
    {role: 'system', content: 'Call complete_step now.'},
    {role: 'assistant', content: [{type: 'text', text: 'Pressing it.'}, {type: 'tool_use', id: 'toolu_2', name: 'tap', input: {ref: '@e5'}}]},
    {role: 'user', content: [{type: 'tool_result', toolUseId: 'toolu_2', content: [{type: 'text', text: 'LOCATOR_NOT_FOUND'}], isError: true}]},
  ];
  const base64 = {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo='}};

  it("are the API's: images in base64, the provider's own turn as it came, the loop's turn where there is none, and a system message where the model takes one", () => {
    expect(messagesOf(history, true)).toEqual([
      {role: 'user', content: [{type: 'text', text: 'Instruction: sign in'}, base64]},
      {role: 'assistant', content: history[1]?.role === 'assistant' ? history[1].raw : null},
      {role: 'user', content: [{type: 'tool_result', tool_use_id: 'toolu_1', content: [{type: 'text', text: 'The screen.'}, base64]}]},
      {role: 'system', content: 'Call complete_step now.'},
      {role: 'assistant', content: [{type: 'text', text: 'Pressing it.'}, {type: 'tool_use', id: 'toolu_2', name: 'tap', input: {ref: '@e5'}}]},
      {role: 'user', content: [{type: 'tool_result', tool_use_id: 'toolu_2', content: [{type: 'text', text: 'LOCATOR_NOT_FOUND'}], is_error: true}]},
    ]);
  });

  it('put a system message at the end of the turn before it, as a reminder, on a model that takes none, or in a turn of its own where none comes before', () => {
    const merged = messagesOf(history, false);
    expect(merged[2]).toEqual({
      role: 'user',
      content: [{type: 'tool_result', tool_use_id: 'toolu_1', content: [{type: 'text', text: 'The screen.'}, base64]}, {type: 'text', text: '<system-reminder>\nCall complete_step now.\n</system-reminder>'}],
    });
    expect(merged).toHaveLength(5);
    expect(messagesOf([{role: 'system', content: 'Be brief.'}], true)).toEqual([{role: 'user', content: [{type: 'text', text: '<system-reminder>\nBe brief.\n</system-reminder>'}]}]);
    expect(messagesOf([{role: 'assistant', content: []}, {role: 'system', content: 'Go on.'}], true)[1]).toEqual({role: 'user', content: [{type: 'text', text: '<system-reminder>\nGo on.\n</system-reminder>'}]});
  });
});

describe('the reply', () => {
  it('is read by block type: an empty thinking block first, the text, the tool calls, and the turn kept to send back', () => {
    const content = [{type: 'thinking', thinking: '', signature: 'sig'}, {type: 'text', text: 'Pressing '}, {type: 'text', text: 'it.'}, {type: 'tool_use', id: 'toolu_9', name: 'tap', input: {ref: '@e5'}}];
    expect(parseCompletion(reply({content, stop_reason: 'tool_use', usage: {input_tokens: 3120, output_tokens: 64, cache_read_input_tokens: 2890, cache_creation_input_tokens: 12}}))).toEqual({
      text: 'Pressing it.',
      toolCalls: [{id: 'toolu_9', name: 'tap', input: {ref: '@e5'}}],
      stopReason: 'tool_use',
      usage: {input: 3120, output: 64, cacheRead: 2890, cacheWrite: 12},
      model: 'claude-opus-5-5',
      raw: content,
    });
  });

  it('names the model that answered, which after a fallback is the substitute', () => {
    const content = [{type: 'fallback', from: {model: 'claude-opus-5-5'}, to: {model: 'claude-opus-4-8'}}, {type: 'text', text: 'Done.'}];
    const parsed = parseCompletion(reply({model: 'claude-opus-4-8', content}));
    expect([parsed.model, parsed.text, parsed.raw]).toEqual(['claude-opus-4-8', 'Done.', content]);
  });

  it('is a refusal with the category and the reason where the API gives them, and the other stops as the loop knows them', () => {
    expect(parseCompletion(reply({content: [], stop_reason: 'refusal', stop_details: {category: 'cyber', explanation: 'exploit development'}}))).toMatchObject({stopReason: 'refusal', detail: 'cyber: exploit development'});
    expect('detail' in parseCompletion(reply({content: [], stop_reason: 'refusal', stop_details: null}))).toBe(false);
    expect([reply({stop_reason: 'stop_sequence'}), reply({stop_reason: 'max_tokens'}), reply({stop_reason: 'pause_turn'}), reply({stop_reason: null})].map(each => parseCompletion(each).stopReason)).toEqual(['end', 'max_tokens', 'other', 'other']);
  });
});

describe('a failure', () => {
  const status = (code: number, message: string) => Object.assign(new Error(message), {status: code});

  it("is the step's by the API's status: the account, the model, the context, or the provider", () => {
    const codes = (error: unknown) => {
      const failure = failureOf(error, 'claude-opus-5-5');
      return [failure.code, failure.message];
    };
    expect(codes(status(401, 'invalid x-api-key'))).toEqual(['MODEL_UNAVAILABLE', 'the Claude API refused this account (401): invalid x-api-key; set ANTHROPIC_API_KEY, or sign in with ant auth login']);
    expect(codes(status(403, 'no'))[0]).toBe('MODEL_UNAVAILABLE');
    expect(codes(status(404, 'model: claude-opus-9'))).toEqual(['MODEL_UNAVAILABLE', 'claude-opus-5-5 is not a model this account can use (404): model: claude-opus-9']);
    expect(codes(status(413, 'request_too_large'))[0]).toBe('CONTEXT_OVERFLOW');
    expect(codes(status(400, 'prompt is too long: 1200000 tokens > 1000000 maximum'))).toEqual(['CONTEXT_OVERFLOW', 'the request is more than claude-opus-5-5 can read: prompt is too long: 1200000 tokens > 1000000 maximum']);
    expect(codes(status(400, 'messages: roles must alternate'))).toEqual(['MODEL_PROVIDER_FAILED', 'the Claude API answered 400: messages: roles must alternate']);
    expect(codes(status(529, 'Overloaded'))[0]).toBe('MODEL_PROVIDER_FAILED');
    expect(codes(new Error('Connection error.'))).toEqual(['MODEL_PROVIDER_FAILED', 'the Claude API could not be reached: Connection error.']);
    expect(codes('socket hang up')[1]).toBe('the Claude API could not be reached: socket hang up');
    expect(codes(null)[1]).toBe('the Claude API could not be reached: null');
  });
});

/** A client that answers from a script, every body kept. */
function fakeClient(...answers: (Reply | Error)[]) {
  const bodies: Record<string, unknown>[] = [];
  const signals: AbortSignal[] = [];
  return {
    bodies,
    signals,
    beta: {
      messages: {
        create(body: Record<string, unknown>, options: {signal: AbortSignal}) {
          bodies.push(body);
          signals.push(options.signal);
          const next = answers.shift() ?? reply();
          return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        },
      },
    },
  };
}

const ask = (extra: Partial<CompletionRequest> = {}): CompletionRequest => ({system: [{text: 'core'}], messages: [{role: 'user', content: [{type: 'text', text: 'go'}]}], tools: [], signal, ...extra});

describe('the Claude model', () => {
  afterEach(() => void vi.restoreAllMocks());

  it('is claude-opus-5-5, thinking as hard as the step asks, medium by default, with room for 16 000 tokens', async () => {
    const client = fakeClient();
    const model = anthropic({client});
    expect([model.id, DEFAULT_MODEL, DEFAULT_MAX_TOKENS]).toEqual(['claude-opus-5-5', 'claude-opus-5-5', 16_000]);
    expect(await model.complete(ask())).toMatchObject({text: 'Done.', stopReason: 'end'});
    await model.complete(ask({effort: 'high', maxTokens: 32_000}));
    expect(client.bodies.map(body => [body.model, (body.output_config as {effort: string}).effort, body.max_tokens, body.fallbacks])).toEqual([
      ['claude-opus-5-5', 'medium', 16_000, 'default'],
      ['claude-opus-5-5', 'high', 32_000, 'default'],
    ]);
    expect(client.signals[0]).toBe(signal);
  });

  it('thinks as hard as the agent says over what the step asks, and writes as much as it allows', async () => {
    const client = fakeClient();
    await anthropic({client, model: 'claude-fable-5-1', effort: 'xhigh', maxTokens: 64_000, fallbacks: false}).complete(ask({effort: 'low'}));
    expect(client.bodies[0]).toMatchObject({model: 'claude-fable-5-1', max_tokens: 64_000, output_config: {effort: 'xhigh'}});
    expect('betas' in (client.bodies[0] as object)).toBe(false);
  });

  it('judges on the same model at low effort, on the model it names, or with the model it is given', async () => {
    const client = fakeClient();
    const same = anthropic({client});
    await same.judge.complete(ask());
    await anthropic({client, judge: 'claude-haiku-5-5', judgeEffort: 'medium'}).judge.complete(ask());
    expect(client.bodies.map(body => [body.model, (body.output_config as {effort: string}).effort, body.fallbacks])).toEqual([
      ['claude-opus-5-5', 'low', 'default'],
      ['claude-haiku-5-5', 'medium', undefined],
    ]);
    expect(same.judge.id).toBe('claude-opus-5-5');
    const own: Model = {id: 'my-judge', complete: () => Promise.reject(new Error('unused'))};
    expect(anthropic({client, judge: own}).judge).toBe(own);
  });

  it('sends a nudge in the user turn on a model that takes no system message, and asks no fallback of one that has none', async () => {
    const client = fakeClient();
    const nudged = ask({messages: [{role: 'user', content: [{type: 'text', text: 'go'}]}, {role: 'system', content: 'Hurry.'}]});
    await anthropic({client, model: 'claude-haiku-5-5'}).complete(nudged);
    expect(client.bodies[0]?.messages).toEqual([{role: 'user', content: [{type: 'text', text: 'go'}, {type: 'text', text: '<system-reminder>\nHurry.\n</system-reminder>'}]}]);
    expect('fallbacks' in (client.bodies[0] as object)).toBe(false);
  });

  it("asks again without a system message where the API says the model takes none, and remembers it for the run", async () => {
    const refused = Object.assign(new Error("400 role 'system' is not supported on this model"), {status: 400});
    const client = fakeClient(refused);
    const model = anthropic({client});
    const nudged = ask({messages: [{role: 'user', content: [{type: 'text', text: 'go'}]}, {role: 'system', content: 'Hurry.'}]});
    await model.complete(nudged);
    await model.complete(nudged);
    expect(client.bodies.map(body => (body.messages as unknown[]).length)).toEqual([2, 1, 1]);
  });

  it('asks again without the fallback where the API here does not take it, says so once, and remembers it', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const refused = Object.assign(new Error('fallbacks: Extra inputs are not permitted'), {status: 400});
    const client = fakeClient(refused);
    const model = anthropic({client});
    await model.complete(ask());
    await model.complete(ask());
    expect(client.bodies.map(body => body.fallbacks)).toEqual(['default', undefined, undefined]);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain('takes no server-side fallback');
  });

  it("is the step's failure for anything else, and the SDK's own error where the step's signal aborted the call", async () => {
    await expect(anthropic({client: fakeClient(Object.assign(new Error('Overloaded'), {status: 529}))}).complete(ask())).rejects.toMatchObject({code: 'MODEL_PROVIDER_FAILED'});
    const odd = {beta: {messages: {create: () => Promise.reject({status: 400})}}};
    await expect(anthropic({client: odd}).complete(ask())).rejects.toMatchObject({code: 'MODEL_PROVIDER_FAILED', message: 'the Claude API answered 400: [object Object]'});
    const aborted = new Error('Request was aborted.');
    await expect(anthropic({client: fakeClient(aborted)}).complete(ask({signal: AbortSignal.abort()}))).rejects.toBe(aborted);
  });
});

describe("the SDK, from the project's own node_modules", () => {
  afterEach(() => void vi.unstubAllEnvs());

  /** A project with a fake SDK installed, whose module exports its class one way or the other. */
  function projectWith(source: string | null): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-sdk-'));
    if (source !== null) {
      const sdk = path.join(root, 'node_modules', '@anthropic-ai', 'sdk');
      fs.mkdirSync(sdk, {recursive: true});
      fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({name: '@anthropic-ai/sdk', main: 'index.js'}));
      fs.writeFileSync(path.join(sdk, 'index.js'), source);
    }
    return root;
  }
  const client = "class Anthropic { constructor() { this.beta = {messages: {create: async body => ({model: body.model, content: [{type: 'text', text: 'from the SDK'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}})}}; } }";

  it('is made once, from the default export or the module itself', async () => {
    for (const exported of [`${client}\nmodule.exports = {default: Anthropic};`, `${client}\nmodule.exports = Anthropic;`]) {
      vi.stubEnv('HARNESS_ROOT', projectWith(exported));
      const model = anthropic();
      expect((await model.complete(ask())).text).toBe('from the SDK');
      expect((await model.judge.complete(ask())).text).toBe('from the SDK');
    }
  });

  it('is looked for in the working directory where HARNESS_ROOT names no other, which here is this repository, where nothing installs it', async () => {
    vi.stubEnv('HARNESS_ROOT', undefined);
    await expect(anthropic().complete(ask())).rejects.toMatchObject({code: 'MODEL_UNAVAILABLE'});
  });

  it('is MODEL_UNAVAILABLE where it is not installed, with the line that installs it, or cannot be made', async () => {
    vi.stubEnv('HARNESS_ROOT', projectWith(null));
    await expect(anthropic().complete(ask())).rejects.toMatchObject({code: 'MODEL_UNAVAILABLE', message: '@anthropic-ai/sdk is not installed in this project; add it with npm install --save-dev @anthropic-ai/sdk'});
    vi.stubEnv('HARNESS_ROOT', projectWith("module.exports = class { constructor() { throw new Error('The ANTHROPIC_API_KEY environment variable is missing or empty'); } };"));
    await expect(anthropic().complete(ask())).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      message: 'the Claude API client could not be made: The ANTHROPIC_API_KEY environment variable is missing or empty',
    });
  });
});

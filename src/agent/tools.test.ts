import {describe, expect, it} from 'vitest';
import {isHarnessError} from '../harness/lib/errors.ts';
import type {JsonSchema, StandardSchemaV1, ToolSpec} from './types.ts';
import {checkJson, defineTool, grammarTools, isStrict, isTool, jsonSchemaOf, toolsOn} from './tools.ts';

const every = new Set(['open', 'press', 'fill', 'type', 'key', 'longPress', 'swipe', 'back', 'dismissKeyboard']);
const names = (tools: ToolSpec[]) => tools.map(tool => tool.name);
const failure = (work: () => unknown) => {
  try {
    work();
    return null;
  } catch (error) {
    if (isHarnessError(error)) return [error.code, error.message];
    throw error;
  }
};

/** Whether a schema is strict all the way down: every object closed, every property required. */
function strictThroughout(schema: JsonSchema): boolean {
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as JsonSchema[]).every(strictThroughout);
  if (schema.type !== 'object') return true;
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  return schema.additionalProperties === false && Object.keys(properties).every(name => (schema.required as string[]).includes(name)) && Object.values(properties).every(strictThroughout);
}

describe("the grammar's tools", () => {
  it('are each one the device can do, sorted by name, every schema strict', () => {
    const tools = grammarTools({capabilities: every, secrets: ['ADA_PASSWORD'], pixels: true});
    expect(names(tools)).toEqual(['back', 'check', 'complete_step', 'dismiss_keyboard', 'double_tap', 'long_press', 'navigate', 'observe', 'press', 'screenshot', 'scroll', 'scroll_to', 'tap', 'tap_at', 'type', 'type_at', 'type_secret']);
    expect(tools.every(tool => tool.strict && strictThroughout(tool.inputSchema))).toBe(true);
  });

  it("offer upload on web where the agent has files to hand a page, and those files alone", () => {
    const tools = grammarTools({capabilities: new Set(['web']), secrets: [], pixels: false, uploads: ['fixtures/avatar.png', 'fixtures/report.pdf']});
    expect(tools.find(tool => tool.name === 'upload')?.inputSchema.properties).toMatchObject({file: {type: 'string', enum: ['fixtures/avatar.png', 'fixtures/report.pdf']}});
    expect(names(grammarTools({capabilities: new Set(['web']), secrets: [], pixels: false, uploads: []}))).not.toContain('upload');
    expect(names(grammarTools({capabilities: new Set(['press']), secrets: [], pixels: false, uploads: ['fixtures/avatar.png']}))).not.toContain('upload');
  });

  it('offer a drag, and a hover and typing at a point of a screenshot, where the device has each', () => {
    const tools = grammarTools({capabilities: new Set(['press', 'type', 'hover', 'drag']), secrets: [], pixels: true});
    expect(names(tools)).toEqual(['check', 'complete_step', 'double_tap', 'drag', 'hover', 'hover_at', 'observe', 'screenshot', 'tap', 'tap_at', 'type_at']);
    expect(tools.every(tool => tool.strict && strictThroughout(tool.inputSchema))).toBe(true);
    expect(names(grammarTools({capabilities: new Set(['press', 'type', 'hover']), secrets: [], pixels: false}))).not.toContain('hover_at');
  });

  it("offer a hover, the home screen, a dialog's answer, and on web a choice in a select and a secondary press, where the device has each", () => {
    const tools = grammarTools({capabilities: new Set(['press', 'hover', 'home', 'alert', 'web']), secrets: [], pixels: false});
    expect(names(tools)).toEqual(['alert', 'check', 'complete_step', 'double_tap', 'home', 'hover', 'observe', 'right_click', 'select', 'tap']);
    expect(tools.every(tool => tool.strict && strictThroughout(tool.inputSchema))).toBe(true);
  });

  it('leave out what the device cannot do, and a picture where none may leave', () => {
    const windows = new Set(['open', 'press', 'fill', 'type', 'key']);
    expect(names(grammarTools({capabilities: windows, secrets: [], pixels: false}))).toEqual(['check', 'complete_step', 'double_tap', 'navigate', 'observe', 'press', 'tap', 'type']);
    expect(names(grammarTools({capabilities: new Set(), secrets: ['TOKEN'], pixels: true}))).toEqual(['complete_step', 'observe', 'screenshot']);
  });

  it('offer type_secret for the step\'s secrets alone, by name', () => {
    const typeSecret = grammarTools({capabilities: every, secrets: ['A_TOKEN', 'B_PASSWORD'], pixels: false}).find(tool => tool.name === 'type_secret');
    const properties = typeSecret?.inputSchema.properties as Record<string, JsonSchema> | undefined;
    expect(properties?.secret).toEqual({type: 'string', enum: ['A_TOKEN', 'B_PASSWORD']});
  });

  it('end a step with a status, a summary, and a code that may be null', () => {
    const complete = grammarTools({capabilities: new Set(), secrets: [], pixels: false}).find(tool => tool.name === 'complete_step');
    expect(complete?.inputSchema.required).toEqual(['status', 'summary', 'errorCode']);
    expect(checkJson(complete?.inputSchema as JsonSchema, {status: 'passed', summary: 'done', errorCode: null})).toEqual([]);
    expect(checkJson(complete?.inputSchema as JsonSchema, {status: 'failed', summary: 'no', errorCode: 'ASSERTION_FAILED'})).toEqual([]);
    expect(checkJson(complete?.inputSchema as JsonSchema, {status: 'maybe', summary: 'x', errorCode: 'NOPE'})).toEqual(['$.status is "maybe", not one of "passed", "failed", "blocked"', '$.errorCode fits none of the shapes it may take']);
  });
});

describe("a project's tool", () => {
  const seed = {name: 'seed_cart', description: 'Put a SKU in the cart.', schema: {type: 'object', properties: {sku: {type: 'string'}}, required: ['sku'], additionalProperties: false}, execute: () => 'seeded'};

  it('is defined with a name of its own and a schema the model is given', () => {
    const tool = defineTool({...seed, mutates: true, platforms: ['web']});
    expect(tool).toMatchObject({kind: 'tool', name: 'seed_cart', mutates: true, strict: true, inputSchema: seed.schema});
    expect(isTool(tool)).toBe(true);
    expect([isTool(seed), isTool(null)]).toEqual([false, false]);
    expect(Object.isFrozen(tool)).toBe(true);
  });

  it('takes a Standard Schema that gives its JSON Schema, as Zod 4 does', () => {
    const zodLike: StandardSchemaV1<{sku: string}> = {
      '~standard': {version: 1, vendor: 'zod', validate: value => ({value: value as {sku: string}}), jsonSchema: {output: () => ({type: 'object', properties: {sku: {type: 'string'}}, required: ['sku']})}},
    };
    const tool = defineTool({...seed, schema: zodLike});
    expect(tool.inputSchema).toEqual({type: 'object', properties: {sku: {type: 'string'}}, required: ['sku']});
    expect(tool.strict).toBe(false);
  });

  it('takes a function that carries a Standard Schema, as ArkType\'s types are', () => {
    const arkLike = Object.assign((value: unknown) => value, {
      '~standard': {version: 1 as const, vendor: 'arktype', validate: (value: unknown) => ({value}), jsonSchema: {output: () => ({type: 'string'})}},
    });
    expect(jsonSchemaOf(arkLike, 'extract')).toEqual({type: 'string'});
  });

  it('is refused a name of the agent\'s own, a bad name, no description, or a schema the model cannot be given', () => {
    expect(failure(() => defineTool({...seed, name: 'tap'}))).toEqual(['INVALID_ARGUMENT', "tap is the name of one of the agent's own tools; give the tool another"]);
    expect(failure(() => defineTool({...seed, name: 'Seed-Cart'}))?.[0]).toBe('INVALID_ARGUMENT');
    expect(failure(() => defineTool({...seed, description: ' '}))).toEqual(['INVALID_ARGUMENT', 'the tool seed_cart has no description, which is how the model knows when to call it']);
    expect(failure(() => defineTool({...seed, schema: 'string' as unknown as JsonSchema}))).toEqual(['INVALID_ARGUMENT', "the tool seed_cart's schema is neither a Standard Schema nor a JSON Schema object"]);
    for (const schema of [() => 'a function, not a schema', null, undefined]) expect(failure(() => jsonSchemaOf(schema, 'the tool x'))?.[1]).toBe("the tool x's schema is neither a Standard Schema nor a JSON Schema object");
    expect(failure(() => jsonSchemaOf({'~standard': {version: 1, vendor: 'v', validate: () => ({value: 1})}}, 'the tool x'))).toEqual([
      'INVALID_ARGUMENT',
      "the tool x's schema is a Standard Schema that gives no JSON Schema; give it one, or a JSON Schema object",
    ]);
  });

  it('is offered on the platforms it names, or on every one', () => {
    const anywhere = defineTool(seed);
    const webOnly = defineTool({...seed, name: 'web_only', platforms: ['web']});
    expect(toolsOn([anywhere, webOnly], 'android').map(tool => tool.name)).toEqual(['seed_cart']);
    expect(toolsOn([anywhere, webOnly], 'web').map(tool => tool.name)).toEqual(['seed_cart', 'web_only']);
  });
});

describe('a strict schema', () => {
  it('is a closed object with every property required', () => {
    expect(isStrict({type: 'object', properties: {a: {}}, required: ['a'], additionalProperties: false})).toBe(true);
    expect(isStrict({type: 'object', properties: {a: {}}, required: [], additionalProperties: false})).toBe(false);
    expect(isStrict({type: 'object', additionalProperties: false})).toBe(true);
    expect(isStrict({type: 'object', properties: {a: {}}, required: ['a']})).toBe(false);
    expect(isStrict({type: 'string'})).toBe(false);
  });
});

describe('checking a value against a JSON Schema', () => {
  const order: JsonSchema = {
    type: 'object',
    properties: {
      total: {type: 'number'},
      count: {type: 'integer'},
      currency: {type: 'string', enum: ['USD', 'EUR']},
      kind: {const: 'order'},
      lines: {type: 'array', items: {type: 'object', properties: {sku: {type: 'string'}}, required: ['sku']}},
      note: {type: ['string', 'null']},
    },
    required: ['total', 'currency'],
    additionalProperties: false,
  };

  it('finds nothing wrong with a value that fits', () => {
    expect(checkJson(order, {total: 45.5, count: 3, currency: 'USD', kind: 'order', lines: [{sku: 'a'}], note: null})).toEqual([]);
    expect(checkJson({type: 'number'}, 3)).toEqual([]);
    expect(checkJson({}, 'anything')).toEqual([]);
    expect(checkJson({type: 'object'}, {any: 'property'})).toEqual([]);
  });

  it('says what is wrong, where, for each thing that is', () => {
    expect(checkJson(order, {count: 1.5, currency: 'GBP', kind: 'quote', lines: [{}], extra: true})).toEqual([
      '$.total is missing',
      '$.count is number, where integer is wanted',
      '$.currency is "GBP", not one of "USD", "EUR"',
      '$.kind is "quote", not "order"',
      '$.lines[0].sku is missing',
      '$.extra is not a property it takes',
    ]);
    expect(checkJson(order, [1])).toEqual(['$ is an array, where object is wanted']);
    expect(checkJson({type: 'array'}, {})).toEqual(['$ is an object, where array is wanted']);
    expect(checkJson({type: 'string'}, null)).toEqual(['$ is null, where string is wanted']);
  });
});

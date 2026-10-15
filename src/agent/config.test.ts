import {describe, expect, it} from 'vitest';
import type {HarnessError} from '../harness/lib/errors.ts';
import {AGENT_DEFAULTS, checkAgentKeys, isModel, MAX_CONTEXT_BYTES, resolveAgent} from './config.ts';
import type {AgentConfig, HarnessAgents} from './config.ts';
import {defineTool} from './tools.ts';
import type {Model} from './types.ts';

const model: Model = {id: 'claude-opus-5-5', complete: () => Promise.reject(new Error('unused'))};
const judge: Model = {id: 'claude-haiku-5-5', complete: () => Promise.reject(new Error('unused'))};
const executor = {name: 'mine', version: '1', runStep: () => Promise.resolve({status: 'passed' as const, summary: 'Done.'})};
const seed = defineTool({name: 'seed_cart', description: 'Seed the cart.', schema: {type: 'object', properties: {}, required: [], additionalProperties: false}, execute: () => 'seeded'});

/** What the check says of a config, or null where it takes it. */
function failure(config: unknown): string | null {
  try {
    checkAgentKeys(config as HarnessAgents, 'harness.config.ts');
    return null;
  } catch (error) {
    expect((error as HarnessError).code).toBe('INVALID_CONFIG');
    return (error as Error).message;
  }
}

describe("the agent's keys of a harness config", () => {
  it('take agents by name, each with what an agent takes', () => {
    const agents: Record<string, AgentConfig> = {
      default: {model, judge, system: 'Verify every outcome.', context: 'A shop.', tools: [seed], maxSteps: 30, maxModelCalls: 40, timeout: 90_000, judgmentTimeout: 20_000, maxObservationBytes: 100_000, screenshotMaxSide: 1024},
      'admin-2': {executor, model: undefined},
    };
    expect(failure({agents, secrets: {ADA_PASSWORD: 'correct horse', TOKEN: () => 'tok_123456', UNSET: undefined}, cache: {mode: 'read-only', dir: '.cache', strict: true}})).toBeNull();
    expect(failure({})).toBeNull();
    expect(failure({cache: 'read-write'})).toBeNull();
    expect(failure({cache: {}})).toBeNull();
  });

  it('name an agent that is not an object, a name it cannot have, and a field it does not take', () => {
    expect(failure({agents: []})).toBe('harness.config.ts: agents is a list; it takes an object of agents by name');
    expect(failure({agents: {default: 'opus'}})).toBe('harness.config.ts: agents.default is "opus"; it takes an object');
    expect(failure({agents: {'2nd': {}}})).toBe('harness.config.ts: agents.2nd is not a name an agent can have: a letter, then letters, digits, _ and -');
    expect(failure({agents: {default: {prompt: 'x'}}})).toBe(
      'harness.config.ts: agents.default.prompt is not something an agent takes; it takes model, judge, system, context, tools, executor, maxSteps, maxModelCalls, timeout, judgmentTimeout, maxObservationBytes, screenshotMaxSide',
    );
  });

  it('name a field of the wrong kind, and the kind it takes', () => {
    const field = (key: string, value: unknown) => failure({agents: {default: {[key]: value}}});
    expect(field('model', 'claude-opus-5-5')).toBe('harness.config.ts: agents.default.model is "claude-opus-5-5"; it takes a model: an object with an id and a complete function, as anthropic() answers');
    expect(field('judge', {id: 'x'})).toMatch(/agents\.default\.judge is an object; it takes a model/);
    expect(field('system', 1)).toBe('harness.config.ts: agents.default.system is 1; it takes a string');
    expect(field('context', null)).toBe('harness.config.ts: agents.default.context is null; it takes a string');
    expect(field('context', 'x'.repeat(MAX_CONTEXT_BYTES + 1))).toMatch(/agents\.default\.context is ".*"; it takes at most 16384 bytes, since every call reads it$/);
    expect(field('tools', [{name: 'x'}])).toBe('harness.config.ts: agents.default.tools is a list; it takes a list of tools made with defineTool');
    expect(field('executor', () => undefined)).toBe('harness.config.ts: agents.default.executor is a function; it takes an executor: an object with a name, a version and a runStep function');
    expect(field('maxSteps', 101)).toBe('harness.config.ts: agents.default.maxSteps is 101; it takes a whole number from 1 to 100');
    expect(field('maxModelCalls', 2.5)).toBe('harness.config.ts: agents.default.maxModelCalls is 2.5; it takes a whole number from 1 to 100');
    expect(field('timeout', 0)).toBe('harness.config.ts: agents.default.timeout is 0; it takes a whole number of ms, 1 or more');
    expect(field('judgmentTimeout', '30s')).toMatch(/judgmentTimeout is "30s"; it takes a whole number of ms/);
    expect(field('maxObservationBytes', 100)).toBe('harness.config.ts: agents.default.maxObservationBytes is 100; it takes a whole number of bytes, 1024 or more');
    expect(field('screenshotMaxSide', 8000)).toBe('harness.config.ts: agents.default.screenshotMaxSide is 8000; it takes a whole number of pixels from 64 to 4096');
  });

  it('refuse an executor beside a prompt or tools, which it brings itself', () => {
    const message = 'harness.config.ts: agents.default has an executor, which brings its own prompt and tools; give it system and tools, or the executor, not both';
    expect(failure({agents: {default: {executor, system: 'x'}}})).toBe(message);
    expect(failure({agents: {default: {executor, tools: []}}})).toBe(message);
  });

  it('name a secret that is not one, a name it cannot have, and a value too short to hide', () => {
    expect(failure({secrets: 'x'})).toBe('harness.config.ts: secrets is "x"; it takes an object of secrets by name');
    expect(failure({secrets: {'ada-password': 'correct horse'}})).toBe("harness.config.ts: secrets.ada-password is not a secret's name: a letter, then letters, digits and underscores");
    expect(failure({secrets: {PIN: 1234}})).toBe('harness.config.ts: secrets.PIN is 1234; it takes a string, or a function that answers one');
    expect(failure({secrets: {PIN: '1234'}})).toBe('harness.config.ts: secrets.PIN is shorter than 6 characters, so hiding it would hide ordinary words too');
  });

  it("name a cache that is not one of its modes or its object", () => {
    const takes = "harness.config.ts: cache is %s; it takes 'off', 'read-only' or 'read-write', or {mode, dir, strict}";
    expect(failure({cache: 'on'})).toBe(takes.replace('%s', '"on"'));
    expect(failure({cache: true})).toBe(takes.replace('%s', 'true'));
    for (const cache of [{mode: 'on'}, {dir: 1}, {strict: 'yes'}, {ttl: 1}]) expect(failure({cache})).toBe(takes.replace('%s', 'an object'));
  });
});

describe('an agent as a step runs it', () => {
  it('is the entry named, with the defaults of what it leaves out', () => {
    const resolved = resolveAgent({default: {model, context: 'A shop.', maxSteps: 10, timeout: undefined}, admin: {model}}, 'default');
    expect(resolved).toEqual({name: 'default', model, judge: model, context: 'A shop.', tools: [], ...AGENT_DEFAULTS, maxSteps: 10});
    expect(AGENT_DEFAULTS).toEqual({maxSteps: 25, maxModelCalls: 25, timeout: 120_000, judgmentTimeout: 30_000, maxObservationBytes: 262_144, screenshotMaxSide: 768});
  });

  it("judges with the judge it names, else its model's own judge, else its model", () => {
    const claude = {...model, judge};
    expect(resolveAgent({default: {model: claude}}, 'default').judge).toBe(judge);
    expect(resolveAgent({default: {model: claude, judge: model}}, 'default').judge).toBe(model);
    expect(resolveAgent({default: {model: {...model, judge: 'haiku'} as Model}}, 'default').judge?.id).toBe('claude-opus-5-5');
    expect('judge' in resolveAgent({default: {}}, 'default')).toBe(false);
  });

  it('keeps an executor, a system and tools as given', () => {
    expect(resolveAgent({mine: {executor}}, 'mine').executor).toBe(executor);
    expect(resolveAgent({mine: {system: 'Be brief.', tools: [seed]}}, 'mine')).toMatchObject({system: 'Be brief.', tools: [seed]});
  });

  it('is default with no model where there are no agents, and INVALID_ARGUMENT for a name the config has not got', () => {
    expect(resolveAgent(undefined, 'default')).toEqual({name: 'default', context: '', tools: [], ...AGENT_DEFAULTS});
    expect(() => resolveAgent({buyer: {}, admin: {}}, 'support')).toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT', message: "there is no agent called support; the harness config's agents are buyer, admin"}));
    expect(() => resolveAgent({buyer: {}}, 'default')).toThrow("there is no agent called default; the harness config's agents are buyer");
    expect(() => resolveAgent(undefined, 'admin')).toThrow("there is no agent called admin; the harness config's agents are none");
  });

  it('tells a model from what is not one', () => {
    expect([isModel(model), isModel({id: 'x'}), isModel(null), isModel({complete: () => undefined})]).toEqual([true, false, false, false]);
  });
});

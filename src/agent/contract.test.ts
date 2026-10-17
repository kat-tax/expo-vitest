// The agent's public surface: what expo-vitest/agent and
// expo-vitest/agent/anthropic export, and the shapes a consumer compiles
// against. A change that fails here breaks a consumer; edit it only on
// purpose, in the commit that makes the change.
import {describe, expect, expectTypeOf, it} from 'vitest';
import * as adapter from './anthropic.ts';
import * as surface from './index.ts';
import type {
  ActOptions,
  ActResult,
  AgentErrorCode,
  AssertOptions,
  Completion,
  CompletionRequest,
  ExtractOptions,
  Model,
  Secret,
  StepCacheInfo,
  StepContext,
  StepExecutor,
  StepOutcome,
  Unique,
  WaitForOptions,
} from './index.ts';

describe('expo-vitest/agent', () => {
  it('exports the agent, its helpers and its error, and nothing more', () => {
    expect(Object.keys(surface).sort()).toEqual(['AGENT_CODES', 'AgentError', 'BLOCKED_CODES', 'agent', 'defineTool', 'forEachAgent', 'isAgentError', 'isSecret', 'isUnique', 'secret', 'toolLoopExecutor', 'unique']);
    expect(Object.keys(surface.agent).sort()).toEqual(['act', 'as', 'assert', 'extract', 'waitFor']);
    expect(Object.keys(surface.agent.as('admin')).sort()).toEqual(['act', 'as', 'assert', 'extract', 'waitFor']);
  });

  it("fails with e2e's codes, with the same meanings", () => {
    expect(surface.AGENT_CODES).toEqual([
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
    ]);
    expect(surface.BLOCKED_CODES).toEqual(['AUTOMATION_UNSUPPORTED', 'AUTHENTICATION_FAILED', 'APP_NOT_OPEN', 'SECRET_UNAVAILABLE', 'POLICY_DENIED', 'UNSUPPORTED_CAPABILITY']);
  });

  it('keeps the shapes a consumer compiled against', () => {
    expectTypeOf(surface.agent.act).parameters.toEqualTypeOf<[instruction: string, options?: ActOptions]>();
    expectTypeOf(surface.agent.act).returns.toEqualTypeOf<Promise<ActResult>>();
    expectTypeOf(surface.agent.assert).parameters.toEqualTypeOf<[assertion: string, options?: AssertOptions]>();
    expectTypeOf(surface.agent.waitFor).parameters.toEqualTypeOf<[condition: string, options?: WaitForOptions]>();
    expectTypeOf(surface.agent.extract<{type: 'number'}>).parameters.toEqualTypeOf<[instruction: string, options: ExtractOptions<{type: 'number'}>]>();
    expectTypeOf<ActResult>().toEqualTypeOf<{summary: string; cache?: StepCacheInfo; modelCalls: number; actions: number; costUsd?: number}>();
    expectTypeOf<StepCacheInfo>().toEqualTypeOf<{
      mode: 'self-finalized' | 'agent-concluded' | 'missed';
      reason?: 'retry' | 'no-entry' | 'invalid-entry' | 'truncated' | 'wrong-context' | 'gap' | 'target-not-found' | 'target-ambiguous' | 'viewport-changed' | 'action-failed' | 'action-uncertain' | 'end-mismatch';
      notRecorded?: 'param-collision' | 'mutating-tool' | 'no-verification';
      replayedActions: number;
      totalActions: number;
    }>();
    expectTypeOf<Secret>().toEqualTypeOf<{readonly kind: 'secret'; readonly name: string; readonly purpose: 'password' | 'generic'}>();
    expectTypeOf<Unique>().toEqualTypeOf<{readonly kind: 'unique'; readonly value: string}>();
    expectTypeOf<Model>().toEqualTypeOf<{readonly id: string; complete(request: CompletionRequest): Promise<Completion>}>();
    expectTypeOf<CompletionRequest['providerOptions']>().toEqualTypeOf<Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined>();
    expectTypeOf<StepExecutor['runStep']>().toEqualTypeOf<(ctx: StepContext) => Promise<StepOutcome>>();
    expectTypeOf<StepOutcome>().toEqualTypeOf<{status: 'passed' | 'failed' | 'blocked'; summary: string; errorCode?: AgentErrorCode}>();
    const error = new surface.AgentError('ASSERTION_FAILED', 'No.', {step: 'assert', instruction: 'the cart is empty'});
    expect([error.name, error.code, error.message, error.explanation, error.blocked, error.step, error.instruction, surface.isAgentError(error)]).toEqual([
      'HarnessError',
      'ASSERTION_FAILED',
      'agent.assert("the cart is empty"): No.',
      'No.',
      false,
      'assert',
      'the cart is empty',
      true,
    ]);
  });
});

describe('expo-vitest/agent/anthropic', () => {
  it('exports the adapter, and the pure functions it is made of', () => {
    expect(Object.keys(adapter).sort()).toEqual(['DEFAULT_MAX_TOKENS', 'DEFAULT_MODEL', 'FALLBACK_BETA', 'anthropic', 'buildRequest', 'failureOf', 'messagesOf', 'parseCompletion', 'strictSchema']);
    expect([adapter.DEFAULT_MODEL, adapter.DEFAULT_MAX_TOKENS, adapter.FALLBACK_BETA]).toEqual(['claude-opus-5-5', 16_000, 'server-side-fallback-2026-07-01']);
    expectTypeOf(adapter.anthropic).parameters.toEqualTypeOf<[options?: adapter.AnthropicOptions]>();
    expectTypeOf(adapter.anthropic).returns.toEqualTypeOf<adapter.ClaudeModel>();
  });
});

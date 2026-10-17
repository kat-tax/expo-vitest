import {describe, expect, expectTypeOf, it} from 'vitest';
import type {HarnessCode} from '../harness/lib/errors.ts';
import {HarnessError, isHarnessError} from '../harness/lib/errors.ts';
import type {AgentErrorCode} from './types.ts';
import {AGENT_CODES, AgentError, BLOCKED_CODES, isAgentCode, isAgentError, isBlockedCode} from './types.ts';

describe('the codes an agent step fails with', () => {
  it("are e2e's twenty-one, every one a harness code too", () => {
    expect(AGENT_CODES).toEqual([
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
    expectTypeOf<AgentErrorCode>().toExtend<HarnessCode>();
  });

  it('name the blocked ones apart', () => {
    expect(BLOCKED_CODES.every(code => isAgentCode(code))).toBe(true);
    expect([isBlockedCode('AUTHENTICATION_FAILED'), isBlockedCode('ASSERTION_FAILED'), isBlockedCode(5)]).toEqual([true, false, false]);
    expect([isAgentCode('STEP_TIMEOUT'), isAgentCode('SCREENSHOT_MISMATCH'), isAgentCode(undefined)]).toEqual([true, false, false]);
  });
});

describe('an AgentError', () => {
  it('is a HarnessError that says which step failed, how, and why', () => {
    const error = new AgentError('ASSERTION_FAILED', 'the total reads $40, not $45', {step: 'assert', instruction: 'the total is $45', platform: 'web'});
    expect(error).toBeInstanceOf(HarnessError);
    expect(isHarnessError(error)).toBe(true);
    expect(error.message).toBe('agent.assert("the total is $45"): the total reads $40, not $45');
    expect(error).toMatchObject({code: 'ASSERTION_FAILED', explanation: 'the total reads $40, not $45', blocked: false, step: 'assert', instruction: 'the total is $45', platform: 'web'});
    expect(error).not.toHaveProperty('screenshot');
  });

  it('carries a blocked verdict, a screenshot and a cause where there are', () => {
    const cause = new Error('captcha');
    const error = new AgentError('AUTOMATION_UNSUPPORTED', 'a captcha stands in the way', {step: 'act', instruction: 'sign in', blocked: true, screenshot: '/r/shot.png', cause});
    expect(error).toMatchObject({blocked: true, screenshot: '/r/shot.png', cause});
    expect(error).not.toHaveProperty('platform');
  });

  it('is told apart by its fields, as a copy from another package would be', () => {
    const copy = Object.assign(new Error('x'), {name: 'HarnessError', code: 'STEP_TIMEOUT', explanation: 'x', blocked: false, step: 'act'});
    expect(isAgentError(copy)).toBe(true);
    expect(isAgentError(new HarnessError('ACTION_FAILED', 'scripted'))).toBe(false);
    expect(isAgentError(Object.assign(new Error('x'), {name: 'HarnessError', code: 'X', explanation: 'x', blocked: 'no', step: 'act'}))).toBe(false);
    expect(isAgentError(Object.assign(new Error('x'), {name: 'HarnessError', code: 'X', explanation: 'x', blocked: false}))).toBe(false);
    expect(isAgentError('a string')).toBe(false);
  });
});

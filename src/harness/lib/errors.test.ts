import {describe, expect, expectTypeOf, it} from 'vitest';
import type {HarnessCode} from './errors.ts';
import {HarnessError, codeOf, isHarnessError} from './errors.ts';

describe('HarnessError', () => {
  it('is an Error with a code beside the message', () => {
    const error = new HarnessError('LOCATOR_NOT_FOUND', 'nothing matches label="Save" on the page (12 nodes)');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HarnessError');
    expect(error.code).toBe('LOCATOR_NOT_FOUND');
    expect(error.message).toBe('nothing matches label="Save" on the page (12 nodes)');
    // The name leads the stack too, and the stack is what a failing test prints.
    expect(error.stack).toMatch(/^HarnessError: nothing matches/);
    // What was not given is not there at all, rather than there and undefined.
    expect(Object.keys(error).sort()).toEqual(['code', 'name']);
    expect('cause' in error).toBe(false);
  });

  it('carries the platform, the evidence and the cause when given them', () => {
    const cause = new Error('net::ERR_CONNECTION_REFUSED');
    const error = new HarnessError('APP_UNREACHABLE', 'could not open /', {platform: 'web', evidence: '.harness/home.png', cause});
    expect(error.platform).toBe('web');
    expect(error.evidence).toBe('.harness/home.png');
    expect(error.cause).toBe(cause);
  });
});

describe('isHarnessError', () => {
  it('knows one by its name and code, so one from a second copy of the package counts', () => {
    expect(isHarnessError(new HarnessError('ACTION_FAILED', 'press failed'))).toBe(true);
    expect(isHarnessError({name: 'HarnessError', code: 'ACTION_FAILED', message: 'press failed'})).toBe(true);
  });

  it('is false for anything else', () => {
    expect(isHarnessError(new Error('press failed'))).toBe(false);
    expect(isHarnessError({name: 'HarnessError'})).toBe(false);
    expect(isHarnessError(null)).toBe(false);
    expect(isHarnessError('HarnessError')).toBe(false);
  });
});

describe('codeOf', () => {
  it('reads the code, or gives one to what has none', () => {
    expect(codeOf(new HarnessError('NOT_ACTIONABLE', '@e3 Button "" has no bounds to press'))).toBe('NOT_ACTIONABLE');
    expect(codeOf(new Error('page.goto: net::ERR_CONNECTION_REFUSED'))).toBe('ACTION_FAILED');
    expect(codeOf(new Error('page.goto: net::ERR_CONNECTION_REFUSED'), 'APP_UNREACHABLE')).toBe('APP_UNREACHABLE');
  });
});

describe('HarnessCode', () => {
  it('is these thirteen, so a new one is a deliberate edit here', () => {
    expectTypeOf<HarnessCode>().toEqualTypeOf<
      | 'DRIVER_UNAVAILABLE'
      | 'APP_UNREACHABLE'
      | 'APP_ALREADY_RUNNING'
      | 'LOCATOR_NOT_FOUND'
      | 'LOCATOR_AMBIGUOUS'
      | 'ACTION_FAILED'
      | 'ASSERTION_FAILED'
      | 'SCREENSHOT_MISMATCH'
      | 'NOT_ACTIONABLE'
      | 'UNSUPPORTED_CAPABILITY'
      | 'INVALID_ARGUMENT'
      | 'INVALID_CONFIG'
      | 'DEVICE_POOL_EXHAUSTED'
    >();
  });
});

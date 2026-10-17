import path from 'node:path';
import {describe, expect, it} from 'vitest';
import type {CaseLike} from './records.ts';
import {fromRoot, recordOf} from './records.ts';

const root = path.resolve('/app');
const at = (...parts: string[]) => path.join(root, ...parts);

function testCase(extra: Partial<CaseLike> & {state?: string; errors?: unknown[]; duration?: number; flaky?: boolean; evidence?: object} = {}): CaseLike {
  const {state = 'passed', errors, duration = 120, flaky = false, evidence, ...rest} = extra;
  return {
    project: {name: 'device:web'},
    module: {moduleId: at('device', 'settings.test.ts')},
    fullName: 'settings > opens',
    result: () => ({state, ...(errors ? {errors} : {})}),
    diagnostic: () => ({duration, flaky}),
    meta: () => (evidence ? {evidence} : {}),
    ...rest,
  };
}

describe('a record', () => {
  it("is the case's project, file from the root, name, line, state, time and flakiness", () => {
    expect(recordOf(testCase({location: {line: 14, column: 3}, flaky: true}), root)).toEqual({
      project: 'device:web',
      file: 'device/settings.test.ts',
      name: 'settings > opens',
      line: 14,
      state: 'passed',
      flaky: true,
      duration: 120,
    });
  });

  it("carries the first error, with a HarnessError's code", () => {
    const failed = recordOf(testCase({state: 'failed', errors: [{message: 'nothing matches', code: 'LOCATOR_NOT_FOUND'}, {message: 'second'}]}), root);
    expect(failed).toMatchObject({state: 'failed', error: {code: 'LOCATOR_NOT_FOUND', message: 'nothing matches'}});
    expect(recordOf(testCase({state: 'failed', errors: [{message: 'plain'}]}), root).error).toEqual({message: 'plain'});
    expect(recordOf(testCase({state: 'failed', errors: ['thrown text']}), root).error).toEqual({message: 'thrown text'});
    expect(recordOf(testCase({state: 'failed', errors: []}), root)).not.toHaveProperty('error');
  });

  it('carries the evidence the device left, from the root', () => {
    const evidence = {folder: at('.harness', 'results', 'web', 't'), trace: at('.harness', 'results', 'web', 't', 'trace.md'), screenshot: at('.harness', 'results', 'web', 't', 'screenshot.png')};
    expect(recordOf(testCase({evidence}), root).evidence).toEqual({folder: '.harness/results/web/t', trace: '.harness/results/web/t/trace.md', screenshot: '.harness/results/web/t/screenshot.png'});
    const {screenshot: _screenshot, ...noPicture} = evidence;
    expect(recordOf(testCase({evidence: noPicture}), root).evidence).toEqual({folder: '.harness/results/web/t', trace: '.harness/results/web/t/trace.md'});
    expect(recordOf(testCase({evidence: {folder: evidence.folder, video: at('.harness', 'results', 'web', 't', 'video.webm')}}), root).evidence).toEqual({folder: '.harness/results/web/t', video: '.harness/results/web/t/video.webm'});
  });

  it('counts a case that did not run as pending, and one with no diagnostic as instant', () => {
    expect(recordOf(testCase({state: 'pending'}), root).state).toBe('pending');
    expect(recordOf(testCase({state: 'skipped'}), root).state).toBe('skipped');
    expect(recordOf({...testCase(), diagnostic: () => undefined}, root)).toMatchObject({duration: 0, flaky: false});
  });

  it('names a file from the root with forward slashes', () => {
    expect(fromRoot(root, at('a', 'b.ts'))).toBe('a/b.ts');
  });
});

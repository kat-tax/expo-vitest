/**
 * A Vitest test case as the reporter keeps it: plain data, read from the few
 * parts of the case the summary needs, so the rest of the reporter never
 * holds Vitest's objects.
 */
import path from 'node:path';
import type {TestRecord} from './render.ts';

/** As much of Vitest's `TestCase` as a record is read from. */
export interface CaseLike {
  project: {name: string};
  module: {moduleId: string};
  fullName: string;
  location?: {line: number; column: number};
  result(): {state: string; errors?: readonly unknown[]};
  diagnostic(): {duration?: number; flaky?: boolean} | undefined;
  meta(): object;
}

/** A path from the project root, with forward slashes, as the summary links it. */
export function fromRoot(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/** The first error a test failed with: its message, and its code where it is a `HarnessError`. */
function errorOf(errors: readonly unknown[] | undefined): TestRecord['error'] {
  const first = errors?.[0] as {message?: unknown; code?: unknown} | undefined;
  if (!first) return undefined;
  return {...(typeof first.code === 'string' ? {code: first.code} : {}), message: typeof first.message === 'string' ? first.message : String(first)};
}

/** A test case as a record. */
export function recordOf(testCase: CaseLike, root: string): TestRecord {
  const result = testCase.result();
  const diagnostic = testCase.diagnostic();
  const state = result.state === 'passed' || result.state === 'failed' || result.state === 'skipped' ? result.state : 'pending';
  const error = errorOf(result.errors);
  const evidence = (testCase.meta() as {evidence?: {folder: string; trace: string; screenshot?: string}}).evidence;
  return {
    project: testCase.project.name,
    file: fromRoot(root, testCase.module.moduleId),
    name: testCase.fullName,
    ...(testCase.location ? {line: testCase.location.line} : {}),
    state,
    flaky: Boolean(diagnostic?.flaky),
    duration: diagnostic?.duration ?? 0,
    ...(error ? {error} : {}),
    ...(evidence
      ? {evidence: {folder: fromRoot(root, evidence.folder), trace: fromRoot(root, evidence.trace), ...(evidence.screenshot ? {screenshot: fromRoot(root, evidence.screenshot)} : {})}}
      : {}),
  };
}

/**
 * Leaves evidence for a device test that fails: the screen, the tree and a
 * trace of its steps, under `.harness/results/`. Imported by the device
 * project's setup file, so Vitest runs this after the test file's own
 * `afterEach`, and a driver closed there leaves no picture, which the trace
 * says: close it in `afterAll`.
 *
 * `HARNESS_TRACE` says when: `retain-on-failure` (the default) for a test
 * that failed, `on` for every test, `off` for none.
 */
import path from 'node:path';
import {afterEach, beforeEach} from 'vitest';
import {writeEvidence} from './evidence.ts';
import {device} from './index.ts';

/** The project under test: where the tests are run from, unless `HARNESS_ROOT` names it. */
const ROOT = path.resolve(process.env.HARNESS_ROOT ?? process.cwd());

/** What a test task carries that this reads. */
interface Task {
  name: string;
  suite?: {name: string; suite?: Task['suite']};
  file: {filepath: string};
  meta: Record<string, unknown>;
  result?: {state?: string; startTime?: number; duration?: number; errors?: {message?: string; code?: string; name?: string}[]};
}

/** A test's title path: its suites, outermost first, then its name. */
function titlePathOf(task: Task): string[] {
  const names = [task.name];
  for (let suite = task.suite; suite?.name; suite = suite.suite) names.unshift(suite.name);
  return names;
}

beforeEach(() => device.journal.begin());

afterEach(async context => {
  const task = context.task as unknown as Task;
  const failed = task.result?.state === 'fail';
  const mode = process.env.HARNESS_TRACE ?? 'retain-on-failure';
  if (mode === 'off' || (mode !== 'on' && !failed)) return;
  // A test that never touched the device has nothing to show.
  if (device.journal.steps.length === 0 && !device.isOpen()) return;
  const started = task.result?.startTime ?? Date.now();
  const written = await writeEvidence(device.evidence(), {
    root: ROOT,
    titlePath: titlePathOf(task),
    file: path.relative(ROOT, task.file.filepath).replace(/\\/g, '/'),
    failed,
    duration: task.result?.duration ?? Date.now() - started,
    at: new Date(started),
    errors: (task.result?.errors ?? []).map(error => `${error.code ? `${error.code}: ` : ''}${error.message ?? String(error)}`),
  });
  console.log(`evidence: ${path.relative(ROOT, written.trace)}`);
  task.meta.evidence = {trace: written.trace, ...(written.screenshot ? {screenshot: written.screenshot} : {})};
  if (written.screenshot) await context.annotate('the screen at the end', 'evidence', {path: written.screenshot, contentType: 'image/png'});
  await context.annotate('trace', 'evidence', {path: written.trace, contentType: 'text/markdown'});
});

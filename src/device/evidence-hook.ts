/**
 * Leaves evidence for a device test that fails: the screen, the tree and a
 * trace of its steps, under `.harness/results/`. Imported by the device
 * project's setup file, so Vitest runs this after the test file's own
 * `afterEach`, and a driver closed there leaves no picture, which the trace
 * says: close it in `afterAll`.
 *
 * `HARNESS_TRACE` says when: `retain-on-failure` (the default) for a test
 * that failed, `on` for every test, `off` for none. `HARNESS_VIDEO`, or
 * `video` in the harness config, records the screen through each test and
 * keeps the recording beside the rest by the same three words.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {TestArtifactBase, TestAttachment} from 'vitest';
import {afterEach, beforeEach, recordArtifact} from 'vitest';
import type {Written} from './evidence.ts';
import {resultsFolder, writeEvidence} from './evidence.ts';
import {device} from './index.ts';
import {keepVideo, videoName} from './video.ts';

/**
 * What a reporter is handed for a test's evidence, through
 * `onTestCaseArtifactRecord`: where each file is, and the files attached.
 * An artifact rather than an annotation, since Vitest takes no annotation
 * from a test that has finished, which it has by `afterEach`.
 */
export interface EvidenceArtifact extends TestArtifactBase {
  type: 'expo-vitest:evidence';
  failed: boolean;
  folder: string;
  trace?: string;
  screenshot?: string;
  video?: string;
  attachments: TestAttachment[];
}

declare const EVIDENCE: unique symbol;

declare module '@vitest/runner' {
  interface TestArtifactRegistry {
    [EVIDENCE]: EvidenceArtifact;
  }
}

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

beforeEach(async () => {
  device.journal.begin();
  if ((device.config.video ?? 'off') !== 'off') await device.recordVideo();
});

afterEach(async context => {
  const task = context.task as unknown as Task;
  const failed = task.result?.state === 'fail';
  const mode = process.env.HARNESS_TRACE ?? 'retain-on-failure';
  const titlePath = titlePathOf(task);
  const file = path.relative(ROOT, task.file.filepath).replace(/\\/g, '/');
  let written: Written | undefined;
  // A test that never touched the device has nothing to show.
  if ((mode === 'on' || (mode !== 'off' && failed)) && (device.journal.steps.length > 0 || device.isOpen())) {
    const started = task.result?.startTime ?? Date.now();
    written = await writeEvidence(device.evidence(), {
      root: ROOT,
      titlePath,
      file,
      failed,
      duration: task.result?.duration ?? Date.now() - started,
      at: new Date(started),
      errors: (task.result?.errors ?? []).map(error => `${error.code ? `${error.code}: ` : ''}${error.message ?? String(error)}`),
    });
    console.log(`evidence: ${path.relative(ROOT, written.trace)}`);
  }
  // The recording ends after the evidence is written, so it runs to the screen the evidence shows.
  const folder = written?.folder ?? resultsFolder(ROOT, device.platform, file, titlePath);
  // A recording after a secret was filled could show it, as a picture could.
  const keep = keepVideo(device.config.video ?? 'off', failed) && !device.journal.privacy?.withheld();
  // A test's folder is replaced each time it is written to, so a recording alone is never beside an older run's trace.
  if (keep && !written) fs.rmSync(folder, {recursive: true, force: true});
  const video = await device.saveVideo(keep ? path.join(folder, videoName(device.platform)) : undefined);
  if (!written && !video) return;
  const kept = {folder, ...(written ? {trace: written.trace} : {}), ...(written?.screenshot ? {screenshot: written.screenshot} : {}), ...(video ? {video} : {})};
  task.meta.evidence = kept;
  const attachments: TestAttachment[] = [
    ...(kept.trace ? [{path: kept.trace, contentType: 'text/markdown'}] : []),
    ...(kept.screenshot ? [{path: kept.screenshot, contentType: 'image/png'}] : []),
    ...(video ? [{path: video, contentType: video.endsWith('.webm') ? 'video/webm' : 'video/mp4'}] : []),
  ];
  await recordArtifact(context.task, {type: 'expo-vitest:evidence', failed, ...kept, attachments});
});

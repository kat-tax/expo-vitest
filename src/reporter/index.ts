/**
 * Two Vitest reporters for a run's summary, set beside Vitest's own:
 *
 *   import {github, summary} from 'expo-vitest/reporter';
 *
 *   deviceConfig({platforms: ['web'], reporters: ['default', summary(), github()]});
 *
 * `summary()` writes `.harness/summary.md`, whose evidence links open in an
 * editor. `github()` adds the same text to the job summary and posts it on the
 * pull request, updating its comment on a rerun. Neither throws out of a hook,
 * and neither changes how the run ends.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Reporter, TestCase, Vitest} from 'vitest/node';
import {artifactsOf, COMMENT_LIMIT, markerFor, SUMMARY_LIMIT, targetOf, upsertComment} from './github.ts';
import type {CaseLike} from './records.ts';
import {fromRoot, recordOf} from './records.ts';
import type {Links, RunFacts, TestRecord} from './render.ts';
import {renderSummary} from './render.ts';

/** This package's version, from its manifest, which is a folder above both src and dist. */
function version(): string {
  try {
    const manifest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as {version: string}).version;
  } catch {
    return 'unknown';
  }
}

/** What both reporters keep of a run: its root, when it started, and every test. */
function collecting(): {hooks: Pick<Reporter, 'onInit' | 'onTestCaseResult'>; root(): string; records: TestRecord[]; facts(): RunFacts} {
  let root = process.cwd();
  let started = Date.now();
  const records: TestRecord[] = [];
  return {
    hooks: {
      onInit(vitest: Vitest) {
        root = vitest.config.root;
        started = Date.now();
      },
      onTestCaseResult(testCase: TestCase) {
        records.push(recordOf(testCase as unknown as CaseLike, root));
      },
    },
    root: () => root,
    records,
    facts: () => ({version: version(), duration: Date.now() - started}),
  };
}

/** A hook's work, with anything it throws said in one line rather than failing the run. */
async function quietly(work: () => Promise<void> | void): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.log(`expo-vitest reporter: ${(error as Error).message}`);
  }
}

/** Writes the run's summary to a Markdown file, `.harness/summary.md` unless given, on every run. */
export function summary(options: {file?: string} = {}): Reporter {
  const run = collecting();
  return {
    ...run.hooks,
    async onTestRunEnd() {
      await quietly(() => {
        const file = path.resolve(run.root(), options.file ?? path.join('.harness', 'summary.md'));
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, renderSummary(run.records, run.facts(), {kind: 'relative', from: fromRoot(run.root(), file)}));
      });
    },
  };
}

/**
 * Adds the run's summary to the job summary, and posts it on the pull
 * request, one comment per job, updated on a rerun. `key` tells apart the
 * comments of a matrix's jobs.
 */
export function github(options: {key?: string} = {}): Reporter {
  const run = collecting();
  return {
    ...run.hooks,
    async onTestRunEnd() {
      await quietly(async () => {
        const environment = process.env;
        const artifacts = artifactsOf(environment);
        const facts: RunFacts = {...run.facts(), ...(environment.GITHUB_RUN_ATTEMPT ? {attempt: environment.GITHUB_RUN_ATTEMPT} : {}), ...(artifacts ? {artifacts} : {})};
        const links: Links = artifacts ? {kind: 'artifacts', url: artifacts} : {kind: 'relative', from: '.harness/summary.md'};
        if (environment.GITHUB_STEP_SUMMARY) fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, renderSummary(run.records, facts, links, SUMMARY_LIMIT));
        const where = targetOf(environment, file => fs.readFileSync(file, 'utf8'));
        if ('why' in where) {
          console.log(`expo-vitest reporter: ${where.why}`);
          return;
        }
        const marker = markerFor(environment, options.key);
        const body = `${marker}\n${renderSummary(run.records, facts, links, COMMENT_LIMIT - marker.length - 1)}`;
        console.log(`expo-vitest reporter: ${await upsertComment(where.target, marker, body, (url, init) => fetch(url, init))}`);
      });
    },
  };
}

export type {TestRecord};

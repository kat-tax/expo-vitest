/**
 * The reporter a bug bash's confirmation run is given, by its path: each
 * test's outcome and the code of the error it failed with, written to the
 * file HARNESS_BUGBASH_RESULTS names, so the command can tell a check that
 * failed from a skeleton that never reached its check.
 */
import fs from 'node:fs';
import type {Reporter, TestCase, Vitest} from 'vitest/node';
import type {CaseLike} from '../../reporter/records.ts';
import {recordOf} from '../../reporter/records.ts';
import type {TestRecord} from '../../reporter/render.ts';

export default class BugBashReporter implements Reporter {
  private root = process.cwd();
  private readonly records: TestRecord[] = [];

  onInit(vitest: Vitest): void {
    this.root = vitest.config.root;
  }

  onTestCaseResult(testCase: TestCase): void {
    this.records.push(recordOf(testCase as unknown as CaseLike, this.root));
  }

  onTestRunEnd(): void {
    const file = process.env.HARNESS_BUGBASH_RESULTS;
    if (file) fs.writeFileSync(file, JSON.stringify(this.records));
  }
}

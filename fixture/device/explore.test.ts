// expo-harness explore as a person runs it: the packed package's command,
// with the fixture's model of rules, which sends the sign-in form empty and
// reports that it said nothing. The report must cite, for that finding, the
// step it came after, the tree that step left and its screenshot.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {onlyOn} from 'expo-vitest';

interface Report {
  steps: {tool: string; ok: boolean; query?: string}[];
  findings: {severity: string; step: number; route?: string; tree: string; screenshot?: string}[];
  outcome: {status: string};
}

onlyOn(['web'], () => {
  it('explores, reports the issue with the step, tree and screenshot it came after, and exits 1', () => {
    const out = path.join('.harness', 'explore-fixture');
    fs.rmSync(out, {recursive: true, force: true});
    const bin = path.join(process.cwd(), 'node_modules', 'expo-vitest', 'dist', 'harness', 'index.js');
    const run = spawnSync(process.execPath, [bin, 'explore', 'send the sign-in form empty', '--platform', 'web', '--max-steps', '4', '--out', out], {encoding: 'utf8', timeout: 120_000});
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(1);
    expect(run.stdout).toContain('✗ issue after step 2: Sign in with an empty form says nothing');

    const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')) as Report;
    expect(report.steps.map(step => [step.tool, step.ok])).toEqual([
      ['navigate', true],
      ['tap', true],
    ]);
    expect(report.steps[1]?.query).toBe('screen.getByTestId("sign-in")');
    expect(report.outcome.status).toBe('passed');
    const [finding] = report.findings;
    expect(finding).toMatchObject({severity: 'issue', step: 2, route: '/sign-in', tree: 'steps/002-tap.txt', screenshot: 'screenshots/002.png'});
    expect(fs.readFileSync(path.join(out, 'steps', '002-tap.txt'), 'utf8')).toContain('button "Sign in" #sign-in');
    expect(fs.statSync(path.join(out, 'screenshots', '002.png')).size).toBeGreaterThan(0);
    const markdown = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
    expect(markdown).toContain('## Issues\n\n### 1. Sign in with an empty form says nothing');
    expect(markdown).toContain('After step 2, `tap button "Sign in"`, on `/sign-in`: [tree](steps/002-tap.txt) · [screenshot](screenshots/002.png)');
  }, 120_000);
});

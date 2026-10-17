// expo-harness bug-bash as a person runs it, on the feature map beside this
// file: two charters at once, which the model of rules explores alike, so
// their one finding is merged, and its skeleton is run, its check failing
// for the judge, which makes it a bug. The run serves the page already, so
// the bug bash and its confirmation run are told they are not in CI, where
// a run may not use an app it did not start. A device run without
// HARNESS_BUGBASH then passes the skeleton by.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {onlyOn} from 'expo-vitest';

interface Merged {
  severity: string;
  area: string;
  charter: string;
  duplicates: {charter: string; title: string}[];
}

const SKELETON = 'device/bug-bash/sign-in-sign-in-with-an-empty-form-says-nothing.test.ts';

onlyOn(['web'], () => {
  it('explores two charters, merges their finding, writes its skeleton and confirms it fails its check', () => {
    const out = path.join('.harness', 'bug-bash-fixture');
    fs.rmSync(out, {recursive: true, force: true});
    fs.rmSync('device/bug-bash', {recursive: true, force: true});
    const bin = path.join(process.cwd(), 'node_modules', 'expo-vitest', 'dist', 'harness', 'index.js');
    const env = {...process.env, CI: 'false'};
    const run = spawnSync(process.execPath, [bin, 'bug-bash', '--feature-map', 'device/features.json', '--platform', 'web', '--parallel', '2', '--max-steps', '4', '--out', out], {encoding: 'utf8', env, timeout: 240_000});
    const said = `${run.stdout}\n${run.stderr}`;
    expect(run.status, said).toBe(1);
    expect(run.stdout).toContain('bug-bash on web: 2 charters from device/features.json, 2 at a time');
    expect(run.stdout).toContain(`wrote ${SKELETON}`);
    expect(run.stdout).toContain('1 confirmed, 0 not verified, 0 rejected, 0 warnings');

    const merged = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8')) as Merged[];
    expect(merged.map(each => [each.severity, each.area, each.charter, each.duplicates.map(duplicate => duplicate.charter)])).toEqual([['issue', 'sign-in', 'sign-in-1', ['profile-1']]]);
    expect(fs.existsSync(path.join(out, 'sign-in-1', 'report.md')) && fs.existsSync(path.join(out, 'profile-1', 'report.md'))).toBe(true);
    const skeleton = fs.readFileSync(SKELETON, 'utf8');
    expect(skeleton).toContain('describe.skipIf(!process.env.HARNESS_BUGBASH)("[bugbash] sign-in: Sign in with an empty form says nothing"');
    expect(skeleton).toContain('      await device.open("/sign-in");\n      await screen.getByTestId("sign-in").press();\n');
    const report = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
    expect(report).toContain('## Confirmed bugs\n\n### 1. sign-in: Sign in with an empty form says nothing');
    expect(report).toContain(`\`${SKELETON}\`: its skeleton failed its check: `);

    // Without HARNESS_BUGBASH, a device run passes the skeleton by.
    const quiet = {...env};
    delete quiet.HARNESS_BUGBASH;
    const normal = spawnSync(process.execPath, [path.join('node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', 'vitest.config.device.mts', '--project', 'device:web', '--reporter=verbose', SKELETON], {encoding: 'utf8', env: quiet, timeout: 120_000});
    expect(normal.status, `${normal.stdout}\n${normal.stderr}`).toBe(0);
    expect(normal.stdout).toMatch(/1 skipped/);
  }, 300_000);
});

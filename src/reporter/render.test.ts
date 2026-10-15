import {describe, expect, it} from 'vitest';
import type {TestRecord} from './render.ts';
import {cell, countsOf, errorText, evidenceLinks, headline, platformOf, renderSummary, spoken} from './render.ts';

const record = (extra: Partial<TestRecord> = {}): TestRecord => ({project: 'device:web', file: 'device/settings.test.ts', name: 'settings > opens', state: 'passed', flaky: false, duration: 1200, ...extra});
const failed = record({
  project: 'device:android',
  name: 'settings > opens the profile',
  line: 14,
  state: 'failed',
  error: {code: 'LOCATOR_NOT_FOUND', message: 'nothing matches testID="profile"; the tree has 38 nodes\n  more detail'},
  evidence: {folder: '.harness/results/android/device/settings/opens-the-profile-a1b2c3', trace: '.harness/results/android/device/settings/opens-the-profile-a1b2c3/trace.md', screenshot: '.harness/results/android/device/settings/opens-the-profile-a1b2c3/screenshot.png'},
});
const facts = {version: '0.2.0', duration: 192_000, attempt: '2', artifacts: 'https://github.com/o/r/actions/runs/9#artifacts'};

describe('the counts', () => {
  it('are failed, flaky, passed and skipped, with a pending test counted as skipped', () => {
    const records = [failed, record(), record({flaky: true}), record({state: 'skipped'}), record({state: 'pending'})];
    expect(countsOf(records)).toEqual({failed: 1, flaky: 1, passed: 2, skipped: 2});
    expect(headline(records)).toBe('## expo-vitest · 1 failed · 1 flaky · 2 passed · 2 skipped');
    expect(headline([record()])).toBe('## expo-vitest · 1 passed');
    expect(headline([])).toBe('## expo-vitest · 0 passed');
  });
});

describe('a cell', () => {
  it('is one line, with its pipes escaped', () => {
    expect(cell('a | b\nc\r\n\nd ')).toBe('a \\| b c d');
  });

  it('holds a failure as its code and its first line, cut to a sentence', () => {
    expect(errorText(failed.error)).toBe('LOCATOR_NOT_FOUND: nothing matches testID="profile"; the tree has 38 nodes');
    expect(errorText({message: '\n  expected "Paid" to be visible'})).toBe('expected "Paid" to be visible');
    expect(errorText({message: 'x'.repeat(300)})).toBe(`${'x'.repeat(199)}…`);
    expect(errorText({message: ''})).toBe('');
    expect(errorText(undefined)).toBe('');
  });
});

describe('a span of time', () => {
  it('is said as a person says it', () => {
    expect([spoken(840), spoken(6400), spoken(192_000), spoken(60_000)]).toEqual(['840 ms', '6.4 s', '3 m 12 s', '1 m 0 s']);
  });
});

describe('the evidence links', () => {
  it('are relative to the summary file, which opens in an editor', () => {
    expect(evidenceLinks(failed.evidence, {kind: 'relative', from: '.harness/summary.md'})).toBe(
      '[screenshot](results/android/device/settings/opens-the-profile-a1b2c3/screenshot.png) · [tree](results/android/device/settings/opens-the-profile-a1b2c3/tree.txt) · [trace](results/android/device/settings/opens-the-profile-a1b2c3/trace.md)',
    );
  });

  it("point at the run's artifacts on GitHub, with the folder beside them", () => {
    const {screenshot: _screenshot, ...noPicture} = failed.evidence as NonNullable<TestRecord['evidence']>;
    expect(evidenceLinks(noPicture, {kind: 'artifacts', url: 'https://x/#artifacts'})).toBe('[tree](https://x/#artifacts) · [trace](https://x/#artifacts)<br>`.harness/results/android/device/settings/opens-the-profile-a1b2c3`');
    expect(evidenceLinks(undefined, {kind: 'artifacts', url: 'u'})).toBe('');
    expect(evidenceLinks({folder: 'r/t', video: 'r/t/video.webm'}, {kind: 'relative', from: 'summary.md'})).toBe('[video](r/t/video.webm)');
    expect(evidenceLinks({folder: 'r/t', trace: 'r/t/trace.md', video: 'r/t/video.mp4'}, {kind: 'relative', from: 'summary.md'})).toBe('[tree](r/t/tree.txt) · [trace](r/t/trace.md) · [video](r/t/video.mp4)');
  });

  it('name the platform, not the project', () => {
    expect([platformOf('device:web'), platformOf('ios')]).toEqual(['web', 'ios']);
  });
});

describe('the summary', () => {
  const records = [failed, record({name: 'checkout > pays', flaky: true, duration: 840}), record({project: 'ios', file: 'src/a.test.tsx', name: 'a > renders', state: 'skipped', duration: 0})];

  it('is the counts, the failures, the flaky tests and every test folded away, and the footer', () => {
    expect(renderSummary(records, facts, {kind: 'relative', from: '.harness/summary.md'})).toBe(
      [
        '## expo-vitest · 1 failed · 1 flaky · 1 passed · 1 skipped',
        '',
        '| Platform | Test | Error | Evidence |',
        '| --- | --- | --- | --- |',
        '| android | settings > opens the profile (device/settings.test.ts:14) | LOCATOR_NOT_FOUND: nothing matches testID="profile"; the tree has 38 nodes | [screenshot](results/android/device/settings/opens-the-profile-a1b2c3/screenshot.png) · [tree](results/android/device/settings/opens-the-profile-a1b2c3/tree.txt) · [trace](results/android/device/settings/opens-the-profile-a1b2c3/trace.md) |',
        '',
        '<details><summary>Flaky, passed on retry (1)</summary>',
        '',
        '| Platform | Test | Time |',
        '| --- | --- | --- |',
        '| web | checkout > pays (device/settings.test.ts) | 840 ms |',
        '',
        '</details>',
        '',
        '<details><summary>Every test (3)</summary>',
        '',
        '| Platform | Test | Result | Time |',
        '| --- | --- | --- | --- |',
        '| android | settings > opens the profile (device/settings.test.ts:14) | failed | 1.2 s |',
        '| web | checkout > pays (device/settings.test.ts) | passed on retry | 840 ms |',
        '| ios | a > renders (src/a.test.tsx) | skipped | 0 ms |',
        '',
        '</details>',
        '',
        'expo-vitest 0.2.0 · 3 m 12 s · android, web, ios · attempt 2 · [artifacts](https://github.com/o/r/actions/runs/9#artifacts)',
        '',
      ].join('\n'),
    );
  });

  it('names no platform for a project with no name, as a config without projects runs', () => {
    expect(renderSummary([record({project: ''})], {version: '0.2.0', duration: 5}, {kind: 'relative', from: 'summary.md'})).toContain('\n\nexpo-vitest 0.2.0 · 5 ms\n');
  });

  it('says so in the footer when there were no tests, and leaves out what it was not told', () => {
    expect(renderSummary([], {version: '0.2.0', duration: 5}, {kind: 'relative', from: 'summary.md'})).toBe('## expo-vitest · 0 passed\n\nexpo-vitest 0.2.0 · 5 ms · no tests\n');
  });

  it('fits a limit by folding away every test first, then the flaky ones, then the failures past what fits', () => {
    const links = {kind: 'relative', from: '.harness/summary.md'} as const;
    const whole = renderSummary(records, facts, links);
    const withoutEvery = renderSummary(records, facts, links, whole.length - 1);
    expect(withoutEvery).not.toContain('Every test (3)');
    expect(withoutEvery).toContain('Flaky, passed on retry (1)');
    expect(withoutEvery).toContain('_Every test is left out, to fit._');
    const failuresOnly = renderSummary(records, facts, links, withoutEvery.length - 1);
    expect(failuresOnly).not.toContain('Flaky');
    expect(failuresOnly).toContain('_Every test and the flaky ones are left out, to fit._');
    const many = [failed, failed, failed];
    const cut = renderSummary(many, facts, links, renderSummary([failed], facts, links).length + 80);
    expect(cut).toContain('more failures, every test and the flaky ones are left out, to fit._');
    expect(cut.match(/^\| android/gm)?.length).toBeLessThan(3);
    expect(renderSummary(many, facts, links, 10)).toContain('_3 more failures, every test and the flaky ones are left out, to fit._');
    expect(renderSummary([record()], facts, links, 10)).toBe(renderSummary([record()], facts, links, 10));
    expect(renderSummary([record()], facts, links, 10)).toContain('_Every test and the flaky ones are left out, to fit._');
  });
});

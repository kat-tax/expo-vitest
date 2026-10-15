import path from 'node:path';
import {describe, expect, it} from 'vitest';
import type {ExploreReport, ExploreStep, Finding} from './report.ts';
import {costLine, describeStep, exitCodeOf, findingLine, outcomeLine, renderReport, reportFolder, screenshotFile, stepFile, stepLine} from './report.ts';

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({input, output, cacheRead, cacheWrite});

const steps: ExploreStep[] = [
  {n: 1, tool: 'navigate', input: {url: '/sign-in'}, ok: true, said: '+ heading "Sign in"', route: '/sign-in', tree: 'steps/001-navigate.txt', screenshot: 'screenshots/001.png', calls: 2, usage: usage(1200, 40, 800)},
  {
    n: 2,
    tool: 'tap',
    input: {},
    target: {kind: 'button', name: 'Sign in', testId: 'sign-in'},
    query: 'screen.getByTestId("sign-in")',
    ok: true,
    said: 'screen: unchanged',
    route: '/sign-in',
    tree: 'steps/002-tap.txt',
    screenshot: 'screenshots/002.png',
    calls: 1,
    usage: usage(300, 20, 1500),
  },
  {n: 3, tool: 'type_secret', input: {secret: 'FIXTURE_PASSWORD'}, target: {kind: 'textbox', name: 'Password'}, ok: false, said: 'POLICY_DENIED: <secret:X> | b', tree: 'steps/003-type_secret.txt', calls: 1, usage: usage(10, 5)},
];

const warning: Finding = {severity: 'warning', title: 'The page has no main heading', expected: 'a heading that names the page', observed: 'no heading', steps: [], step: 0, route: '/', tree: 'steps/000-start.txt'};
const issue: Finding = {
  severity: 'issue',
  title: 'An empty form says nothing',
  expected: 'a message naming the empty fields',
  observed: 'the page stayed as it was',
  steps: ['open /sign-in', 'tap Sign in'],
  step: 2,
  route: '/sign-in',
  tree: 'steps/002-tap.txt',
  screenshot: 'screenshots/002.png',
};

const report: ExploreReport = {
  goal: 'send the sign-in form empty',
  platform: 'web',
  agent: 'default',
  models: ['claude-opus-5-5'],
  startedAt: '2026-10-15T12:00:00.000Z',
  durationMs: 12_345,
  outcome: {status: 'passed', summary: 'Sent the form empty; it said nothing.'},
  start: {route: '/', tree: 'steps/000-start.txt', screenshot: 'screenshots/000.png'},
  steps,
  findings: [warning, issue],
  usage: {calls: 4, tokens: usage(1510, 65, 2300), costUsd: 0.0123},
};

describe('the explore report', () => {
  it('puts the issues first, each with its steps and the screen it cites, then the warnings, then every step', () => {
    expect(renderReport(report)).toBe(
      [
        '# Explore: send the sign-in form empty',
        '',
        'web · agent default · 2026-10-15T12:00:00.000Z · 12.3 s · 3 steps · 4 model calls · in 3 810 (cache 60%) · out 65 · $0.0123',
        '',
        'The run concluded passed: Sent the form empty; it said nothing.',
        '',
        '## Issues',
        '',
        '### 1. An empty form says nothing',
        '',
        'Expected: a message naming the empty fields',
        '',
        'Observed: the page stayed as it was',
        '',
        'Steps to reproduce:',
        '',
        '1. open /sign-in',
        '2. tap Sign in',
        '',
        'After step 2, `tap button "Sign in"`, on `/sign-in`: [tree](steps/002-tap.txt) · [screenshot](screenshots/002.png)',
        '',
        '## Warnings',
        '',
        '### 2. The page has no main heading',
        '',
        'Expected: a heading that names the page',
        '',
        'Observed: no heading',
        '',
        'Steps to reproduce:',
        '',
        'None given.',
        '',
        'Before any step, on `/`: [tree](steps/000-start.txt)',
        '',
        '## Steps',
        '',
        '| # | action | answered | screen |',
        '| --- | --- | --- | --- |',
        '| 0 | start | | on `/`: [tree](steps/000-start.txt) · [screenshot](screenshots/000.png) |',
        '| 1 | `navigate "/sign-in"` | + heading "Sign in" | on `/sign-in`: [tree](steps/001-navigate.txt) · [screenshot](screenshots/001.png) |',
        '| 2 | `tap button "Sign in"` | screen: unchanged | on `/sign-in`: [tree](steps/002-tap.txt) · [screenshot](screenshots/002.png) |',
        '| 3 | `type_secret textbox "Password" <secret:FIXTURE_PASSWORD>` | failed: POLICY_DENIED: &lt;secret:X> \\| b | [tree](steps/003-type_secret.txt) |',
        '',
      ].join('\n'),
    );
  });

  it('says where nothing was found, and how a run that was stopped ended', () => {
    const quiet = renderReport({...report, findings: [], steps: [], outcome: {status: 'ended', code: 'STEP_BUDGET_EXHAUSTED', summary: 'it took 8 actions, its budget'}, start: {tree: 'steps/000-start.txt'}});
    expect(quiet).toContain('· 0 steps ·');
    expect(quiet).toContain('The run ended by STEP_BUDGET_EXHAUSTED: it took 8 actions, its budget\n\n## Findings\n\nNone: the run reported nothing off.\n\n## Steps');
    expect(quiet.endsWith('| 0 | start | | [tree](steps/000-start.txt) |\n')).toBe(true);
  });

  it('keeps a table cell on one line', () => {
    const long = renderReport({...report, findings: [], steps: [{...(steps[0] as ExploreStep), said: 'first\n  second'}]});
    expect(long).toContain('| `navigate "/sign-in"` | first second |');
  });
});

describe("the report's lines", () => {
  it('name the files of a step and the folder of a run', () => {
    expect([stepFile(3, 'tap'), stepFile(12, 'type_secret'), screenshotFile(7)]).toEqual(['steps/003-tap.txt', 'steps/012-type_secret.txt', 'screenshots/007.png']);
    const at = new Date(2026, 9, 5, 9, 4, 3);
    expect(reportFolder('/app', at)).toBe(path.join('/app', '.harness', 'explore', '2026-10-05-090403'));
    expect(reportFolder('/app', at, 'bug-bash')).toBe(path.join('/app', '.harness', 'bug-bash', '2026-10-05-090403'));
  });

  it('say what the calls took, and that the cost is not known where it is not', () => {
    expect(costLine({calls: 1, tokens: usage(1234567, 1000), costUsd: null})).toBe('1 model call · in 1 234 567 (cache 0%) · out 1 000 · cost n/a');
  });

  it('describe an action by its tool, its node and its input, a secret by its name', () => {
    expect(describeStep({tool: 'back', input: {}})).toBe('back');
    expect(describeStep({tool: 'type', input: {text: 'ada', replace: true}, target: {kind: 'textbox', name: 'Email'}})).toBe('type textbox "Email" "ada" replace true');
    expect(describeStep({tool: 'type_secret', input: {secret: 'PIN'}})).toBe('type_secret <secret:PIN>');
  });

  it('print how a run ended, a finding as it is made, and a step under debug', () => {
    expect(outcomeLine({status: 'blocked', summary: 'a login'})).toBe('concluded blocked: a login');
    expect(outcomeLine({status: 'ended', code: 'STEP_TIMEOUT', summary: 'it ran past its timeout'})).toBe('ended by STEP_TIMEOUT: it ran past its timeout');
    expect(findingLine(issue)).toBe('✗ issue after step 2: An empty form says nothing');
    expect(findingLine(warning)).toBe('! warning after step 0: The page has no main heading');
    expect(stepLine(steps[0] as ExploreStep)).toBe('· 1 navigate "/sign-in": + heading "Sign in" · 2 calls · in 2 000 out 40');
    expect(stepLine(steps[2] as ExploreStep)).toBe('✗ 3 type_secret textbox "Password" <secret:FIXTURE_PASSWORD>: POLICY_DENIED: <secret:X> | b · 1 call · in 10 out 5');
  });

  it('exit 1 for an issue, 2 where the run could not explore, else 0', () => {
    const passed = {status: 'passed', summary: ''} as const;
    expect(exitCodeOf({findings: [issue], outcome: {status: 'blocked', summary: ''}})).toBe(1);
    expect(exitCodeOf({findings: [warning], outcome: passed})).toBe(0);
    expect(exitCodeOf({findings: [], outcome: {status: 'failed', summary: ''}})).toBe(0);
    expect(exitCodeOf({findings: [], outcome: {status: 'blocked', summary: ''}})).toBe(2);
    expect(exitCodeOf({findings: [], outcome: {status: 'ended', code: 'STEP_BUDGET_EXHAUSTED', summary: ''}})).toBe(0);
    expect(exitCodeOf({findings: [], outcome: {status: 'ended', code: 'STEP_TIMEOUT', summary: ''}})).toBe(0);
    expect(exitCodeOf({findings: [], outcome: {status: 'ended', code: 'MODEL_PROVIDER_FAILED', summary: ''}})).toBe(2);
  });
});

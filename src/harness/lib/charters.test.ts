import {describe, expect, it} from 'vitest';
import type {BugBash, Charter, Found, Merged, RunRecord} from './charters.ts';
import {actionLine, bugBashExit, chartersOf, foundIn, merge, POSTURES, readFeatureMap, renderBugBash, skeletonOf, skeletonPath, slugOf, totalUsage, verdictOf} from './charters.ts';
import type {ExploreReport, ExploreStep, Finding} from './report.ts';

const usage = (input = 0, output = 0) => ({input, output, cacheRead: 0, cacheWrite: 0});
const step = (n: number, tool: string, extra: Partial<ExploreStep> = {}): ExploreStep => ({n, tool, input: {}, ok: true, said: 'screen: unchanged', tree: `steps/00${n}-${tool}.txt`, calls: 1, usage: usage(), ...extra});

const failure = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    return [(error as {code?: string}).code, (error as Error).message];
  }
};

describe('the feature map', () => {
  it('takes areas with goals or none, an agent each, and postures', () => {
    const map = {areas: [{name: 'checkout', goals: ['buy one item'], agent: 'buyer'}, {name: 'settings'}], postures: ['edge input']};
    expect(readFeatureMap(JSON.stringify(map), 'features.json')).toEqual(map);
  });

  it('names the first thing wrong, and the file', () => {
    const read = (value: unknown) => failure(() => readFeatureMap(typeof value === 'string' ? value : JSON.stringify(value), 'features.json'))?.[1];
    expect(failure(() => readFeatureMap('{', 'features.json'))?.[0]).toBe('INVALID_CONFIG');
    expect(read('{')).toMatch(/^features\.json is not JSON: /);
    expect(read([])).toBe('features.json: areas takes a list of areas, each {name, goals, agent}');
    expect(read({areas: []})).toBe('features.json: areas takes a list of areas, each {name, goals, agent}');
    expect(read({areas: [{name: 'a'}], routes: []})).toBe('features.json: routes is not something a feature map takes; it takes areas and postures');
    expect(read({areas: [{name: 'a'}], postures: ['']})).toBe('features.json: postures takes a list of postures in words');
    expect(read({areas: ['a']})).toBe('features.json: areas[0] takes an object: {name, goals, agent}');
    expect(read({areas: [{name: 'a', route: '/'}]})).toBe('features.json: areas[0].route is not something an area takes; it takes name, goals, agent');
    expect(read({areas: [{name: 'Check out'}]})).toBe('features.json: areas[0].name takes lower-case letters, digits and -, since it names files');
    expect(read({areas: [{name: 'a'}, {name: 'a'}]})).toBe('features.json: two areas are called a');
    expect(read({areas: [{name: 'a', goals: 'buy'}]})).toBe('features.json: areas[0].goals takes a list of goals in words');
    expect(read({areas: [{name: 'a', agent: ''}]})).toBe("features.json: areas[0].agent takes the name of one of the harness config's agents");
  });
});

describe('the charters', () => {
  it("are an area's goals, or one a posture, the map's or e2e's five, each with its folder", () => {
    expect(chartersOf({areas: [{name: 'checkout', goals: ['buy one item', 'pay twice'], agent: 'buyer'}, {name: 'settings'}], postures: ['edge input']})).toEqual([
      {area: 'checkout', n: 1, goal: 'In checkout: buy one item', agent: 'buyer', folder: 'checkout-1'},
      {area: 'checkout', n: 2, goal: 'In checkout: pay twice', agent: 'buyer', folder: 'checkout-2'},
      {area: 'settings', n: 1, goal: 'Explore settings. Posture: edge input.', folder: 'settings-1'},
    ]);
    expect(chartersOf({areas: [{name: 'home'}]}).map(charter => charter.goal)).toEqual(POSTURES.map(posture => `Explore home. Posture: ${posture}.`));
  });
});

const finding = (title: string, extra: Partial<Finding> = {}): Finding => ({severity: 'issue', title, expected: 'a message', observed: 'nothing', steps: [], step: 1, tree: 'steps/001-tap.txt', ...extra});
const charter: Charter = {area: 'sign-in', n: 1, goal: 'In sign-in: send the form empty', folder: 'sign-in-1'};

describe('the merge', () => {
  it("keeps each finding with its charter, the run's start and its steps up to it", () => {
    const report = {findings: [finding('An empty form says nothing', {step: 1})], steps: [step(1, 'tap'), step(2, 'back')], start: {tree: 'steps/000-start.txt'}};
    expect(foundIn(charter, report)).toEqual([{...finding('An empty form says nothing'), area: 'sign-in', charter: 'sign-in-1', start: {tree: 'steps/000-start.txt'}, actions: [step(1, 'tap')]}]);
  });

  it('drops a finding onto the first with its route and title, or its first three steps, and names it there', () => {
    const at = (title: string, folder: string, extra: Partial<Finding> = {}): Found => ({...finding(title, extra), area: 'sign-in', charter: folder, start: {tree: 'steps/000-start.txt'}, actions: []});
    const three = ['open /sign-in', 'tap Sign in', 'read the page'];
    const merged = merge([
      at('An empty form says nothing', 'sign-in-1', {route: '/sign-in'}),
      at('an  EMPTY form says nothing ', 'profile-1', {route: '/sign-in'}),
      at('An empty form says nothing', 'profile-2', {route: '/profile'}),
      at('No message', 'sign-in-2', {steps: three}),
      at('The form is silent', 'sign-in-3', {steps: [...three.map(each => each.toUpperCase()), 'wait']}),
      at('Two steps', 'sign-in-4', {steps: three.slice(0, 2)}),
      at('Two steps alike', 'sign-in-5', {steps: three.slice(0, 2)}),
    ]);
    expect(merged.map(each => [each.charter, each.duplicates])).toEqual([
      ['sign-in-1', [{charter: 'profile-1', title: 'an  EMPTY form says nothing '}]],
      ['profile-2', []],
      ['sign-in-2', [{charter: 'sign-in-3', title: 'The form is silent'}]],
      ['sign-in-4', []],
      ['sign-in-5', []],
    ]);
  });
});

describe('the skeletons', () => {
  it('are named by their area and title, numbered where the name is taken', () => {
    expect(slugOf('A negative quantity: the total reads -12.00!')).toBe('a-negative-quantity-the-total-reads-12-00');
    expect(slugOf('one two three four five six seven eight nine ten eleven')).toBe('one-two-three-four-five-six-seven-eight-nine-ten');
    expect(slugOf('x'.repeat(60))).toBe('x'.repeat(48));
    expect(slugOf('!!!')).toBe('finding');
    const taken = new Set<string>();
    expect([skeletonPath({area: 'checkout', title: 'Total'}, taken), skeletonPath({area: 'checkout', title: 'total'}, taken), skeletonPath({area: 'checkout', title: 'TOTAL'}, taken)]).toEqual([
      'device/bug-bash/checkout-total.test.ts',
      'device/bug-bash/checkout-total-2.test.ts',
      'device/bug-bash/checkout-total-3.test.ts',
    ]);
  });

  it('write each step as a device test does, and a comment where a test does it otherwise', () => {
    const on = {target: {kind: 'button', name: 'Pay'}, query: 'screen.getByRole("button", {name: "Pay"})'};
    const lines = [
      step(1, 'tap', on),
      step(2, 'long_press', on),
      step(3, 'type', {...on, input: {text: '-1', replace: true}}),
      step(4, 'type', {...on, input: {text: '0', replace: false}}),
      step(5, 'type_secret', {target: {kind: 'textbox', name: 'Password'}, query: 'screen.getByTestId("password")', input: {secret: 'PASSWORD'}}),
      step(6, 'check', {...on, input: {checked: true}}),
      step(7, 'check', {...on, input: {checked: false}}),
      step(8, 'press', {input: {key: 'Enter'}}),
      step(9, 'scroll', {...on, input: {direction: 'down'}}),
      step(10, 'scroll', {input: {direction: 'down'}}),
      step(11, 'scroll_to', on),
      step(12, 'scroll_to', {input: {text: 'Terms'}}),
      step(13, 'navigate', {input: {url: '/checkout'}}),
      step(14, 'navigate', {input: {url: 'https://example.com/pay'}}),
      step(15, 'back'),
      step(16, 'dismiss_keyboard'),
      step(17, 'tap_at', {input: {x: 10, y: 20}}),
      step(18, 'seed_account'),
      step(19, 'tap', {target: {kind: 'button', name: 'Pay'}}),
      step(20, 'tap', {...on, ok: false, said: 'NOT_ACTIONABLE: it is\ndisabled'}),
    ].map(actionLine);
    expect(lines).toEqual([
      'await screen.getByRole("button", {name: "Pay"}).press();',
      'await screen.getByRole("button", {name: "Pay"}).longPress();',
      'await screen.getByRole("button", {name: "Pay"}).fill("-1");',
      'await screen.getByRole("button", {name: "Pay"}).type("0");',
      'await agent.act("fill the textbox \\"Password\\" with {value}", {params: {value: secret("PASSWORD")}});',
      'await screen.getByRole("button", {name: "Pay"}).check();',
      'await screen.getByRole("button", {name: "Pay"}).uncheck();',
      'await device.key("Enter");',
      'await screen.getByRole("button", {name: "Pay"}).swipe("up");',
      '// step 10, scroll "down": a test scrolls the node that scrolls, with swipe',
      'await screen.getByRole("button", {name: "Pay"}).scrollIntoView();',
      'await screen.getByText("Terms").scrollIntoView();',
      'await device.open("/checkout");',
      'await device.openLink("https://example.com/pay");',
      'await device.back();',
      'await device.dismissKeyboard();',
      '// step 17, tap_at x 10 y 20: a point of a screenshot, which a test finds by the node there',
      "// step 18, seed_account: the project's tool, which a test calls for itself",
      '// step 19, tap button "Pay": no query finds that node alone',
      '// step 20, tap button "Pay", failed in the explore: NOT_ACTIONABLE: it is disabled',
    ]);
  });

  it('are the steps up to the issue, then its expectation checked by the judge, skipped unless HARNESS_BUGBASH is set', () => {
    const found: Found = {
      ...finding('Sign in with an empty form\nsays nothing', {steps: ['open /sign-in', 'tap Sign in'], expected: 'a message that names\nthe empty fields', observed: 'the page stayed as it was'}),
      area: 'sign-in',
      charter: 'sign-in-1',
      start: {route: '/', tree: 'steps/000-start.txt'},
      actions: [step(1, 'navigate', {input: {url: '/sign-in'}}), step(2, 'tap', {target: {kind: 'button', name: 'Sign in'}, query: 'screen.getByTestId("sign-in")'})],
    };
    expect(skeletonOf(found, 'web', '2026-10-15')).toBe(
      [
        '// Found by expo-harness bug-bash on 2026-10-15 in sign-in, by the charter sign-in-1.',
        '// Expected: a message that names the empty fields',
        '// Observed: the page stayed as it was',
        '// The steps, as the explore told them:',
        '//   1. open /sign-in',
        '//   2. tap Sign in',
        "import {agent} from 'expo-vitest/agent';",
        "import {device, onlyOn, screen} from 'expo-vitest';",
        "import {describe, it} from 'vitest';",
        '',
        'describe.skipIf(!process.env.HARNESS_BUGBASH)("[bugbash] sign-in: Sign in with an empty form says nothing", () => {',
        '  onlyOn(["web"], () => {',
        '    it("a message that names the empty fields", async () => {',
        '      await device.open("/");',
        '      await device.open("/sign-in");',
        '      await screen.getByTestId("sign-in").press();',
        "      // Review: the expectation in the agent's words. Where a matcher says the same, it is the faster check.",
        '      await agent.assert("a message that names the empty fields");',
        '    });',
        '  });',
        '});',
        '',
      ].join('\n'),
    );
    const secretly = skeletonOf({...found, steps: [], start: {tree: 'steps/000-start.txt'}, actions: [step(1, 'type_secret', {target: {kind: 'textbox', name: 'Code'}, query: 'screen.getByTestId("code")', input: {secret: 'CODE'}})]}, 'android', '2026-10-15');
    expect(secretly).toContain("// Observed: the page stayed as it was\nimport {agent, secret} from 'expo-vitest/agent';");
    expect(secretly).toContain('  onlyOn(["android"], () => {');
    expect(secretly).toContain('      await device.open("/");\n      await agent.act(');
  });
});

describe('a verdict', () => {
  const record = (state: RunRecord['state'], error?: RunRecord['error'], file = 'device/bug-bash/a.test.ts'): RunRecord => ({project: 'device:web', file, state, ...(error ? {error} : {})});

  it("is a bug where the skeleton's check failed, rejected where it passed, and not verified otherwise", () => {
    const file = 'device/bug-bash/a.test.ts';
    expect(verdictOf([], file)).toEqual({status: 'unchecked', reason: 'its skeleton did not run'});
    expect(verdictOf([record('skipped'), record('failed', {code: 'ASSERTION_FAILED', message: 'x'}, 'device/bug-bash/b.test.ts')], file)).toEqual({status: 'unchecked', reason: 'its skeleton did not run'});
    expect(verdictOf([record('passed')], file)).toEqual({status: 'rejected', reason: 'its skeleton passed: the app did what was expected'});
    expect(verdictOf([record('passed'), record('failed', {code: 'ASSERTION_FAILED', message: 'agent.assert("a message"): no\nmessage shows'})], file)).toEqual({
      status: 'confirmed',
      reason: 'its skeleton failed its check: agent.assert("a message"): no message shows',
    });
    expect(verdictOf([record('failed', {code: 'LOCATOR_NOT_FOUND', message: 'no button "Pay"'})], file)).toEqual({status: 'unverified', reason: 'its skeleton failed before its check, LOCATOR_NOT_FOUND: no button "Pay"'});
    expect(verdictOf([record('failed', {message: 'boom'})], file)).toEqual({status: 'unverified', reason: 'its skeleton failed before its check, without a code: boom'});
    expect(verdictOf([record('pending')], file)).toEqual({status: 'unverified', reason: 'its skeleton failed before its check, without a code: it did not finish'});
  });
});

describe('the bug bash report', () => {
  const report = (findings: Finding[]): ExploreReport => ({
    goal: 'g',
    platform: 'web',
    agent: 'default',
    models: [],
    startedAt: '2026-10-15T12:00:00.000Z',
    durationMs: 1000,
    outcome: {status: 'passed', summary: 'Explored.'},
    start: {tree: 'steps/000-start.txt'},
    steps: [],
    findings,
    usage: {calls: 2, tokens: usage(100, 10), costUsd: null},
  });
  const merged = (title: string, folder: string, extra: Partial<Merged> = {}): Merged => ({...finding(title), area: 'sign-in', charter: folder, start: {tree: 'steps/000-start.txt'}, actions: [], duplicates: [], ...extra});
  const run: BugBash = {
    map: 'device/features.json',
    platform: 'web',
    parallel: 2,
    startedAt: '2026-10-15T12:00:00.000Z',
    durationMs: 5000,
    runs: [
      {charter, report: report([finding('An empty form says nothing')])},
      {charter: {area: 'profile', n: 1, goal: 'Explore | profile', folder: 'profile-1'}, error: 'DRIVER_UNAVAILABLE: no browser'},
    ],
    issues: [
      {found: merged('An empty form says nothing', 'sign-in-1', {steps: ['open /sign-in'], duplicates: [{charter: 'profile-2', title: 'Silent form'}]}), skeleton: 'device/bug-bash/a.test.ts', verdict: {status: 'confirmed', reason: 'its skeleton failed its check: no message'}},
      {found: merged('Pay does nothing', 'sign-in-1'), skeleton: 'device/bug-bash/b.test.ts', verdict: {status: 'unchecked', reason: 'its skeleton did not run'}},
      {found: merged('Total is wrong', 'sign-in-1'), verdict: {status: 'unchecked', reason: 'it was not checked: --no-confirm'}},
      {found: merged('Back is broken', 'sign-in-1'), skeleton: 'device/bug-bash/c.test.ts', verdict: {status: 'rejected', reason: 'its skeleton passed: the app did what was expected'}},
    ],
    warnings: [merged('No heading', 'sign-in-1', {severity: 'warning', step: 0, tree: 'steps/000-start.txt'})],
    usage: {calls: 2, tokens: usage(100, 10), costUsd: 0.5},
  };

  it('puts the confirmed bugs first, then the risks, the rejected and the warnings, then each charter', () => {
    expect(renderBugBash(run)).toBe(
      [
        '# Bug bash: device/features.json',
        '',
        'web · 2 charters, 2 at a time · 2026-10-15T12:00:00.000Z · 5.0 s · 2 model calls · in 100 (cache 0%) · out 10 · $0.5000',
        '',
        '## Confirmed bugs',
        '',
        '### 1. sign-in: An empty form says nothing',
        '',
        'Expected: a message',
        '',
        'Observed: nothing',
        '',
        'Steps to reproduce:',
        '',
        '1. open /sign-in',
        '',
        'Found by sign-in-1 after step 1 ([report](sign-in-1/report.md), [tree](sign-in-1/steps/001-tap.txt)), and by profile-2 as "Silent form".',
        '',
        '`device/bug-bash/a.test.ts`: its skeleton failed its check: no message.',
        '',
        '## Risks it could not verify',
        '',
        '### 2. sign-in: Pay does nothing',
        '',
        'Expected: a message',
        '',
        'Observed: nothing',
        '',
        'Steps to reproduce:',
        '',
        'None given.',
        '',
        'Found by sign-in-1 after step 1 ([report](sign-in-1/report.md), [tree](sign-in-1/steps/001-tap.txt)).',
        '',
        '`device/bug-bash/b.test.ts`: its skeleton did not run.',
        '',
        '### 3. sign-in: Total is wrong',
        '',
        'Expected: a message',
        '',
        'Observed: nothing',
        '',
        'Steps to reproduce:',
        '',
        'None given.',
        '',
        'Found by sign-in-1 after step 1 ([report](sign-in-1/report.md), [tree](sign-in-1/steps/001-tap.txt)).',
        '',
        'it was not checked: --no-confirm.',
        '',
        '## Rejected',
        '',
        '### 4. sign-in: Back is broken',
        '',
        'Expected: a message',
        '',
        'Observed: nothing',
        '',
        'Steps to reproduce:',
        '',
        'None given.',
        '',
        'Found by sign-in-1 after step 1 ([report](sign-in-1/report.md), [tree](sign-in-1/steps/001-tap.txt)).',
        '',
        '`device/bug-bash/c.test.ts`: its skeleton passed: the app did what was expected.',
        '',
        '## Warnings',
        '',
        '### 5. sign-in: No heading',
        '',
        'Expected: a message',
        '',
        'Observed: nothing',
        '',
        'Steps to reproduce:',
        '',
        'None given.',
        '',
        'Found by sign-in-1 after step 0 ([report](sign-in-1/report.md), [tree](sign-in-1/steps/000-start.txt)).',
        '',
        '## Charters',
        '',
        '| charter | goal | how it ended | findings | cost |',
        '| --- | --- | --- | --- | --- |',
        '| [sign-in-1](sign-in-1/report.md) | In sign-in: send the form empty | concluded passed: Explored. | 1 | 2 model calls · in 100 (cache 0%) · out 10 · cost n/a |',
        '| [profile-1](profile-1/report.md) | Explore \\| profile | could not explore: DRIVER_UNAVAILABLE: no browser |  |  |',
        '',
      ].join('\n'),
    );
  });

  it('says where a group is empty, with one charter', () => {
    const quiet = renderBugBash({...run, runs: [run.runs[0] as BugBash['runs'][number]], issues: [], warnings: []});
    expect(quiet).toContain('· 1 charter, 2 at a time ·');
    expect(quiet).toContain('## Confirmed bugs\n\nNone.\n\n## Risks it could not verify\n\nNone.\n\n## Rejected\n\nNone.\n\n## Warnings\n\nNone.\n\n## Charters');
  });

  it("adds every charter's calls and tokens, and the cost while each one's is known", () => {
    const priced = (calls: number, costUsd: number | null) => ({charter, report: {...report([]), usage: {calls, tokens: usage(calls * 100, calls), costUsd}}});
    expect(totalUsage([priced(2, 0.25), run.runs[1] as BugBash['runs'][number], priced(3, 0.5)])).toEqual({calls: 5, tokens: usage(500, 5), costUsd: 0.75});
    expect(totalUsage([priced(2, 0.25), priced(1, null)]).costUsd).toBeNull();
  });

  it('exits 1 on a bug, or on an issue whose skeleton did not run, 2 where no charter explored, else 0', () => {
    const [confirmed, unchecked, , rejected] = run.issues as BugBash['issues'];
    const unverified = {...(confirmed as BugBash['issues'][number]), verdict: {status: 'unverified' as const, reason: 'its skeleton failed before its check'}};
    const explored = [run.runs[0] as BugBash['runs'][number]];
    expect(bugBashExit({runs: explored, issues: [confirmed as BugBash['issues'][number]]})).toBe(1);
    expect(bugBashExit({runs: explored, issues: [unchecked as BugBash['issues'][number]]})).toBe(1);
    expect(bugBashExit({runs: explored, issues: [unverified, rejected as BugBash['issues'][number]]})).toBe(0);
    expect(bugBashExit({runs: explored, issues: []})).toBe(0);
    expect(bugBashExit({runs: [run.runs[1] as BugBash['runs'][number]], issues: []})).toBe(2);
  });
});

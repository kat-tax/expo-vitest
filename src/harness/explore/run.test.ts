import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {done, FakeDevice, hostOf, signIn} from '../../agent/__fixtures__/device.ts';
import {callsTool, scriptedModel} from '../../agent/__fixtures__/model.ts';
import type {AgentConfig} from '../../agent/config.ts';
import {resolveAgent} from '../../agent/config.ts';
import type {ActingHost} from '../../agent/hands.ts';
import {SecretStore} from '../../agent/secrets.ts';
import {defineTool} from '../../agent/tools.ts';
import type {Model} from '../../agent/types.ts';
import {encodePng} from '../lib/png.ts';
import type {ExploreStep, Finding} from '../lib/report.ts';
import {EXPLORE_PROMPT, exploreTurn, runExplore} from './run.ts';

/** A PNG the driver writes: the screen at its own size, all one grey. */
const writer = (file: string) => {
  fs.writeFileSync(file, encodePng({width: 400, height: 800, pixels: Buffer.alloc(400 * 800 * 4, 128)}));
  return Promise.resolve(done());
};

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-explore-'));
const read = (out: string, file: string) => fs.readFileSync(path.join(out, file), 'utf8');
const finish = (summary = 'Explored the form.') => callsTool('complete_step', {status: 'passed', summary, errorCode: null});

/** A device whose fill puts what it was given in the email field, and a run over it. */
function setUp(model: Model, options: {secrets?: Record<string, string>; maxSteps?: number; timeout?: number; tools?: ReturnType<typeof defineTool>[]; host?: Partial<ActingHost>; agent?: Partial<AgentConfig>} = {}) {
  const device: FakeDevice = new FakeDevice({
    screenshot: writer,
    fill: (target, text) => {
      device.calls.push(`fill ${JSON.stringify(target)} ${JSON.stringify(text)}`);
      device.screen = signIn({email: text});
      return Promise.resolve(done());
    },
  });
  const out = folder();
  const findings: Finding[] = [];
  const steps: ExploreStep[] = [];
  const run = () =>
    runExplore({
      host: hostOf(device, options.host),
      agent: resolveAgent({default: {model, context: 'A sign-in form.', ...(options.tools ? {tools: options.tools} : {}), ...options.agent}}, 'default'),
      goal: 'send the form with no password',
      maxSteps: options.maxSteps ?? 8,
      timeout: options.timeout ?? 60_000,
      secrets: new SecretStore(options.secrets ?? {}, {} as NodeJS.ProcessEnv),
      out,
      onFinding: finding => void findings.push(finding),
      onStep: step => void steps.push(step),
    });
  return {device, out, findings, steps, run};
}

describe("an explore's model", () => {
  it("carries the agent's provider options on every call, as a test's agent does", async () => {
    const model = scriptedModel([callsTool('tap', {ref: '@e5'}), finish()]);
    await setUp(model, {agent: {providerOptions: {anthropic: {metadata: {user_id: 'explore'}}}}}).run();
    expect(model.requests.map(request => request.providerOptions)).toEqual([{anthropic: {metadata: {user_id: 'explore'}}}, {anthropic: {metadata: {user_id: 'explore'}}}]);
  });
});

describe('an explore', () => {
  it('acts toward the goal, keeps the tree and a picture of every step, and a finding with the step it came after', async () => {
    const model = scriptedModel([
      callsTool('type', {ref: '@e2', text: 'ada', replace: true}),
      callsTool('tap', {ref: '@e5'}),
      callsTool('report_finding', {severity: 'issue', title: 'Sign in with no password says nothing', expected: 'a message that the password is missing', observed: 'the form stayed as it was', steps: ['type ada as the email', 'tap Sign in']}),
      finish('Sent the form with no password; it said nothing.'),
    ]);
    const {device, out, findings, steps, run} = setUp(model);
    const report = await run();

    expect(device.calls).toEqual(['fill {"ref":"@e11"} "ada"', 'press {"ref":"@e14"}']);
    expect(report.steps.map(step => [step.n, step.tool, step.input, step.target, step.query, step.ok, step.tree, step.screenshot])).toEqual([
      [1, 'type', {text: 'ada', replace: true}, {kind: 'textbox', name: 'Email'}, 'screen.getByRole("textbox", {name: "Email"})', true, 'steps/001-type.txt', 'screenshots/001.png'],
      [2, 'tap', {}, {kind: 'button', name: 'Sign in'}, 'screen.getByRole("button", {name: "Sign in"})', true, 'steps/002-tap.txt', 'screenshots/002.png'],
    ]);
    expect(report.steps[1]?.said).toBe('screen: unchanged');
    expect([report.steps[0]?.calls, report.steps[1]?.calls]).toEqual([1, 1]);
    expect(report.findings).toEqual([
      {
        severity: 'issue',
        title: 'Sign in with no password says nothing',
        expected: 'a message that the password is missing',
        observed: 'the form stayed as it was',
        steps: ['type ada as the email', 'tap Sign in'],
        step: 2,
        tree: 'steps/002-tap.txt',
        screenshot: 'screenshots/002.png',
      },
    ]);
    expect([findings, steps]).toEqual([report.findings, report.steps]);
    expect(report.outcome).toEqual({status: 'passed', summary: 'Sent the form with no password; it said nothing.'});
    expect(report.start).toEqual({tree: 'steps/000-start.txt', screenshot: 'screenshots/000.png'});
    expect(report.usage.calls).toBe(4);
    expect([report.goal, report.platform, report.agent, report.models]).toEqual(['send the form with no password', 'web', 'default', ['claude-opus-5-5']]);

    expect(read(out, 'steps/001-type.txt')).toContain('@e2 textbox "Email" (value:"ada")');
    expect(fs.readdirSync(path.join(out, 'screenshots'))).toEqual(['000.png', '001.png', '002.png']);
    expect(read(out, 'transcript.txt')).toContain('report_finding');
    // The frozen prompt first, then the app; the first turn the goal, the budget and the screen.
    const first = model.requests[0];
    expect(first?.system.map(block => block.text)).toEqual([EXPLORE_PROMPT, 'About the app:\nA sign-in form.']);
    expect(first?.tools.map(tool => tool.name)).toContain('report_finding');
    const opening = first?.messages[0];
    expect(opening?.role === 'user' && opening.content[0]?.type === 'text' ? opening.content[0].text : '').toBe('Goal: send the form with no password\n\nYou have 8 actions and 1 minute to explore with. The run ends when you call complete_step, or when they are spent.');
  });

  it('keeps an action that failed as a step, hides a secret in every tree, keeps no picture after one is filled, and ends on the budget', async () => {
    const model = scriptedModel([
      callsTool('tap', {ref: '@e99'}),
      callsTool('type_secret', {ref: '@e2', secret: 'RECOVERY'}),
      callsTool('report_finding', {severity: 'warning', title: 'The code rc-4417-secret-value shows', expected: 'a hidden code', observed: 'the code in the field', steps: []}),
      callsTool('tap', {ref: '@e5'}),
      callsTool('tap', {ref: '@e5'}),
    ]);
    const {out, run} = setUp(model, {secrets: {RECOVERY: 'rc-4417-secret-value'}, maxSteps: 2});
    const report = await run();

    expect(report.steps.map(step => [step.n, step.tool, step.ok, step.said, step.screenshot])).toEqual([
      [1, 'tap', false, 'LOCATOR_NOT_FOUND: @e99 is not on the screen now; observe to see what is', 'screenshots/001.png'],
      [2, 'type_secret', true, '~ @e2  textbox  "Email"  value="<secret:RECOVERY>"', undefined],
      [3, 'tap', true, 'screen: unchanged', undefined],
    ]);
    expect(report.steps[1]?.input).toEqual({secret: 'RECOVERY'});
    expect(read(out, 'steps/002-type_secret.txt')).toContain('(value:"<secret:RECOVERY>")');
    expect(report.findings[0]).toMatchObject({severity: 'warning', title: 'The code <secret:RECOVERY> shows', step: 2, tree: 'steps/002-type_secret.txt'});
    expect(report.findings[0]?.screenshot).toBeUndefined();
    expect(fs.readdirSync(path.join(out, 'screenshots'))).toEqual(['000.png', '001.png']);
    expect(report.outcome).toEqual({status: 'ended', code: 'STEP_BUDGET_EXHAUSTED', summary: 'it took 2 actions, its budget'});
    // The first turn names each secret it may fill.
    const opening = model.requests[0]?.messages[0];
    expect(opening?.role === 'user' && opening.content[0]?.type === 'text' ? opening.content[0].text : '').toContain('Secrets you may fill with type_secret, by name:\n- RECOVERY: a secret, <secret:RECOVERY>');
  });

  it("keeps a project's tool that changes the app as a step, failing or not, and one that only reads as none", async () => {
    const none = {type: 'object', properties: {}, additionalProperties: false};
    const seed = defineTool({name: 'seed', description: 'Seed an account.', schema: none, mutates: true, execute: () => 'seeded'});
    const wipe = defineTool({name: 'wipe', description: 'Wipe the accounts.', schema: none, mutates: true, execute: () => Promise.reject(new Error('no database'))});
    const look = defineTool({name: 'look_up', description: 'Look an account up.', schema: none, execute: () => 'found'});
    const model = scriptedModel([callsTool('seed', {}), callsTool('wipe', {}), callsTool('look_up', {}), finish()]);
    const report = await setUp(model, {tools: [seed, wipe, look]}).run();
    expect(report.steps.map(step => [step.tool, step.ok, step.said, step.target])).toEqual([
      ['seed', true, 'seeded', undefined],
      ['wipe', false, 'the tool failed: no database', undefined],
    ]);
  });

  it('keeps where the app is, a node by its test id, and an input without what was left out', async () => {
    const model = scriptedModel([
      callsTool('report_finding', {severity: 'warning', title: 'The form has no heading', expected: 'a heading', observed: 'none', steps: []}),
      callsTool('long_press', {ref: '@e5', durationMs: null}),
      callsTool('report_finding', {severity: 'warning', title: 'A long press does nothing', expected: 'a menu', observed: 'nothing', steps: ['long press Sign in']}),
      finish(),
    ]);
    const {device, run} = setUp(model, {host: {route: () => Promise.resolve('/sign-in'), scheme: 'fixture'}});
    device.screen = {...signIn(), nodes: signIn().nodes.map(each => (each.role === 'button' ? {...each, testId: 'sign-in'} : each))};
    const report = await run();
    expect(report.start.route).toBe('/sign-in');
    expect(report.steps[0]).toMatchObject({input: {}, target: {kind: 'button', name: 'Sign in', testId: 'sign-in'}, query: 'screen.getByTestId("sign-in")', route: '/sign-in'});
    expect(report.findings.map(finding => [finding.step, finding.route, finding.tree, finding.screenshot])).toEqual([
      [0, '/sign-in', 'steps/000-start.txt', 'screenshots/000.png'],
      [1, '/sign-in', 'steps/001-long_press.txt', 'screenshots/001.png'],
    ]);
  });

  it('keeps the action a timeout stopped as a step, and ends where the driver is gone', async () => {
    const hung = setUp(scriptedModel([callsTool('tap', {ref: '@e5'})]), {timeout: 200});
    (hung.device.driver as {press: unknown}).press = () => new Promise(() => undefined);
    const stopped = await hung.run();
    expect(stopped.steps.map(step => [step.tool, step.ok, step.said])).toEqual([['tap', false, 'STEP_TIMEOUT: it ran past its timeout of 200 ms']]);
    expect(stopped.outcome).toEqual({status: 'ended', code: 'STEP_TIMEOUT', summary: 'it ran past its timeout of 200 ms'});

    const gone = setUp(scriptedModel([callsTool('tap', {ref: '@e5'})]));
    // A driver answers rather than throws, with the code of what went wrong.
    (gone.device.driver as {press: unknown}).press = () => Promise.resolve({ok: false, code: 'DRIVER_UNAVAILABLE', message: 'the browser closed'});
    const ended = await gone.run();
    expect(ended.steps.map(step => [step.ok, step.said])).toEqual([[false, 'DRIVER_UNAVAILABLE: the browser closed']]);
    expect(ended.outcome).toEqual({status: 'ended', code: 'DRIVER_UNAVAILABLE', summary: 'the browser closed'});
  });

  it('is stopped by what ends a step, a model that fails among them, and needs a model to begin', async () => {
    const failing: Model = {id: 'broken', complete: () => Promise.reject(new Error('the network is down'))};
    const report = await setUp(failing).run();
    expect(report.outcome).toEqual({status: 'ended', code: 'MODEL_PROVIDER_FAILED', summary: 'the network is down'});
    expect(report.usage.costUsd).toBe(0);
    const unpriced = await setUp(scriptedModel([{...finish(), model: 'unknown-model'}])).run();
    expect(unpriced.usage.costUsd).toBeNull();

    // A completion with no tool calls at all is a bug in the model's adapter, not something the run reads.
    const bug: Model = {id: 'buggy', complete: () => Promise.resolve({text: '', stopReason: 'tool_use', usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, model: 'buggy'} as never)};
    await expect(setUp(bug).run()).rejects.toThrow(TypeError);

    const none = {...setUp(scriptedModel([])), agent: resolveAgent(undefined, 'default')};
    await expect(
      runExplore({host: hostOf(new FakeDevice()), agent: none.agent, goal: 'look around', maxSteps: 1, timeout: 1000, secrets: new SecretStore({}, {} as NodeJS.ProcessEnv), out: none.out}),
    ).rejects.toMatchObject({code: 'MODEL_UNAVAILABLE', explanation: 'the agent default has no model; give it one under agents in the harness config'});
  });

  it('takes no picture where the platform takes none, or where the driver fails to take one', async () => {
    const device = new FakeDevice({screenshot: () => Promise.reject(new Error('the window is gone'))});
    const out = folder();
    const report = await runExplore({
      host: hostOf(device),
      agent: resolveAgent({default: {model: scriptedModel([callsTool('tap', {ref: '@e5'}), finish()])}}, 'default'),
      goal: 'tap',
      maxSteps: 1,
      timeout: 1000,
      secrets: new SecretStore({}, {} as NodeJS.ProcessEnv),
      out,
    });
    expect([report.start.screenshot, report.steps[0]?.screenshot]).toEqual([undefined, undefined]);
    expect(fs.existsSync(path.join(out, 'screenshots'))).toBe(false);
  });
});

describe("an explore's first turn", () => {
  it('gives the time in minutes from one, else in seconds, and names a password as one', () => {
    const text = (turn: ReturnType<typeof exploreTurn>) => (turn.role === 'user' && turn.content[0]?.type === 'text' ? turn.content[0].text : '');
    expect(text(exploreTurn('go', {actions: 1, timeout: 150_000}, [{name: 'PASSWORD', purpose: 'password'}], 'view'))).toBe(
      'Goal: go\n\nYou have 1 action and 3 minutes to explore with. The run ends when you call complete_step, or when they are spent.\n\nSecrets you may fill with type_secret, by name:\n- PASSWORD: a password, <secret:PASSWORD>',
    );
    expect(text(exploreTurn('go', {actions: 2, timeout: 400}, [], 'view'))).toContain('2 actions and 1 second');
    expect(text(exploreTurn('go', {actions: 2, timeout: 30_000}, [], 'view'))).toContain('2 actions and 30 seconds');
  });
});

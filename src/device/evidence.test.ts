import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import type {Snapshot, SnapshotNode} from '../harness/lib/snapshot.ts';
import type {EvidenceSource, Step, TreeDigest} from './evidence.ts';
import {Journal, diffDigests, digest, identify, renderTrace, resultsFolder, sanitiseTitle, writeEvidence} from './evidence.ts';

const node = (ref: string, role: string, name: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name, depth: 1, interactive: false, ...extra});
const tree = (...nodes: SnapshotNode[]): Snapshot => ({platform: 'web', nodes});

const home = tree(node('@e1', 'button', 'Settings', {kind: 'button', testId: 'settings', interactive: true, focused: true}), node('@e2', 'span', 'Drops', {kind: 'text'}));
const settings = tree(
  node('@e1', 'h1', 'Settings', {kind: 'heading', heading: 1}),
  node('@e3', 'input', 'Name', {kind: 'textbox', testId: 'name', interactive: true, focused: true}),
  node('@e4', 'input', 'E-mail address', {kind: 'textbox', testId: 'email', interactive: true}),
  node('@e2', 'span', 'Drops', {kind: 'text'}),
);

/** A clock a test moves. */
function clock() {
  const time = {at: 1000};
  return {time, now: () => time.at};
}

describe('a digest', () => {
  it('keeps what each node is, by kind or role and testID or name, which had the focus, and how many can be acted on', () => {
    expect(identify(node('@e9', 'Custom', 'Pane'))).toBe('Custom "Pane"');
    expect(digest(home)).toEqual({nodes: ['button "settings"', 'text "Drops"'], focused: 'button "settings"', interactive: 1});
    expect(digest(tree(node('@e1', 'span', 'x')))).toEqual({nodes: ['span "x"'], interactive: 0});
  });

  it('says what came, what went and where the focus moved, or that nothing changed', () => {
    expect(diffDigests(digest(home), digest(settings))).toBe(
      '+3 −1: appeared heading "Settings", textbox "name", textbox "email"; gone button "settings"; focus button "settings" → textbox "name"',
    );
    expect(diffDigests(digest(home), digest(home))).toBe('unchanged');
    const many: TreeDigest = {nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], interactive: 0};
    expect(diffDigests({nodes: [], interactive: 0}, many)).toBe('+8 −0: appeared a, b, c, d, e, f and 2 more');
    expect(diffDigests({nodes: ['a', 'a'], focused: 'a', interactive: 0}, {nodes: ['a'], interactive: 0})).toBe('+0 −1: gone a; focus a → nowhere');
    expect(diffDigests({nodes: ['a'], interactive: 0}, {nodes: ['a'], focused: 'a', interactive: 0})).toBe('+0 −0: focus nowhere → a');
  });
});

describe('the journal', () => {
  it('records each step with when it began, how long it took and how it ended, and tells who listens', async () => {
    const {time, now} = clock();
    const journal = new Journal(now);
    journal.begin();
    const heard: Step[] = [];
    const stop = journal.onStep(step => heard.push(step));
    time.at += 100;
    await journal.run({event: 'open', what: '/'}, async () => void (time.at += 800));
    await journal.run({event: 'key', what: 'Enter'}, async () => 'skipped' as const, answer => ({result: answer, message: 'no keys'}));
    stop();
    await expect(journal.run({event: 'press', what: 'getByText("Save")', resolved: '@e7 button "Save"'}, async () => Promise.reject(new Error('covered')))).rejects.toThrow('covered');
    expect(journal.steps).toEqual([
      {index: 1, event: 'open', what: '/', startedAt: 100, durationMs: 800, result: 'ok', message: ''},
      {index: 2, event: 'key', what: 'Enter', startedAt: 900, durationMs: 0, result: 'skipped', message: 'no keys'},
      {index: 3, event: 'press', what: 'getByText("Save")', resolved: '@e7 button "Save"', startedAt: 900, durationMs: 0, result: 'failed', message: 'covered'},
    ]);
    expect(heard.map(step => step.index)).toEqual([1, 2]);
  });

  it('digests a snapshot into the step under way, or into the last step that has none yet, and keeps the last', async () => {
    const journal = new Journal();
    journal.saw(home);
    expect(journal.last).toBe(home);
    await journal.run({event: 'open', what: '/'}, async () => journal.saw(home));
    await journal.run({event: 'press', what: 'Settings'}, async () => {});
    journal.saw(settings);
    journal.saw(home);
    expect(journal.steps.map(step => step.treeAfter?.nodes.length)).toEqual([2, 4]);
    expect(journal.last).toBe(home);
    journal.begin();
    expect([journal.steps, journal.last]).toEqual([[], null]);
  });

  it("keeps the app's console with when each line came, the last 500 of them, and starts afresh with a test", () => {
    const {time, now} = clock();
    const journal = new Journal(now);
    journal.begin();
    time.at += 250;
    journal.log('error', 'boom');
    expect(journal.console).toEqual([{level: 'error', text: 'boom', at: 250}]);
    for (let line = 0; line < 600; line++) journal.log('log', `line ${line}`);
    expect(journal.console).toHaveLength(500);
    expect(journal.console[0]?.text).toBe('line 100');
    journal.begin();
    expect(journal.console).toEqual([]);
  });

  it("notes a step once it is over, from when it began, and keeps the agent's steps until the next test", () => {
    const {time, now} = clock();
    const journal = new Journal(now);
    journal.begin();
    const began = journal.time();
    time.at += 300;
    const noted = journal.note({event: 'agent', what: 'act "sign in"', began, result: 'ok', message: 'passed: Signed in.'});
    expect(noted).toEqual({index: 1, event: 'agent', what: 'act "sign in"', startedAt: 0, durationMs: 300, result: 'ok', message: 'passed: Signed in.'});
    journal.agents.push({kind: 'act', instruction: 'sign in', agent: 'default', outcome: 'passed', turns: []});
    journal.begin();
    expect([journal.steps, journal.agents]).toEqual([[], []]);
  });

  it("says an action was seen to take effect, naming the last that did not fail, and nothing when there was none", async () => {
    const journal = new Journal();
    journal.verified('expect(getByText("Saved")) to be visible');
    expect(journal.steps).toEqual([]);
    await journal.run({event: 'press', what: 'Save'}, async () => {});
    await journal.run({event: 'snapshot', what: 'the whole tree'}, async () => {});
    await journal.run({event: 'fill', what: 'Name'}, async () => Promise.reject(new Error('no field'))).catch(() => {});
    await journal.run({event: 'hover', what: 'More'}, async () => 'skipped', () => ({result: 'skipped', message: ''}));
    journal.verified('expect(getByText("Saved")) to be visible');
    expect(journal.steps.at(-1)).toMatchObject({index: 5, event: 'verified', verifies: 1, message: 'step 1 took effect', result: 'ok'});
  });
});

describe('where evidence goes', () => {
  it('names a test folder by its titles, cleaned, cut short and told apart by a hash', () => {
    expect(sanitiseTitle(['settings', 'opens the profile form'])).toMatch(/^settings-opens-the-profile-form-[0-9a-f]{6}$/);
    expect(sanitiseTitle(['Ça va?'])).not.toBe(sanitiseTitle(['?a va?']));
    expect(sanitiseTitle(['x'.repeat(100)])).toMatch(/^x{80}-[0-9a-f]{6}$/);
    expect(sanitiseTitle(['a'.repeat(79) + ' b'])).toMatch(/^a{79}-[0-9a-f]{6}$/);
    expect(sanitiseTitle(['!!!'])).toMatch(/^[0-9a-f]{6}$/);
  });

  it('puts it under .harness/results by platform and the test file, without its extension', () => {
    const root = path.join(os.tmpdir(), 'app');
    const folder = resultsFolder(root, 'web', 'device/settings.test.ts', ['opens settings']);
    expect(path.relative(root, folder).split(path.sep).slice(0, 4)).toEqual(['.harness', 'results', 'web', 'device']);
    expect(path.basename(path.dirname(folder))).toBe('settings');
    expect(path.relative(root, resultsFolder(root, 'ios', path.join(root, 'e2e', 'a.spec.ts'), ['t'])).split(path.sep).slice(2, 5)).toEqual(['ios', 'e2e', 'a.spec']);
  });
});

describe('the trace', () => {
  const steps: Step[] = [
    {index: 1, event: 'open', what: '/', startedAt: 0, durationMs: 812, result: 'ok', message: '', treeAfter: digest(home)},
    {index: 2, event: 'press', what: 'getByRole("button", {name: "Settings"})', resolved: '@e1   button "Settings" #settings', startedAt: 840, durationMs: 96, result: 'ok', message: '', treeAfter: digest(settings)},
    {index: 3, event: 'assert', what: 'expect(getByLabelText("Email")) to be visible', startedAt: 950, durationMs: 5003, result: 'failed', message: 'not so within 5.0 s\nmore', polls: 13, readings: ['gone'], treeAfter: digest(settings)},
    {index: 4, event: 'snapshot', what: 'a | b', startedAt: 6000, durationMs: 10, result: 'ok', message: ''},
    {index: 5, event: 'wait', what: 'x', startedAt: 6100, durationMs: 1, result: 'ok', message: '', polls: 1},
  ];

  it('reads as the test, its failure, its steps with the screen after each, and the screen at the end', () => {
    const trace = renderTrace({
      titlePath: ['settings', 'opens the profile form'],
      platform: 'web',
      file: 'device/settings.test.ts',
      failed: true,
      duration: 6400,
      at: new Date('2026-10-13T06:24:00.123Z'),
      errors: ['AssertionError: expected getByLabelText("Email") to be visible within 5.0 s'],
      steps,
      tree: settings,
      noScreenshot: 'the driver was closed',
    });
    expect(trace).toBe(
      [
        '# settings › opens the profile form',
        '',
        'web · device/settings.test.ts · failed after 6.4 s · 2026-10-13T06:24:00Z',
        '',
        'AssertionError: expected getByLabelText("Email") to be visible within 5.0 s',
        '',
        '## Steps',
        '',
        '| # | at | step | took | result | screen after |',
        '| --- | --- | --- | --- | --- | --- |',
        '| 1 | 0.00 s | open / | 812 ms | ok | 2 nodes |',
        '| 2 | 0.84 s | press getByRole("button", {name: "Settings"}) → @e1   button "Settings" #settings | 96 ms | ok | +3 −1: appeared heading "Settings", textbox "name", textbox "email"; gone button "settings"; focus button "settings" → textbox "name" |',
        '| 3 | 0.95 s | assert expect(getByLabelText("Email")) to be visible | 5.0 s | failed: not so within 5.0 s | polled 13 times, unchanged |',
        '| 4 | 6.00 s | snapshot a \\| b | 10 ms | ok |  |',
        '| 5 | 6.10 s | wait x | 1 ms | ok | polled 1 time |',
        '',
        '## Screen at failure',
        '',
        'Screenshot: not taken, the driver was closed.',
        '',
        '4 nodes, 2 interactive. Full tree in tree.txt, JSON in tree.json.',
        '',
        '      @e1 h1/heading "Settings" (h1)',
        '      @e3 input/textbox "Name" #name [focused]',
        '      @e4 input/textbox "E-mail address" #email',
        '      @e2 span/text "Drops"',
        '',
      ].join('\n'),
    );
  });

  it("names the component behind the failing step's node, with the end of the chain above it, and the app's console", () => {
    const chain = ['App', 'Router', 'Screen', 'Settings', 'Section', 'Row', 'Field', 'Label', 'Form', 'Group', 'Line', 'SaveButton', 'Pressable', 'View'];
    const trace = renderTrace({
      titlePath: ['t'],
      platform: 'web',
      file: 'a.test.ts',
      failed: true,
      duration: 1,
      at: new Date(0),
      errors: [],
      steps: [],
      tree: null,
      chain: {node: '@e7 button "Save"', component: 'SaveButton', chain},
      console: [{level: 'warn', text: 'a | b\nc', at: 1500}],
    });
    expect(trace).toContain('## Component\n\n@e7 button "Save" is drawn by SaveButton:\n\n    … › Screen › Settings › Section › Row › Field › Label › Form › Group › Line › SaveButton › Pressable › View\n');
    expect(trace).toContain('## Console\n\n| at | level | text |\n| --- | --- | --- |\n| 1.50 s | warn | a \\| b c |');
    const plain = renderTrace({titlePath: ['t'], platform: 'web', file: 'a.test.ts', failed: true, duration: 1, at: new Date(0), errors: [], steps: [], tree: null, chain: {node: '@e1 text "Hi"', chain: ['View']}});
    expect(plain).toContain('@e1 text "Hi" is drawn by no component of the app:\n\n    View\n');
    const long = Array.from({length: 60}, (_, at) => ({level: 'log', text: `line ${at}`, at}));
    expect(renderTrace({titlePath: ['t'], platform: 'web', file: 'a.test.ts', failed: true, duration: 1, at: new Date(0), errors: [], steps: [], tree: null, console: long})).toContain('The last 50 of 60 lines.');
  });

  it("gives each of the agent's steps a section: what it was, who ran it, how it ended, and its last turns", () => {
    const trace = renderTrace({
      titlePath: ['sign in'],
      platform: 'web',
      file: 'device/a.test.ts',
      failed: false,
      duration: 10,
      at: new Date('2026-10-15T00:00:00Z'),
      errors: [],
      steps: [],
      tree: null,
      agents: [
        {kind: 'act', instruction: 'sign in as Ada', agent: 'default', outcome: 'passed: Signed in. · 2 calls · 1 action', turns: ['tap {"ref":"@e5"} -> screen: unchanged', 'complete_step passed: Signed in.']},
        {kind: 'assert', instruction: 'the welcome shows', agent: 'buyer', outcome: 'pass: The heading reads Welcome back.', turns: []},
      ],
    });
    expect(trace).toContain(
      [
        '## Agent',
        '',
        '### act "sign in as Ada" · default',
        '',
        'passed: Signed in. · 2 calls · 1 action',
        '',
        '    tap {"ref":"@e5"} -> screen: unchanged',
        '    complete_step passed: Signed in.',
        '',
        '### assert "the welcome shows" · buyer',
        '',
        'pass: The heading reads Welcome back.',
        '',
        '## Screen at the end',
      ].join('\n'),
    );
  });

  it('says so where there were no steps and no tree, a test passed, and the tree is long', () => {
    const none = renderTrace({titlePath: ['t'], platform: 'ios', file: 'a.test.ts', failed: false, duration: 20, at: new Date(0), errors: [], steps: [], tree: null});
    expect(none).toContain('ios · a.test.ts · passed in 20 ms · 1970-01-01T00:00:00Z');
    expect(none).toContain('No steps were taken.');
    expect(none).toContain('## Screen at the end\n\nNo tree was read.');
    const skipped: Step = {index: 1, event: 'hover', what: 'getByText("More")', startedAt: 0, durationMs: 1, result: 'skipped', message: ''};
    expect(renderTrace({titlePath: ['t'], platform: 'ios', file: 'a.test.ts', failed: false, duration: 1, at: new Date(0), errors: [], steps: [skipped], tree: null})).toContain('| 1 | 0.00 s | hover getByText("More") | 1 ms | skipped |  |');
    const long = tree(...Array.from({length: 45}, (_, at) => node(`@e${at}`, 'li', `Row ${at}`)));
    expect(renderTrace({titlePath: ['t'], platform: 'web', file: 'a.test.ts', failed: true, duration: 1, at: new Date(0), errors: [], steps: [], tree: long})).toContain('    ... and 5 more in tree.txt');
  });
});

describe('writeEvidence', () => {
  /** A device that answers what the writer asks, as a test sets. */
  function source(options: {open?: boolean; screenshot?: () => Promise<boolean>; tree?: () => Promise<Snapshot>; last?: Snapshot | null} = {}): EvidenceSource {
    const journal = new Journal();
    journal.last = options.last === undefined ? home : options.last;
    return {
      platform: 'web',
      journal,
      open: () => options.open ?? true,
      screenshot: options.screenshot ?? (async (file: string) => (fs.writeFileSync(file, 'png'), true)),
      tree: options.tree ?? (async () => settings),
    };
  }
  const input = (root: string) => ({root, titlePath: ['opens settings'], file: 'device/settings.test.ts', failed: true, duration: 10, at: new Date(0), errors: ['boom']});

  it('writes the picture, the tree twice and the trace into a fresh folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
    const first = await writeEvidence(source(), input(root));
    fs.writeFileSync(path.join(first.folder, 'stale.txt'), 'old');
    const written = await writeEvidence(source(), input(root));
    expect(fs.readdirSync(written.folder).sort()).toEqual(['screenshot.png', 'trace.md', 'tree.json', 'tree.txt']);
    expect(written.screenshot).toBe(path.join(written.folder, 'screenshot.png'));
    expect(fs.readFileSync(path.join(written.folder, 'tree.txt'), 'utf8')).toContain('@e3 input/textbox "Name"');
    expect(JSON.parse(fs.readFileSync(path.join(written.folder, 'tree.json'), 'utf8'))).toEqual(settings);
    expect(fs.readFileSync(written.trace, 'utf8')).toContain('4 nodes, 2 interactive');
    fs.rmSync(root, {recursive: true, force: true});
  });

  it("writes the pictures the agent kept beside the trace, by the names its errors gave", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
    const kept = source();
    kept.journal.agents.push({kind: 'assert', instruction: 'the welcome shows', agent: 'default', outcome: 'fail', turns: [], picture: {name: 'agent-1.png', png: Buffer.from('png')}});
    kept.journal.agents.push({kind: 'act', instruction: 'sign in', agent: 'default', outcome: 'passed', turns: []});
    const written = await writeEvidence(kept, input(root));
    expect(fs.readFileSync(path.join(written.folder, 'agent-1.png'), 'utf8')).toBe('png');
    fs.rmSync(root, {recursive: true, force: true});
  });

  it("hides the agent's secrets in what it writes, and keeps no picture where the agent says none may be", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
    const typed = tree(node('@e1', 'input', 'Recovery code', {kind: 'textbox', value: 'rc-7731-secret', interactive: true}));
    const kept = source({tree: async () => typed});
    kept.journal.privacy = {redact: text => text.replaceAll('rc-7731-secret', '<secret:RECOVERY>'), withheld: () => 'a secret was filled in this test'};
    const written = await writeEvidence(kept, input(root));
    const all = ['tree.txt', 'tree.json', 'trace.md'].map(name => fs.readFileSync(path.join(written.folder, name), 'utf8')).join('\n');
    expect(all).not.toContain('rc-7731-secret');
    expect(all).toContain('<secret:RECOVERY>');
    expect([written.screenshot, fs.existsSync(path.join(written.folder, 'screenshot.png'))]).toEqual([undefined, false]);
    expect(fs.readFileSync(written.trace, 'utf8')).toContain('Screenshot: not taken, a secret was filled in this test.');
    fs.rmSync(root, {recursive: true, force: true});
  });

  it('says why there is no picture, and falls back to the last tree the journal kept', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
    const closed = await writeEvidence(source({open: false}), input(root));
    expect(closed.screenshot).toBeUndefined();
    expect(fs.readFileSync(closed.trace, 'utf8')).toContain('Screenshot: not taken, the driver was closed.\n\n2 nodes');
    const refused = await writeEvidence(source({screenshot: async () => false, tree: () => Promise.reject(new Error('gone'))}), input(root));
    expect(fs.readFileSync(refused.trace, 'utf8')).toContain('Screenshot: not taken, the backend could not take one.\n\n2 nodes');
    const thrown = await writeEvidence(source({screenshot: () => Promise.reject(new Error('no window\nmore'))}), input(root));
    expect(fs.readFileSync(thrown.trace, 'utf8')).toContain('Screenshot: not taken, taking it failed: no window.');
    const blank = await writeEvidence(source({open: false, last: null}), input(root));
    expect(fs.readdirSync(blank.folder)).toEqual(['trace.md']);
    expect(fs.readFileSync(blank.trace, 'utf8')).toContain('No tree was read.');
    fs.rmSync(root, {recursive: true, force: true});
  });

  it('gives each node the component behind it, and the failing step its chain, where the React tree can be read', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
    const reading = source();
    reading.react = async () => ({nodes: [{id: 1, host: 'input', chain: ['App', 'NameField', 'TextInput'], component: 'NameField', ref: '@e3'}]});
    reading.journal.steps.push(
      {index: 1, event: 'fill', what: 'getByTestId("name")', resolved: '@e3   textbox "Name" #name', startedAt: 0, durationMs: 1, result: 'ok', message: ''},
      {index: 2, event: 'press', what: 'getByText("Gone")', resolved: '@e9   button "Gone"', startedAt: 1, durationMs: 1, result: 'ok', message: ''},
    );
    const written = await writeEvidence(reading, input(root));
    const trace = fs.readFileSync(written.trace, 'utf8');
    expect(trace).not.toContain('## Component');
    expect(fs.readFileSync(path.join(written.folder, 'tree.txt'), 'utf8')).toContain('@e3 input/textbox "Name" <NameField> #name [focused]');
    reading.journal.steps[1] = {...(reading.journal.steps[1] as Step), result: 'failed', resolved: undefined};
    reading.journal.steps[0] = {...(reading.journal.steps[0] as Step), result: 'failed'};
    const again = await writeEvidence(reading, input(root));
    expect(fs.readFileSync(again.trace, 'utf8')).toContain('@e3 textbox "Name" is drawn by NameField:\n\n    App › NameField › TextInput');
    reading.react = async () => ({nodes: [{id: 1, host: 'input', chain: ['TextInput'], ref: '@e3'}]});
    reading.tree = async () => tree(node('@e3', 'input', 'Name', {testId: 'name'}));
    expect(fs.readFileSync((await writeEvidence(reading, input(root))).trace, 'utf8')).toContain('@e3 input "Name" is drawn by no component of the app:');
    reading.react = async () => null;
    expect(fs.readFileSync((await writeEvidence(reading, input(root))).trace, 'utf8')).not.toContain('## Component');
    reading.react = () => Promise.reject(new Error('no Metro'));
    expect(fs.readFileSync((await writeEvidence(reading, input(root))).trace, 'utf8')).not.toContain('## Component');
    reading.journal.steps.length = 0;
    reading.react = async () => ({nodes: []});
    expect(fs.readFileSync((await writeEvidence(reading, input(root))).trace, 'utf8')).not.toContain('## Component');
    fs.rmSync(root, {recursive: true, force: true});
  });

  it('reads the real time by default', async () => {
    const journal = new Journal();
    const spy = vi.spyOn(Date, 'now');
    journal.begin();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

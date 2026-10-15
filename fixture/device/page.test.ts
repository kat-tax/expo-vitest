// The device layer as an app has it: the packed package, driving a real
// Chromium over a page served for the run. Each test reads like the ones in
// the docs, and between them they touch the queries, the actions, the
// matchers, the evidence, a screenshot and the command.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {device, isHarnessError, screen, within} from 'expo-vitest/device';

afterAll(() => device.close());

it('finds the form by role and label, fills it, and waits for the save to show', async () => {
  await device.open('/');
  await expect(screen.getByRole('heading', {name: 'Profile'})).toBeVisible();
  const name = screen.getByPlaceholderText('Your name');
  await name.fill('Ada');
  await expect(name).toHaveValue('Ada');
  await screen.getByRole('checkbox', {name: 'Send me news'}).check();
  await expect(screen.getByRole('checkbox', {name: 'Send me news'})).toBeChecked();
  await screen.getByRole('button', {name: 'Save'}).press();
  await expect(screen.getByRole('progressbar', {name: 'Saving'})).toBeHidden();
  await expect(screen.getByText('Saved')).toBeVisible();
});

it('reads a list, strictly, and inside one node', async () => {
  await expect(screen.getAllByRole('listitem')).toHaveCount(3);
  await expect(screen.getAllByRole('listitem')).toHaveText(['First draft', 'Second draft', 'Third draft']);
  await expect(within(screen.getByRole('list', {name: 'Drafts'})).getByText('Second draft')).toBeVisible();
  const ambiguous = await screen
    .getByRole('button')
    .press()
    .catch((error: unknown) => error);
  expect(isHarnessError(ambiguous) && ambiguous.code).toBe('LOCATOR_AMBIGUOUS');
  expect(await screen.findByRole('status')).toMatchObject({name: 'Saved'});
});

it('waits for something to be gone, and stay gone', async () => {
  await screen.getByRole('button', {name: 'Reset'}).press();
  await expect(screen.getByText('Saved')).not.toBeVisible();
  await expect(screen.getByPlaceholderText('Your name')).toHaveValue('');
  await expect(screen.getByRole('checkbox', {name: 'Send me news'})).not.toBeChecked();
});

it('keeps a screenshot as evidence where there is no baseline', async () => {
  await expect(device).toMatchScreenshot('profile');
  expect(fs.existsSync(path.join(process.cwd(), '.harness', 'web-profile.actual.png'))).toBe(true);
});

it('left a trace for each test before it, with its steps', () => {
  const folder = path.join(process.cwd(), '.harness', 'results', 'web', 'device', 'page');
  const traces = fs.readdirSync(folder).map(test => fs.readFileSync(path.join(folder, test, 'trace.md'), 'utf8'));
  const first = traces.find(trace => trace.startsWith('# finds the form by role and label'));
  expect(first).toContain('| check getByRole("checkbox", {name: "Send me news"}) → ');
  expect(first).toContain('| verified expect(getByText("Saved")) to be visible |');
  expect(fs.readdirSync(folder).every(test => fs.existsSync(path.join(folder, test, 'tree.json')))).toBe(true);
});

it('drives the same page with the command an app has installed', () => {
  const bin = path.join(process.cwd(), 'node_modules', 'expo-vitest', 'dist', 'harness', 'index.js');
  const out = execFileSync(process.execPath, [bin, '-p', 'web', '--url', process.env.HARNESS_URL as string, 'open', '/', 'tree'], {encoding: 'utf8'});
  expect(out).toContain('h1/heading "Profile"');
});

// The device layer as an app has it: the packed package, driving a real
// Chromium over a page served for the run. Each test reads like the ones in
// the docs, and between them they touch the queries, the actions, the
// matchers, the evidence, a screenshot, the harness config and the command.
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {inject} from 'vitest';
import {by, device, isHarnessError, onlyOn, requires, screen, step, within} from 'expo-vitest';

afterAll(() => device.close());

it('runs on the app harness.config.ts names, served by the command it starts', () => {
  expect(device.config).toMatchObject({platform: 'web', url: 'http://127.0.0.1:41731', assertionTimeout: 4000});
  expect(inject('harness.command')).toMatchObject({key: expect.stringContaining('serve.mjs')});
  expect(inject('harness.runId')).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{6}$/);
});

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

it('matches a masked baseline with the clock moved on, and not without the mask', async () => {
  await screen.getByRole('button', {name: 'Start the clock'}).press();
  const clock = {mask: [by.testID('clock')]};
  // Recorded here and compared here, since a baseline belongs to the machine that drew it.
  process.env.HARNESS_UPDATE_SCREENSHOTS = '1';
  try {
    await expect(device).toMatchScreenshot('masked', clock);
  } finally {
    delete process.env.HARNESS_UPDATE_SCREENSHOTS;
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  await expect(device).toMatchScreenshot('masked', clock);
  const unmasked = await expect(device)
    .toMatchScreenshot('masked', {maxRatio: 0})
    .catch((error: unknown) => error);
  expect(isHarnessError(unmasked) && unmasked.code).toBe('SCREENSHOT_MISMATCH');
  for (const kind of ['expected', 'actual', 'diff']) expect(fs.existsSync(path.join(process.cwd(), '.harness', `web-masked.${kind}.png`)), kind).toBe(true);
  // The harness config gives the app an identity, which keeps its baselines in a folder of their own.
  expect(fs.existsSync(path.join(process.cwd(), 'device', '__screenshots__', 'web', 'fixture', 'masked.png'))).toBe(true);
});

it("restarts the app in a fresh context, and clears what it kept", async () => {
  await screen.getByPlaceholderText('Your name').fill('Ada');
  expect(await device.restart()).toBe('done');
  await expect(screen.getByPlaceholderText('Your name')).toHaveValue('');
  await expect(screen.getByText('Tick 0')).toBeVisible();
  expect(await device.clearState()).toBe('done');
  await expect(screen.getByRole('heading', {name: 'Profile'})).toBeVisible();
});

it('goes back from a link, and says which page is in front', async () => {
  await screen.getByRole('link', {name: 'All drafts'}).press();
  expect(await device.foregroundApp()).toBe(`${device.config.url}/drafts`);
  expect(await device.back()).toBe('done');
  expect(await device.foregroundApp()).toBe(`${device.config.url}/`);
});

it("sets the device's appearance and network, and puts each back", async () => {
  expect(await device.setAppearance('dark')).toBe('done');
  await expect(screen.getByText('Scheme: dark')).toBeVisible();
  expect(await device.setAppearance('light')).toBe('done');
  await expect(screen.getByText('Scheme: light')).toBeVisible();
  expect(await device.setNetwork('offline')).toBe('done');
  await expect(screen.getByText('Online: false')).toBeVisible();
  expect(await device.setNetwork('online')).toBe('done');
  await expect(screen.getByText('Online: true')).toBeVisible();
});

// On web the clipboard is Chromium's alone, so under HARNESS_BROWSER=webkit
// or firefox this is skipped with the reason.
requires(['clipboard', 'setClipboard'], () => {
  it('keeps text on the clipboard', async () => {
    expect(await device.setClipboard('from the fixture')).toBe('done');
    expect(await device.clipboard()).toBe('from the fixture');
  });
});

it('double clicks, as two clicks the browser counts as one', async () => {
  await device.open('/press');
  await screen.getByRole('button', {name: 'Open'}).press();
  await expect(screen.getByText('Clicks: 1')).toBeVisible();
  await expect(screen.getByText('Opened by a double click')).toBeHidden();
  await screen.getByRole('button', {name: 'Open'}).press({count: 2});
  await expect(screen.getByText('Clicks: 3')).toBeVisible();
  await expect(screen.getByText('Opened by a double click')).toBeVisible();
});

it("drags a card onto a list, by the browser's own drag and drop, and a held pointer across", async () => {
  await device.open('/drag');
  await screen.getByText('Card').dragTo(screen.getByRole('region', {name: 'Done'}));
  await expect(screen.getByText('Dropped Card on Done')).toBeVisible();
  await screen.getByTestId('handle').dragTo(screen.getByTestId('end'));
  await expect(screen.getByTestId('moved')).toHaveText(/^Moved [1-9]\d* times$/);
});

it('keeps a signed-in session when the app ends, and starts from it after a restart, but not after the state is cleared', async () => {
  expect(await device.clearState()).toBe('done');
  await device.open('/session');
  await expect(screen.getByText('Signed out')).toBeVisible();
  await screen.getByRole('button', {name: 'Sign in'}).press();
  await expect(screen.getByText('Signed in as Ada')).toBeVisible();
  // Ended and started again, the app finds what it kept.
  expect(await device.stopApp()).toBe('done');
  expect(await device.foregroundApp()).toBe('about:blank');
  await device.open('/session');
  await expect(screen.getByText('Signed in as Ada')).toBeVisible();
  const kept = await device.web.storageState('.harness/session.json');
  expect(JSON.parse(fs.readFileSync(kept as string, 'utf8'))).toMatchObject({cookies: [expect.objectContaining({name: 'session'})], origins: [expect.objectContaining({localStorage: [{name: 'user', value: 'Ada'}]})]});
  expect(await device.restart()).toBe('done');
  await device.open('/session');
  await expect(screen.getByText('Signed in as Ada')).toBeVisible();
  expect(await device.clearState()).toBe('done');
  await device.open('/session');
  await expect(screen.getByText('Signed out')).toBeVisible();
});

it('travels a route, a place a second, and ends on the last', async () => {
  await device.open('/place');
  expect(await device.setLocation({latitude: 51.5, longitude: -0.12})).toBe('done');
  await screen.getByRole('button', {name: 'Follow'}).press();
  await expect(screen.getByText('At 51.5000,-0.1200')).toBeVisible();
  // About 22 m at 10 m a second: three seconds on the way.
  expect(await device.travel([{latitude: 51.5, longitude: -0.12}, {latitude: 51.5002, longitude: -0.12}], {speed: 10})).toBe('done');
  await expect(screen.getByText('At 51.5002,-0.1200')).toBeVisible();
  await expect(screen.getByTestId('seen')).toHaveText(/^Seen ([3-9]|\d{2,}) places$/);
});

it('names an image by its alt, an SVG by its title, and anything else by its title last', async () => {
  await device.open('/names');
  await expect(screen.getByRole('img', {name: 'A red square'})).toBeVisible();
  await expect(screen.getByRole('img', {name: 'Close'})).toBeVisible();
  await expect(screen.getByRole('button', {name: 'Search'})).toBeVisible();
  await expect(screen.getByText('●')).toBeVisible();
  expect(await screen.queryByText('Online')).toBeNull();
  // What is inside an image is part of the picture.
  expect(await screen.queryAllByRole('img', {name: 'Chart'})).toHaveLength(1);
  // What a screen reader says after the name: a title that does not name, and what aria-describedby points at.
  await expect(screen.getByRole('button', {name: '×'})).toHaveAttribute('help', 'Delete the draft');
  await expect(screen.getByRole('textbox', {name: 'Email'})).toHaveAttribute('help', 'We never share it');
  expect(await screen.tree()).not.toContain('svg ""');
});

it("finds an image by its alt and anything by its title, as Testing Library's queries do", async () => {
  await device.open('/names');
  await expect(screen.getByAltText('A red square')).toBeVisible();
  await expect(screen.getByAltText('Search')).toHaveRole('button');
  await expect(screen.getByAltText('A red square')).toHaveAttribute('alt', 'A red square');
  await expect(screen.getByTitle('Delete the draft')).toHaveAccessibleName('×');
  await expect(screen.getByTitle('Close')).toHaveRole('image');
  await expect(screen.getByTitle(/^On/)).toHaveText('●');
  // The image inside role="img" is part of the picture: only the outer one is found, and not by an alt it does not have.
  expect(await screen.queryByAltText('Chart')).toBeNull();
  await expect(screen.findByTitle('Open', {}, {timeout: 0})).rejects.toThrow('the titles there: "Close", "Delete the draft", "Online"');
});

it('names its own steps', async () => {
  await step('Open the profile', async () => {
    await device.open('/');
    await expect(screen.getByRole('heading', {name: 'Profile'})).toBeVisible();
  });
});

it('left a trace for each test before it, with its steps', () => {
  const folder = path.join(process.cwd(), '.harness', 'results', 'web', 'device', 'page');
  const traces = fs.readdirSync(folder).map(test => fs.readFileSync(path.join(folder, test, 'trace.md'), 'utf8'));
  const first = traces.find(trace => trace.startsWith('# finds the form by role and label'));
  expect(first).toContain('| check getByRole("checkbox", {name: "Send me news"}) → ');
  expect(first).toContain('| verified expect(getByText("Saved")) to be visible |');
  const named = traces.find(trace => trace.startsWith('# names its own steps'));
  expect(named).toContain('| step "Open the profile" |');
  expect(named).toContain('| Open the profile › open / |');
  expect(fs.readdirSync(folder).every(test => fs.existsSync(path.join(folder, test, 'tree.json')))).toBe(true);
});

requires(['home'], () => {
  it('goes home, which a browser has no screen for, so it is skipped with the reason', async () => {
    await device.home();
  });
});

onlyOn(['android', 'ios'], () => {
  it('runs on a phone only', () => {
    throw new Error('this runs on a phone only');
  });
});

// Run without blocking: over CDP the command shares the browser this file is
// connected to, and a page it opens waits until this one has answered too.
it('drives the same page with the command an app has installed', async () => {
  const bin = path.join(process.cwd(), 'node_modules', 'expo-vitest', 'dist', 'harness', 'index.js');
  const {stdout} = await promisify(execFile)(process.execPath, [bin, '-p', 'web', '--url', device.config.url as string, 'open', '/', 'tree'], {encoding: 'utf8'});
  expect(stdout).toContain('h1/heading "Profile"');
});

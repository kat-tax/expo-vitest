// device.web as an app's tests have it: on web each call reaches the browser
// the driver holds, and a test file shared with a device runs there too, each
// call answering 'skipped'.
import fs from 'node:fs';
import path from 'node:path';
import {device, onlyOn, screen} from 'expo-vitest/device';

const opened = () => device.open('/web');

it('says whether there is a browser to reach', () => {
  expect(device.can('web')).toBe(device.platform === 'web');
});

onlyOn(['web'], () => {
  it('answers a request with a route, until the route is taken off', async () => {
    await opened();
    const unroute = await device.web.route('**/api/greeting', route => route.fulfill({json: {greeting: 'Hello from the test'}}));
    await screen.getByTestId('greet').press();
    await expect(screen.getByText('Hello from the test')).toBeVisible();
    if (unroute !== 'skipped') await unroute();
    await screen.getByTestId('greet').press();
    await expect(screen.getByText('Hello from the server')).toBeVisible();
  });

  it('answers every dialog as the test says, and the next one as an alert says', async () => {
    await opened();
    const off = await device.web.onDialog(dialog => (dialog.message === 'Delete the draft?' ? 'accept' : 'dismiss'));
    await screen.getByTestId('ask').press();
    await expect(screen.getByText('Deleted')).toBeVisible();
    await device.alert('dismiss');
    await screen.getByTestId('ask').press();
    await expect(screen.getByText('Kept')).toBeVisible();
    if (off !== 'skipped') off();
  });

  it('evaluates in the page, a function with its argument, and an expression', async () => {
    await opened();
    expect(await device.web.evaluate((selector: string) => document.querySelectorAll(selector).length, 'button')).toBe(2);
    expect(await device.web.evaluate('document.title')).toBe('Web');
  });

  it('sets the viewport, and keeps cookies', async () => {
    await opened();
    expect(await device.web.setViewport({width: 400, height: 700})).toBe('done');
    expect(await device.web.evaluate('[innerWidth, innerHeight]')).toEqual([400, 700]);
    await device.web.setCookies([{name: 'session', value: 'abc', url: device.config.url as string}]);
    const cookies = await device.web.cookies();
    expect(cookies !== 'skipped' && cookies.map(cookie => [cookie.name, cookie.value])).toEqual([['session', 'abc']]);
    expect(await device.web.evaluate('document.cookie')).toBe('session=abc');
    await device.web.clearCookies();
    expect(await device.web.cookies()).toEqual([]);
  });

  it('chooses an option, gives a file input a file, and presses with the secondary button', async () => {
    await opened();
    await device.web.selectOption(screen.getByTestId('colour'), 'Blue');
    await expect(screen.getByText('Chose b')).toBeVisible();
    // An option the select lacks is said at once, with the ones it has, rather than waited for.
    const started = Date.now();
    await expect(device.web.selectOption(screen.getByTestId('colour'), 'blue')).rejects.toMatchObject({code: 'ACTION_FAILED', message: expect.stringMatching(/has no option "blue"; its options are "Red", "Blue"/)});
    expect(Date.now() - started).toBeLessThan(5000);
    await device.web.setInputFiles(screen.getByTestId('attachment'), 'device/page.html');
    await expect(screen.getByText('Attached page.html')).toBeVisible();
    await expect(device.web.setInputFiles(screen.getByTestId('attachment'), '../outside.txt')).rejects.toMatchObject({code: 'INVALID_ARGUMENT'});
    await device.web.secondaryTap(screen.getByTestId('menu-target'));
    await expect(screen.getByText('Menu open')).toBeVisible();
  });

  it('keeps a download, by the name the page gave it', async () => {
    await opened();
    const file = await device.web.waitForDownload(() => screen.getByTestId('report').press());
    expect(file).toBe(path.join(process.cwd(), '.harness', 'downloads', 'report.csv'));
    expect(fs.readFileSync(file as string, 'utf8')).toBe('name,drafts\nAda,3\n');
  });

  it('finds and acts on what is in a frame, through a screen of the frame', async () => {
    await opened();
    const card = device.web.frame('#card');
    if (card === 'skipped') throw new Error('web has frames');
    await card.getByRole('textbox', {name: 'Card number'}).fill('4242');
    await card.getByRole('button', {name: 'Pay'}).press();
    await expect(card.getByText('Paid with 4242')).toBeVisible();
    // The page's own screen does not reach into the frame.
    expect(await screen.queryByText('Paid with 4242')).toBeNull();
  });
});

// A page that stops answering, as an app does when its JavaScript loops for
// ever. The first test fails on purpose, at its own timeout of a second; its
// evidence waits as long again for the driver, finds it stuck, and lets it
// go. The second opens another driver, and holds the first to its bound.
import fs from 'node:fs';
import path from 'node:path';
import {device, screen} from 'expo-vitest';

afterAll(() => device.close());

let began = 0;

it.fails('fails at its own timeout of a second while the page hangs', {timeout: 1000}, async () => {
  began = Date.now();
  await device.open('/hang');
  await expect(screen.getByText('Never on the page')).toBeVisible();
});

it('opens another driver after it, which answers, the first over in under four seconds', async () => {
  const started = Date.now();
  await device.open('/');
  await expect(screen.getByRole('heading', {name: 'Profile'})).toBeVisible();
  // The first test's timeout, its evidence's wait for the driver, and the driver's close.
  expect(started - began).toBeLessThan(4000);
  const folder = path.join(process.cwd(), '.harness', 'results', 'web', 'device', 'hang');
  const first = fs.readdirSync(folder).find(name => name.startsWith('fails-at-its-own-timeout'));
  const trace = fs.readFileSync(path.join(folder, first ?? '', 'trace.md'), 'utf8');
  // A browser may draw a picture while the page's script is stuck, so what the driver did not answer may be the tree.
  expect(trace).toMatch(/the driver did not answer for (a screenshot|the tree) within 1\.0 s, so the evidence asked it nothing more\./i);
  // The step the timeout left under way, which never ended.
  expect(trace).toMatch(/\| failed: had not answered after \d/);
});

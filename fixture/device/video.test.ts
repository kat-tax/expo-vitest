// Video as an app has it. scripts/fixture.js runs this file again with
// HARNESS_VIDEO=retain-on-failure and FIXTURE_VIDEO=1, and checks that the
// test that fails on purpose kept its recording and the one that passes kept
// none.
import {device, screen} from 'expo-vitest/device';

afterAll(() => device.close());

it('passes, and keeps no recording', async () => {
  await device.open('/');
  await expect(screen.getByRole('heading', {name: 'Profile'})).toBeVisible();
});

it.runIf(process.env.FIXTURE_VIDEO === '1')('fails on purpose, and keeps its recording', async () => {
  await device.open('/');
  await expect(screen.getByRole('heading', {name: 'Nowhere'})).toBeVisible({timeout: 1000});
});

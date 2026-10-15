// A first launch: three pages that introduce the app, which Next moves
// through and Get started or Skip finishes, and which a launch after does
// not show again.
import {device, screen} from 'expo-vitest/device';
import {relaunch} from './helpers';

beforeEach(async () => {
  await device.clearState();
  await device.open('/');
});

it('moves through the three pages with Next, and Get started goes to sign-in', async () => {
  await expect(screen.getByRole('tab', {name: 'Page 1 of 3'})).toBeSelected();
  await screen.getByRole('button', {name: 'Next'}).press();
  await expect(screen.getByRole('tab', {name: 'Page 2 of 3'})).toBeSelected();
  await screen.getByRole('button', {name: 'Next'}).press();
  await expect(screen.getByRole('tab', {name: 'Page 3 of 3'})).toBeSelected();
  await expect(screen.getByRole('button', {name: 'Skip'})).toBeHidden();
  await screen.getByRole('button', {name: 'Get started'}).press();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
});

it('is skipped once, and not shown again on the next launch', async () => {
  await screen.getByRole('button', {name: 'Skip'}).press();
  await expect(screen.getByRole('textbox', {name: 'Email'})).toBeVisible();
  await relaunch();
  await expect(screen.getByRole('textbox', {name: 'Email'})).toBeVisible();
  await expect(screen.getByRole('button', {name: 'Skip'})).toBeHidden();
});

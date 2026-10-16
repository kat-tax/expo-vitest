// A first launch: three pages that introduce the app, which Next moves
// through and Get started or Skip finishes, and which a launch after does
// not show again.
import {screen} from 'expo-vitest/device';
import {field, firstLaunch, relaunch} from './helpers';

beforeEach(async () => {
  await firstLaunch();
});

// A page's dot, by its name: a tab on web, a button on Android.
const dot = (page: number) => screen.getByLabelText(`Page ${page} of 3`);

it('moves through the three pages with Next, and Get started goes to sign-in', async () => {
  await expect(dot(1)).toBeSelected();
  await screen.getByRole('button', {name: 'Next'}).press();
  await expect(dot(2)).toBeSelected();
  await screen.getByRole('button', {name: 'Next'}).press();
  await expect(dot(3)).toBeSelected();
  await expect(screen.getByRole('button', {name: 'Skip'})).toBeHidden();
  await screen.getByRole('button', {name: 'Get started'}).press();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
});

it('is skipped once, and not shown again on the next launch', async () => {
  await screen.getByRole('button', {name: 'Skip'}).press();
  await expect(field('Email', 'sign-in-email')).toBeVisible();
  await relaunch(field('Email', 'sign-in-email'));
  await expect(screen.getByRole('button', {name: 'Skip'})).toBeHidden();
});

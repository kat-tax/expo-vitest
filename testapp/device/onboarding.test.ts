// A first launch: three pages that introduce the app, which Next moves
// through and Get started or Skip finishes, and which a launch after does
// not show again.
import {device, screen} from 'expo-vitest/device';
import {field, firstLaunch, relaunch} from './helpers';

beforeEach(async () => {
  await firstLaunch();
});

// A page's dot, by its name: a tab on web, a button on Android. WinUI's pager
// on Windows names it "Page 1", its place in the set beside the name, and says
// of none that it is selected, so there the page is told by its buttons.
const dot = (page: number) => screen.getByLabelText(device.platform === 'windows' ? `Page ${page}` : `Page ${page} of 3`);
const onPage = async (page: number) => {
  if (device.platform !== 'windows') await expect(dot(page)).toBeSelected();
};

it('moves through the three pages with Next, and Get started goes to sign-in', async () => {
  await onPage(1);
  await screen.getByRole('button', {name: 'Next'}).press();
  await onPage(2);
  await screen.getByRole('button', {name: 'Next'}).press();
  await onPage(3);
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

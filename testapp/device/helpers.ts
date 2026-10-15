// What the tests share: the demo account, and a first launch taken past
// onboarding and signed in, landing on the notes.
import type {Locator} from 'expo-vitest/device';
import {device, screen} from 'expo-vitest/device';

export const DEMO = {email: 'ada@example.com', password: 'testapp-demo-pass'};

/** A first launch, past onboarding, signed in with the demo account, on the notes. */
export async function signedIn(): Promise<void> {
  await device.clearState();
  await device.open('/');
  await screen.getByRole('button', {name: 'Skip'}).press();
  await screen.getByRole('textbox', {name: 'Email'}).fill(DEMO.email);
  await screen.getByRole('textbox', {name: 'Password'}).fill(DEMO.password);
  await screen.getByRole('button', {name: 'Sign in'}).press();
  await expect(screen.getByRole('searchbox', {name: 'Search notes'})).toBeVisible();
}

/**
 * The next launch: the app relaunched on a device, which keeps its data, and
 * the page loaded again on web, since a restart there is a new browser
 * context with no storage at all.
 */
export async function relaunch(): Promise<void> {
  if (device.platform === 'web') await device.open('/');
  else await device.restart();
}

/**
 * Runs one of a row's own actions where a person finds it: in the row's
 * menu, opened with a right click on web and a long press on Android, or
 * among the buttons a swipe shows on iOS.
 */
export async function rowAction(row: Locator, action: string): Promise<void> {
  if (device.platform === 'ios') {
    await row.swipe('left');
    await screen.getByRole('button', {name: action}).press();
    return;
  }
  if (device.platform === 'web') await device.web.secondaryTap(row);
  else await row.longPress();
  await screen.getByRole('menuitem', {name: action}).press();
}

/** Goes to a tab as a person would: a link in the bar on web, a tab elsewhere. */
export async function openTab(name: 'Notes' | 'Settings'): Promise<void> {
  await screen.getByRole(device.platform === 'web' ? 'link' : 'tab', {name}).press();
}

// What the tests share: the demo account, the app's launches as each
// platform has them, a first launch taken past onboarding and signed in, a
// row's own actions, and the tabs.
import type {Locator, Queries} from 'expo-vitest';
import {device, screen, within} from 'expo-vitest';

export const DEMO = {email: 'ada@example.com', password: 'testapp-demo-pass'};

/** How long the app may take to come up: on a device the dev server may be building its first bundle. */
const UP = 90_000;

/**
 * Opens the app. On web that is its page. A development build on a device
 * loads its JavaScript from the dev server the run started, which it learns
 * of from the link expo-dev-client registers (docs/controls.md, An Expo
 * development build), since a cleared app has no server to go back to and a
 * restarted one opens on the launcher.
 */
async function launch(): Promise<void> {
  if (device.platform !== 'android' && device.platform !== 'ios') {
    await device.open('/');
    return;
  }
  const server = encodeURIComponent(String(device.config.url));
  await device.openLink(`exp+testapp://expo-development-client/?url=${server}&disableOnboarding=1&disableFab=1&disableAutoLaunch=1`);
}

/**
 * Waits for `first` after a launch. A development build on an Android
 * emulator now and then dies as it first draws, a SIGSEGV in React Native's
 * mounting, and leaves the launcher in front. It is launched again then, at
 * most twice, but only once it is seen gone, since a second load over a
 * first one is not survived. iOS may name the app in front by its name
 * rather than its bundle id, so there the wait is the assertion alone.
 *
 * A hook that runs out of time leaves this going into the next test, where
 * a launch would land in the middle of it, so it stops once its test is
 * over.
 */
async function comesUp(first: Locator): Promise<void> {
  const until = Date.now() + UP;
  const test = expect.getState().currentTestName;
  const ours = () => expect.getState().currentTestName === test;
  for (let again = 0; device.platform === 'android' && again < 2; again++) {
    if (await showsBefore(first, until, ours)) return;
    if (Date.now() >= until || !ours()) break;
    await launch();
  }
  if (ours()) await expect(first).toBeVisible({timeout: Math.max(until - Date.now(), 1000)});
}

/** How long a launched app may take to come to the front, and how long it must stay away to count as gone. */
const TO_FRONT = 20_000;
const GONE = 3_000;

/** Whether `first` shows before `until`, or false once the app is seen gone from the front or the test is over. */
async function showsBefore(first: Locator, until: number, ours: () => boolean): Promise<boolean> {
  const launched = Date.now();
  let seen = false;
  let away: number | null = null;
  while (Date.now() < until && ours()) {
    if (await first.isVisible().catch(() => false)) return true;
    const front = await device.foregroundApp().catch(() => null);
    if (front === device.config.app?.bundleId) {
      seen = true;
      away = null;
    } else if (front !== null) {
      away ??= Date.now();
      if (seen ? Date.now() - away >= GONE : Date.now() - launched >= TO_FRONT) return false;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

/** A first launch, with nothing saved, which opens on onboarding. */
export async function firstLaunch(): Promise<void> {
  await device.clearState();
  await launch();
  await comesUp(screen.getByRole('button', {name: 'Skip'}));
}

/** How long a restarted development build is given to open its last server by itself. */
const BY_ITSELF = 15_000;

/**
 * The next launch, which keeps what was saved, until `first` shows: the app
 * restarted on a device and on Windows, and the page loaded again on web,
 * since a restart there is a new browser context with no storage at all. A development build
 * may open the server it last loaded by itself as it restarts, and a link
 * sent then starts a second load over the first, which React Native does not
 * survive ("runtime not ready"), so the link goes only where the app has not
 * come up.
 */
export async function relaunch(first: Locator): Promise<void> {
  if (device.platform === 'android' || device.platform === 'ios') {
    await device.restart();
    if (await first.isVisible().catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, BY_ITSELF));
    if (await first.isVisible().catch(() => false)) return;
    await launch();
  } else if (device.platform === 'windows') {
    await device.restart();
  } else {
    await launch();
  }
  await comesUp(first);
}

/**
 * A text field by the name a person hears for it. expo-interface names a
 * field by its placeholder alone, which goes once the field holds text on
 * Android and iOS (kat-tax/expo-interface#22, item 3), so on both the field
 * is found by its testID. sign-in.test.ts shows the gap, marked failing on
 * both until the kit names its fields.
 */
export function field(name: string, testId: string): Locator {
  return device.platform === 'android' || device.platform === 'ios' ? screen.getByTestId(testId) : screen.getByRole('textbox', {name});
}

/**
 * A checkbox by its name. expo-interface draws one on iOS as a button that
 * reads as selected while it is on (kat-tax/expo-interface#22, item 10),
 * where the other platforms have a checkbox that reads as checked, so the
 * two helpers after this set and read it either way.
 */
export function checkbox(name: string): Locator {
  return screen.getByRole(device.platform === 'ios' ? 'button' : 'checkbox', {name});
}

/** Turns a checkbox on or off, pressing it only where it is not so already. */
export async function setCheckbox(name: string, on: boolean): Promise<void> {
  if (device.platform !== 'ios') {
    await (on ? checkbox(name).check() : checkbox(name).uncheck());
    return;
  }
  const node = await checkbox(name).waitFor();
  if (Boolean(node?.selected) !== on) await checkbox(name).press();
  await expectCheckbox(name, on);
}

/** That a checkbox is on, or off. */
export async function expectCheckbox(name: string, on: boolean): Promise<void> {
  const box = checkbox(name);
  if (device.platform === 'ios') await (on ? expect(box).toBeSelected() : expect(box).not.toBeSelected());
  else await (on ? expect(box).toBeChecked() : expect(box).not.toBeChecked());
}

/** The notes' search field. */
export const searchField = () => screen.getByRole('searchbox', {name: 'Search notes'});

/** A first launch, past onboarding, signed in with the demo account, on the notes. */
export async function signedIn(): Promise<void> {
  await firstLaunch();
  await screen.getByRole('button', {name: 'Skip'}).press();
  await field('Email', 'sign-in-email').fill(DEMO.email);
  await field('Password', 'sign-in-password').fill(DEMO.password);
  await screen.getByRole('button', {name: 'Sign in'}).press();
  await expect(searchField()).toBeVisible();
}

/**
 * An item of a menu by its name: a menu item on web, a button among those a
 * swipe shows on iOS, and on Android an item by its name alone, since
 * Compose gives a menu's items no role.
 */
export function menuItem(name: string): Locator {
  if (device.platform === 'android') return screen.getByLabelText(name);
  return screen.getByRole(device.platform === 'ios' ? 'button' : 'menuitem', {name});
}

/**
 * Runs one of a row's own actions where a person finds it: in the row's
 * menu, opened with a right click on web and a long press on Android, or
 * among the buttons a swipe shows on iOS.
 */
export async function rowAction(row: Locator, action: string): Promise<void> {
  if (device.platform === 'ios') await row.swipe('left');
  else if (device.platform === 'web') await device.web.secondaryTap(row);
  else await row.longPress();
  await menuItem(action).press();
}

/**
 * An alert by its title, to look inside. On Android an alert is a window of
 * its own, the only one read while it shows, and nothing in it says it is a
 * dialog, so the screen is the alert there. On Windows it sits in the popup
 * host over the screen, its field beside the popup window that holds its
 * text and buttons, and neither is named by its title.
 */
export function alert(title: string): Queries {
  if (device.platform === 'android') return screen;
  if (device.platform === 'windows') return within(screen.getByRole('pane', {name: 'PopupHost'}));
  return within(screen.getByRole('dialog', {name: title}));
}

/** What shows while an alert does: its dialog, or its title where nothing names a dialog. */
export function alertTitle(title: string): Locator {
  return device.platform === 'android' || device.platform === 'windows' ? screen.getByText(title) : screen.getByRole('dialog', {name: title});
}

/**
 * Goes to a tab as a person would: a link in the bar on web, a tab on iOS,
 * and on Android the bar's item by its name, which Material marks a tab by a
 * role description agent-device does not report.
 */
export async function openTab(name: 'Notes' | 'Settings'): Promise<void> {
  const tab = device.platform === 'android' ? screen.getByLabelText(name) : screen.getByRole(device.platform === 'web' ? 'link' : 'tab', {name});
  await tab.press();
}

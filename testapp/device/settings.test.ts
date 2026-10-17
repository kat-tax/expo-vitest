// Settings: each kind of control saves as it changes and is there after a
// relaunch, a display name's problem shows under its section, and what needs
// a confirmation asks for one: signing out, resetting the app, and deleting
// the account, which waits for a word typed first.
import {device, screen} from 'expo-vitest';
import {alert, alertTitle, expectCheckbox, field, openTab, relaunch, searchField, setCheckbox, signedIn} from './helpers';

const name = () => field('Display name', 'settings-name');

// The digest's frequency, named by its label, and on Android by its label
// and then its value, as Compose reads the row.
const frequency = () => screen.getByRole('combobox', {name: /^Digest frequency/});

// A choice of the theme: a radio, and on Windows an item of the list WinUI's
// segmented control is, which is selected rather than checked.
const theme = (choice: string) => screen.getByRole(device.platform === 'windows' ? 'listitem' : 'radio', {name: choice});
const expectTheme = (choice: string) => (device.platform === 'windows' ? expect(theme(choice)).toBeSelected() : expect(theme(choice)).toBeChecked());

// Notes per page, a stepper: its Increment button and the number beside it,
// and on Windows, where it is WinUI's NumberBox, its Increase button and the
// number in its field.
const stepUp = () => screen.getByRole('button', {name: device.platform === 'windows' ? 'Increase' : 'Increment'}).press();
const expectPerPage = (count: string) =>
  device.platform === 'windows' ? expect(screen.getByRole('textbox', {name: /^Notes per page/})).toHaveValue(count) : expect(screen.getByText(count)).toBeVisible();

beforeEach(async () => {
  await signedIn();
  await openTab('Settings');
  await expect(name()).toHaveValue('Ada');
});

/**
 * A button of the form, scrolled to first, since an Android list draws a row
 * only once it is scrolled to. The scroll looks for the button's text, which
 * agent-device finds as it scrolls: the name the button goes by is the
 * tree's reading of that text, which agent-device does not see.
 */
async function press(label: string): Promise<void> {
  await screen.getByText(label).scrollIntoView();
  await screen.getByRole('button', {name: label}).press();
}

// On Android expo-interface's named switch has no role
// (kat-tax/expo-interface#24, item 1). Marked failing there until that is
// fixed.
(device.platform === 'android' ? it.fails : it)('keeps what each control was set to across a relaunch', async () => {
  await name().fill('Ada L.');
  await screen.getByRole('switch', {name: 'Push notifications'}).uncheck();
  await expect(frequency()).toBeDisabled();
  await screen.getByRole('switch', {name: 'Email digest'}).check();
  await expect(frequency()).toBeEnabled();
  await device.web.selectOption(frequency(), 'Monthly');
  await theme('Dark').press();
  await stepUp();
  await setCheckbox('Share usage data', true);

  await relaunch(searchField());
  await openTab('Settings');
  await expect(name()).toHaveValue('Ada L.');
  await expect(screen.getByRole('switch', {name: 'Push notifications'})).not.toBeChecked();
  await expect(screen.getByRole('switch', {name: 'Email digest'})).toBeChecked();
  if (device.platform === 'web') await expect(frequency()).toHaveValue('monthly');
  await expectTheme('Dark');
  await expectPerPage('30');
  await expectCheckbox('Share usage data', true);
});

it('says under its section what is wrong with a display name', async () => {
  await name().clear();
  await expect(screen.getByText('A display name is needed.')).toBeVisible();
  await name().fill('Augusta Ada King, Countess of Lovelace');
  await expect(screen.getByText('A display name is 30 characters at most.')).toBeVisible();
  await name().fill('Ada');
  await expect(screen.getByText('A display name is needed.')).toBeHidden();
});

it('asks before it signs out, and stays where asked to', async () => {
  await screen.getByRole('button', {name: 'Sign out'}).press();
  await alert('Sign out?').getByRole('button', {name: 'Cancel'}).press();
  await expect(alertTitle('Sign out?')).toBeHidden();
  await screen.getByRole('button', {name: 'Sign out'}).press();
  await alert('Sign out?').getByRole('button', {name: 'Sign out'}).press();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
});

it('deletes the account only once DELETE is typed', async () => {
  await press('Delete account');
  await expect(alert('Delete your account?').getByRole('button', {name: 'Delete'})).toBeDisabled();
  await alert('Delete your account?').getByRole('textbox').fill('DELETE');
  await alert('Delete your account?').getByRole('button', {name: 'Delete'}).press();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
  await expect(screen.getByText('Your account was deleted')).toBeVisible();
});

it('resets the app to its first launch', async () => {
  await press('Reset the app');
  await alert('Reset the app?').getByRole('button', {name: 'Reset'}).press();
  await expect(screen.getByRole('button', {name: 'Skip'})).toBeVisible();
});

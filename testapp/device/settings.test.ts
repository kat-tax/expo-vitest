// Settings: each kind of control saves as it changes and is there after a
// relaunch, a display name's problem shows under its section, and what needs
// a confirmation asks for one: signing out, resetting the app, and deleting
// the account, which waits for a word typed first.
import {device, screen} from 'expo-vitest/device';
import {alert, alertTitle, field, openTab, relaunch, searchField, signedIn} from './helpers';

const name = () => field('Display name', 'settings-name');

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

// expo-interface on Android draws a switch's, a checkbox's and a slider's
// label beside the control rather than on it, so nothing names them there,
// and draws the picker with nothing to press. Marked failing on Android
// until the kit names them.
(device.platform === 'android' ? it.fails : it)('keeps what each control was set to across a relaunch', async () => {
  await name().fill('Ada L.');
  await screen.getByRole('switch', {name: 'Push notifications'}).uncheck();
  await expect(screen.getByRole('combobox', {name: 'Digest frequency'})).toBeDisabled();
  await screen.getByRole('switch', {name: 'Email digest'}).check();
  await expect(screen.getByRole('combobox', {name: 'Digest frequency'})).toBeEnabled();
  await device.web.selectOption(screen.getByRole('combobox', {name: 'Digest frequency'}), 'Monthly');
  await screen.getByRole('radio', {name: 'Dark'}).press();
  await screen.getByRole('button', {name: 'Increment'}).press();
  await screen.getByRole('checkbox', {name: 'Share usage data'}).check();

  await relaunch(searchField());
  await openTab('Settings');
  await expect(name()).toHaveValue('Ada L.');
  await expect(screen.getByRole('switch', {name: 'Push notifications'})).not.toBeChecked();
  await expect(screen.getByRole('switch', {name: 'Email digest'})).toBeChecked();
  if (device.platform === 'web') await expect(screen.getByRole('combobox', {name: 'Digest frequency'})).toHaveValue('monthly');
  await expect(screen.getByRole('radio', {name: 'Dark'})).toBeChecked();
  await expect(screen.getByText('30')).toBeVisible();
  await expect(screen.getByRole('checkbox', {name: 'Share usage data'})).toBeChecked();
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

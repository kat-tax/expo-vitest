// Settings: each kind of control saves as it changes and is there after a
// relaunch, a display name's problem shows under its section, and what needs
// a confirmation asks for one: signing out, resetting the app, and deleting
// the account, which waits for a word typed first.
import {device, screen, within} from 'expo-vitest/device';
import {openTab, relaunch, signedIn} from './helpers';

const dialog = (name: string) => within(screen.getByRole('dialog', {name}));

beforeEach(async () => {
  await signedIn();
  await openTab('Settings');
  await expect(screen.getByRole('textbox', {name: 'Display name'})).toHaveValue('Ada');
});

it('keeps what each control was set to across a relaunch', async () => {
  await screen.getByRole('textbox', {name: 'Display name'}).fill('Ada L.');
  await screen.getByRole('switch', {name: 'Push notifications'}).uncheck();
  await expect(screen.getByRole('combobox', {name: 'Digest frequency'})).toBeDisabled();
  await screen.getByRole('switch', {name: 'Email digest'}).check();
  await expect(screen.getByRole('combobox', {name: 'Digest frequency'})).toBeEnabled();
  await device.web.selectOption(screen.getByRole('combobox', {name: 'Digest frequency'}), 'Monthly');
  await screen.getByRole('radio', {name: 'Dark'}).press();
  await screen.getByRole('button', {name: 'Increment'}).press();
  await screen.getByRole('checkbox', {name: 'Share usage data'}).check();

  await relaunch();
  await openTab('Settings');
  await expect(screen.getByRole('textbox', {name: 'Display name'})).toHaveValue('Ada L.');
  await expect(screen.getByRole('switch', {name: 'Push notifications'})).not.toBeChecked();
  await expect(screen.getByRole('switch', {name: 'Email digest'})).toBeChecked();
  if (device.platform === 'web') await expect(screen.getByRole('combobox', {name: 'Digest frequency'})).toHaveValue('monthly');
  await expect(screen.getByRole('radio', {name: 'Dark'})).toBeChecked();
  await expect(screen.getByText('30')).toBeVisible();
  await expect(screen.getByRole('checkbox', {name: 'Share usage data'})).toBeChecked();
});

it('says under its section what is wrong with a display name', async () => {
  await screen.getByRole('textbox', {name: 'Display name'}).clear();
  await expect(screen.getByText('A display name is needed.')).toBeVisible();
  await screen.getByRole('textbox', {name: 'Display name'}).fill('Augusta Ada King, Countess of Lovelace');
  await expect(screen.getByText('A display name is 30 characters at most.')).toBeVisible();
  await screen.getByRole('textbox', {name: 'Display name'}).fill('Ada');
  await expect(screen.getByText('A display name is needed.')).toBeHidden();
});

it('asks before it signs out, and stays where asked to', async () => {
  await screen.getByRole('button', {name: 'Sign out'}).press();
  await dialog('Sign out?').getByRole('button', {name: 'Cancel'}).press();
  await expect(screen.getByRole('dialog', {name: 'Sign out?'})).toBeHidden();
  await screen.getByRole('button', {name: 'Sign out'}).press();
  await dialog('Sign out?').getByRole('button', {name: 'Sign out'}).press();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
});

it('deletes the account only once DELETE is typed', async () => {
  await screen.getByRole('button', {name: 'Delete account'}).press();
  await expect(dialog('Delete your account?').getByRole('button', {name: 'Delete'})).toBeDisabled();
  await dialog('Delete your account?').getByRole('textbox').fill('DELETE');
  await dialog('Delete your account?').getByRole('button', {name: 'Delete'}).press();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
  await expect(screen.getByText('Your account was deleted')).toBeVisible();
});

it('resets the app to its first launch', async () => {
  await screen.getByRole('button', {name: 'Reset the app'}).press();
  await dialog('Reset the app?').getByRole('button', {name: 'Reset'}).press();
  await expect(screen.getByRole('button', {name: 'Skip'})).toBeVisible();
});

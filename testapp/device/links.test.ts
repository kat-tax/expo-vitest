// Links into the app: one to a note opens that note, one to a note that is
// gone says so, and one into the app without an account goes to sign-in.
import {device, screen} from 'expo-vitest/device';
import {signedIn} from './helpers';

it('opens the note a link names', async () => {
  await signedIn();
  await device.open('/notes/3');
  await expect(screen.getByRole('heading', {name: 'Quarterly report'})).toBeVisible();
  await expect(screen.getByRole('button', {name: 'Edit'})).toBeVisible();
});

it('says so when the note a link names is gone', async () => {
  await signedIn();
  await device.open('/notes/999');
  await expect(screen.getByText('This note is gone')).toBeVisible();
});

it('sends a link into the app to sign-in when there is no account', async () => {
  await device.clearState();
  await device.open('/settings');
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
});

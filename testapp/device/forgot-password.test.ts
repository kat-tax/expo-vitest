// A forgotten password: an email that is not one is refused, and one that
// is gets the confirmation, from which sign-in is a press away.
import {device, screen} from 'expo-vitest/device';

beforeEach(async () => {
  await device.clearState();
  await device.open('/');
  await screen.getByRole('button', {name: 'Skip'}).press();
  await screen.getByRole('button', {name: 'Forgot your password?'}).press();
});

it('refuses what is not an email, then confirms the link was sent', async () => {
  await screen.getByRole('textbox', {name: 'Email'}).fill('ada');
  await screen.getByRole('button', {name: 'Send link'}).press();
  await expect(screen.getByText('Enter the email address you signed up with.')).toBeVisible();
  await screen.getByRole('textbox', {name: 'Email'}).fill('ada@example.com');
  await screen.getByRole('button', {name: 'Send link'}).press();
  await expect(screen.getByText('Check your email')).toBeVisible();
  await screen.getByRole('button', {name: 'Back to sign in'}).press();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
});

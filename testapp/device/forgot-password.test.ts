// A forgotten password: an email that is not one is refused, and one that
// is gets the confirmation, from which sign-in is a press away.
import {screen} from 'expo-vitest/device';
import {field, firstLaunch} from './helpers';

beforeEach(async () => {
  await firstLaunch();
  await screen.getByRole('button', {name: 'Skip'}).press();
  await screen.getByRole('button', {name: 'Forgot your password?'}).press();
});

it('refuses what is not an email, then confirms the link was sent', async () => {
  await field('Email', 'forgot-email').fill('ada');
  await screen.getByRole('button', {name: 'Send link'}).press();
  await expect(screen.getByText('Enter the email address you signed up with.')).toBeVisible();
  await field('Email', 'forgot-email').fill('ada@example.com');
  await screen.getByRole('button', {name: 'Send link'}).press();
  await expect(screen.getByText('Check your email')).toBeVisible();
  await screen.getByRole('button', {name: 'Back to sign in'}).press();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
});

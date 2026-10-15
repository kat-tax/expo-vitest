// Sign-up: the form says what it lacks when sent, section by section, rates
// the password as it is typed, and creates the account once all is there.
import {device, screen} from 'expo-vitest/device';

beforeEach(async () => {
  await device.clearState();
  await device.open('/');
  await screen.getByRole('button', {name: 'Skip'}).press();
  await screen.getByRole('button', {name: 'Create an account'}).press();
});

it('says what each section lacks when sent empty', async () => {
  await screen.getByRole('button', {name: 'Create account'}).press();
  await expect(screen.getByText('Enter your name.')).toBeVisible();
  await expect(screen.getByText('A password is 8 characters at least.')).toBeVisible();
  await expect(screen.getByText('Agree to the terms to go on.')).toBeVisible();
});

it('rates the password, finds the two that differ, and creates the account once all is there', async () => {
  await screen.getByRole('textbox', {name: 'Name'}).fill('Grace Hopper');
  await screen.getByRole('textbox', {name: 'Email'}).fill('grace@example.com');
  await screen.getByRole('textbox', {name: 'Password', exact: true}).fill('short');
  await expect(screen.getByText('Strength: Weak')).toBeVisible();
  await screen.getByRole('textbox', {name: 'Password', exact: true}).fill('Compilers-1952!');
  await expect(screen.getByText('Strength: Strong')).toBeVisible();
  await screen.getByRole('textbox', {name: 'Password again'}).fill('Compilers-1953!');
  await screen.getByRole('checkbox', {name: 'I agree to the terms'}).check();
  await screen.getByRole('button', {name: 'Create account'}).press();
  await expect(screen.getByText('The two passwords differ.')).toBeVisible();
  await screen.getByRole('textbox', {name: 'Password again'}).fill('Compilers-1952!');
  await device.web.selectOption(screen.getByRole('combobox', {name: 'Country'}), 'Japan');
  await screen.getByRole('button', {name: 'Create account'}).press();
  await expect(screen.getByRole('searchbox', {name: 'Search notes'})).toBeVisible();
  await expect(screen.getByText('Welcome, Grace Hopper')).toBeVisible();
});

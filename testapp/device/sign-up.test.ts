// Sign-up: the form says what it lacks when sent, section by section, rates
// the password as it is typed, and creates the account once all is there.
import {device, screen} from 'expo-vitest/device';
import {field, firstLaunch, searchField, setCheckbox} from './helpers';

beforeEach(async () => {
  await firstLaunch();
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
  await field('Name', 'sign-up-name').fill('Grace Hopper');
  await field('Email', 'sign-up-email').fill('grace@example.com');
  await field('Password', 'sign-up-password').fill('short');
  await expect(screen.getByText('Strength: Weak')).toBeVisible();
  await field('Password', 'sign-up-password').fill('Compilers-1952!');
  await expect(screen.getByText('Strength: Strong')).toBeVisible();
  await field('Password again', 'sign-up-again').fill('Compilers-1953!');
  await setCheckbox('I agree to the terms', true);
  await screen.getByRole('button', {name: 'Create account'}).press();
  await expect(screen.getByText('The two passwords differ.')).toBeVisible();
  await field('Password again', 'sign-up-again').fill('Compilers-1952!');
  await device.web.selectOption(screen.getByRole('combobox', {name: 'Country'}), 'Japan');
  await screen.getByRole('button', {name: 'Create account'}).press();
  await expect(searchField()).toBeVisible();
  await expect(screen.getByText('Welcome, Grace Hopper')).toBeVisible();
});

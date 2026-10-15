// Sign-in: the button waits for both fields, a malformed email is refused
// at once, a wrong password after the server answers, the demo account goes
// to the notes, and an account not remembered is gone after a restart.
import {device, screen} from 'expo-vitest/device';
import {DEMO, relaunch} from './helpers';

const email = () => screen.getByRole('textbox', {name: 'Email'});
const password = () => screen.getByRole('textbox', {name: 'Password'});
const submit = () => screen.getByRole('button', {name: 'Sign in'});

beforeEach(async () => {
  await device.clearState();
  await device.open('/');
  await screen.getByRole('button', {name: 'Skip'}).press();
});

it('waits for both fields, and refuses an email that is not one', async () => {
  await expect(submit()).toBeDisabled();
  await email().fill('ada');
  await expect(submit()).toBeDisabled();
  await password().fill('anything');
  await expect(submit()).toBeEnabled();
  await submit().press();
  await expect(screen.getByText('Enter an email address, such as ada@example.com.')).toBeVisible();
});

it('says the password is wrong once the server answers', async () => {
  await email().fill(DEMO.email);
  await password().fill('not-the-password');
  await submit().press();
  await expect(screen.getByText('The email or the password is wrong.')).toBeVisible();
  await expect(screen.getByRole('searchbox', {name: 'Search notes'})).toBeHidden();
});

it('shows the password when asked', async () => {
  await password().fill('hunter22');
  await screen.getByRole('checkbox', {name: 'Show password'}).check();
  await expect(password()).toHaveValue('hunter22');
});

it('signs in with the demo account, and keeps it across a restart while remembered', async () => {
  await email().fill(DEMO.email);
  await password().fill(DEMO.password);
  await submit().press();
  await expect(screen.getByRole('searchbox', {name: 'Search notes'})).toBeVisible();
  await relaunch();
  await expect(screen.getByRole('searchbox', {name: 'Search notes'})).toBeVisible();
});

it('forgets an account it was not to remember, on the next launch', async () => {
  await email().fill(DEMO.email);
  await password().fill(DEMO.password);
  await screen.getByRole('checkbox', {name: 'Remember me'}).uncheck();
  await submit().press();
  await expect(screen.getByRole('searchbox', {name: 'Search notes'})).toBeVisible();
  await relaunch();
  await expect(email()).toBeVisible();
});

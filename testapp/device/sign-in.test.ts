// Sign-in: the button waits for both fields, a malformed email is refused
// at once, a wrong password after the server answers, the demo account goes
// to the notes, and an account not remembered is gone after a restart.
import {device, screen} from 'expo-vitest';
import {DEMO, field, firstLaunch, relaunch, searchField, setCheckbox} from './helpers';

const email = () => field('Email', 'sign-in-email');
const password = () => field('Password', 'sign-in-password');
const submit = () => screen.getByRole('button', {name: 'Sign in'});

beforeEach(async () => {
  await firstLaunch();
  await screen.getByRole('button', {name: 'Skip'}).press();
});

// A field keeps its name once it holds text. expo-interface names a field
// by its placeholder alone, which goes once the field holds text
// (kat-tax/expo-interface#22, item 3), so this is marked failing on Android
// and iOS until the kit names its fields.
(device.platform === 'android' || device.platform === 'ios' ? it.fails : it)('keeps the name of a field that holds text', async () => {
  await email().fill(DEMO.email);
  await expect(screen.getByRole('textbox', {name: 'Email'})).toHaveValue(DEMO.email);
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
  await expect(searchField()).toBeHidden();
});

// On Android the password field, once shown, still says it is a password
// field, so it reports no value (kat-tax/expo-interface#22, item 9). Marked
// failing there until that is fixed.
(device.platform === 'android' ? it.fails : it)('shows the password when asked', async () => {
  await password().fill('hunter22');
  await setCheckbox('Show password', true);
  await expect(password()).toHaveValue('hunter22');
});

it('signs in with the demo account, and keeps it across a restart while remembered', async () => {
  await email().fill(DEMO.email);
  await password().fill(DEMO.password);
  await submit().press();
  await expect(searchField()).toBeVisible();
  await relaunch(searchField());
});

it('forgets an account it was not to remember, on the next launch', async () => {
  await email().fill(DEMO.email);
  await password().fill(DEMO.password);
  await setCheckbox('Remember me', false);
  await submit().press();
  await expect(searchField()).toBeVisible();
  await relaunch(email());
});

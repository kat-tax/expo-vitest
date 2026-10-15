// Written by a coding agent from an MCP session alone: the flow was found
// over expo-harness mcp on this page, by observing, acting by ref and
// reading what changed, and each query here is the screen.* call its
// locate answered for the node. With a field empty the press changes
// nothing but the focus; with all three filled the welcome replaces the form.
import {device, screen} from 'expo-vitest/device';

it('stays on the form while a field is empty, and welcomes the email once all three hold something', async () => {
  await device.open('/sign-in');
  await screen.getByLabelText('Email').fill('ada');
  await screen.getByLabelText('Recovery code').fill('rc-0001');
  await screen.getByRole('button', {name: 'Sign in'}).press();
  await expect(screen.getByRole('heading', {name: 'Sign in'})).toBeVisible();
  await expect(screen.getByRole('heading', {name: 'Welcome, ada'})).not.toBeVisible();

  await screen.getByLabelText('Password').fill('a-passphrase');
  await screen.getByRole('button', {name: 'Sign in'}).press();
  await expect(screen.getByRole('heading', {name: 'Welcome, ada'})).toBeVisible();
});

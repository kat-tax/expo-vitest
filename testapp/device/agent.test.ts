// The agent as an app has it: expo-vitest/agent, with the model of rules the
// harness config gives it, acting a sign-in with a wrong password from the
// sign-in screen. What the app said is the test's to check, as it would be
// with a live model.
import {agent} from 'expo-vitest/agent';
import {screen} from 'expo-vitest/device';
import {firstLaunch} from './helpers';

beforeEach(async () => {
  await firstLaunch();
  await screen.getByRole('button', {name: 'Skip'}).press();
});

it('signs in with a wrong password, which the app refuses', async () => {
  const result = await agent.act('sign in with the demo email and a wrong password');
  expect(result.summary).toBe('Signed in with the demo email and a wrong password.');
  await expect(screen.getByText('The email or the password is wrong.')).toBeVisible();
});

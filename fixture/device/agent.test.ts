// The agent as an app has it: the packed package's expo-vitest/agent, on the
// device the file shares, with the model of rules harness.config.ts gives
// it. The fixture runs this file twice: the first run records the sign-in,
// once the assertion after it has held; the second, with FIXTURE_AGENT_REPLAY,
// replays it, and the model refuses to act there.
import {agent, isAgentError, secret} from 'expo-vitest/agent';
import {device} from 'expo-vitest/device';

afterAll(() => device.close());

const replay = Boolean(process.env.FIXTURE_AGENT_REPLAY);

it('signs in, the runner typing each secret, and the judge checks and reads what shows', async () => {
  await device.open('/sign-in');
  const result = await agent.act('sign in as {user} with {code} and {password}', {params: {user: 'ada', code: secret('FIXTURE_RECOVERY'), password: secret('FIXTURE_PASSWORD')}});
  expect(result.summary).toBe('Signed in as ada.');
  if (replay) expect(result).toMatchObject({cache: {mode: 'self-finalized', replayedActions: 4, totalActions: 4}, modelCalls: 0});
  else expect(result).toMatchObject({cache: {mode: 'missed', reason: 'no-entry', totalActions: 4}, modelCalls: 5, actions: 4});
  await agent.assert('the welcome message names ada', {screenshot: false});
  await agent.waitFor('the welcome message names ada', {interval: 100});
  expect(await agent.extract('the name the welcome message gives', {schema: {type: 'string'}})).toBe('ada');
});

it('fails an assertion the screen does not bear out, as an AgentError', async () => {
  await device.open('/sign-in');
  const error = await agent.assert('the welcome message names ada', {screenshot: false}).catch((thrown: unknown) => thrown);
  expect(isAgentError(error) && [error.code, error.explanation]).toEqual(['ASSERTION_FAILED', 'No heading welcomes ada.']);
});

it.skipIf(replay)('keeps a secret it typed out of the evidence, though the field shows it', async () => {
  await device.open('/sign-in');
  await agent.act('fill the recovery code with {code}', {params: {code: secret('FIXTURE_RECOVERY')}});
  await expect(device.snapshot()).resolves.toMatchObject({nodes: expect.arrayContaining([expect.objectContaining({name: 'Recovery code', value: 'rc-4417-fixture-code'})])});
});

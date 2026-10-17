// The agent, live: Claude through the Claude adapter, on the sign-in page.
// It is billed, so it runs only by hand, with credentials in the SDK's chain
// and HARNESS_AGENT_SMOKE=1, which scripts/fixture.js passes on, installing
// @anthropic-ai/sdk in its copy. After it, read its trace.md and the AI
// trace. Run twice in one copy, the second run's act is self-finalized.
import fs from 'node:fs';
import path from 'node:path';
import {agent, secret} from 'expo-vitest/agent';
import {device} from 'expo-vitest';

describe.skipIf(!process.env.HARNESS_AGENT_SMOKE)('the agent, live', () => {
  afterAll(() => device.close());
  const claude = agent.as('claude');

  it('reads the page in a picture, signs in, waits for and reads the welcome, the cache doing its share', async () => {
    await device.open('/sign-in');
    // Before any secret is filled, while a picture may leave.
    await claude.assert('the page asks for an email, a recovery code and a password', {vision: true});
    const result = await claude.act('sign in as {user} with {code} and {password}', {params: {user: 'ada', code: secret('FIXTURE_RECOVERY'), password: secret('FIXTURE_PASSWORD')}});
    console.log(`act: ${JSON.stringify(result)}`);
    await claude.waitFor('the page welcomes ada');
    expect(await claude.extract('the name the welcome gives', {schema: {type: 'string'}})).toBe('ada');
    if (result.cache?.mode === 'self-finalized') return;
    // The second call of the act reads the first's prompt from the provider's cache.
    const calls = fs
      .readFileSync(path.join(process.cwd(), '.harness', 'ai-trace.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as {step: {kind: string}; usage: {input: number; cacheRead: number; cacheWrite: number}});
    const second = calls.filter(call => call.step.kind === 'act')[1];
    expect(second).toBeDefined();
    const {input, cacheRead, cacheWrite} = (second as (typeof calls)[number]).usage;
    expect(cacheRead / (input + cacheRead + cacheWrite)).toBeGreaterThan(0.5);
  });
});

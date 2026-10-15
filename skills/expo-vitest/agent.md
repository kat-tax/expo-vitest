# The agent

`expo-vitest/agent` carries out a device test's steps written in words. The
agents, their models and the secrets are in `harness.config.ts`.

```ts
import {device, screen} from 'expo-vitest/device';
import {agent, secret} from 'expo-vitest/agent';

it('signs in', async () => {
  await device.open('/sign-in');
  await agent.act('sign in as {user} with {password}', {params: {user: 'ada', password: secret('ADA_PASSWORD')}});
  await expect(screen.getByRole('heading', {name: 'Welcome, ada'})).toBeVisible();
});
```

| Call | What it does |
| --- | --- |
| `agent.act(instruction, {params})` | Carries the instruction out, and concludes passed, failed or blocked. |
| `agent.assert(statement)` | Judges a statement about the screen now; throws `ASSERTION_FAILED` where it does not hold. |
| `agent.waitFor(condition)` | Looks until the condition holds, or its timeout. |
| `agent.extract(instruction, {schema})` | Reads a value off the screen. |

## Writing one

- Follow each `act` with a check: a matcher, `agent.assert` or a locator's
  `waitFor`. An act is recorded for replay only once a check after it holds,
  and the next run replays it with no model call.
- A value that varies goes in `params`, never in the instruction, or the
  step's key changes each run. `unique(value)` marks one made new each run.
- A secret is `secret('NAME')`, its value from `HARNESS_SECRET_NAME` or the
  config's `secrets`. The model fills it by its name and never sees it.
- `vision: true` on a judgment sends a picture with the tree, for what the
  tree cannot say, such as a colour. It stops after a secret is filled.
- Prefer a scripted step where the selector is known: it is faster and free.

## When one fails

The error has a code: `ASSERTION_FAILED`, `LOCATOR_NOT_FOUND`,
`STEP_BUDGET_EXHAUSTED`, `STEP_TIMEOUT`, `MODEL_UNAVAILABLE` and the rest. The
trace's Agent section has each step's turns, and `HARNESS_AI_TRACE=1` keeps
every model call, redacted, in `.harness/ai-trace.jsonl`.

More: `node_modules/expo-vitest/docs/agent.md`.

# The agent

[Docs home](README.md) · [Device tests](device-tests.md) · [Evidence](evidence.md) · [Configuration](configuration.md#the-agent)

`expo-vitest/agent` carries out a test's steps written in words. A model
reads the screen as the accessibility tree, as text, and acts on it through
the same driver as `device`, in the same test, so an agent step and a
scripted step share the browser, the window or the device, and the evidence
of a failing test shows both in order.

```ts
import {device} from 'expo-vitest/device';
import {agent, secret} from 'expo-vitest/agent';

it('upgrades the workspace', async () => {
  await device.open('/settings/billing');
  await agent.act('sign in as {user} with {password}', {params: {user: 'ada', password: secret('ADA_PASSWORD')}});
  await agent.act('upgrade the workspace to the {plan} plan', {params: {plan: 'Pro'}});
  await agent.assert('the invoice preview shows a prorated amount');
  const total = await agent.extract('the order total, as a number', {schema: {type: 'number'}});
  expect(total).toBeGreaterThan(0);
});
```

A step that has run once and was seen to work is [recorded](#the-cache),
and replayed on the next run with no model call.

## Setting it up

The agent runs in a [device project](device-tests.md), and takes its agents,
their models and the secrets from `harness.config.ts`:

```ts
// harness.config.ts
import {defineHarness} from 'expo-vitest/device';
import {anthropic} from 'expo-vitest/agent/anthropic';

export default defineHarness({
  app: {web: {url: 'http://localhost:8081'}},
  agents: {
    default: {
      model: anthropic(),
      context: 'A workspace billing app. Plans are Free, Team and Pro. Settings is the gear in the top bar.',
    },
  },
  secrets: {ADA_PASSWORD: process.env.ADA_PASSWORD},
});
```

The Claude adapter needs the SDK, which this package does not install:

```sh
npm install --save-dev @anthropic-ai/sdk
```

Its credentials come through the SDK's own chain: `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile. No key goes in the
config. Any other provider is a [model](#models) of a dozen lines.

## The four calls

| Call | What it does | Answers |
| --- | --- | --- |
| `agent.act(instruction, options)` | Carries out the instruction, then checks the screen and concludes: passed, failed or blocked. | `{summary, cache, modelCalls, actions, costUsd}` |
| `agent.assert(assertion, options)` | Judges a statement about the screen as it is now. | nothing; it throws where the judge says no |
| `agent.waitFor(condition, options)` | Looks at the screen every interval until the judge says the condition holds. | nothing; it throws at its timeout |
| `agent.extract(instruction, {schema})` | Reads a value off the screen, as the schema allows. | the value |

| Option | Calls | What it is | Default |
| --- | --- | --- | --- |
| `params` | `act` | Values for the `{name}` holes in the instruction: text, a number, a [secret](#secrets) or a `unique()` value. | none |
| `timeout` | all | How long the step may take, in ms. | 120 000 for `act`, 30 000 for the rest |
| `maxSteps` | `act` | The actions it may take. An option may lower the agent's own, never raise it. | 25 |
| `maxModelCalls` | `act`, `waitFor` | The model calls it may make, the same way. | 25 |
| `vision` | `assert`, `waitFor`, `extract` | `true` sends a picture of the screen with the tree; `'only'` sends the picture alone. | off |
| `screenshot` | `assert` | Keeps a picture after the verdict, beside the trace, where one may be taken. | on |
| `interval` | `waitFor` | How often the screen is looked at, 100 to 60 000 ms. The judge is called only when the screen changed. | 3000 |
| `schema` | `extract` | A Standard Schema, such as a Zod 4 schema, or a JSON Schema object. | required |
| `agent` | all | The [agent](#several-agents) to run it, by name. | the block's, else `default` |

The judgments read only the agent's context, the statement and the screen
now, never the steps before, so a verdict is about the screen and not about
what the agent meant to do. A statement the screen does not show enough to
judge is `ASSERTION_INCONCLUSIVE`, never a guess, and so is a value
`extract` cannot find on it.

An act's result says how the cache served it, how many calls and actions it
took, and what it cost in dollars from the [price table](#debugging-and-cost),
which is absent where a model that answered has no price there.

### Params

A hole `{name}` in the instruction is filled from `params` for the model to
read. A secret fills it as `<secret:NAME>`, and the model fills the field
with the secret by its name. `unique(value)` marks a value made new each run,
such as an email address to sign up with: the [cache](#the-cache) keeps it as
a slot and types this run's value on a replay. Give a unique value as a
param, never inline in the instruction, or the step's key changes each run.

## What the model sees

The screen as text, a line a node: its ref, its kind, its name in quotes,
its test id after `#`, its states in brackets, and its value where it has one.
The controls come first, the rest after a blank line:

```text
route: /settings/billing
window: 1280x900

@e1  button  "Upgrade to Pro"  #upgrade-cta
@e2  tab  "Billing"  [selected]
@e3  textbox  "Workspace name"  value="Acme"
@e4  textbox  "Password"  [secure]

@e5  heading  "Billing"  h1
@e6  status  "Saving"  live:polite
```

A ref names the same node for the rest of the step, on every platform, even
where the platform numbers its refs afresh in every snapshot, as iOS and
Android do. After an action the model reads what changed: `+` a node that
came, `-` one that went, `~` one whose states or value changed, the whole
view where most of the screen changed, or `screen: unchanged`. A view over
262 144 bytes leaves out what cannot be acted on first.

The tools it is offered are those the device can do: `tap`, `check`,
`long_press`, `type`, `type_secret`, `press`, `scroll`, `scroll_to`,
`navigate`, `back`, `dismiss_keyboard`, `observe`, and while a picture may
leave, `screenshot` and `tap_at`, then the agent's own [tools](#project-tools).
A tool the platform has no counterpart for is never offered.

The loop asks the model to change its approach after three failed actions in
a row, and to conclude after five; names a call repeated on a screen it did
not change; and asks for a conclusion within three calls or actions of a
budget, or 15 seconds of the step's timeout. Each action has 15 seconds of
its own.

## Secrets

```ts
import {secret} from 'expo-vitest/agent';

await agent.act('sign in with {password}', {params: {password: secret('ADA_PASSWORD')}});
```

A secret is a handle: its name and what it is for, and no value. A name
ending in `PASSWORD` is a password, or `secret(name, {purpose})` says. Its
value comes from `secrets` in `harness.config.ts`, a string or a function
that answers one, and `HARNESS_SECRET_<NAME>` in the environment wins over
both, so CI can inject one without editing the file. A value under 6
characters is refused when the file loads, since hiding it would hide
ordinary words too. A step whose secret has no value is blocked with
`SECRET_UNAVAILABLE` before any model call.

What holds:

- The model never sees a value. It fills a field with `type_secret` and the
  secret's name, and the runner types the value.
- Only a secret in the step's params can be filled, into an enabled text
  field, and a password into a password field alone.
- Every value is hidden, as `<secret:NAME>`, in what the model is sent, in
  `trace.md`, `tree.txt` and `tree.json`, in the [AI trace](#debugging-and-cost),
  and, while a step runs, in what the console, stdout and stderr are given.
  It is found as typed, JSON-escaped, HTML-escaped, percent-encoded, in any
  case and with any whitespace, and a value cut off at the end of a text.
- After a secret is filled, no picture of the screen leaves the test: no
  `vision`, no `screenshot` tool, no picture after an assert, and no
  screenshot or recording in its evidence.
- A secure field's value is never read: it is not in the tree.
- Every secure field is painted over in a picture before it leaves, and
  where one has no bounds to paint, no picture leaves.
- `navigate` goes to `http:`, `https:`, `about:blank`, the app's own scheme,
  or a route of the app's, and refuses `file:`, `data:`, `javascript:`,
  `view-source:`, `blob:` and `filesystem:` by name.

## The cache

An act that passed is recorded at the first check after it that holds: an
`agent.assert` or `agent.waitFor` that passes, a [matcher](matchers.md) that
passes, or a locator's `waitFor` that resolves. The next run replays it with
no model call:

- the route it started on must be the route now, where a path or query
  segment that is a number, a UUID or a hash is a wildcard;
- each action's control is found again by its test id, else by its kind and
  name, told apart by its parent's;
- the screen must end as it did: the route, and up to eight controls that
  came and eight that went.

Where a replay stops agreeing, the model takes over from the screen as it is,
told what the replay did and why it stopped, and the step's whole is recorded
again once a check after it holds.

| `cache.mode` | Meaning |
| --- | --- |
| `self-finalized` | Replayed to the end, with no model call. |
| `agent-concluded` | Replayed until `reason`, then finished by the model. |
| `missed` | Not replayed: `retry` (a test's retry replays nothing), `no-entry`, `invalid-entry`, `wrong-context` (another app or executor), or `truncated`. |

A hand-off's `reason` is `target-not-found`, `target-ambiguous`,
`viewport-changed` (a press at a point on a screen of another size),
`action-failed`, `end-mismatch`, or `gap`, where the recording stopped at a
tool that changed the app.

An act is not recorded, and its result's `cache.notRecorded` says why,
where two params share a value (`param-collision`), where its first action
was a tool that changed the app (`mutating-tool`), or where the test ended
before any check held (`no-verification`).

The key is the test, the platform, the instruction as written, the params
(a secret by its name, a unique value as its slot), the agent's name and
context, the app and the executor, and not the model, so changing the model
misses nothing. Entries are `.harness/cache/<key>.json`, written whole or not
at all.

| `cache` in `harness.config.ts` | What it does |
| --- | --- |
| `'read-write'` | Replays, and records. The default, locally. |
| `'read-only'` | Replays, and records nothing. The default where `CI` is set. |
| `'off'` | Neither. |
| `{mode, dir, strict}` | `dir` is where entries go; `strict` makes a hand-off `REPLAY_STALE` with no model call, and records nothing. |

`HARNESS_CACHE` wins over the file. To share replays, a team commits
`.harness/cache/` on purpose; `init` leaves the rest of `.harness/` ignored.
[`expo-harness cache`](harness.md#the-agents-cache) lists, counts and
empties it.

## Several agents

```ts
// harness.config.ts
agents: {
  buyer: {model: anthropic(), context: 'A shop. The buyer has a card on file.'},
  admin: {model: anthropic({effort: 'high'}), context: 'The shop admin.', tools: [seedCart]},
},
```

```ts
import {agent, forEachAgent} from 'expo-vitest/agent';

forEachAgent(['buyer', 'admin'], name => {
  it('opens the orders page', async () => {
    await agent.act('open the orders page');
  });
});

await agent.as('admin').act('refund the last order');
await agent.act('open the orders page', {agent: 'buyer'});
```

`forEachAgent` runs its block once for each agent, the name in brackets in
the titles. A step's agent is its `agent` option, else `agent.as`, else the
nearest `forEachAgent`, else `default`. An entry does not inherit from
`default`, and a name the config has not got is `INVALID_ARGUMENT`. The
cache keys on the agent, so one never replays another's steps.

| Agent field | What it is | Default |
| --- | --- | --- |
| `model` | The model it acts with. | none |
| `judge` | The model its judgments use. | the model's own judge, else the model |
| `context` | What the app is, which every call reads, the judgments' too. At most 16 384 bytes. | none |
| `system` | Instructions the acting loop alone reads. | none |
| `tools` | Its [project tools](#project-tools). | none |
| `executor` | An [executor](#an-executor-of-your-own) in place of the built-in loop. Not beside `system` or `tools`. | the built-in loop |
| `maxSteps`, `maxModelCalls` | 1 to 100. | 25 |
| `timeout`, `judgmentTimeout` | In ms. | 120 000, 30 000 |
| `maxObservationBytes` | The most a view may take. | 262 144 |
| `screenshotMaxSide` | The long side of a picture the model sees, in pixels. | 768 |

## Project tools

```ts
import {defineTool} from 'expo-vitest/agent';
import {z} from 'zod';

export const seedCart = defineTool({
  name: 'seed_cart',
  description: "Put one SKU in the signed-in user's cart through the test API. Call it before checking out when the goal names a SKU.",
  schema: z.object({sku: z.string()}),
  mutates: true,
  platforms: ['web', 'android'],
  async execute({sku}, context) {
    const response = await fetch(`${context.app.url}/__test/cart`, {method: 'POST', body: JSON.stringify({sku})});
    if (!response.ok) throw new Error(`seed failed: ${response.status}`);
    return `seeded ${sku}`;
  },
});
```

The schema is a JSON Schema object, or a Standard Schema that gives one, as
Zod 4 does; the input is checked by it before `execute` runs. A tool is
offered on the `platforms` it names, or all of them. `execute` gets the
input and `{platform, app: {url, scheme}, observe(), signal}`, and answers
text, or a value given to the model as JSON. What it throws goes back to the
model as an error. A tool with `mutates: true` spends one of the step's
actions, may not look at the screen, and ends what the cache can replay. A
name the agent uses itself, such as `tap` or `complete_step`, is refused.

## An executor of your own

The built-in loop is an executor named `builtin`, and an agent can name
another. Every executor runs over the same step context, so its actions are
checked against the same rules, counted against the same budgets and
recorded for the same cache:

```ts
import type {StepExecutor} from 'expo-vitest/agent';

export const checker: StepExecutor = {
  name: 'checker',
  version: '1',
  async runStep(ctx) {
    const {tree} = await ctx.observe();
    const shown = tree.nodes.some(node => node.name === ctx.step.instruction);
    return shown ? {status: 'passed', summary: 'It shows.'} : {status: 'blocked', summary: 'This executor only looks.', errorCode: 'AUTOMATION_UNSUPPORTED'};
  },
};
```

`ctx` holds the step, the target's platform and verbs, `observe()`, the
authorised `actions` (`tap`, `type`, `typeSecret`, `press`, `check`,
`scroll`, `scrollTo`, `navigate`, `back`, `dismissKeyboard`, `longPress`,
`tapAt`), the counted `model`, the `budgets` with `runTool`, the steps
before, the signal, the deadline, what a replay did, and places to attach a
transcript, turns and screenshots. `cache: 'off'` keeps an executor's steps
out of the cache. `toolLoopExecutor({name, system, buildPrompt, tools})` runs
the built-in loop with a prompt and tools of its own, `guard` making a
harness failure a tool's answer rather than the step's end. `waitFor` and
`extract` always use the built-in judgments.

## Models

`anthropic()` is Claude Opus 5.5, `claude-opus-5-5`:

| Option | What it is | Default |
| --- | --- | --- |
| `model` | `claude-fable-5-1`, `claude-sonnet-5-5`, `claude-haiku-5-5` and the rest, by name. | `claude-opus-5-5` |
| `effort` | How hard it thinks when it acts: `low` to `max`. | `medium` |
| `judge` | The judgments' model: a name, or any `Model`. | the same model |
| `judgeEffort` | How hard the judge thinks. | `low` |
| `fallbacks` | Anthropic's server-side fallback, which reruns a declined request on its recommended substitute in the same call; `false` for none. Claude Haiku 5.5 has none. | `'default'` |
| `maxTokens` | The most a turn may write, its thinking included. | 16 000 |
| `client` | A client of the SDK's own. | `new Anthropic()` |

The request is the same on every turn but for what the conversation adds, so
the provider's cache holds it: the tools in name order, the system blocks
byte for byte, and no turn already sent ever edited, which the thinking
blocks of these models also need. A tool input cut off at the token limit
is asked for once more with twice the room. Where a model takes no system
message within the conversation, the loop's word goes at the end of the
user's turn instead; where the API here takes no fallback, the adapter says
so once and runs without it.

Any other provider is an object with an id and a `complete` method:

```ts
import type {Model} from 'expo-vitest/agent';

const myModel: Model = {
  id: 'my-provider/model',
  async complete({system, messages, tools, signal}) {
    const reply = await callMyProvider({system: system.map(block => block.text).join('\n'), messages, tools, signal});
    return {
      text: reply.text,
      toolCalls: reply.calls.map(call => ({id: call.id, name: call.name, input: call.args})),
      stopReason: reply.calls.length ? 'tool_use' : 'end',
      usage: {input: reply.usage.in, output: reply.usage.out, cacheRead: 0, cacheWrite: 0},
      model: 'my-provider/model',
    };
  },
};
```

## Errors

Every failure of a step is an `AgentError`, which extends `HarnessError`:
its `code`, its `explanation`, the `step` and its `instruction`, `blocked`
where the step could not go on rather than finding the app wrong, and
`screenshot` where one was kept. `isAgentError` tells one by its fields, as
two copies of the package hold two classes.

| Code | Meaning |
| --- | --- |
| `ASSERTION_FAILED` | The judge said no, or a wait ran out of time. |
| `ASSERTION_INCONCLUSIVE` | The screen does not show enough to say, or the value is not on it. |
| `ACTION_FAILED` | An act concluded it could not do what it was asked, or an action failed. |
| `STEP_BUDGET_EXHAUSTED` | Its actions or model calls are spent. |
| `STEP_TIMEOUT` | It ran past its timeout. |
| `STEP_NO_CONCLUSION` | The model ended two turns in a row without calling a tool. |
| `CONTEXT_OVERFLOW` | The request is more than the model can read. |
| `MODEL_UNAVAILABLE` | No model, no SDK, or the account or the model refused. |
| `MODEL_PROVIDER_FAILED` | The provider failed the call, or the model declined it. |
| `MODEL_OUTPUT_INVALID` | An answer could not be used, even after a repair. |
| `POLICY_DENIED` | A rule above refused it. |
| `SECRET_UNAVAILABLE` | A secret of the step has no value. Blocked. |
| `AUTOMATION_UNSUPPORTED`, `AUTHENTICATION_FAILED`, `APP_NOT_OPEN`, `UNSUPPORTED_CAPABILITY` | Blocked, as the model or the executor found. |
| `INVALID_ARGUMENT` | An option or an agent's name is wrong. |
| `REPLAY_STALE` | A strict cache's replay stopped agreeing. |
| `CANCELLED` | The test was cancelled. |

## Debugging and cost

`HARNESS_DEBUG=1` prints a line to stderr after each step:

```text
agent  act  "upgrade the workspace to the Pro plan"  web  4.8 s  3 calls  2 actions  in 9 412 (cache 84%)  out 211  $0.0119  self-finalized
```

`HARNESS_AI_TRACE=1` appends each call to `.harness/ai-trace.jsonl`, a JSON
line a call, with the test, the step and its turn, the model that answered,
the request with its text redacted and each image as its size, the reply,
the usage, the cost and how long it took. A line a call, so the workers of a
run share the file without a lock.

A test's [trace](evidence.md#the-trace) gains an Agent section: each agent
step, who ran it, how it ended, what it cost, and its last turns.

Dollars come from a table in the package, checked on a date, with a row per
model; a model not in it costs nothing the line can name, `cost n/a`.

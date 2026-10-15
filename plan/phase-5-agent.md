# Phase 5. The agent

Status: done, but for what needs a live model, which is billed and runs by hand: the smoke on web, Android and Windows, and the cache share it shows. The agent ran on web in the fixture and on the Android emulator with models of rules, and has not run on Windows or iOS · Size: L · Depends on: Phase 2, Phase 3 · Unblocks: Phase 6

`expo-vitest/agent` is a subpath a test imports. A model is required only
then. The four calls, their options and their budgets match e2e's, so a test
written against e2e's `agent` reads the same here. What differs is underneath:
the model is an interface, the tree is what the model reads, the same rules
hold on Windows, and nothing leaves the machine except to the model and the
app. The shared facts this document builds on are in
[`README.md`](README.md#11-shared-facts-the-phases-build-on), section 11.

## As built

On the `e2e` branch, after Phase 4, one commit an item or more. Where the
build differs from the design below, the build is what holds.

- **Items 1 to 8: the logic.** `types.ts`, `secrets.ts`, `redact.ts`,
  `view.ts`, `policy.ts`, `tools.ts`, `cost.ts` and `cache.ts`, each
  under the gate as it landed. `jsonSchemaOf` takes a function carrying a
  Standard Schema, as ArkType's types are. `findTarget` finds a control by
  its test id alone only where one node has it: on Android a list's rows
  share `android:id/title`, which the replay on the emulator found, so a
  shared id is narrowed by the kind and name, and a vanished one falls back
  to them.
- **Item 9: the judgments.** `judge.ts`, with `step.ts` beside it for what
  the act loop shares: a step's signal, whose abort reason is the step's own
  `STEP_TIMEOUT` or `CANCELLED`, the model call and the assistant turn.
  `extract` asks inside an envelope that says whether the screen shows the
  value, so a value it does not show is `ASSERTION_INCONCLUSIVE`; a
  Standard Schema that cannot express itself, as Zod's transforms throw, is
  asked for as JSON in text. `waitFor` looks an interval after each look
  began.
- **Item 10: the loop.** `loop.ts`, over a step context (`context.ts`)
  every executor shares, and the hands (`hands.ts`), which every action,
  the model's and the replay's, goes through. The two-image window is not
  built: dropping an image from a turn already sent is an edit of the
  history, which the thinking blocks of these models refuse with a 400, so
  every image stays and later turns read it from the provider's cache. A
  step's refs are its own (`RefBook` in `view.ts`): a node keeps the ref
  it was first shown with, by its identity, since iOS and Android number
  refs afresh and a diff names only what changed. The replay finds its
  controls through the hands and the cache's `findTarget`, not through a
  `Locator`. A pass called beside other calls in its turn is refused until
  the model has seen what they did. Every message that leaves for the model
  is redacted once, as it is first sent, so the history stays byte for byte
  the same.
- **Item 11: the executors.** As designed. `prepareMessages` transforms
  what is sent, and cannot end the loop.
- **Item 12: the adapter.** As designed, and: an SDK error is told apart by
  its HTTP status, as the SDK's classes are; the system-role and the
  fallback retries are remembered per model for the run; `strict` is sent
  for a strict tool alone, and a strict schema and the extract format are
  closed all the way down and stripped of the constraints structured
  outputs do not take. `anthropic()` makes the judge too, a model whose
  judgments run at low effort. No live call was made.
- **Item 13: `resizeImage`**, a box filter, in `image.ts` with the rest of
  the pure pixel geometry, under the gate, in place of `resizePng` in
  `png.ts`.
- **Item 14: the runtime and the public module.** `runtime.ts` holds all of
  it over a host, under the gate, and `index.ts` binds it to the device.
  `agents`, `secrets` and `cache` are checked when the file loads (the
  agent's `config.ts`), and the setup file keeps its load for the agent;
  `tools` at the root is an unknown key. The config's hash names an
  instance of a class rather than walking it, since a client or a Zod
  schema can hold a key, or itself. The journal gained `note()`, for an act
  recorded around the steps it took, the agent's notes for the trace's Agent
  section, and a privacy hook, through which the evidence redacts its trace
  and its tree and keeps no picture or recording after a secret was filled:
  the design redacted the trace but not the tree, and said nothing of the
  evidence's own pictures. An assert's picture rides on the journal's note
  and the evidence writes it, since a test's folder is replaced when its
  evidence is written. The AI trace is `.harness/ai-trace.jsonl`, a JSON
  line a call, appended so the workers of a run share it without a lock.
- **Item 15: the subpaths**, the optional peer, and a contract test of the
  agent's own, `src/agent/contract.test.ts`.
- **Item 16: `expo-harness cache`.** As designed; the fixture runs the
  packed command.
- **Item 17: the fixture.** A model of rules in its harness config signs in
  on a page with a password and a generic secret, asserts, waits and reads;
  a second run replays the sign-in with the model refusing to act; the grep
  finds neither value under `.harness/`; and the tree of a test that typed
  the generic secret into a field that shows it hides it. The live smoke is
  `fixture/device/agent.smoke.test.ts`, written and not run.
- **Item 18: the docs.** `agent.md`, and the configuration, evidence,
  harness and migrating pages, and the README's rows.

Run by hand on the Android emulator, with a model of rules that taps a node
by its name: an act on Settings, an assert on the screen it led to, and a
second run that replayed the act with no model call. Not run: Windows, where
the agent would press controls in the apps on this machine's desk, and iOS.

## Purpose and the claims it proves

| Claim | How it is shown |
| --- | --- |
| Friendlier | `agent.act`, `assert`, `waitFor` and `extract` with e2e's names, options, defaults and result shapes. A test ports by changing one import. |
| Wider | The same four calls run on web, Windows, Android and iOS. A tool a driver cannot offer is left out of the model's tool list instead of failing the step. |
| Lighter | One optional peer, `@anthropic-ai/sdk`, loaded only by `expo-vitest/agent/anthropic`. Any other provider is an object with one method. No `ai`, no `zod`, no `pngjs`. |
| Safer | Secrets are handles. The runner fills them. The model, the trace, the evidence and the console see `<secret:name>`. No telemetry. |
| Faster | A verified `act` replays with zero model calls through the same locator resolution a scripted test uses, so a replayed step costs what a scripted step costs. |

## What e2e does

From its agent reference, agent-steps, cache, security, authentication, tools,
executors, agents and debugging pages, checked 2026-10-13.

- **Four calls.** `act(instruction, {params, timeout, maxSteps, maxModelCalls, agent})` returns `{summary, cache?, modelCalls, actions}` where `actions` is a count. `assert(assertion, {vision, timeout, screenshot, agent})`, `waitFor(condition, {vision, timeout, interval, maxModelCalls, agent})` and `extract(instruction, {schema, vision, timeout, agent})`. Budgets: `act` 25 model calls and 25 action steps, `waitFor` 25 calls and no actions, `assert` and `extract` 2 calls (one judgment, one repair). `act` times out at `config.timeout` (120 s), the judgments at `judgmentTimeout` (30 s). `waitFor` polls every 3 s by default and makes no model call while the screen is unchanged.
- **What the model sees.** The instruction, params, completed steps, and a redacted text snapshot: roles, names, text and states, with ids that stay stable while an element exists. After an action, the screen changes or a full new snapshot when most of the screen changed. Judgments see the assertion, the current screen and the agent's `context`, never prior steps. `vision: true` adds a masked screenshot, at most 768 px on the long side, the newest two kept. `vision: 'only'` sends the screenshot alone and fails with `POLICY_DENIED` when pixels are withheld.
- **Tools.** Per engine verb: `tap`, `double_tap`, `long_press`, `right_click`, `hover`, `type`, `type_secret`, `press`, `select`, `check`, `scroll`, `scroll_to`, `drag`, `upload`, `navigate`, `back`, `observe`, `dismiss_keyboard`, plus pixel tools `screenshot`, `tap_at`, `hover_at`, `type_at`, `press_at`, `select_at` while no secret has been filled, plus project tools. A targeted action times out after 15 s.
- **Loop controls.** Repeated-call and cycle detection. After three failed actions in a row the model is told to change approach, after five it is asked for a verdict, and it is asked for a verdict when the budget or deadline is near. A step ends `passed`, `failed` or `blocked`.
- **Secrets.** `credentials.user(name)` and `secrets.get(name)` return handles with no value accessor. The model sees name and purpose and gets `type_secret`. The runner checks the field is an enabled editable `textbox`, `searchbox` or `combobox`, a password only into a password field, and types the value itself. After any secret fill, screenshots and pixel tools are off for the rest of the attempt. Known values are replaced by `<secret:name>` in model input, reports, traces, console output and text downloads, matching plain, JSON-escaped, HTML-escaped, percent-encoded and case-insensitive forms with whitespace collapsed. Static secrets under 6 characters are `INVALID_CONFIG`. `E2E_SECRET_<NAME>` overrides a value for one run.
- **Policy.** `navigate` accepts `http:`, `https:` and `about:blank` only; `device.openLink` accepts an app scheme but refuses `file:`, `data:`, `javascript:`, `view-source:`, `blob:`, `filesystem:`. Uploads only from inside the project and never hidden paths. Only secrets in the step's params can be filled. Reading a secure field's value is denied.
- **Cache.** A verified `act` is recorded after a later check passes (a locator matcher, `locator.waitFor`, `agent.assert`, `agent.waitFor`). The entry holds the actions, target descriptions, typed text, a step summary and end checks: the route plus up to eight controls that appeared and eight that disappeared. It is keyed by test, target, instruction, params, agent, `context` and `agentContext`, engine, project id and app identity, not the model. Replay checks the starting route, finds each control by role, name, test id and context, repeats, checks the end state, and hands off on mismatch. `StepCacheInfo` is `{mode: 'self-finalized' | 'agent-concluded' | 'missed', reason?, derived?, notRecorded?: 'param-collision', replayedActions, totalActions}`. Miss reasons: `retry`, `no-entry`, `invalid-entry`, `truncated`, `wrong-context`. Hand-off reasons: `gap`, `target-not-found`, `target-ambiguous`, `viewport-changed`, `action-failed`, `action-uncertain`, `end-mismatch`. Modes `read-write` locally, `read-only` in CI, `off`; `strict` fails stale entries with `REPLAY_STALE`. `unique(value)` marks a per-run value and throws `INVALID_ARGUMENT` for a non-string, empty or whitespace-only value, or text containing `{{param:`. `e2e cache ls|stats|clear`.
- **Tools, executors, personas.** `defineTool(aiSdkTool, {mutates, platforms})`; a mutating tool spends an action slot and cannot be replayed, so the agent runs that part live. `StepExecutor` with `name`, `version`, `cache`, `runStep(ctx)` returning `{status, summary, errorCode?}`; `createToolLoopExecutor({name, system, buildPrompt, tools, prepareMessages, maxModelCalls})`. `agents.<name>` entries with `model`, `judge`, `system`, `context`, `tools`, `executor`, `maxSteps`, `maxModelCalls`, `judgmentTimeout`, `maxObservationBytes`, `maxInputTokens`, `providerOptions`. `system` reaches the acting loop only, `context` every call including the judges. `{agent: ['buyer', 'admin']}` runs a test once per agent with the name in brackets in the title.
- **Debugging.** `--debug` prints phase timings and a per-step table of duration, model calls, tokens, cache share and cost, and saves transcripts. `--ai-trace` writes `.e2e/ai-trace.json` with inputs redacted and image bytes replaced by counts. `trace.md` holds the agent's last turns.
- **Errors.** `AgentError` with a closed `code`, an `explanation`, an optional `screenshot` path and a `blocked` flag, checked with `isAgentError`. Codes include `ASSERTION_FAILED`, `ASSERTION_INCONCLUSIVE`, `ACTION_FAILED`, `LOCATOR_NOT_FOUND`, `LOCATOR_AMBIGUOUS`, `STEP_BUDGET_EXHAUSTED`, `STEP_TIMEOUT`, `STEP_NO_CONCLUSION`, `CONTEXT_OVERFLOW`, `MODEL_UNAVAILABLE`, `MODEL_PROVIDER_FAILED`, `MODEL_OUTPUT_INVALID`, `POLICY_DENIED`, `SECRET_UNAVAILABLE`, `AUTOMATION_UNSUPPORTED`, `UNSUPPORTED_CAPABILITY`, `INVALID_ARGUMENT`, `REPLAY_STALE`, `CANCELLED`, `APP_NOT_OPEN`, `AUTHENTICATION_FAILED`.

## What this package has today

- `src/device/index.ts`: `device` over one `Driver`, `element(by.…)`, `by`, `configFromEnvironment`. Nothing agent-shaped.
- `src/harness/lib/snapshot.ts`: the flat tree `{platform, source, nodes}` with `ref`, `role`, `name`, `testId`, `depth`, `interactive`, `focused`, `enabled`, `offscreen`, `bounds` and the optional screen-reader fields; `findNode`, `renderSnapshot`, `centreOf`. By the time this phase starts, Phase 1 has added `parent` and Phase 2 has added `kind`, `screen`, the `Locator`, the polling matchers and the evidence ledger that writes `trace.md`.
- `src/harness/lib/types.ts`: the `Driver` with `open`, `snapshot`, `press`, `fill`, `type`, `key?`, `screenshot`, `idleSeconds`, `close`. Phase 3 adds the lifecycle and device-control methods and `device.can`.
- `src/harness/lib/png.ts`: `decodePng`, `encodePng`, `comparePng`. Phase 3 adds masking and cropping. This phase adds a box-filter `resizePng` for the 768 px screenshot.
- `src/projects.ts`: `SUBPATHS` and `file()`, which is how a new subpath is added, with the test in `src/projects.test.ts` that keeps `SUBPATHS` and `package.json`'s `exports` in step.
- `package.json`: optional peers through `peerDependenciesMeta`; `playwright-core` is the pattern to copy for `@anthropic-ai/sdk`.
- `harness.config.ts` and `defineHarness` from Phase 3, loaded by the device setup file in the worker. This phase adds `agents`, `tools`, `secrets` and `cache` to it.
- `HarnessError` with `code` from Phase 0. `AgentError` extends it.

## Design

### 5.1 The public API

```ts
// expo-vitest/agent
import {agent, defineTool, forEachAgent, isAgentError, secret, unique} from 'expo-vitest/agent';

await agent.act('upgrade the workspace to the {plan} plan', {params: {plan: 'Pro'}});
await agent.assert('the invoice preview shows a prorated amount', {vision: true});
await agent.waitFor('the upload has finished');
const total = await agent.extract('the order total as a number', {schema: z.number()});
await agent.act('sign in as {user}', {
  params: {user: 'ada@example.com', password: secret('ADA_PASSWORD')},
});
const admin = agent.as('admin');
```

```ts
export type AgentStepKind = 'act' | 'assert' | 'waitFor' | 'extract';
export type VisionMode = boolean | 'only';

export interface AgentOption {
  /** A name under `agents` in harness.config.ts. The block's agent, then `default`, when absent. */
  agent?: string;
}
export interface ActOptions extends AgentOption {
  params?: Record<string, string | number | boolean | Secret | Unique>;
  /** Milliseconds. 120 000 unless the agent entry says otherwise. */
  timeout?: number;
  /** Action steps. 25, and an option may only lower the entry's value. */
  maxSteps?: number;
  /** Model calls. 25, same rule. */
  maxModelCalls?: number;
}
export interface AssertOptions extends AgentOption {
  vision?: VisionMode;
  /** 30 000 unless the entry's `judgmentTimeout` says otherwise. */
  timeout?: number;
  /** A screenshot kept as evidence after the verdict. On unless pixels are withheld. */
  screenshot?: boolean;
}
export interface WaitForOptions extends AgentOption {
  vision?: VisionMode;
  timeout?: number;
  /** 100 to 60 000 ms, 3 000 by default. */
  interval?: number;
  maxModelCalls?: number;
}
export interface ExtractOptions<S> extends AgentOption {
  /** A Standard Schema v1 validator, or a plain JSON Schema object. */
  schema: S;
  vision?: VisionMode;
  timeout?: number;
}

export interface StepCacheInfo {
  mode: 'self-finalized' | 'agent-concluded' | 'missed';
  reason?: ReplayMissReason | ReplayHandOffReason;
  notRecorded?: 'param-collision' | 'mutating-tool' | 'no-verification';
  replayedActions: number;
  totalActions: number;
}
export interface ActResult {
  summary: string;
  cache?: StepCacheInfo;
  modelCalls: number;
  /** Actions performed, the way e2e counts them: grammar actions plus mutating tool calls. */
  actions: number;
  /** Ours: dollars for this step from the adapter's price table, absent when the model reports no usage. */
  costUsd?: number;
}

export interface Agent {
  act(instruction: string, options?: ActOptions): Promise<ActResult>;
  assert(assertion: string, options?: AssertOptions): Promise<void>;
  waitFor(condition: string, options?: WaitForOptions): Promise<void>;
  extract<S extends StandardSchemaV1 | JsonSchema>(instruction: string, options: ExtractOptions<S>): Promise<Infer<S>>;
  as(name: string): Agent;
}
```

`agent` is one object made on first use from the loaded `harness.config.ts`,
the way `device` is made from the environment. It drives the same `Driver`
instance `device` holds, so an agent step and a scripted step in one test share
the browser, the window or the device session, and the evidence ledger records
both in order.

Every failure is an `AgentError`, which extends `HarnessError` from Phase 0:

```ts
export class AgentError extends HarnessError {
  readonly code: AgentErrorCode;
  readonly explanation: string;
  readonly screenshot?: string;
  readonly blocked: boolean;
}
export function isAgentError(error: unknown): error is AgentError;
```

The codes are e2e's, listed above under errors, with the same meanings. A
`blocked` verdict carries one of the blocked codes and `blocked: true`.

`secret(name)` returns a `Secret`, an object with `name`, a `purpose` of
`'password'` or `'generic'` (a name ending in `PASSWORD` is a password, or
`secret(name, {purpose})` says), and no value property at all. The value lives
in a module-private `WeakMap` keyed by the handle and is read only by the
runner when it fills a field. `JSON.stringify(secret)` yields
`{"secret":"ADA_PASSWORD"}`. `unique(value)` returns `{value}` branded as
`Unique` and throws `INVALID_ARGUMENT` on a non-string, an empty or
whitespace-only value, or text containing `{{param:`.

`forEachAgent(['buyer', 'admin'], (name) => {...})` is `describe.each(names)('[%s]', ...)`
with a `beforeEach` that pushes the name onto the agent selection stack and an
`afterEach` that pops it. `agent.as(name)` returns an `Agent` bound to one
entry for one call site. Resolution order for a step: the explicit `agent`
option, then `agent.as`, then the nearest `forEachAgent` block, then
`default`. An unknown name throws `INVALID_ARGUMENT`.

Timeouts are capped by the device test's own timeout: `deviceConfig` sets
`testTimeout` to 120 s, and `act` defaults to the same number, so a step
cannot outlive its test. The docs say to raise both together.

### 5.2 The model interface and the Claude adapter

```ts
// expo-vitest/agent, provider neutral
export interface Model {
  readonly id: string;
  complete(request: CompletionRequest): Promise<Completion>;
}
export interface CompletionRequest {
  /** Stable first, volatile last. The adapter places its cache breakpoints on the block boundaries. */
  system: readonly SystemBlock[];
  messages: readonly Message[];
  tools: readonly ToolSpec[];
  /** For extract: the model answers with JSON matching this schema instead of calling tools. */
  format?: JsonSchema;
  /** `low` for judgments, `medium` for acting unless the entry says otherwise. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  signal: AbortSignal;
}
export interface SystemBlock { text: string; cache?: boolean }
export type Message =
  | {role: 'user'; content: readonly (TextPart | ImagePart | ToolResultPart)[]}
  | {role: 'assistant'; content: readonly (TextPart | ToolUsePart)[]; raw?: unknown}
  | {role: 'system'; content: string};
export interface TextPart { type: 'text'; text: string }
export interface ImagePart { type: 'image'; mediaType: 'image/png'; data: string; width: number; height: number }
export interface ToolUsePart { type: 'tool_use'; id: string; name: string; input: unknown }
export interface ToolResultPart { type: 'tool_result'; toolUseId: string; content: readonly (TextPart | ImagePart)[]; isError?: boolean }
export interface ToolSpec { name: string; description: string; inputSchema: JsonSchema }
export interface Completion {
  text: string;
  toolCalls: readonly {id: string; name: string; input: unknown}[];
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  usage: Usage;
  /** The model that produced it, which a fallback may have changed. */
  model: string;
  /** The provider's assistant turn, replayed verbatim by the loop. */
  raw?: unknown;
}
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
```

The `raw` field is the whole point of replaying a provider's own assistant
turn. Claude Opus 5.5, Claude Fable 5.1, Claude Sonnet 5.5 and Claude Haiku 5.5
bind their thinking blocks to the conversation that produced them, and an
edited history can be a 400 on accounts created on or after 2026-08-31. The
loop therefore never edits an earlier turn: it appends the adapter's `raw`
assistant turn as it came, appends tool results and nudges as new messages,
and never strips a block.

**`expo-vitest/agent/anthropic`** is the first adapter, over
`@anthropic-ai/sdk` as an optional peer, resolved from the project with
`createRequire` the way the web driver resolves `playwright-core`. A missing
SDK fails the first model call with `MODEL_UNAVAILABLE` and the install line.

```ts
import {anthropic} from 'expo-vitest/agent/anthropic';

anthropic();                                                  // claude-opus-5-5
anthropic({model: 'claude-fable-5-1', effort: 'high'});
anthropic({judge: 'claude-haiku-5-5', fallbacks: false, maxTokens: 8000});
```

| Option | Default | Note |
| --- | --- | --- |
| `model` | `claude-opus-5-5` | `claude-fable-5-1`, `claude-sonnet-5-5` and `claude-haiku-5-5` by name. No date suffixes. |
| `effort` | `medium` for acting | Claude Opus 5.5 defaults to `medium` on its own; the adapter sets it explicitly on every call so a model change does not silently change depth. Judgments use `low` unless `judgeEffort` says otherwise. |
| `judge` | the same model | A separate `Model` for `assert`, `waitFor` and `extract`. |
| `fallbacks` | `'default'` | `fallbacks: 'default'` with beta `server-side-fallback-2026-07-01`, so a safety classifier decline reruns on Anthropic's recommended substitute inside the same call. `false` turns it off. On a platform that rejects the parameter the adapter retries once without it and says so once. |
| `maxTokens` | 16000 | Non-streaming, per the SDK guidance. |
| `client` | `new Anthropic()` | Credentials through the SDK's own chain: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, an `ant auth login` profile. No key handling of ours. |

The request the adapter builds, from the shapes in the skill files:

```ts
const response = await client.beta.messages.create({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  output_config: {effort: 'medium', ...(format ? {format: {type: 'json_schema', schema: format}} : {})},
  system: [
    {type: 'text', text: core},                                               // frozen, identical every run
    {type: 'text', text: contextAndSystem, cache_control: {type: 'ephemeral'}}, // per agent entry
  ],
  tools: tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,                                            // additionalProperties: false
    strict: true,
  })),
  tool_choice: {type: 'auto'},
  messages,                                                                    // SDK MessageParam[]
  cache_control: {type: 'ephemeral'},                                          // automatic breakpoint on the tail
}, {signal});
```

Rules the adapter follows and the unit tests pin:

- No `thinking` parameter. On these models thinking is always on and `effort` is the control. Content is read by block type, never by position, because a response can begin with `thinking` blocks whose text is empty under the default display.
- `tool_choice` is `auto`. Forced tool use is a 400 on these models, so the prompt names the tool and the loop checks a call was made.
- Tools are sorted by name before the request, and the system blocks are byte-identical between turns. The only volatile content is in `messages`.
- Caching: tools render before system, so the breakpoint on the last system block caches both. The top-level `cache_control` moves the tail breakpoint forward each turn. Opus 5.5 and the other named models cache from 512 tokens, and the core prompt plus the tool list is well past that.
- `stop_reason` is checked before `content`. `refusal` ends the step with `MODEL_PROVIDER_FAILED` and the `stop_details` category in the explanation. `max_tokens` with a `tool_use` block present is a truncated input: the loop retries that turn once with double `max_tokens`, then fails with `MODEL_OUTPUT_INVALID`.
- A `fallback` content block or a `fallback_message` entry in `usage.iterations` means a substitute model ran. The adapter reports `response.model` as `Completion.model`, and the cost uses that model's row.
- Errors are the SDK's typed classes. `AuthenticationError` becomes `MODEL_UNAVAILABLE`, `RateLimitError` and `InternalServerError` are retried by the SDK's own `max_retries` and then become `MODEL_PROVIDER_FAILED`, `BadRequestError` naming the context window becomes `CONTEXT_OVERFLOW`.
- A mid-conversation nudge is sent as `{role: 'system', content}` appended to `messages`, which these models accept without a beta header and which leaves the cached prefix intact. A `BadRequestError` saying `role 'system' is not supported` makes the adapter resend the nudge as a text block after the last tool results and remember the fallback for the run.
- `format` becomes `output_config.format` with the JSON Schema, which guarantees schema-valid output for `extract` when the schema can be expressed that way.

Any other provider is an object with `id` and `complete`. The docs carry the
example in full; it is about twelve lines because the interface is small:

```ts
const myModel: Model = {
  id: 'my-provider/model',
  async complete({system, messages, tools, signal}) {
    const reply = await callMyProvider({system: system.map(b => b.text).join('\n'), messages, tools, signal});
    return {
      text: reply.text,
      toolCalls: reply.calls.map(c => ({id: c.id, name: c.name, input: c.args})),
      stopReason: reply.calls.length ? 'tool_use' : 'end',
      usage: {input: reply.usage.in, output: reply.usage.out, cacheRead: 0, cacheWrite: 0},
      model: 'my-provider/model',
    };
  },
};
```

No shim for another vendor ships in this package.

### 5.3 Configuration

`harness.config.ts` from Phase 3 gains four keys:

```ts
import {defineHarness} from 'expo-vitest/device';
import {defineTool} from 'expo-vitest/agent';
import {anthropic} from 'expo-vitest/agent/anthropic';

export default defineHarness({
  app: {/* Phase 3 */},
  agents: {
    default: {
      model: anthropic(),
      context: 'A workspace billing app. Plans are Free, Team and Pro. Settings is the gear in the top bar.',
      system: 'Verify every outcome before you finish. Dismiss cookie banners first.',
      maxSteps: 25,
      maxModelCalls: 25,
      judgmentTimeout: 30_000,
    },
    admin: {model: anthropic({effort: 'high'}), context: '…', tools: [seedCart]},
  },
  secrets: {ADA_PASSWORD: process.env.ADA_PASSWORD},
  cache: 'read-write',
});
```

```ts
export interface AgentConfig {
  model?: Model;
  judge?: Model;
  /** Read by the acting loop only. */
  system?: string;
  /** Read by every call, the judges included. At most 16 384 bytes. */
  context?: string;
  tools?: readonly Tool[];
  executor?: StepExecutor;
  maxSteps?: number;          // 1 to 100, 25
  maxModelCalls?: number;     // 1 to 100, 25
  judgmentTimeout?: number;   // 30 000
  maxObservationBytes?: number; // 262 144
  screenshotMaxSide?: number; // 768
}
export interface HarnessAgents {
  agents?: Record<string, AgentConfig>;
  secrets?: Record<string, string | undefined | (() => Promise<string> | string)>;
  cache?: 'off' | 'read-only' | 'read-write' | {mode?: 'off' | 'read-only' | 'read-write'; dir?: string; strict?: boolean};
}
```

Entries do not inherit from `default`. `executor` and `system` or `tools` on
the same entry is `INVALID_ARGUMENT` at load, as e2e rejects it. A `secrets`
value shorter than 6 characters is `INVALID_ARGUMENT` at load. The worker
loads the file the way Phase 3 arranged, so a `Model` object with functions
never has to cross a process boundary. `HARNESS_SECRET_<NAME>` overrides a
configured value and supplies one that is not configured, so CI can inject
without editing the file. `HARNESS_CACHE` overrides `cache`; without either,
`read-write` locally and `read-only` when `CI` is set.

### 5.4 The loop

**The view.** `view.ts` renders a `Snapshot` as text, one node per line,
interactive nodes first and the rest after a blank line, with a cap of
`maxObservationBytes`:

```text
route: /settings/billing
window: 1280x900

@e7  button   "Upgrade to Pro"  #upgrade-cta
@e3  tab      "Billing"  [selected]
@e9  textbox  "Workspace name"  value="Acme"
@e12 textbox  "Password"  [secure]
@e14 checkbox "Email receipts"  [checked]

@e1  heading  "Billing"  h1
@e5  text     "Your plan renews on 1 November"
@e6  status   "Saving…"  live:polite
```

The ref is the stable id within one snapshot, `kind` is the word the
model acts by, the name is quoted, the test id follows `#`, states are in
brackets, and a secure field never shows a value. The screen-reader fields
from Windows render the way `renderSnapshot` already prints them. Nodes are
listed in tree order within each group, so a parent reads before its children.

After an action the loop sends the diff against the previous view, computed by
identity (`kind`, name, test id, parent) rather than by ref, as `+` added,
`-` removed and `~` changed lines, with a `screen: unchanged` line when nothing
moved. When more than half the lines changed it sends the whole view instead,
which is what e2e does and what keeps a navigation legible.

**The first turn** of an `act` is one user message: the instruction with
`{param}` holes substituted (a `Secret` substitutes to `<secret:NAME>`, a
`Unique` to its value), the params as a list, the completed steps of this test
so far in one line each, then the view. The system blocks are the frozen core
prompt (what the tools do, how to read the view, when to call `complete_step`,
the loop rules) and the entry's `context` and `system`. Judgments get the core
judge prompt, the `context`, the assertion and the current view, never the
steps or an `act` summary.

**Tools offered** are chosen from `device.can` for the step's driver and
rendered as strict JSON Schema. Every schema sets `additionalProperties: false`
and lists every property in `required`, with optional ones typed as a union
with `null`, which is what `strict` needs:

| Tool | Input | Needs |
| --- | --- | --- |
| `tap`, `long_press` | `{ref}`, `{ref, durationMs}` | `press` |
| `type` | `{ref, text, replace}` | `fill` |
| `type_secret` | `{ref, secret}` | `fill` and a secret in the step's params |
| `press` | `{key}` | `key` |
| `check` | `{ref, checked}` | `press` |
| `scroll` | `{direction, ref?}` | `swipe` (Phase 3) |
| `scroll_to` | `{text}` or `{ref}` | `swipe` |
| `navigate` | `{url}` | `open` |
| `back` | `{}` | `back` (Phase 3) |
| `dismiss_keyboard` | `{}` | `dismissKeyboard` (Phase 3) |
| `observe` | `{}` | always |
| `screenshot` | `{}` | pixels allowed |
| `tap_at` | `{x, y}` | `press` at a point and pixels allowed |
| `complete_step` | `{status, summary, errorCode?}` | always |
| project tools | their own schema | the entry's `tools`, filtered by `platforms` |

A tool a driver cannot offer is not in the list. The model cannot ask for
`hover` on Android because it was never told it exists.

**The state machine.** One step is a loop of model turn, action, observation:

1. `deciding`: one model call. `modelCalls += 1`. Every `tool_use` in the reply is handled in order; the assistant turn is appended as `raw`.
2. `acting`: a grammar tool runs through `Locator` resolution on a fresh snapshot (`ref` from the newest view, else `target-not-found`), then the `Driver`, with the Phase 1 settle wait; `actions += 1`. A project tool with `mutates: true` also counts. `observe`, `screenshot` and a read-only tool do not count. Each result goes back as a `tool_result`, with the diff text, or `isError: true` and the `HarnessError` message.
3. `checking`: after each turn the loop checks the budgets and the deadline. Within three model calls or three actions of a limit, or within 15 s of the deadline, it appends a `system` message asking for `complete_step` now. A repeated call (same tool, same input, same view as the last call) gets a `system` message naming the repetition. Three failed actions in a row get a `system` message to change approach; five get the verdict request.
4. `concluding`: `complete_step` ends the step. `passed` resolves `act`. `failed` rejects with the given `errorCode` or `ACTION_FAILED`. `blocked` rejects with the given blocked code and `blocked: true`. A turn with no tool call and no `complete_step` is answered with a `system` message asking for one; the second such turn ends the step with `STEP_NO_CONCLUSION`. Budget exhaustion ends it with `STEP_BUDGET_EXHAUSTED`, the deadline with `STEP_TIMEOUT`, the test's `signal` with `CANCELLED`.

A targeted action has its own 15 s limit, after which the result is an error
to the model, not the end of the step.

**Judgments.** `assert` makes one call with the judge prompt and a
`complete_step`-shaped verdict tool, `{verdict: 'pass' | 'fail' | 'inconclusive', explanation}`.
A malformed reply gets one repair call. `fail` is `ASSERTION_FAILED` with the
explanation, `inconclusive` is `ASSERTION_INCONCLUSIVE`. With `screenshot`
on and pixels allowed, a screenshot is saved to the evidence folder after the
verdict. `waitFor` snapshots every `interval`, calls the judge only when the
view differs from the last judged view, and ends with `ASSERTION_FAILED` at
the timeout; the view comparison is the same identity diff, so a clock ticking
in a `text` node does not trigger a call unless its text changed. `extract`
sends `format` when the schema is JSON Schema or a Standard Schema that also
exposes one, and otherwise asks for a JSON object in text; the value is
validated with `~standard.validate` (awaited when it returns a promise) or the
package's small JSON Schema checker (types, `enum`, `required`, `properties`,
`items`, `anyOf`), with one repair call carrying the issues, then
`MODEL_OUTPUT_INVALID`. `extract` on data the screen does not show is
`ASSERTION_INCONCLUSIVE`, never a placeholder.

**Vision.** With `vision: true` the user turn carries the view and a
screenshot; with `'only'` the screenshot alone. The screenshot is the driver's
PNG, resized by `resizePng` in `png.ts` (box filter, no dependency) so the
long side is at most `screenshotMaxSide`, 768 by default, which on the
28-pixel patch grid is about 450 visual tokens for a phone screen. Every
secure field's bounds are painted over with the Phase 3 mask before encoding.
Pixels are withheld, and `vision: 'only'` fails with `POLICY_DENIED`, when a
secret has been filled in this test, when any secure field in the tree has no
bounds to mask, or when the driver cannot screenshot. Only the newest two
images stay in the message history; older image parts are replaced, in the
message the loop appends, by a text line saying a screenshot was here. The
loop never rewrites an earlier message to do this: image parts live in
`tool_result` content for `screenshot` and in the step's user turns, and the
replacement is done when the turn is first built, by keeping a window of two
and sending older turns' images as text from the start. In practice that means
the loop builds the message list for each call from its own ledger rather
than mutating one array, and the built list is identical for a given ledger,
so the cached prefix is unchanged.

### 5.5 Security rules

The rules match e2e's in effect and are enforced in `policy.ts`, which is pure
logic over the step's state and the tree:

| Rule | Enforcement |
| --- | --- |
| A secret is a handle with no value accessor. | `Secret` carries `name` and `purpose`; the value is in a `WeakMap` only `secrets.ts` reads. A secret reaching `JSON.stringify` yields its name. |
| Only a secret in the step's params can be filled. | `type_secret` with any other name is `POLICY_DENIED` back to the model. |
| `type_secret` only into an enabled, editable text field. A password only into a password field. | The target node must have `kind` `textbox`, `searchbox` or `combobox`, `enabled` not `false`, and for `purpose: 'password'` the `secure` state. Otherwise `POLICY_DENIED`. |
| The runner types the value. | `secrets.ts` resolves the value and calls `driver.fill` directly. The value is never in a tool input, a tool result, a message or the ledger. |
| No screenshots after a secret fill, for the rest of the test. | A per-test `tainted` flag. `screenshot`, `tap_at`, `assert` screenshots, `vision`, and Phase 3's `toMatchScreenshot` consult it. The flag resets in the device `afterEach`. |
| Redaction everywhere text leaves the process. | `redact.ts` replaces every configured value in model input, tool results, `trace.md`, `tree.txt`, `ai-trace.json`, `HarnessError` messages and, while an agent step runs, `console.log`, `console.error`, `process.stdout.write` and `process.stderr.write`. |
| `navigate` only to `http:`, `https:`, `about:blank`, or the app's own scheme from `harness.config.ts`. | Parsed with `URL`; anything else is `POLICY_DENIED`. `file:`, `data:`, `javascript:`, `view-source:`, `blob:` and `filesystem:` are named in the message. |
| Uploads only from inside the project, never hidden paths. | A future `upload` tool resolves against `HARNESS_ROOT` and rejects `..`, absolute escapes and any path segment starting with `.`. |
| Secure fields are never read. | `get`-style reads of a node with the `secure` state are `POLICY_DENIED`. The view shows no value for them. |
| No outbound connection but the model and the app. | There is no other network code in `src/agent/`, and the fixture's device suite runs with a network allowlist in Phase 4's CI job. |

The redaction algorithm: for each secret value, build the variant set
`{plain, JSON.stringify(v).slice(1, -1), htmlEscape(v), encodeURIComponent(v)}`,
each also with whitespace collapsed; sort all variants by length descending;
replace every case-insensitive occurrence with `<secret:NAME>`; finally, when a
string ends with a prefix of a value at least 6 characters long, replace that
tail too, which is the truncated-text rule. Values under 6 characters are
refused at load so the tail rule cannot match ordinary words. The function is
pure and the unit tests cover every form.

### 5.6 The replay cache

**Recording.** During an `act`, `cache.ts` keeps the list of grammar actions
performed with, for each, the tool, its input minus any secret, the target's
identity, and the view diff summary after it. The step is `pending` when
`act` returns. The Phase 2 evidence ledger emits `verified` when a polling
matcher passes, a `Locator.waitFor` resolves, or `agent.assert` or
`agent.waitFor` passes, and the first `verified` after the step finalizes it:
the entry is written. A test that ends with the step still pending leaves
`notRecorded: 'no-verification'` in the result's cache info. A step whose
params collide, meaning two params with the same value, is not recorded,
`param-collision`. A step that called a `mutates: true` tool is recorded up to
that call and marked `truncated`, and `notRecorded: 'mutating-tool'` is
reported when the tool call was the first action. Only `read-write` writes.

```json
{
  "v": 1,
  "key": "b1f2…",
  "test": {"file": "device/billing.test.ts", "title": "a member upgrades to Pro"},
  "platform": "web",
  "instruction": "upgrade the workspace to the {plan} plan",
  "params": {"plan": "Pro"},
  "agent": {"name": "default", "contextHash": "9c…"},
  "app": {"identity": "http://localhost:8081"},
  "executor": {"name": "builtin", "version": "1"},
  "start": {"route": "/settings/billing"},
  "actions": [
    {"tool": "tap", "target": {"kind": "button", "name": "Upgrade to Pro", "testId": "upgrade-cta", "parent": ["main", "Billing"]}, "input": {}},
    {"tool": "type", "target": {"kind": "textbox", "name": "Card number", "testId": null, "parent": ["dialog", "Payment"]}, "input": {"text": "4242 4242 4242 4242", "replace": true}}
  ],
  "end": {
    "route": "/settings/billing/confirm",
    "appeared": [{"kind": "status", "name": "Prorated amount"}],
    "disappeared": [{"kind": "button", "name": "Upgrade to Pro"}]
  },
  "summary": "Opened the upgrade dialog, entered the card and confirmed.",
  "recordedAt": "2026-10-13T06:24:00Z",
  "viewport": {"width": 1280, "height": 900}
}
```

Typed text is stored as typed, except a secret fill which stores
`{"secret": "ADA_PASSWORD"}` and is authorised again on replay. A `Unique`
param is stored as the slot `{{param:name}}` in the instruction and in any
typed text equal to its value, so the key is stable across runs.

**The key** is `sha256` over canonical JSON (sorted keys, no whitespace) of
`{test: {file, title}, platform, instruction (with Unique slots), params (Unique as slots, Secret as names), agent: {name, context, agentContext}, app: {identity}, executor: {name, version}}`.
The model is not in the key, so changing it is not a miss. Entries live at
`.harness/cache/<key>.json`, written to a temp name and renamed, so a crash
never leaves a half entry. `.harness/` is gitignored by `init`; to share
replays, a team commits `.harness/cache/` on purpose, which the docs explain.

**Replay.** In `read-only` or `read-write`, `act` first looks up the entry.
`no-entry` and a JSON or version failure, `invalid-entry`, are misses. A
retry attempt of the same test (Vitest `retry`) is a miss, `retry`. An entry
whose `app.identity` or `executor` differ is `wrong-context`. Then:

1. The current route must equal the recorded start route after placeholdering, where a path or query segment that is a number, a UUID or a hash is treated as a wildcard. Otherwise hand off with `end-mismatch` before any action, which e2e also reports as a hand-off at the start.
2. For each action, resolve the target on a fresh snapshot: by `testId` when recorded, else by `kind` and name, disambiguated by the recorded parent path. None is `target-not-found`, several `target-ambiguous`. A `tap_at` whose recorded viewport differs is `viewport-changed`. The action runs through the same `Driver` call the model's action used. A failed action is `action-failed`; an action whose result the driver could not confirm is `action-uncertain`.
3. After the last action, the end checks: route, and each recorded appeared and disappeared control present or absent in the current tree. A mismatch is `end-mismatch`.
4. All checks pass: `mode: 'self-finalized'`, zero model calls, `replayedActions === totalActions`.

On any hand-off the model takes over from the current screen. Its first turn
carries the replayed prefix as completed actions and the reason, so it does
not repeat them. The result is `mode: 'agent-concluded'` with the reason and
the counts. Under `strict`, a hand-off is `REPLAY_STALE` instead and no model
call is made, and strict runs never write or delete entries. `HARNESS_CACHE=off`
skips the lookup and the recording; `expo-harness cache ls` prints key, test,
platform, instruction and age, `stats` the count and bytes, `clear` empties
the folder. `--no-cache` on the harness's `explore` (Phase 6) maps to `off`.

### 5.7 Tools, executors, personas

```ts
export const seedCart = defineTool({
  name: 'seed_cart',
  description: 'Put one SKU in the signed-in user\'s cart through the test API. Call it before checking out when the goal names a SKU.',
  schema: {type: 'object', properties: {sku: {type: 'string'}}, required: ['sku'], additionalProperties: false},
  mutates: true,
  platforms: ['web', 'android'],
  async execute({sku}, ctx) {
    const response = await fetch(`${ctx.app.url}/__test/cart`, {method: 'POST', body: JSON.stringify({sku})});
    if (!response.ok) throw new Error(`seed failed: ${response.status}`);
    return `seeded ${sku}`;
  },
});
```

`schema` is a plain JSON Schema object or a Standard Schema that exposes one;
a Zod 4 schema does, so it works without this package depending on Zod. A
name that collides with a grammar tool or `complete_step`, `locate`,
`start_recording`, `stop_recording`, `report_finding` is `INVALID_ARGUMENT` at
load. A `mutates: true` tool spends an action slot and ends the replayable
prefix. A read-only tool may call `ctx.observe()`; a mutating one may not, and
gets `POLICY_DENIED` if it tries, which keeps observation and side effects in
separate calls the way e2e requires.

```ts
export interface StepExecutor {
  name: string;
  version: string;
  cache?: 'inherit' | 'off';
  runStep(ctx: StepContext): Promise<{status: 'passed' | 'failed' | 'blocked'; summary: string; errorCode?: AgentErrorCode}>;
}
export interface StepContext {
  step: {kind: AgentStepKind; instruction: string; params: Readonly<Record<string, unknown>>; index: number};
  target: {platform: Platform; verbs: readonly string[]};
  observe(options?: {tree?: boolean; pixels?: boolean}): Promise<{text: string; tree?: Snapshot; pixels?: ImagePart | {withheld: string}}>;
  actions: AuthorisedActions;      // tap, type, typeSecret, press, check, scroll, scrollTo, navigate, back, scrollUntil
  model?: Model;
  agentContext: string;
  ledger: readonly CompletedStep[];
  budgets: {modelCalls: Budget; actions: Budget; runTool<T>(meta: {name: string; mutates: boolean}, fn: () => Promise<T>): Promise<T>};
  signal: AbortSignal;
  replayedPrefix?: {actions: readonly RecordedAction[]; reason: ReplayHandOffReason};
  attachTranscript(text: string): void;
  attachTurns(turns: readonly Message[]): void;
  attachScreenshot(label: string, image: ImagePart): void;
}
export function toolLoopExecutor(options: {
  name: string;
  system: string;
  buildPrompt(ctx: StepContext): string | readonly Message[];
  tools(ctx: StepContext, helpers: {guard<T>(fn: () => Promise<T>): Promise<T | string>}): Record<string, Tool>;
  prepareMessages?(messages: readonly Message[], ctx: StepContext): readonly Message[] | {messages: readonly Message[]; stop: true};
  maxModelCalls?: number;
}): StepExecutor;
```

The built-in loop is itself a `StepExecutor` named `builtin`, so the runner
has one path. `ctx.actions` are authorised, counted, recorded and redacted
exactly as the built-in loop's are, so a custom executor cannot bypass the
policy. `waitFor` and `extract` always use the built-in judgments and need a
model even under a custom executor. A decision-model vendor's executor fits
this slot; none is shipped, per README section 9.

Personas are the `agents` map plus `forEachAgent` and `agent.as`, described
in 5.1. The cache key includes the agent name and context, so one persona
never replays another's steps. The evidence ledger records which agent ran
each step, and `trace.md` prints it.

### 5.8 Debugging and cost

`HARNESS_DEBUG=1` prints to stderr, after each step:

```text
agent  act  "upgrade the workspace to the Pro plan"  web  4.8 s  3 calls  2 actions  in 9 412 (cache 84%)  out 211  $0.0119  self-finalized
```

The per-test table at the end sums calls, tokens, cache share and dollars.

`cost.ts` is a table, data checked on a date, with a row per model id:

| Model | Input $/M | Output $/M | Cache read $/M | Cache write $/M |
| --- | --- | --- | --- | --- |
| `claude-opus-5-5` | 4.00 | 20.00 | 0.20 | 5.00 |
| `claude-fable-5-1` | 10.00 | 50.00 | 0.25 | 12.50 |
| `claude-sonnet-5-5` | 2.00 | 10.00 | 0.20 | 2.50 |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 | 0.125 |

Cache writes are 1.25 times input for the 5-minute TTL, which is the TTL the
adapter uses. A `Completion.model` not in the table costs `undefined`, and the
debug line prints `cost n/a`. The table is the only place a price lives.

`HARNESS_AI_TRACE=1` writes `.harness/ai-trace.json`, an array of calls:

```json
{
  "at": "2026-10-13T06:24:01.120Z",
  "test": "device/billing.test.ts > a member upgrades to Pro",
  "step": {"kind": "act", "index": 0, "turn": 2},
  "model": "claude-opus-5-5",
  "request": {"system": ["…redacted…"], "messages": [{"role": "user", "content": [{"type": "text", "text": "…"}, {"type": "image", "bytes": 48213, "width": 768, "height": 432}]}], "tools": ["tap", "type", "observe", "complete_step"]},
  "response": {"stopReason": "tool_use", "text": "", "toolCalls": [{"name": "tap", "input": {"ref": "@e7"}}]},
  "usage": {"input": 3120, "output": 64, "cacheRead": 2890, "cacheWrite": 0},
  "costUsd": 0.0027,
  "durationMs": 1830
}
```

Text is redacted and image bytes are replaced by counts and sizes, so the
file can be shared. `trace.md` from Phase 2 gains an `Agent` section per
step with the last four turns, redacted, and the verdict.

A live smoke runs behind `HARNESS_AGENT_SMOKE=1`, described under
Verification.

## Compatibility

- Two new subpaths, `expo-vitest/agent` and `expo-vitest/agent/anthropic`, added to `SUBPATHS` and `package.json`'s `exports`; the existing test keeps them in step.
- One new optional peer, `@anthropic-ai/sdk`, in `peerDependencies` with `"*"` and `peerDependenciesMeta.optional: true`, the way `playwright-core` is declared. Nothing imports it except `src/agent/anthropic.ts`, and that through `createRequire` at call time.
- No change to `expo-vitest/device`'s existing API, the tree shape, the matchers or the harness steps. The agent reads the `Driver`, the `Locator` and the ledger through the interfaces Phases 1 to 3 added.
- `harness.config.ts` gains optional keys. A file without them is unchanged in meaning.
- `.harness/` gains `cache/` and `ai-trace.json`. Both are under the folder `init` already ignores.
- New environment variables, all read only when set: `HARNESS_SECRET_<NAME>`, `HARNESS_CACHE`, `HARNESS_DEBUG`, `HARNESS_AI_TRACE`, `HARNESS_AGENT_SMOKE`.
- The console patch for redaction is installed only while an agent step runs and only when secrets are configured, and it is removed in `afterEach`, so a scripted device test is untouched.

## Work items

Each item is one commit, pure logic first, under the coverage gate as it
lands.

1. `src/agent/types.ts`: the public types above, `AgentError` over `HarnessError`, `isAgentError`, the code list. Tests pin the code list against the error table in this document.
2. `src/agent/secrets.ts`: `secret()`, the `WeakMap` store, loading from config and `HARNESS_SECRET_<NAME>`, the 6-character rule, `purpose` inference. Tests: no enumerable value, `JSON.stringify` yields the name, override precedence.
3. `src/agent/redact.ts`: the variant set, the replacement, the tail rule, a `Redactor` built once per test. Tests: every form, overlapping secrets, a value that is a prefix of another, the 6-character floor, idempotence.
4. `src/agent/view.ts`: `renderView`, `diffViews`, the identity function, the half-changed rule, `maxObservationBytes` truncation that keeps interactive nodes. Tests on fixture trees from all four platforms, including a Windows tree with the screen-reader fields and a web tree with a secure field.
5. `src/agent/policy.ts`: `canFill`, `canNavigate`, `canUpload`, `pixelsAllowed`, the tainted flag, the reserved tool names. Tests for each rule and each denial message.
6. `src/agent/tools.ts`: the grammar tool specs as strict JSON Schema from a capability set, `defineTool`, schema acceptance (JSON Schema or Standard Schema with a JSON Schema), name collisions, the small JSON Schema checker. Tests: every capability subset renders a valid strict schema (`additionalProperties: false`, every property required), Zod-shaped and plain schemas both validate.
7. `src/agent/cost.ts`: the table and `costOf(model, usage)`. Tests: each row, an unknown model, zero usage.
8. `src/agent/cache.ts`: the key, canonical JSON, the entry shape and version, atomic write, lookup, the replay matcher (route placeholdering, target resolution with parent disambiguation, end checks), the mode and reason enums, `ls`, `stats`, `clear`. Tests with recorded fixtures: every miss reason and every hand-off reason reachable, strict mode, `Unique` slots, secret names only.
9. `src/agent/judge.ts`: the judge prompt, the verdict tool, the repair round, `waitFor`'s unchanged-view rule, `extract` validation through `~standard.validate` and the checker. Tests with a scripted `Model`.
10. `src/agent/loop.ts`: the state machine, budgets, the nudges as `system` messages, repeated-call detection, the two-image window, the message builder from the ledger, the verdict handling, the error mapping. Tests with a scripted `Model` that returns a fixed sequence of completions and a fake `Driver`: a clean pass, a fail verdict, a blocked verdict, budget exhaustion, the deadline, three failures then the nudge, five then the verdict request, a repeated call, a truncated tool input retried once, a refusal.
11. `src/agent/executors.ts`: `StepExecutor`, `StepContext`, `toolLoopExecutor`, the built-in loop registered as `builtin`, `ctx.budgets.runTool`. Tests: a model-free executor passes one assertion and blocks the rest with `AUTOMATION_UNSUPPORTED`; `observe` inside a mutating tool is denied.
12. `src/agent/anthropic.ts`: `buildRequest(request, options)` and `parseCompletion(response)` as pure functions over SDK types, plus the thin `complete` that calls `client.beta.messages.create` and maps errors; the `role: 'system'` fallback; the `fallbacks` retry-without. Tests pin the request shape in this document byte for byte, the sorted tools, the two system blocks, `strict`, `tool_choice`, the beta header, `output_config`, and the parse of a reply with a leading empty `thinking` block, a `tool_use`, a `fallback` block, a `refusal` stop.
13. `src/harness/lib/png.ts`: `resizePng` with a box filter. Tests: a 2000 by 1000 image becomes 768 by 384, colours average, a small image is untouched.
14. `src/agent/index.ts`: `agent`, `agent.as`, `forEachAgent`, `unique`, wiring to `device`'s driver and the evidence ledger, `harness.config.ts` loading, `HARNESS_DEBUG` and `HARNESS_AI_TRACE` writers, the console patch. Covered by the fixture suite and the smoke, since it binds to a driver.
15. `src/projects.ts` and `package.json`: the two subpaths, the optional peer. The existing subpath test covers the agreement.
16. `src/harness/index.ts`: `expo-harness cache ls|stats|clear`.
17. `fixture/device/agent.test.ts`: the model-free paths that need no key, run in CI: `agent.act` with a scripted `Model` injected through `harness.config.ts` (the fixture's config exports a fake model), a replay from a committed entry under the fixture's `.harness/cache/`, a `type_secret` into the page's password field with the grep afterwards. `fixture/device/agent.smoke.test.ts` behind `HARNESS_AGENT_SMOKE=1`.
18. Docs, listed below, and the README rows.

## Verification

- **Unit, under the 100% gate.** `vitest.config.mts`'s `coverage.include` gains `src/agent/types.ts`, `secrets.ts`, `redact.ts`, `view.ts`, `policy.ts`, `tools.ts`, `cost.ts`, `cache.ts`, `judge.ts`, `loop.ts`, `executors.ts`, `anthropic.ts` and the `resizePng` part of `png.ts`. The scripted `Model` is a test helper in `src/agent/fake-model.ts` that replays a list of `Completion`s and records every `CompletionRequest`, so a test can assert the exact messages a turn received. The fake `Driver` returns fixture trees in sequence.
- **The fixture, in CI.** The web device suite from Phase 2 gains the two agent files. The scripted model makes `act` deterministic, so the CI run proves the wiring: `agent` binds to the same driver as `device`, the ledger records the step, the matcher after it finalizes the cache entry, a second run inside the same job replays it with zero calls, and the trace has an `Agent` section.
- **The secret grep.** `scripts/secret-grep.js` takes a value and a folder and exits non-zero if the value appears in any file, in any of the redaction forms. The fixture's agent test runs it over `.harness/` after a `type_secret` with `HARNESS_SECRET_TOKEN=correct-horse-battery`. It is also run by hand after the smoke on each platform.
- **The smoke, by hand.** `HARNESS_AGENT_SMOKE=1` with real credentials runs one `act`, one `assert` with `vision: true`, one `waitFor` and one `extract` against the fixture page on web, and against a consumer's app on Android and Windows. The reviewer reads `trace.md` and `ai-trace.json`, checks the cache share on the second turn is above 50%, checks the cost line against the table, and checks the second run says `self-finalized`.
- **Not in CI.** Any call to a real model. The smoke is deliberate and billed.

## Docs

- `docs/agent.md`: the four calls, options and defaults, `secret` and `unique`, the `Model` interface with the custom provider example, the Claude adapter's options, what the model sees, the tools per platform, the loop rules, the security rules as a table, the cache with its modes and reasons, tools and executors, personas, `HARNESS_DEBUG` and `HARNESS_AI_TRACE`, the cost table with its date, and the errors.
- `docs/configuration.md`: `agents`, `secrets`, `cache` in `harness.config.ts`, the environment overrides, the Node floor.
- `docs/evidence.md`: the `Agent` section of `trace.md`, `ai-trace.json`, `.harness/cache/`, what is and is not safe to share.
- `docs/harness.md`: `expo-harness cache`.
- `README.md`: the rows for agent steps, the replay cache, secrets, tools and executors, debug and cost, with the install line `npm install --save-dev @anthropic-ai/sdk` beside the agent row.
- `docs/migrating.md` (Phase 4): the e2e table gains the `agent` rows, which are identical names.

Every page describes the package as it is, with no history, per `AGENTS.md`.

## Risks and fallbacks

- **Cost.** An uncached ten-turn `act` on `claude-opus-5-5` with a 4 000-token prefix and 1 500 tokens of fresh view per turn is on the order of two cents with the prefix cached and about eight cents cold. The cache, the cheap judge and the replay keep a suite's steady state near the cached figure. The debug line makes the number visible on every run, and `judge: anthropic({model: 'claude-haiku-5-5'})` is one line.
- **Nondeterminism.** A model may take a different path on two runs. The cache makes the verified path the one that reruns, the budgets bound the cost of a bad path, and the `expect` after an `act` is what catches a wrong path, which the docs say in the first paragraph.
- **API drift.** The adapter is the only file that knows the SDK. `buildRequest` and `parseCompletion` are pinned by tests, and the beta header for `fallbacks: 'default'` is one constant. If the parameter is rejected, the adapter retries without it once and the test still runs. The peer is `*`, as `playwright-core` is, and the adapter checks for `client.beta.messages.create` at load.
- **Preserved thinking.** An edited history is a 400 on new accounts. The loop is append-only by construction and the fake-model tests assert that every request's `messages` is a prefix-extension of the previous request's, which is also what keeps the cache warm.
- **agent-device pre-1.0.** The agent touches it only through the `Driver`. A CLI change is Phase 1's to absorb.
- **The Node floor.** `harness.config.ts` holds the `Model` object and needs 22.18 or 24 to load as TypeScript. Phase 3 sets `engines.node`; this phase inherits it.
- **Platform gaps.** Windows has no `swipe`, `back` or `dismiss_keyboard`, so those tools are absent on Windows and the model is told the platform. `scroll` on Windows is a mouse wheel at the node's centre, which Phase 3 adds.
- **Schema reach.** Structured output supports a JSON Schema subset without numeric or length constraints. A Standard Schema with no JSON Schema falls back to text plus validation, which costs at most one repair call.

## Exit criteria

- The four calls pass on web against the fixture page in CI with the scripted model, and by hand against a consumer's app on Android and Windows with `claude-opus-5-5`.
- A second run of the same `act` reports `mode: 'self-finalized'` with zero model calls, on web in CI and on Android by hand.
- `scripts/secret-grep.js` finds nothing under `.harness/` after a `type_secret`, in CI and by hand.
- Every file in the work items' coverage list is at 100% on four metrics, and the contract test from Phase 0 is unchanged.
- The adapter's request shape test matches section 5.2 byte for byte, and a refusal, a fallback and a truncated tool input are each handled as described.
- `HARNESS_DEBUG` shows a cache share above 50% from the second turn of an `act`, and the dollar figure matches the table for the usage printed.
- `docs/agent.md` exists and every option in it is one the code accepts.

## References

- e2e agent reference: https://e2e.tester.army/docs/reference/agent
- e2e, how agent steps work: https://e2e.tester.army/docs/agent-steps
- e2e cache: https://e2e.tester.army/docs/cache
- e2e security rules: https://e2e.tester.army/docs/reference/security
- e2e authentication: https://e2e.tester.army/docs/authentication
- e2e tools: https://e2e.tester.army/docs/tools
- e2e executors: https://e2e.tester.army/docs/executors
- e2e agents and personas: https://e2e.tester.army/docs/agents
- e2e debugging: https://e2e.tester.army/docs/debugging
- e2e errors: https://e2e.tester.army/docs/reference/errors
- Anthropic vision limits and visual tokens: https://platform.claude.com/docs/en/build-with-claude/vision
- Anthropic tool use overview: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Anthropic prompt caching and refusal fallbacks: the `claude-api` skill's `shared/prompt-caching.md` and `shared/model-migration.md`, checked 2026-10-13 against `@anthropic-ai/sdk` 0.133.0
- Standard Schema v1: https://standardschema.dev/
- Vitest `describe.each` and test context: https://vitest.dev/api/, https://vitest.dev/guide/test-context
- Node `crypto.createHash` and atomic rename: https://nodejs.org/api/crypto.html, https://nodejs.org/api/fs.html

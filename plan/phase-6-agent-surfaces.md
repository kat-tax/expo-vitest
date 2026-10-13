# Phase 6. Agent surfaces

Status: not started · Size: M · Depends on: Phase 4, Phase 5 · Unblocks: nothing

The agent of Phase 5 reached from outside a test file: an MCP server a coding
agent drives the app through, an `explore` command that runs the agent with a
goal instead of a test, and a `bug-bash` command that runs many explores at
once and turns what they find into failing tests. The shared facts this
document leans on, including the MCP framing and lifecycle shapes, are in
[README.md, section 11](README.md#11-shared-facts-the-phases-build-on).

## Purpose and the claims it proves

Three claims from the [feature map](README.md#6-feature-map):

- **An MCP session on Windows and on web.** e2e's `e2e mcp` opens a session
  on its web and mobile engines only. Ours opens one on every platform the
  harness drives, Windows included, with the same four tool names a coding
  agent already knows from e2e, so a skill written for one reads the same on
  the other.
- **Explore and bug bash on four platforms, with no telemetry and no SDK.** The
  server is written against the protocol, which keeps the dependency policy at
  zero, and nothing it does leaves the machine except the model calls the user
  configured.
- **The tree is what the agent reads.** `observe` returns the accessibility
  tree in the harness's own spelling (`@e7` refs, the native `role` and the
  normalised `kind`), which is what a device test then asserts on, so a
  flow found over MCP becomes a test with no translation.

## What e2e does

From the [MCP reference](https://e2e.tester.army/docs/reference/mcp), the
[coding agents page](https://e2e.tester.army/docs/coding-agents), the
[explore page](https://e2e.tester.army/docs/explore) and the
[bug bash page](https://e2e.tester.army/docs/bug-bash), checked 2026-10-13:

- `e2e mcp [--config <path>] [--target <name>] [--headed] [--max-sessions <n>]`
  runs a stdio server with four tools: `open_session` (`target`, `config`,
  `headed`), `tools` (`tool`, `session`), `call` (`tool`, `args`, `session`)
  and `close_session` (`session`). `open_session` loads the config, starts the
  app command, boots the engine, opens the app and returns the session id, the
  catalog and the first observation. `call` runs one catalog tool and returns
  its summary and what changed on screen.
- The catalog: `observe` (nodes as `#id role "name"`), the action verbs,
  `type_secret` only when the config declares credentials or secrets,
  `dismiss_keyboard` when the keyboard supports it, `locate` (exactly one of
  `role`, `text`, `label`, `placeholder`, `testId`, answering the match count
  and a suggested `screen.*` call), `screenshot` and the point tools
  `tap_at`, `hover_at`, `type_at`, `press_at`, `select_at`, `start_recording`
  and `stop_recording` when the engine records, project tools under their own
  names, and `open_app`, `swipe`, `alert` from the mobile tool pack.
- Sessions: one attempt on one target, each with its own browser or device,
  up to `--max-sessions` (1 to 16, default 4), the id required only while
  several are open, one config shared by all open sessions
  (`CONFIG_IN_USE` otherwise), closed on `close_session`, after 30 idle
  minutes, after 4 hours, on client disconnect, and on SIGINT or SIGTERM.
  Node ids are valid only against the newest observation. Secret values are
  redacted from tool output. After a secret fill, `screenshot` and the point
  tools return `PIXEL_TAINTED` for the rest of the session.
- `e2e explore [goal]` runs the agent with a goal, default
  `Explore the app and find bugs`, `--max-steps` default 8 and at most 12,
  `--timeout` default 10 minutes and at most 15, `--headed`, `--target`,
  `--agent`, `--session`. A finding is an `issue` (exit code 1) or a
  `warning`, each with the steps to reproduce it and a screenshot when
  possible. The final report puts the most severe issues first.
- A bug bash is a procedure in the skill, not a command: the coding agent
  reads the routes and the branch diff, writes 5 to 10 one-sentence charters
  with a posture each (first-time user, numbers and copy, edge input, state
  after reload, error paths), runs one `e2e explore` per charter four at a
  time with its own `--agent` and `--output`, merges and filters findings,
  writes a repro test per finding, and reports a bug only when that test fails
  with `ASSERTION_FAILED`. Repro tests carry the `bugbash` tag and stay out of
  the merge gate with `--exclude-tag bugbash`.
- `init` writes the skill to `.agents/skills/e2e/` with a symlink for
  `.claude/skills/`, registers the server in `.mcp.json` and
  `.cursor/mcp.json`, and `e2e guide [topic]` prints it.
- agent-device ships its own `agent-device mcp` for iOS and Android with the
  same registration shape, `{"mcpServers": {"agent-device": {"command":
  "agent-device", "args": ["mcp"]}}}`, and recommends the open, snapshot,
  act, re-snapshot, verify, close loop
  ([agent setup](https://oss.callstack.com/agent-device/docs/agent-setup)).

## What this package has today

- `src/harness/index.ts` is the whole command: `parse` (lines 71 to 101)
  turns `argv` into `{platform, url, scheme, target, out, force, interactive,
  steps, command}` where `command` is `doctor`, `run` or `help`; `guard`
  (lines 128 to 136) refuses synthetic input on Windows while the machine was
  touched in the last 180 seconds unless `--force`; `step` (lines 138 to 195)
  runs one step; `main` (lines 209 to 258) makes the driver, checks
  `available()` and runs the steps in order, printing with `console.log`.
  Every new subcommand lands here.
- `src/harness/lib/types.ts` is the `Driver` shape every platform answers:
  `open`, `snapshot`, `press`, `fill`, `type`, optional `key`, `screenshot`,
  `idleSeconds`, `close`, each answering a `StepResult` rather than throwing.
  The catalog is gated on this shape plus the controls Phase 3 adds.
- `src/harness/lib/snapshot.ts`: `Snapshot` is `{platform, source, nodes}`,
  a node has `ref`, `role`, `name`, `testId`, `depth`, `interactive`, state
  fields and `bounds`; `parseTarget` reads `@e3`, `label="Save"`,
  `role=button`, `testID=x`; `findNode` resolves a `Selector` (ref, testId,
  role plus label, contains) to the first match; `renderSnapshot` prints the
  indented text a person reads. Refs are numbered per snapshot and stable
  within one only.
- `src/harness/lib/drivers.ts`: `driverFor(platform, options)` picks the
  Windows, web or agent-device driver.
- `src/device/index.ts`: `configFromEnvironment` reads `HARNESS_PLATFORM`,
  `HARNESS_URL`, `HARNESS_SCHEME`, `HARNESS_TARGET`; the `Device` class makes
  a driver on first use and keeps it.
- `package.json`: one bin, `expo-harness`, at `dist/harness/index.js`.
  Phase 4 adds the `expo-vitest` alias to the same file.
- Nothing reads or writes JSON-RPC, keeps sessions, or runs the agent outside
  a test. Phase 5 adds `src/agent/` with the loop, the view, the tools, the
  secrets, the redaction and the policy this phase reuses.

## Design

### The MCP server

`expo-harness mcp [--platform <name>] [--config <path>] [--headed] [--force]
[--max-sessions <n>]`. `--platform` is what `open_session` uses when its
`target` is omitted; without either, the first platform `doctor` reports ready.
`--config` names a `harness.config.ts` other than the project root's. `--force`
lifts the Windows idle guard for every session the way it does for the CLI.
`--max-sessions` is 1 to 16, default 4.

The server is four modules under `src/harness/mcp/`, none of them importing a
driver directly, so the framing and the session table are unit tested without
a device.

**`rpc.ts`, the framing.** Reads stdin through `readline` with
`crlfDelay: Infinity`, one JSON-RPC message per line, UTF-8, and writes one
message per line to stdout, awaiting `drain` when `write` returns `false` so a
large observation never interleaves with the next response. Everything the
process would otherwise print goes to stderr: on entry the server rebinds
`console.log` and `console.info` to `console.error`, because the drivers and
the harness print progress with them and one stray line on stdout ends the
session.

```ts
export type Id = string | number | null;
export interface Request {jsonrpc: '2.0'; id?: Id; method: string; params?: unknown}
export interface Failure {code: number; message: string; data?: unknown}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/** One line of stdin: a request, a notification, or the error to answer with. */
export function parseLine(line: string): {request: Request} | {error: Failure; id: Id};
export function respond(id: Id, result: unknown): string;
export function fail(id: Id, error: Failure): string;
```

The rules, each with a unit test:

- A line that is not JSON answers `PARSE_ERROR` with `id: null`.
- A JSON array answers `INVALID_REQUEST`: the 2025-06-18 revision of the
  protocol removed JSON-RPC batching, so a batch is not a valid message.
- An object without `jsonrpc: '2.0'` or a string `method` answers
  `INVALID_REQUEST` with the id it carried or `null`.
- A message without `id` is a notification and never gets a response.
  `notifications/initialized` is a no-op, `notifications/cancelled` marks its
  `requestId` so the in-flight call's result is dropped and its abort signal
  fires, and any other notification is ignored.
- A request before `initialize` answers `INVALID_REQUEST` with the message
  `not initialized`, except `ping`, which always answers `{}`.
- An unknown method answers `METHOD_NOT_FOUND`. Bad `params` answer
  `INVALID_PARAMS` with the validation message in `data`.
- A throw out of a handler answers `INTERNAL_ERROR` with the message and no
  stack, after the message has gone through the redaction of Phase 5.

**`server.ts`, the methods.** `initialize` answers the protocol version the
client sent when it is `2025-06-18` or newer, and `2025-06-18` otherwise, with:

```json
{
  "protocolVersion": "2025-06-18",
  "capabilities": {"tools": {"listChanged": false}},
  "serverInfo": {"name": "expo-harness", "version": "<package.json version>"},
  "instructions": "Open a session with open_session, read the catalog with tools, then observe before every call: node ids are valid only against the newest observation. Check locators with locate, which answers with the screen.* call to write in a device test. Close the session when done."
}
```

`tools/list` answers the four MCP tools with JSON Schemas carrying
`additionalProperties: false`. `tools/call` dispatches to them. The four are
fixed; the per-session catalog lives behind `call`, as e2e arranges it, so a
client never needs `listChanged`.

```json
{"name": "open_session", "inputSchema": {"type": "object", "properties": {"target": {"type": "string", "description": "A platform (web, windows, android, ios) or a device project name from harness.config.ts"}, "config": {"type": "string"}, "headed": {"type": "boolean"}, "force": {"type": "boolean"}}, "additionalProperties": false}}
{"name": "tools", "inputSchema": {"type": "object", "properties": {"tool": {"type": "string"}, "session": {"type": "string"}}, "additionalProperties": false}}
{"name": "call", "inputSchema": {"type": "object", "properties": {"tool": {"type": "string"}, "args": {"type": "object"}, "session": {"type": "string"}}, "required": ["tool"], "additionalProperties": false}}
{"name": "close_session", "inputSchema": {"type": "object", "properties": {"session": {"type": "string"}}, "additionalProperties": false}}
```

A failure inside a tool is a tool result with `isError: true` and one text
block `CODE: message`, where `CODE` is the `HarnessError` code or one of
`NO_SESSION`, `SESSION_REQUIRED`, `SESSION_OPEN`, `UNKNOWN_TOOL`,
`NODE_STALE`, `PIXEL_TAINTED`, `POLICY_DENIED`, the same names e2e uses.
Protocol errors are kept for malformed messages, so a model that calls a tool
wrongly reads the reason as text rather than losing the turn.

A request with `_meta.progressToken` gets `notifications/progress` while a
call polls for settle or waits on a device, at most twice a second, with
`progress` counting attempts and no `total`.

**`sessions.ts`, the table.** A session is `{id, platform, driver, config,
newest: Snapshot | null, tainted: boolean, queue: Promise<void>, openedAt,
touchedAt}`. Ids are `s1`, `s2` and so on, counted for the life of the
process, because a model copies them back by hand. The table enforces:

- At most `--max-sessions` open; one more answers `SESSION_OPEN`.
- With one session open, `session` may be omitted. With several, a call
  without it answers `SESSION_REQUIRED`; a call with an unknown one answers
  `NO_SESSION`.
- One tool call at a time per session, through its `queue`, since a driver
  is one window or one device. Different sessions run in parallel.
- An idle timer of 30 minutes and a total timer of 4 hours, each closing the
  session through the same path as `close_session`: stop any recording,
  `driver.close()`, drop the row. Both checked by a unit test with fake
  timers.
- On stdin `end`, SIGINT or SIGTERM: close every session in parallel with a
  10 second budget, then exit 0. The timers are `unref`ed so they never keep
  the process alive on their own.

All open sessions share one `harness.config.ts`. `open_session` with a
different `config` while others are open answers `CONFIG_IN_USE`, as e2e
does, because the secrets and tools of two configs must not meet in one
process.

**`catalog.ts`, what `call` runs.** The catalog is computed per session from
what its driver can do, so a tool a platform lacks is absent from `tools`
rather than failing when called, which is the harness's rule of answering
rather than throwing in another form.

| Catalog tool | Arguments | Driver call | Offered when |
| --- | --- | --- | --- |
| `observe` | `interactive?` | `snapshot` | always |
| `tap` | `id` | `press(target)` | always |
| `double_tap` | `id` | two presses 100 ms apart | always |
| `long_press` | `id`, `durationMs?` | Phase 3 `longPress` | the driver has it |
| `right_click` | `id` | Phase 4 `device.web.secondaryTap`, Windows input with the right button | web, windows |
| `hover` | `id` | Phase 2 `hover` | web, windows |
| `type` | `id?`, `text` | `fill` with an id, `type` without | always |
| `type_secret` | `id`, `secret` | `fill` with the resolved value | the config declares secrets |
| `press` | `key` | `key` | the driver has `key` |
| `select` | `id`, `value` | Phase 4 `device.web.selectOption` | web |
| `check` | `id`, `checked` | press when the state differs | always |
| `scroll` | `direction`, `amount?` | Phase 3 `scroll` | the driver has it |
| `scroll_to` | `id` or `text` | Phase 2 `scrollIntoView`, else scroll until found | the driver has it |
| `drag` | `id`, `to` | Phase 3 `drag` | the driver has it |
| `upload` | `id`, `paths` | Phase 4 `device.web.setInputFiles` | web |
| `navigate` | `url` | `open` | always, subject to the scheme policy |
| `back`, `home` | | Phase 3 `back`, `home` | the driver has them |
| `dismiss_keyboard`, `alert`, `open_app`, `swipe` | | Phase 3 controls | android, ios |
| `locate` | one of `role`, `text`, `label`, `placeholder`, `testId`, and `name?` | `snapshot` plus the Phase 2 query resolution | always |
| `screenshot` | | `screenshot` to a temp file, read back, masked | always, until tainted |
| `tap_at`, `hover_at`, `type_at`, `press_at`, `select_at` | `x`, `y`, and the verb's value | `press(point)` and the matching verb | always, until tainted |
| `start_recording`, `stop_recording` | | Phase 4 video | the driver records |
| project tools | their schema | `execute` from `harness.config.ts` | always, filtered by `platforms` |

Two rules carry most of the safety:

- **Node ids resolve against the newest observation, never against a fresh
  snapshot.** Refs are numbered per snapshot, so `@e7` taken from the model's
  last observation can name a different control in the snapshot a driver
  takes a moment later. `call` therefore looks the id up in
  `session.newest`, turns that node into a durable target the way the Phase 5
  loop does (`testId` first, then `role` plus `label`, then the centre of
  `bounds`), and hands the driver that target. An id not in the newest
  observation answers `NODE_STALE` with the hint to call `observe`. This is
  the same helper Phase 5 writes for the agent's own actions; if that phase
  names it differently, this one follows.
- **Pixel taint.** `type_secret` sets `session.tainted`. From then on
  `screenshot` and the point tools answer `PIXEL_TAINTED`, and `observe`
  keeps answering text. Every string that leaves a tool passes through the
  Phase 5 redaction, so a secret the app echoes into a label comes back as
  `<secret:name>`.

`locate` answers the count and, when exactly one node matches, the call to
write:

```json
{"count": 1, "suggestion": "screen.getByRole('button', {name: 'Save'})", "matches": [{"id": "@e12", "kind": "button", "name": "Save", "testId": "save"}]}
```

With several matches it suggests the narrowing that would make one:
`getByTestId` when the matches carry different test ids, `{name}` when
their names differ, and `.nth(i)` otherwise. With none it suggests the
nearest name from the tree by case-insensitive substring, so a typo is one
turn to fix. The suggestion strings are the Phase 2 queries, `getByRole`,
`getByText`, `getByLabelText`, `getByPlaceholderText`, `getByTestId`, and
the unit test asserts each against fixture trees.

**What `open_session` returns.** One text block the model reads and the same
data under `structuredContent`, which the specification asks for when both
are given:

```json
{
  "content": [{"type": "text", "text": "session s1 on windows (MyApp.exe, 42 nodes)\ntools: observe tap double_tap hover type type_secret press check scroll navigate locate screenshot tap_at hover_at type_at press_at\n\n@e1 Window \"MyApp\"\n  @e2 Button \"New\" #new [focused]\n  @e3 Edit \"Name\"\n  ..."}],
  "structuredContent": {"session": "s1", "platform": "windows", "source": "MyApp.exe", "tools": ["observe", "tap", "..."], "observation": {"nodes": [{"id": "@e1", "role": "Window", "kind": "dialog", "name": "MyApp", "interactive": false}]}}
}
```

The text is `renderSnapshot` with the Phase 2 `kind` appended where it
differs from the native word, which is the same rendering a device test's
failure evidence prints, so a model moves between the two without relearning
the shape. `observe` answers the same block without the header. After an
action, `call` answers the action's summary and the diff of the tree against
`session.newest` in `+`, `-` and `=` lines, or the whole tree when more than
half of it changed, and the new tree becomes `session.newest`.

**The Windows idle guard.** An action on a Windows session goes through the
same check as the CLI: if the machine was touched in the last 180 seconds and
neither `--force` nor the session's `force: true` is set, the call answers
`NOT_ACTIONABLE: someone used this machine N seconds ago; open the session with
force: true when the desk is free`. A model given that text knows what to do;
a silently misdirected click does not tell it anything.

### `expo-harness explore`

```sh
expo-harness explore "Explore the checkout flow like a first-time buyer and report anything off" \
  --platform web --agent default --max-steps 8 --timeout 600000 --headed
```

The goal defaults to `Explore the app and find bugs`. `--max-steps` is 1 to
12, default 8; `--timeout` is at most 900000 ms, default 600000. `--agent`
picks an entry from `agents` in `harness.config.ts`. `--headed` applies to
web. `--out` moves the report folder.

The run is the Phase 5 loop with three changes, all in `src/harness/explore.ts`
so the loop itself stays one module:

- The step kind is `explore`: the system prompt asks the agent to plan one
  step at a time toward the goal, to try the posture named in it, and to
  report anything off rather than to complete a task. A failed action does
  not end the run.
- One tool is added, `report_finding({severity: 'issue' | 'warning', title,
  detail, steps: string[]})`. The runner attaches the current tree and, when
  pixels are not tainted, a screenshot to each finding.
- The budget is `--max-steps` actions and the same number of model calls per
  step, under `--timeout`, with the loop's own stop rules (repeated calls,
  three failed actions, a verdict near the budget) unchanged.

The report goes under `.harness/explore/<yyyy-mm-dd-hhmmss>/`:

```
report.md          the assessment, issues first, each with steps, tree and screenshot links
report.json        {goal, platform, agent, startedAt, steps: [...], findings: [...], usage: {calls, tokens, cost}}
steps/001-tap.txt  the tree after each step, as renderSnapshot prints it
screenshots/       001.png and so on, absent after a secret fill
```

A finding is `{severity, title, detail, steps, step: n, route, tree:
'steps/00n-....txt', screenshot?: 'screenshots/00n.png'}`. The exit code is 1
when any finding is an `issue`, else 0, as e2e's is. The terminal prints each
finding as it is made and the cost line at the end, with the model calls and
tokens per step under `HARNESS_DEBUG=1`.

### `expo-harness bug-bash`

```sh
expo-harness bug-bash --feature-map device/features.json --platform web --parallel 4
```

e2e leaves the orchestration to the coding agent and the skill. Ours is a
command, because the fan-out, the merge and the skeletons are the same every
time and a command does not forget a step. The feature map is a JSON file, so
it needs no parser dependency:

```json
{
  "areas": [
    {"name": "checkout", "goals": ["buy one item as a first-time user", "enter edge values in every quantity field"], "agent": "buyer"},
    {"name": "settings", "goals": ["change the display name and reload"]}
  ],
  "postures": ["first-time user", "numbers and copy", "edge input", "state after reload", "error paths"]
}
```

Each area's goals become charters. Without `goals`, the command writes one
charter per posture for the area, which is e2e's five. `--parallel` is 4 by
default and is capped by what the platform can host: web starts one browser
per charter; Windows is one window, so `--parallel` is 1 there and the command
says so; Android and iOS take one device per charter from the Phase 4 pool
and run as many as are free. Each charter is one explore run with its own
report folder under `.harness/bug-bash/<timestamp>/<area>-<n>/`.

When the charters finish the command merges the findings into
`findings.json`, dropping duplicates by `(route, lower-cased title)` and by
an identical first three steps, and writes one skeleton per issue to
`device/bug-bash/<area>-<slug>.test.ts`:

```ts
// Found by expo-harness bug-bash on 2026-10-13 in checkout.
// Steps: open /checkout, tap "Add", fill "Quantity" with "-1", tap "Pay".
// Expected: the total never goes below zero. Observed: the total read "-12.00".
import {device, screen} from 'expo-vitest/device';

describe.skipIf(!process.env.HARNESS_BUGBASH)('[bugbash] checkout: a negative quantity', () => {
  it('keeps the total at or above zero', async () => {
    await device.open('/checkout');
    await screen.getByRole('button', {name: 'Add'}).press();
    await screen.getByLabelText('Quantity').fill('-1');
    await screen.getByRole('button', {name: 'Pay'}).press();
    await expect(screen.getByTestId('total')).not.toHaveText(/^-/);
  });
});
```

The steps come from the finding's recorded actions, each resolved to a Phase 2
query through `locate`'s own suggestion logic, so the skeleton uses the
selector a person would have written. The expectation line is the agent's
stated expectation turned into the nearest polling matcher, and it is marked
with a comment to review. `describe.skipIf` keeps the file out of a normal
`vitest run` without touching `deviceConfig`; `HARNESS_BUGBASH=1 vitest run
--config vitest.config.device.mts device/bug-bash` runs them. A finding counts
as a bug only when its skeleton fails for the expected reason, which the
command runs last and reports in `report.md` in e2e's order: confirmed bugs,
risks it could not verify, rejected findings by reason, warnings. After a fix,
the guard comes off and the file moves out of `device/bug-bash/` as a
regression test.

### The skill, `init` and the configs

`init` from Phase 4 gains two offers, each shown before writing and skipped
with `--yes` unless `--mcp` is passed:

```json
// .mcp.json, read by Claude Code at project scope; approved on first use
{"mcpServers": {"expo-harness": {"type": "stdio", "command": "npx", "args": ["expo-harness", "mcp"]}}}
```

```json
// .cursor/mcp.json
{"mcpServers": {"expo-harness": {"type": "stdio", "command": "npx", "args": ["expo-harness", "mcp"]}}}
```

An existing file is merged, not replaced: the `expo-harness` key is added or
updated and every other server is kept. The docs say that Claude Code asks
before using a project server and that `claude mcp add --transport stdio
--scope project expo-harness -- npx expo-harness mcp` writes the same entry.

The skill at `.claude/skills/expo-vitest/` gains topics, each a file
`SKILL.md` links to so it stays under the 500-line guidance:

- `reference/mcp.md`: open, `tools`, `observe`, `locate`, act, re-observe,
  close; node ids are per observation; what `PIXEL_TAINTED` and `NODE_STALE`
  mean; one session per subagent.
- `reference/agent.md` (from Phase 5): `agent.act` followed by an `expect`
  so the cache can replay, secrets through `secret()`, when to pass
  `vision`.
- `reference/explore.md`: writing a goal with a posture and a limit, reading
  `report.md`, verifying a finding against its evidence before acting on it.
- `reference/bug-bash.md`: the feature map, the charter postures, reading
  the merged report, promoting a skeleton to a regression test.

`expo-vitest guide mcp` prints a topic from the installed package, so an
agent that has no skill folder can still read it.

## Compatibility

Everything here is a new subcommand or a new file. `expo-harness` keeps every
step, target spelling and option it has today; `mcp`, `explore` and
`bug-bash` are recognised by `parse` the way `doctor` is, before the step
list, so `expo-harness mcp` is never read as a step named `mcp`. The
`expo-vitest/device` API is untouched: the skeletons use the Phase 2
`screen` and the Phase 0 contract test passes unchanged. `.mcp.json` and
`.cursor/mcp.json` are written only when the person says yes.

## Work items

1. `src/harness/mcp/rpc.ts` with `parseLine`, `respond`, `fail`, the
   constants, and a `Transport` over stdin and stdout that honours `drain`;
   `src/harness/mcp/rpc.test.ts` covering parse errors, batch rejection,
   missing `jsonrpc`, notifications, cancellation marking, `ping` before
   `initialize`, unknown methods, and back-pressure with a fake writable.
2. `src/harness/mcp/sessions.ts` with the table, the id counter, the
   per-session queue, the idle and total timers, `closeAll`;
   `sessions.test.ts` with fake timers and a fake driver recording its calls.
3. `src/harness/mcp/catalog.ts` with the tool schemas, the capability gating
   from a driver's shape, id resolution against the newest observation, the
   diff rendering, redaction and the taint flag, and `locate`'s suggestions;
   `catalog.test.ts` over fixture trees for web, Windows and Android,
   including the three-way `locate` outcomes.
4. `src/harness/mcp/server.ts` wiring `initialize`, `ping`, `tools/list`,
   `tools/call`, progress notifications and shutdown; the `mcp` subcommand in
   `src/harness/index.ts` with its flags and the `console` rebinding.
5. `src/harness/lib/report.ts`, the explore report writer, and
   `src/harness/explore.ts` over the Phase 5 loop with the `explore` step
   kind and `report_finding`; `report.test.ts` for the markdown and JSON
   rendering from a fixed findings list.
6. `src/harness/bug-bash.ts`: the feature map reader and validator, charter
   generation, the parallel runner over explore, the merge and dedupe, the
   skeleton writer and the confirmation run; `bug-bash.test.ts` for the
   reader, the charters, the dedupe and the skeleton text.
7. `init`'s `.mcp.json` and `.cursor/mcp.json` merge in Phase 4's
   `src/cli/init.ts`, with a test that an existing file keeps its other
   servers; the four skill topic files and the `guide` topics.
8. The fixture's `device/mcp.test.ts`: spawns `expo-harness mcp` with
   `HARNESS_PLATFORM=web`, speaks `initialize`, `open_session`, `observe`,
   `call locate`, `close_session` over its stdio, and asserts the shapes.
9. `vitest.config.mts` coverage `include` gains `src/harness/mcp/rpc.ts`,
   `sessions.ts`, `catalog.ts`, `src/harness/lib/report.ts`, and the pure
   parts of `bug-bash.ts` split into `src/harness/lib/charters.ts`.
10. Docs: `docs/coding-agents.md`, the `mcp`, `explore` and `bug-bash`
    sections of `docs/harness.md`, the README rows, and `harness.md`'s "What
    each platform can do" table gaining the MCP column.

One commit per item, each with the message saying why and what was verified.

## Verification

- **Unit, under the 100% gate:** the framing (every rule in `rpc.ts`), the
  session table (limits, id rules, queue ordering, idle and total timers,
  `closeAll` order), the catalog (gating per driver shape, stale ids,
  taint, redaction, the diff, every `locate` outcome), the report rendering,
  the charter generation, the dedupe and the skeleton text. These are logic
  and join the coverage `include` list.
- **The fixture, in CI:** `device/mcp.test.ts` drives the real server over
  stdio against the fixture's static page on web, which proves the transport,
  the lifecycle, `open_session` through a real driver, `observe`, `locate` and
  shutdown on every push.
- **By hand, before the phase closes:** a Claude Code session with only the
  `.mcp.json` entry and the skill writes a passing device test for a flow in
  the fixture's web page on this repository, and for a flow in expo-windows's
  example app on a Windows machine; an `explore` on the fixture page is run
  and its `report.md` read against the trees it cites; a `bug-bash` with two
  areas on the fixture page produces skeletons that run under
  `HARNESS_BUGBASH=1`.
- **Cost:** the explore smoke prints its model calls and tokens, and the
  numbers are recorded in the phase's closing note with the model used.

## Docs

- `docs/coding-agents.md`, new: the one-prompt setup, the `.mcp.json` entry,
  the skill, the open, observe, locate, act, re-observe, close loop, reading
  a failing test's `trace.md`, `explore` and `bug-bash`, with the limits
  stated plainly (Windows is one session; pixels stop after a secret fill;
  the idle guard).
- `docs/harness.md`: three sections for `mcp`, `explore` and `bug-bash`
  under Usage, their options in the options table, and an MCP column in
  "What each platform can do".
- `README.md`: feature rows for the MCP server and for explore and bug bash,
  and the documentation table row for `coding-agents.md`.
- The skill topics named above, shipped in the package under
  `skills/expo-vitest/` (Phase 4's folder) so `init` copies them and `guide`
  prints them.

Every page describes the package as it is, with no history, per `AGENTS.md`.

## Risks and fallbacks

- **A stray line on stdout corrupts the stream.** The `console` rebinding
  covers the harness's own prints; a driver that spawns `agent-device` or
  PowerShell captures their output already. The fixture's `mcp.test.ts`
  fails on any non-JSON line, which is the guard against regressions.
- **A model mistakes the `tools` catalog tool for `tools/list`.** e2e has the
  same two layers and the same name. The `instructions` text and the skill
  say which is which, and `call` with an unknown tool answers with the
  catalog inline.
- **The Windows idle guard blocks an unattended agent.** By design. The
  refusal text says to open the session with `force: true`, and `--force` on
  the server covers a machine known to be free.
- **A client that dies without closing stdin leaves a session open.** The
  idle timer closes it after 30 minutes; a device claim held by agent-device
  is released by `driver.close()` on that path, and `agent-device device
  release --stale` is the documented recovery if the process itself was
  killed.
- **Long calls against client timeouts.** Progress notifications when the
  client sent a token, and every catalog action bounded by the Phase 3
  `actionTimeout` of 30 seconds, so a call always answers inside what MCP
  clients typically allow.
- **Bug bash on devices without Phase 4 pools.** `--parallel` is capped to
  the devices available and the command says what it capped and why, rather
  than queueing charters silently.
- **Explore cost.** Default 8 steps and 10 minutes, hard limits of 12 and
  15, the cost line at the end, and `HARNESS_DEBUG=1` for the per-step
  table. Nothing runs a model without a configured one.
- **Cancellation reaching a driver mid-action.** The in-flight driver call
  completes and its result is dropped; the session's queue then continues
  with the next call. An action that may have committed is reported as such
  in the next `observe` rather than retried.

## Exit criteria

- A coding agent writes a passing device test for a new flow using only the
  MCP session and the skill, once on the fixture's web page and once on
  expo-windows's example app on Windows.
- The fixture's `device/mcp.test.ts` passes in CI on every push, and
  `bun run test:coverage` holds 100% with the new logic files included.
- `expo-harness explore` on the fixture page writes a report whose every
  finding cites a step, a tree and, when untainted, a screenshot, and exits 1
  only when an `issue` was reported.
- `expo-harness bug-bash` with two areas writes skeletons that are skipped by
  a normal device run and run under `HARNESS_BUGBASH=1`.
- The Phase 0 contract test passes unchanged, and `expo-harness` with no
  subcommand behaves exactly as before.

## References

- MCP specification 2025-06-18: [transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports),
  [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle),
  [tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
  [ping](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/ping),
  [cancellation](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation),
  [progress](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress),
  [logging](https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/logging),
  and the revision's changelog for the removal of JSON-RPC batching.
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification): request, response,
  error codes, batch rules.
- e2e: [MCP server](https://e2e.tester.army/docs/reference/mcp),
  [coding agents](https://e2e.tester.army/docs/coding-agents),
  [explore](https://e2e.tester.army/docs/explore),
  [bug bash](https://e2e.tester.army/docs/bug-bash),
  [CLI](https://e2e.tester.army/docs/reference/cli).
- Claude Code: [MCP configuration](https://code.claude.com/docs/en/mcp),
  [skills](https://code.claude.com/docs/en/skills).
- Cursor: [MCP configuration](https://cursor.com/docs/context/mcp).
- agent-device: [agent setup and `agent-device mcp`](https://oss.callstack.com/agent-device/docs/agent-setup).
- Node: `readline` with `crlfDelay`, `Writable.write` and the `drain` event,
  `process.on('SIGINT' | 'SIGTERM')`, `timer.unref()`.
- This repository: `src/harness/index.ts`, `src/harness/lib/types.ts`,
  `src/harness/lib/snapshot.ts`, `src/harness/lib/drivers.ts`,
  `src/device/index.ts`.

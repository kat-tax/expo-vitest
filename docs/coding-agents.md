# Coding agents

[Docs home](README.md) · [The harness](harness.md) · [The agent](agent.md) · [Evidence](evidence.md)

A coding agent works with this package in three ways. It reads how to write
and run the tests from the skill. It drives the running app through the MCP
server to find a flow before it writes the flow's test. And it asks the
package's own agent to look for bugs, with `explore` and `bug-bash`.

## The guide

```sh
npx expo-vitest guide            # the overview
npx expo-vitest guide device     # one topic
npx expo-vitest guide --list     # the topics
```

`guide` prints the skill from the copy of the package that is installed, so
what an agent reads is always the version the project runs. Any agent that
can run a command can read it. One line in `AGENTS.md`, or `CLAUDE.md`,
points it there:

```
Tests use expo-vitest. Run `npx expo-vitest guide` for how to write them, run them and read a failure.
```

`init` prints this line and leaves the file to you.

## The skill in a project

The skill is in `skills/expo-vitest/`: `SKILL.md`, the overview, and a topic
each on the projects, the device, the evidence, the harness, the agent, the
MCP server, explore and bug bash. `init` asks whether to add it, and copies
it into `.claude/skills/expo-vitest/`, where Claude Code reads a project's
skills. Run again after an upgrade, it replaces a file whose
`metadata.version` is older than the package's, showing the change first,
and leaves one that was edited since it was copied. The skill may run
`vitest`, `expo-harness` and `expo-vitest` through `npx` or `bunx`, and read
and search files.

## The MCP server

`expo-harness mcp` is an MCP server over stdio. A coding agent opens a
session on the app the project's `harness.config.ts` names, and acts on it
with the same tools and the same rules as the [agent](agent.md): refs that
name one node, secrets filled by name, no picture after a secret, and only
the tools the platform has.

### Registering it

`init` asks whether to register it, and `init --yes --mcp` does without
asking. It writes the same entry where Claude Code reads a project's servers,
`.mcp.json`, and where Cursor does, `.cursor/mcp.json`:

```json
{"mcpServers": {"expo-harness": {"type": "stdio", "command": "npx", "args": ["expo-harness", "mcp"]}}}
```

A file that is there keeps every other server, and gains or updates this
one, its diff shown first. Claude Code asks before it first starts a server
a project names. For Claude Code alone, this writes the same entry:

```sh
claude mcp add --transport stdio --scope project expo-harness -- npx expo-harness mcp
```

### The loop

The server has four tools:

| Tool | What it does |
| --- | --- |
| `open_session` | Opens the app on a `target` platform, or the one the server was started with, or the first the machine can drive. It starts the config's command where nothing answers at its url yet, and uses what is there where something does. It answers the session's id, its tools and the first observation. |
| `tools` | A session's tools, or one tool's input schema. |
| `call` | Runs one of a session's tools with its `args`, and answers what it did and what changed on the screen. |
| `close_session` | Closes a session and lets go of its driver. |

A session's tools are the agent's: `observe`, `tap`, `double_tap`, `check`,
`long_press`, `hover`, `type`, `type_secret` where the config has secrets,
`press`, `scroll`, `scroll_to`, `navigate`, `back`, `home`, `alert`,
`dismiss_keyboard`, on web `select` and `right_click`, `screenshot` and
`tap_at` where the platform takes screenshots, the default agent's
[project tools](agent.md#project-tools), and `locate`. A coding agent
observes, acts by ref, reads what changed, and when the flow works, asks
`locate` how a test finds each node it used:

```json
{"tool": "locate", "args": {"role": "button", "name": "Save"}}
```

```json
{"count": 1, "suggestion": "screen.getByRole(\"button\", {name: \"Save\"})", "matches": [{"ref": "@e4", "kind": "button", "name": "Save"}]}
```

`locate` takes one of `role`, `text`, `label`, `placeholder` or `testId`,
and `name` with a role. Where several nodes match, it answers the call that
finds each one alone; where none does, the names near the one asked for.

### Sessions

- A ref names the same node for the whole session. A node that has gone is
  `NODE_STALE`, and the answer says to observe again.
- A secret's value never comes back in an answer: each is hidden as
  `<secret:NAME>`. Once one is filled, `screenshot` and `tap_at` answer
  `PIXEL_TAINTED` for the rest of the session.
- Up to `--max-sessions` are open at once, 4 by default and 16 at most. With
  several open, a call names its `session`, or it is `SESSION_REQUIRED`. All
  of them use one harness config; another is `CONFIG_IN_USE`.
- A session on web has a browser of its own. Windows is one desktop and a
  device is one device, so each takes one session at a time, and another is
  `SESSION_OPEN`. Synthetic input on Windows waits until nobody has used the
  machine for three minutes, unless the session was opened with
  `force: true` or the server with `--force`.
- An open answers within three minutes, a cold simulator's boot included.
  One that takes longer is `OPEN_TIMEOUT`, and the session is closed if it
  opens after. Each action has 15 seconds of its own, as an agent's does.
- A call whose request carries a `progressToken` in its `_meta` hears every
  two seconds that it is still going, as `notifications/progress` with how
  long so far, so a client that waits on progress does not time out an open
  that boots a device. None comes after the call ends or is cancelled.
- A cancelled call gets no answer. What it started still finishes, and a
  session a cancelled `open_session` opened is closed as soon as it is open,
  since the client never hears its id.
- A session closes at `close_session`, after 30 idle minutes, after 4 hours,
  and when the client goes. SIGINT and SIGTERM close them all.
- stdout is the protocol's alone. Everything the server would print goes to
  stderr.

| Option | What it does |
| --- | --- |
| `--platform <name>` | The platform a session opens on where it names none. |
| `--config <path>` | A harness config other than the project root's. |
| `--headed` | On web, a browser window to watch. |
| `--force` | On Windows, act even while someone is using the machine. |
| `--max-sessions <n>` | How many sessions may be open at once, 1 to 16. 4 by default. |

## Explore

`expo-harness explore` runs the agent with a goal instead of a test step. It
plans a step at a time toward the goal, tries the posture the goal names,
reads an action that failed rather than stopping at it, and reports what is
off with a tool of its own, `report_finding`: an issue where the app does
what a person would call a bug, or a warning for a rough edge, each with
what was expected, what the screen showed, and the steps that reach it.

```sh
npx expo-harness explore "Explore the checkout like a first-time buyer, and report anything off" --platform web
```

| Option | What it does |
| --- | --- |
| `goal` | What to explore, with a posture. `Explore the app and find bugs` by default. |
| `--platform <name>` | Where to explore. The first platform the machine can drive by default. |
| `--agent <name>` | An agent from the harness config's `agents`. `default` by default. |
| `--max-steps <n>` | The actions it may take, 1 to 12. 8 by default. Its model calls are the agent's `maxModelCalls`. |
| `--timeout <ms>` | How long it may take, at most 900 000. 600 000 by default. |
| `--headed`, `--force`, `--config` | As for the server. |
| `--out <dir>` | The report's folder. `.harness/explore/<yyyy-mm-dd-hhmmss>` by default. |

Every secret in the harness config may be filled, by name. The report's
folder holds:

| File | What it is |
| --- | --- |
| `report.md` | How the run ended, the issues, then the warnings, each with its steps and links to the tree and the screenshot it cites, then every step. |
| `report.json` | The same as data: the goal, the platform, the agent, each step with the query that finds its node in a device test, each finding, and the calls, tokens and cost. |
| `steps/` | The tree each step left, as the model saw it, `000-start.txt` first. |
| `screenshots/` | A picture after each step, with secure fields painted over, and none once a secret was filled. |
| `transcript.txt` | Each call the model made, and what it answered. |

A finding cites the step it was reported after, so its claim can be checked
against the tree that step left. The terminal prints each finding as it is
made, each step's calls and tokens under `HARNESS_DEBUG=1`, and the cost at
the end. It exits 1 when it reported an issue, 2 when it could not explore,
as when it was blocked or its model failed, and 0 otherwise.

## Bug bash

`expo-harness bug-bash` explores many goals at once and turns each issue it
finds into a test, which then decides whether the issue is a bug.

```sh
npx expo-harness bug-bash --feature-map device/features.json --platform web --parallel 4
```

The feature map is JSON:

```json
{
  "areas": [
    {"name": "checkout", "goals": ["buy one item as a first-time user", "enter edge values in every quantity field"], "agent": "buyer"},
    {"name": "settings"}
  ],
  "postures": ["first-time user", "numbers and copy", "edge input", "state after reload", "error paths"]
}
```

Each goal of an area is a charter. An area with no goals gets one charter a
posture, the map's or those five. An area's `name` names files, so it is
lower-case letters, digits and `-`, and its `agent` is one of the harness
config's. The charters run `--parallel` at a time on web, 4 by default, each
in a browser of its own; on Windows, which is one desktop, and on Android
and iOS, one at a time, which the command says. The config's command is
started once for all of them.

When they finish, it:

1. merges the findings into `findings.json`, two being one where they share a
   route and a title, or their first three steps, the one kept naming the
   other, so a wrong merge stays in sight;
2. writes a skeleton for each issue to `device/bug-bash/<area>-<slug>.test.ts`:
   the explore's steps up to the issue, each by the query that found its
   node, then `agent.assert` of what was expected, inside
   `describe.skipIf(!process.env.HARNESS_BUGBASH)`, so a normal run passes it
   by;
3. runs the skeletons with `vitest.config.device.*` and `HARNESS_BUGBASH=1`.

```ts
// Found by expo-harness bug-bash on 2026-10-15 in sign-in, by the charter sign-in-1.
// Expected: a message that names the empty fields
// Observed: the page stayed as it was, with no message
import {agent} from 'expo-vitest/agent';
import {device, onlyOn, screen} from 'expo-vitest';
import {describe, it} from 'vitest';

describe.skipIf(!process.env.HARNESS_BUGBASH)("[bugbash] sign-in: Sign in with an empty form says nothing", () => {
  onlyOn(["web"], () => {
    it("a message that names the empty fields", async () => {
      await device.open("/");
      await device.open("/sign-in");
      await screen.getByTestId("sign-in").press();
      // Review: the expectation in the agent's words. Where a matcher says the same, it is the faster check.
      await agent.assert("a message that names the empty fields");
    });
  });
});
```

An issue whose skeleton fails its check with `ASSERTION_FAILED` is a bug. One
whose skeleton passed is rejected, since the app did what was expected. One
whose skeleton failed before its check, or did not run, is a risk it could
not verify. `report.md` in the run's folder lists them in that order, then
the warnings, then each charter with how it ended and what it cost. Each
charter's own explore report is in `<area>-<n>/`. It exits 1 on a bug or on
an issue whose skeleton did not run, 2 when no charter could explore, and 0
otherwise.

| Option | What it does |
| --- | --- |
| `--feature-map <file>` | The map. `device/features.json` by default. |
| `--parallel <n>` | Charters at once, 1 to 16. 4 by default, on web. |
| `--agent <name>` | The agent of an area that names none. `default` by default. |
| `--max-steps <n>`, `--timeout <ms>` | Each charter's, as for `explore`. |
| `--vitest-config <path>` | The device config the skeletons run with, in place of the root's `vitest.config.device.*`. |
| `--no-confirm` | Writes the skeletons and runs none of them. |
| `--out <dir>` | The run's folder. `.harness/bug-bash/<yyyy-mm-dd-hhmmss>` by default. |
| `--platform`, `--config`, `--headed`, `--force` | As for `explore`. |

A skeleton is a start, not a test: review its steps, and replace the
`agent.assert` with a matcher where one says the same. After the fix, take
its `describe.skipIf` off and move it out of `device/bug-bash/`, as a
regression test. The skeletons run again with:

```sh
HARNESS_BUGBASH=1 npx vitest run --config vitest.config.device.mts device/bug-bash
```

## What the evidence gives an agent

A failing device test leaves `trace.md` in its [folder](evidence.md): what was
expected, what was there instead, such as names like the one asked for, and
each step with what it did to the screen. It is text written to be read
before anything else, so an agent fixes the query, the wait or the app from
it without a screenshot. `tree.txt` has every node, and the skill's evidence
page says what to do with each kind of failure.

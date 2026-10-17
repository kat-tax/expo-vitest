# The harness

[Docs home](README.md) · [Platforms](platforms.md) · [Coding agents](coding-agents.md)

`expo-harness` runs the device tests' drivers as a command: open an app on a
platform, drive it, and look at what it drew. One command, four platforms,
the same steps everywhere. Tests prove behaviour; the harness is how you see
the thing itself, by hand or from a script.

```sh
npx expo-harness doctor
```

`doctor` says what this machine can drive, and what is missing for the rest.
It changes nothing. [Platforms](platforms.md) has what each platform needs.

## Usage

```sh
expo-harness doctor
expo-harness init [--yes] [--mcp] [--agent]
expo-harness guide [topic | --list]
expo-harness cache [ls | stats | clear]
expo-harness mcp [options]
expo-harness explore [goal] [options]
expo-harness bug-bash [options]
expo-harness -p <platform> [options] <step>...
```

The command answers to `expo-vitest` too, the package's own name, so
`npx expo-vitest init` works in a project that has not installed it yet.

## Setting a project up

`init` sets a project up to test with this package:

```sh
npx expo-vitest init
```

It reads what the project has: the package manager, the Expo SDK, React
Native Testing Library's version, the platforms the app builds for, the app's
identity and scheme, TypeScript, and the tests already there. Then it asks
five things: which platforms, whether to set up device tests, whether to add
the [skill for coding agents](coding-agents.md), whether to register the
[MCP server](coding-agents.md#the-mcp-server), and whether to install the
packages now.

| File | What init does with it |
| --- | --- |
| `vitest.config.mts` | A project per platform. |
| `vitest.config.device.mts`, `harness.config.ts` | With device tests: the device projects, and the app each platform drives, from what it found. With `--agent`, the agent too. |
| `device/example.test.ts` | With device tests: one that opens the app and reads what it drew. |
| `src/platform.test.ts` | Where the project has no tests yet: one that runs in each platform's project. |
| `package.json` | `test`, `test:watch`, and `test:device` with device tests, among its scripts. |
| `tsconfig.json` | The types for the globals and the matchers. A file with comments is not plain JSON, so init prints what to add instead. |
| `.gitignore` | `.harness/`. |
| `.claude/skills/expo-vitest/` | With the skill: its files. |
| `.mcp.json`, `.cursor/mcp.json` | With the MCP server: its entry, for Claude Code and for Cursor. A file that is there keeps every other server. |

It shows each file before it writes it, a diff for a file it edits, and asks
for each one: `y`, `n`, or `a` for the rest. A config or a test the project
has already is kept, and init says so. `package.json`, `tsconfig.json` and
`.gitignore` are edited, and a skill file older than the package's is
refreshed, each with its diff shown. Without installing, it prints the
commands that would, and it ends with the commands that run the tests.

`--yes` takes every default: the platforms it found, device tests and the
skill. It writes without asking and installs nothing, and leaves the MCP
server out unless `--mcp` is passed too.

`--agent` sets the [agent](agent.md) up as well, and device tests with it,
since the agent runs in a device project. It asks for the model: Claude,
through the adapter here, by name, and a sentence of what the app is for the
agent's context; or a model of your own, whose entry it prints for you to
write. A new `harness.config.ts` is written with the agent in it. One that
is there gains the adapter's import and the agent's entry, its diff shown,
unless it has agents already. Installing adds `@anthropic-ai/sdk`. With
`--yes`, the agent is Claude Opus 5.5, with no context.

## The guide

`guide` prints the [skill](coding-agents.md) from the installed package: how
to write the tests, run them and read a failure, for a person or an agent.
`guide <topic>` prints one part, and `guide --list` the parts.

## The agent's cache

`cache` reads the [agent's](agent.md#the-cache) replay cache, in the folder
the harness config's `cache.dir` names, else `.harness/cache`:

| Command | What it does |
| --- | --- |
| `cache ls` | Each entry, newest first: the start of its key, how old it is, the platform, the test and the instruction. |
| `cache stats` | How many entries there are, and their size. |
| `cache clear` | Empties the folder, and says how many entries it held. |

## For coding agents

Three commands drive the app for an agent rather than a person. Each is on
[Coding agents](coding-agents.md) in full, with its options.

- `mcp` is an [MCP server](coding-agents.md#the-mcp-server) over stdio. A
  coding agent opens a session on the app the harness config names, acts on
  it by ref with the agent's tools, and asks `locate` for the `screen.*` call
  a test finds a node with.
- `explore` runs the [agent with a goal](coding-agents.md#explore) instead
  of a test, and writes a report of what it found off, each finding citing
  the tree and the screenshot of the step it came after. It exits 1 on an
  issue.
- `bug-bash` runs a [feature map's charters](coding-agents.md#bug-bash) at
  once, merges what they found, writes a skeleton test for each issue in
  `device/bug-bash/`, and runs them: an issue is a bug only where its
  skeleton's check fails.

## Steps

```sh
# a web app, from its dev server
expo-harness -p web --url http://localhost:8081 \
  open / wait 3000 screenshot home.png tree

# a Windows build, deep-linked to a route
expo-harness -p windows --target windows/x64/Release/MyApp.exe \
  open /detail wait 1000 screenshot detail.png tree

# press something by its name, then look
expo-harness -p windows --target MyApp \
  press 'label="New"' wait 500 screenshot after.png

# a device
expo-harness -p android --scheme myapp \
  open /settings screenshot settings.png
```

Steps run in order in one session, so a sequence is a flow rather than four
separate commands. Each waits for the screen to hold still before the next,
as a [device test](device-tests.md#waiting-for-the-screen) does, so `press`
followed by `tree` shows what the press led to.

| Step | What |
| --- | --- |
| `open <path or url>` | A route, as a deep link or a URL. |
| `tree` | The accessibility tree as indented text, as a screen reader reads it: names, roles, and what a platform adds past them, such as `(3 of 7)`, `h2`, `live:polite` and `help:"..."`. |
| `snapshot [file]` | The same tree as JSON, to stdout or a file. |
| `press <target>` | A press on what a ref or a selector names. |
| `tap <x> <y>` | A press at a point, in the window's own pixels from its top left, when nothing names the thing. |
| `fill <target> <text>` | Put text in a field, in place of what it held. |
| `type <text>` | Into whatever has focus. |
| `screenshot <file>` | A PNG, under `.harness/` unless the path says otherwise. |
| `raise` | Bring the app to the front. Windows only. |
| `wait <ms>` | Let something settle. |
| `idle` | How long the machine has been quiet. |
| `bench [n]` | Time each operation `n` times, 20 by default. See [timing a platform](#timing-a-platform). |

## Targets

| Target | What it names |
| --- | --- |
| `@e7` | A ref from the last snapshot. |
| `label="New drop"` | An accessible name. |
| `role=button` | A role. |
| `testID=new-drop` | The component's `testID`. |
| `New drop` | A bare word is a label. |

This is the spelling `agent-device` takes. Quote a target that has spaces or
quotes in it, as your shell requires.

## Options

| Option | What it does |
| --- | --- |
| `-p`, `--platform <name>` | `web`, `windows`, `android` or `ios`. Required. |
| `--url <url>` | Where the app is served, for web. `http://localhost:8081` by default. |
| `--browser <name>` | On web, `chromium`, `firefox` or `webkit`. See [the browser](platforms.md#the-browser). |
| `--cdp <endpoint>` | On web, a Chromium already running, reached at the endpoint of its remote debugging. |
| `--scheme <scheme>` | The app's URI scheme, for deep links. |
| `--target <what>` | The device, simulator, exe or process to drive. |
| `--out <dir>` | Where screenshots go. `.harness` by default. |
| `-i`, `--interactive` | Snapshot only what can be acted on. |
| `--force` | On Windows, use synthetic input even when someone is using the machine. See [the quiet desk](platforms.md#synthetic-input-waits-for-a-quiet-desk). |
| `--settle <ms>` | How long the screen must hold still after a step. 150 by default; 0 for no wait. |
| `--transition <ms>` | How long a control the last step brought in or moved is given before a press. 500 by default. |
| `--iterations <n>` | How many times `bench` runs each operation. The same as `bench <n>`. |
| `--press <target>` | Something a press does nothing to, for `bench` to time `press` on. |
| `--field <target>` | A field for `bench` to time `fill` on. |
| `--json` | `bench` prints its result as JSON instead of a table. |
| `-h`, `--help` | The usage. |

Everything is relative to the project the command is run in, or to
`HARNESS_ROOT` when that is set. On web, `HARNESS_HEADED=1` opens the browser
in a window, and `HARNESS_SLOWMO=<ms>` slows each operation.

## What each platform can do

| | web | windows | android | ios |
| --- | :-: | :-: | :-: | :-: |
| `open`, `screenshot` | yes | yes | yes | yes |
| `tree`, `snapshot` | yes | yes | yes | yes |
| `press`, `tap`, `fill`, `type` | yes | yes | yes | yes |
| `raise` | | yes | | |
| `bench` | yes | yes | yes | yes |
| Named keys, in [device tests](device-tests.md) | yes | yes | skipped | skipped |
| `mcp` sessions at once | `--max-sessions` | 1 | 1 | 1 |
| `explore` | yes | yes | yes | yes |
| `bug-bash` charters at once | `--parallel` | 1 | 1 | 1 |

A step a platform cannot do says so and is skipped rather than failed, so the
same script runs on all four and tells you what it could not do.

## Timing a platform

`bench` measures what each thing a driver does costs, so a change meant to
make one faster can be shown to. It is a step like the others, and times
whatever the steps before it left on screen:

```sh
expo-harness -p web --url http://localhost:8081 open / bench --press 'label="Home"'
expo-harness -p windows --target MyApp bench 50
expo-harness -p android --scheme myapp open /settings bench --field 'testID=search'
```

```
bench on web (http://localhost:8083), 20 iterations, node 24.20.0, 2026-10-17T04:00:03Z

  operation         cold      p50      p95      min      max
  snapshot           2.7      0.7      1.3      0.7      2.5
  snapshot -i        0.9      0.8      0.9      0.7      1.1
  press              4.7      3.6      4.1      3.0      4.4
  fill         skipped: pass --field <target> to measure it
  settle           161.0    154.9    166.8    152.7    167.8
  screenshot        22.6     33.2     34.4     28.6     39.9
```

Each operation runs once and then `n` more times, and the times are in
milliseconds. The first call is `cold`, kept out of the rest because it pays
for whatever starts on first use, which is a different fact from the steady
state. p50 and p95 are by nearest rank over the other `n`. At least 5 are
needed, since the p95 of fewer is only the slowest.

| Operation | What runs |
| --- | --- |
| `snapshot` | The whole tree. |
| `snapshot -i` | Only what can be acted on. |
| `press` | A press on what `--press` names, found afresh each time as `element(…).press()` does in a test. Skipped without `--press`. |
| `fill` | Types `bench` into the field `--field` names, found afresh each time. The field keeps the text. Skipped without `--field`. |
| `settle` | The wait each step makes after it acts, on a screen that holds still: the tree read until two reads agree, with the run's settle between them, `--settle` or 150 ms. Skipped with `--settle 0`, which makes the steps wait for nothing, and where the driver waits inside each step by itself, as agent-device does, so its `press` and `fill` include it. |
| `screenshot` | A PNG, deleted afterwards. |

`--press` has to name something a press does nothing to, since it is pressed
every time: a heading, or the tab that is already selected. Nothing in the
tree says what is safe to press. A container that responds to a press can
carry no role at all, so `bench` leaves the choice to you.

`bench` times the driver's own work, without the wait for the screen that the
steps make, which `settle` times apart. On Windows, a synthetic `press` or
`fill` is refused while someone is using the machine, as it is for the steps,
and the check runs before every call. Once refused, the operation stops there
with the refusal as the reason, and the rest is still timed. A press through
a control's pattern needs no quiet desk.

Every run writes its result, every sample included, to
`.harness/bench/<platform>-<time>.json`, so a before and an after can be
compared. [Performance](performance.md) has the numbers for each platform on
real apps.

Screenshots and results land in `.harness/`. Add it to `.gitignore`, which
`init` does.

## From Vitest

The same drivers back the test API, so a flow is a test rather than a shell
invocation. See [Device tests](device-tests.md).

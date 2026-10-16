# Phase 4. Developer experience

Status: done, but for what needs an account or more iOS work: a provider's hosted device, and an iOS job that runs but does not pass yet · Size: M · Depends on: Phase 3 · Unblocks: Phase 6

The shared goal, the bar, the compatibility contract and the dependency policy
are in [README.md](README.md). The shared facts this phase builds on, the
Vitest reporter hooks, Playwright's `connectOverCDP` and `recordVideo`, and
agent-device's `record` and `connect`, are in README.md section 11. This
document does not repeat them.

## As built

On the `e2e` branch, after Phase 3, one commit an item or more. Where the
build differs from the design below, the build is what holds.

- **Items 1 to 5: `init`, the skill and `guide`.** `src/cli/detect.ts`,
  `templates.ts`, `plan.ts` (`planInit`, the diffs), `init.ts`,
  `skill.ts` and `guide.ts`; `init` and `guide` known in the first place
  of the command line; `expo-vitest` as a second bin; `skills/expo-vitest/`
  shipped, with `metadata.version` 0.1.0. `init` writes no line into
  `AGENTS.md` or `CLAUDE.md`: it prints the line, and the file is the
  project's.
- **Items 6 to 8: the reporter.** `src/reporter/render.ts`, `github.ts`,
  `records.ts` and `index.ts` as `expo-vitest/reporter`, with
  `summary()` and `github({key})`, and `reporters` on `deviceConfig`.
  Vitest's `--reporter` on the command line replaces a config's reporters,
  so a run that fails on purpose names its own and posts nothing.
- **Item 9: video.** Web records with `page.screencast` (playwright-core
  1.59 on) rather than a context made with `recordVideo`: a page per test
  made a test that relied on the page before it fail only with video on.
  A recording starts at the test's first step, so a test that never uses
  the device opens nothing. A page the test replaces, by a restart, is a
  part of its own, kept as `video-2.webm`. agent-device records with
  `--scope device`, since its default, the app it opened, has no session at
  a test's first step. Playwright records only with the ffmpeg build its
  own version names, so the fixture's copy fetches its own. Measured: 70 to
  250 ms a test on web, 4.4 to 5.6 s on the Android emulator, most of it in
  the stop.
- **Item 10: the browsers and CDP.** As designed, and: what each browser
  grants a page, measured with a page open, is `GRANTS` in
  `web-browsers.ts`, and a grant a browser lacks is passed over and noted,
  since one it does not know fails the whole context. The clipboard is
  Chromium's alone on web. The warm-up prints what a run passes over, once.
  While one CDP client is blocked, a page another opens does not load, so
  the fixture's test of the command runs it with `execFile`. The install
  hints name `npx playwright-core install`, the project's own version.
- **Item 11: hosted devices.** As designed, with `--no-login` on every
  `connect`, and the connection made through the command line from either
  transport, since the Node client has none. agent-device allocates on
  every command but `connect`, `close`, `disconnect`, `session` and a few
  more, so the warm-up's availability check allocates the device; the
  warm-up then installs `appPath`. Not run against a provider: there is no
  account here. The refusal without credentials is what was run.
- **Item 12: pools.** Vitest 4.1 takes workers per project, not as one sum
  at the root: a pooled project gets `maxWorkers`, `fileParallelism` and a
  `sequence.groupOrder` of its own, which Vitest asks of projects whose
  workers differ. The size is read from the harness config while the
  Vitest config is built, with `require` and Node's type stripping
  (`loadHarnessSync`). A claim is a lock file, then a session of its own
  opened with nothing in it, which agent-device holds the device for. The
  setup file closes the device when its file ends. The warm-up warms each
  device of the pool by name, since a driver left to agent-device's choice
  could take any device on the machine. Run with two emulators, the second
  an AVD made for it and removed after.
- **Item 13: `device.web`.** As designed, and: a frame is read in the frame,
  of any origin, its refs `@f<n>e<m>` and its boxes the page's, and every
  step on such a ref resolves in the frame. A download goes where the test
  says, or `.harness/downloads/`, not the test's evidence folder, which the
  device does not know while the test runs. Each call is a `'web'` step.
- **Item 14: the docs.** `ci.md`, `migrating.md` and `coding-agents.md`,
  `init` and `guide` in `harness.md`, the browser, pools and hosted devices
  where they belong, and the README's rows. `locators.md`, `matchers.md` and
  `controls.md` were split from `device-tests.md` in earlier phases. The
  CI page says which of its jobs have run: the web job's steps, in this
  repository's CI.
- **Item 15: the fixture.** It ends with `init --yes` on the copy with its
  configs and tests taken away, the component tests on what it wrote, and
  a second `init --yes` that must write nothing and name each file it
  kept. This repository's CI gives the fixture its token, with
  `pull-requests: write`.

Against the exit criteria:

- `init` with every default, then the component tests: green in the
  fixture. `test:device` on web on an app it set up: run by hand on a fresh
  `create-expo-app` (Expo 57.0.30, React Native 0.86.3) with the packed
  package, `init --yes` and the packages it named, on port 8097 through
  `HARNESS_URL`, since the config it writes serves the app on 8081, where
  this machine's own dev server is. It failed first: the global setup
  started `expo start` with Vitest's own environment, `NODE_ENV=test`
  among it, under which React Native's dev middleware will not start. The
  command now starts without what Vitest set for itself, and the run and
  the component tests init wrote passed, on the Vitest 5.0.5 its install
  line chose.
- A second `init` changes nothing and says so per file: checked in the
  fixture.
- The pull request comment: seen on the branch's pull request, posted by
  the summary reporter from the fixture's device run in CI, with the
  run's 29 passed and 37 skipped and every test in a table. Each later run
  on the branch updated that comment rather than adding one.
- Video: `video.webm` for a failing web test and none for a passing one,
  `video.mp4` on the Android emulator, and Windows has no `video`
  capability, with the reason.
- `HARNESS_BROWSER=webkit`, and `firefox`, run the fixture's web device
  suite, and `HARNESS_CDP` runs it on a Chromium the run did not start.
- Two emulators in `devices` ran two files at the same time, each device
  held by one file at a time, and agent-device showed no claim left after.
- The CI jobs: `.github/workflows/testapp.yml` runs the four of them on
  this repository's pull requests, against the test app from the packed
  package, as Phase 7's notes say. Web passed on `ubuntu-latest`, Android
  on an API 35 emulator there, and Windows on `windows-latest`, once what
  their first runs showed was fixed. The iOS job runs on a simulator on
  `macos-26`: the app launches and the onboarding passes, and the rest fails
  for the reasons Phase 7's notes give. `docs/ci.md` names the
  images, and its Windows job sets a larger screen, as a runner's 1024x768
  is smaller than most app windows.
- `docs/migrating.md` has every row of e2e's Detox and Maestro guides, read
  for it, and the Playwright and e2e tables.

## Purpose and the claims it proves

Phase 3 leaves a device layer that does what e2e's does on four platforms. This
phase makes it the easier one to start, the easier one to read when it fails,
and the easier one to run in CI. It proves three of the criteria from README.md
section 2:

- **Friendlier.** From `npx expo-vitest init` to a green component run and a
  green web device test with no other step. e2e's `init` writes a web config and
  one example test; ours sets up components and devices on four platforms.
- **Lighter.** Every deliverable here adds no runtime dependency. The pull
  request comment is `fetch` against GitHub's REST API, video is what Playwright
  and agent-device already record, hosted devices are agent-device's own
  `connect`.
- **Wider.** Each feature says what it does on Windows, and where that is
  `skipped`, says why in the answer rather than in a footnote.

## What e2e does

Checked 2026-10-13 against the pages in README.md's appendix.

- **`npx e2e init`** asks for an engine (web or mobile) and a model option
  (subscription, provider, none), writes `e2e.config.ts` and
  `tests/example.e2e.ts`, adds `e2e` to devDependencies, copies its skill to
  `.agents/skills/e2e/` with `.claude/skills/e2e/` as a symlink, registers its
  MCP server in `.mcp.json` and `.cursor/mcp.json`, keeps existing files, and
  with `--yes` writes a web config on Vercel AI Gateway and installs nothing. It
  does not edit `AGENTS.md`; the docs tell the user to add one line by hand.
  Its video walkthrough says it shows every change before writing.
- **`npx e2e guide [topic]`** prints the skill from the installed package.
- **`@e2e-dev/github`** is a reporter that posts one pull request comment per
  run and updates it on reruns, writes the same text to the job summary, needs
  `pull-requests: write` and `GITHUB_TOKEN` in the step's `env`, takes a `key`
  for matrix jobs, stays silent on forks and non-pull-request events, and never
  changes the exit code. The comment carries a headline with counts, agent
  stats, each failure with a source link and error code, evidence links into the
  run's Artifacts section, a collapsed flaky section, a collapsed table of every
  test, and a footer.
- **Video** is `video: off | on | retain-on-failure | on-first-retry` in config,
  per target, or per test, and `--video` on the CLI. WebM per page on web, MP4
  on devices through agent-device, built from screenshots at about 15 frames a
  second on a physical iPhone.
- **Hosted browsers and devices** are provider packages: `@e2e-dev/kernel`,
  `@e2e-dev/smol`, `@e2e-dev/eas`, `@e2e-dev/limrun`, plus a `DeviceProvider`
  interface with `acquire`, `release` and `record` for anything else, and
  `web({connect: {cdpEndpoint}})` for a remote Chromium.
- **Parallelism** is `workers` with a device pool per target, one worker per
  device, two workers never sharing one.
- **The browser fixture** has `route`, `unroute`, `waitForResponse`,
  `onDialog`, `waitForDownload`, `frameLocator`, `evaluate`, `addInitScript`,
  `cookies`, `setCookies`, `setViewport`, `goto`, `reload`, `back`, `forward`,
  `url`, `title`, `waitForURL`, `keyboard` and `mouse`, with the browser chosen
  by `web({browser})` and installed by `npx @e2e-dev/web install webkit --with-deps`.
- **CI pages** for GitHub Actions (ubuntu web, a macOS job that creates a
  simulator on a named runtime and boots it by UDID, an Android job on
  `reactivecircus/android-emulator-runner` with KVM), EAS Workflows (build
  jobs feeding custom jobs through `eas/download_build`, an emulator on
  `linux-medium-nested-virtualization`), Bitrise (`xcode-start-simulator@0`,
  `avd-manager@2`, `wait-for-android-emulator@1`) and Codemagic
  (`mac_mini_m2`, `linux_x2`). CI mode sets retries 1, workers 1, cache
  read-only, and uploads `.e2e/` with `if: ${{ !cancelled() }}`.
- **Migration guides** from Playwright, Cypress, Selenium, Detox and Maestro,
  each a table with a status column: same, renamed, by design, missing.

## What this package has today

- `src/harness/index.ts:1-281`: the `expo-harness` entry. `parse()` at line
  76 treats `doctor`, `--help` and the options, and every other word as a step
  from `STEP_ARGUMENTS`. There is no `init`, `guide` or second bin;
  `package.json` has one `bin`, `expo-harness`.
- `package.json`: `files` is `dist`, `types.d.ts`, `README.md`, `docs`,
  `LICENSE`. A skill folder shipped with the package has to be added here.
- `src/projects.ts:21-28`: `SUBPATHS`, which a new `reporter` subpath joins,
  with the matching `exports` entry, or `src/projects.test.ts` fails.
- `src/harness/platforms/web.ts:94-240`: one browser, one page for the whole
  driver, `chromium.launch()` only, no `recordVideo`, no `connectOverCDP`, no
  routes, dialogs, downloads or frames.
- `src/harness/platforms/agent-device.ts`: no `record`, no `connect`. Phase 1
  replaces its transport with the Node client and a named session.
- `src/device/index.ts:27-45`: `configFromEnvironment` reads `HARNESS_PLATFORM`,
  `HARNESS_URL`, `HARNESS_SCHEME`, `HARNESS_TARGET`. Phase 3 adds
  `harness.config.ts` and `app.<platform>`; this phase adds `HARNESS_VIDEO`,
  `HARNESS_CDP`, `HARNESS_BROWSER` and `devices`.
- `.claude/skills/verify/SKILL.md`: the one skill in the repository, with
  `name`, a quoted `description` and `allowed-tools` in its frontmatter. The
  commit `969af35` quoted the description because an unquoted one with a colon
  did not parse. The shipped skill follows the same form.
- `docs/getting-started.md:200-208`: the whole of the CI guidance, two lines
  for the component projects on a Linux runner. No device CI, no migration
  guides, no performance page.
- `.github/workflows/ci.yml`: one Ubuntu job. Phase 2 adds the fixture's web
  device suite to it, which is where the reporter's comment is proved.

## Design

### 4.1 `expo-vitest init`

**The second bin.** `package.json` gains
`"expo-vitest": "./dist/harness/index.js"`, the same entry as `expo-harness`.
`parse()` in `src/harness/index.ts` gains the commands `init`, `guide` and
`bench` beside `doctor`, each taking the rest of the arguments as its own.
`expo-harness init` therefore works too, and nothing about the existing step
parser changes: a command word is recognised only in the first position, which
no step occupies today. `USAGE` lists the commands under both names. The
command bodies live in `src/cli/init.ts`, `src/cli/guide.ts`,
`src/cli/detect.ts` and `src/cli/templates.ts`, so the harness file stays the
dispatcher it is.

**Detection**, in `src/cli/detect.ts`, pure functions over a `package.json`
object, a list of files that exist, and `process.env`:

| What | How | Falls back to |
| --- | --- | --- |
| Package manager | `packageManager` field (`bun@`, `pnpm@`, `yarn@`, `npm@`); else a lockfile, `bun.lock` or `bun.lockb`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`; else `npm_config_user_agent` | npm |
| Expo SDK | the major of `dependencies.expo` | a warning that the package is verified on SDK 57, and continue |
| RNTL | the major of `devDependencies['@testing-library/react-native']`; 14 needs `test-renderer`, 13 does not | install RNTL 14 and `test-renderer` |
| Platforms | `ios/` and `android/` folders or `expo` present for the native pair; `react-native-web` or `react-dom` for web; `react-native-windows` for Windows | all four when nothing is found, which is a library |
| TypeScript | `tsconfig.json` exists | skip the `types` edit and say so |
| App identity | `app.json` or `app.config.json`: `expo.scheme`, `expo.ios.bundleIdentifier`, `expo.android.package`, `expo.slug` | placeholders in `harness.config.ts` |
| Existing tests | any file matching the file-name rule under `src/` or the `include` folders | write the example test only when none exist |

**The flow.** Four questions, each with a default an Enter accepts, through
`node:readline/promises`, no dependency:

1. Platforms, pre-selected from detection: `[x] ios [x] android [x] web [ ] windows`.
2. Device tests, yes by default.
3. Coding-agent files (the skill, and the MCP entry once Phase 6 ships), yes
   by default.
4. Install the dependencies now, yes by default outside `--yes`.

`--yes` answers every question with its default and never installs. `--agent`
adds a fifth question for the model provider (Phase 5) and is refused until
then. Every file is shown in full before it is written, a modified file as a
unified diff, with one prompt per file (`y`, `n`, `a` for all), and `--yes`
prints each and writes. A file that exists is never overwritten: `init` prints
what it would have added and moves on, which is what makes a rerun after an
upgrade safe. `package.json` scripts are merged only for keys that do not
exist. `.gitignore` gains the lines it lacks. `tsconfig.json` is edited only
when it parses as strict JSON; a file with comments gets the snippet printed
and a note to add it by hand, since the package has no JSONC parser and will
not take one.

**The files.** Templates live in `src/cli/templates.ts` as functions of the
detection result, so each is unit tested by its output.

```ts
// vitest.config.mts
import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest';

export default defineConfig({
  test: {projects: expoProjects({platforms: ['ios', 'android', 'web']})},
});
```

```ts
// vitest.config.device.mts
import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest';

export default defineConfig(deviceConfig({platforms: ['web']}));
```

```ts
// harness.config.ts
import {defineHarness} from 'expo-vitest/device';

export default defineHarness({
  app: {
    web: {
      url: 'http://localhost:8081',
      command: {executable: 'npx', args: ['expo', 'start', '--web', '--port', '8081']},
      readyUrl: 'http://localhost:8081',
    },
    android: {bundleId: 'com.example.app', scheme: 'myapp'},
    ios: {bundleId: 'com.example.app', scheme: 'myapp'},
  },
});
```

```ts
// src/platform.test.ts, runs on every project the config makes
import {Platform} from 'react-native';

it('knows its platform', () => {
  expect(['ios', 'android', 'web', 'windows']).toContain(Platform.OS);
});
```

```ts
// device/example.test.ts
import {device, screen} from 'expo-vitest/device';

afterAll(() => device.close());

it('opens and is labelled', async () => {
  await device.open('/');
  expect(await device.snapshot()).toBeFullyLabelled();
  await expect(device).toMatchScreenshot('home');
});
```

Plus: `"test": "vitest run"`, `"test:watch": "vitest"`,
`"test:device": "vitest run --config vitest.config.device.mts"` in `scripts`;
`"expo-vitest/types"` and `"vitest-expo/types"` in `compilerOptions.types`;
`.harness/` in `.gitignore`; the skill copied to `.claude/skills/expo-vitest/`
(section 4.2); and, once Phase 6 ships, the `.mcp.json` and
`.cursor/mcp.json` entries below. The install line is the one from
`docs/getting-started.md`, through the detected manager:
`npx expo install --dev expo-vitest vitest vitest-expo vitest-native
@testing-library/react-native test-renderer @testing-library/react
@testing-library/jest-dom jsdom playwright-core`, trimmed to the platforms
chosen, followed by `npx playwright install chromium` when web device tests
were chosen.

```json
{
  "mcpServers": {
    "expo-vitest": {
      "type": "stdio",
      "command": "npx",
      "args": ["expo-harness", "mcp"]
    }
  }
}
```

Claude Code reads that from `.mcp.json` at the project root and prompts for
approval on first use; Cursor reads the same shape from `.cursor/mcp.json`.
`init` writes both only when the installed package has the `mcp` command, which
it checks by asking its own `parse()`.

**Output.** One line per file written, skipped or left alone, then the next
three commands: run the component tests, start the app, run the device tests.
`init` does not edit `AGENTS.md` or `CLAUDE.md`; it prints the one line to add,
as e2e's docs do, because those files are the user's instructions to an agent
and a tool should not write into them unasked.

### 4.2 The skill and `expo-vitest guide`

The skill ships inside the package under `skills/expo-vitest/`, added to
`files`, so `guide` can print it and `init` can copy it without a network.

```
skills/expo-vitest/
  SKILL.md        the overview and navigation, under 200 lines
  projects.md     the four projects, the file-name rule, RNTL 14 awaits, vi not jest
  device.md       device tests: env vars, harness.config.ts, screen queries, matchers, controls
  evidence.md     where .harness/results lands, how to read trace.md, baselines are never recorded by a run
  harness.md      the expo-harness steps, targets and options
  agent.md        Phase 5
  mcp.md          Phase 6
```

`SKILL.md`'s frontmatter, in the form the repository already uses and that
Claude Code documents:

```yaml
---
name: expo-vitest
description: "Test Expo code with Vitest on iOS, Android, web and Windows: component tests routed by file name, device tests against a running app, and the expo-harness command. Use when writing or running a test in a project that uses expo-vitest, or when a device test failed and left evidence under .harness/."
argument-hint: "[projects|device|evidence|harness|agent|mcp]"
allowed-tools: Bash(npx vitest *), Bash(npx expo-harness *), Bash(bunx vitest *), Bash(bunx expo-harness *), Read, Grep
metadata:
  version: 0.2.0
---
```

The description is quoted because it holds colons. `metadata.version` is the
package version the copy came from; `init` compares it with its own and offers
to refresh a stale copy, so an upgrade does not leave an old skill behind.
Claude Code loads `.claude/skills/<name>/SKILL.md` from the repository, so
`init` copies there. It does not write `.agents/skills/`; a project that wants
the skill in another agent's folder copies the same files.

`expo-vitest guide` prints `SKILL.md`; `guide <topic>` prints one topic file;
`guide --list` prints the topics. It reads from the installed package through
`file()`, so it prints the version that is installed, not the one on the
network.

### 4.3 `expo-vitest/reporter`

A new subpath `reporter` → `src/reporter/index.ts` exporting `summary(options)`
and `github(options)`. Both are Vitest reporter objects; Vitest accepts an
instance in `reporters` beside the built-in names.

```ts
// vitest.config.device.mts
import {github, summary} from 'expo-vitest/reporter';

export default defineConfig(deviceConfig({
  platforms: ['web', 'android'],
  reporters: ['default', summary(), github({key: process.env.MATRIX_KEY})],
}));
```

`deviceConfig` passes `reporters` through, because Vitest keeps reporters at
the root and a device config is its own root.

**Hooks.** `onInit(vitest)` keeps the root and the output folder.
`onTestCaseResult(testCase)` records, for every test, `project.name` (the
platform project from Phase 3), `module.moduleId`, `fullName`, `location` when
`includeTaskLocation` is on, `result().state` and `errors`, `diagnostic()` for
`duration`, `retryCount` and `flaky`, and `annotations()` of type `evidence`,
which Phase 2's `afterEach` adds with the paths of the screenshot, the tree and
`trace.md`. `onTestRunEnd(modules, errors, reason)` renders and delivers.
Everything the hooks receive is kept as plain data so the rendering is a pure
function in `src/reporter/render.ts`.

**The summary**, Markdown, the same text for the file, the job summary and the
comment:

```
## expo-vitest · 2 failed · 1 flaky · 41 passed · 3 skipped

| Platform | Test | Error | Evidence |
| --- | --- | --- | --- |
| android | settings > opens the profile (device/settings.test.ts:14) | LOCATOR_NOT_FOUND: nothing matches testID="profile"; the tree has 38 nodes | screenshot · tree · trace |
| web | checkout > pays | ASSERTION_FAILED: expected "Paid" to be visible within 5000 ms | screenshot · tree · trace |

<details><summary>Flaky, passed on retry (1)</summary> … </details>
<details><summary>Every test (47)</summary> … </details>

expo-vitest 0.2.0 · 3 m 12 s · web, android · attempt 1 · artifacts
```

The evidence words are links. In the job summary and the comment they point at
the run's Artifacts section,
`${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}#artifacts`,
with the relative path beside them, because GitHub does not serve artifact
files by URL. In `.harness/summary.md` they are relative links that open in an
editor. The file is written on every run. `GITHUB_STEP_SUMMARY` is appended
when set; GitHub caps a step summary at 1 MiB, so the collapsed table is cut
first and a line says so.

**The comment**, in `src/reporter/github.ts`, posts only when all of these
hold: `GITHUB_ACTIONS` is `true`, `GITHUB_EVENT_NAME` is `pull_request` or
`pull_request_target`, a token is in `GITHUB_TOKEN` or `GH_TOKEN`, and a pull
request number is in the `GITHUB_EVENT_PATH` payload at
`pull_request.number`, or failing that in `GITHUB_REF` as
`refs/pull/<n>/merge`. The calls, through global `fetch`:

| Step | Call |
| --- | --- |
| Find ours | `GET /repos/{owner}/{repo}/issues/{n}/comments?per_page=100`, following `page` until a body starts with the marker |
| Update | `PATCH /repos/{owner}/{repo}/issues/comments/{id}` with `{body}` |
| Create | `POST /repos/{owner}/{repo}/issues/{n}/comments` with `{body}` |

Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
`X-GitHub-Api-Version` pinned to a dated version and bumped deliberately. The
base URL is `GITHUB_API_URL` so GitHub Enterprise Server works. The marker is
`<!-- expo-vitest-reporter key=<key> -->` on the first line, where `key`
defaults to `${GITHUB_WORKFLOW}/${GITHUB_JOB}` and the `key` option is appended
for matrix entries, so each matrix job keeps its own comment and a rerun
updates it rather than adding one. A comment is at most 65536 characters;
the collapsed sections are cut first. The reporter never throws out of a hook
and never changes the exit code: a 403, which is what a fork's read-only token
returns, a missing token, or a non-pull-request event each print one line
saying why nothing was posted, and the job summary still gets the text. The
footer carries `GITHUB_RUN_ATTEMPT`, so a rerun is visible as such.

Permissions the workflow needs, which `docs/ci.md` states:

```yaml
permissions:
  contents: read
  pull-requests: write
```

### 4.4 Video

`HARNESS_VIDEO=on | retain-on-failure | off`, default `off`, and the same as
`video` in `harness.config.ts`, the environment winning.

| Platform | How | File |
| --- | --- | --- |
| web | the context is created with `recordVideo: {dir, size: viewport}`; with video on, the driver opens a new page per test, because Playwright writes one video per page and finalises it when the page closes; after each test `page.video().saveAs(dest)` or `video.delete()` | `video.webm` |
| android, ios | `client.recording.record({action: 'start', path})` in `beforeEach`, `{action: 'stop'}` in `afterEach`; a passing test's file is deleted under `retain-on-failure`; a physical iPhone's recording is built from screenshots at about 15 frames a second, which the docs say | `video.mp4` |
| windows | `skipped`, with the reason: no screen recorder without a dependency; take screenshots | none |

The destination is the test's evidence folder from Phase 2,
`.harness/results/<platform>/<file>/<test>/`, so the reporter links it beside
the screenshot. The per-test page on web costs one navigation per test, which
is why the default is `off` and the docs say so. `device.can('video')`
answers whether the platform records.

### 4.5 CDP connect and browser choice

`HARNESS_CDP=<ws or http endpoint>` makes the web driver call
`chromium.connectOverCDP(endpoint)` instead of `launch()`, take
`browser.contexts()[0]` or open a context, and on `close()` disconnect without
closing the remote browser. That is how a hosted Chromium such as Kernel's is
reached: it hands out a CDP URL. `HARNESS_HEADED` and `HARNESS_BROWSER` are
ignored with a one-line note when `HARNESS_CDP` is set, since the remote
decides both.

`HARNESS_BROWSER=chromium | firefox | webkit`, default `chromium`, picks the
`playwright-core` browser type. The headless shell search in `shells()` applies
to Chromium only; the others need `npx playwright install firefox --with-deps`
or `webkit`, and `doctor` reports each browser as installed or missing by
checking `browserType.executablePath()` exists. The harness takes the same two
as `--cdp` and `--browser`. The web project's pre-bundling and the DOM
collection script do not change; what the page is served by does not matter to
either.

### 4.6 Hosted devices

No provider code. agent-device's `connect <provider>` checks credentials and
saves non-secret state; the device is allocated on the first `open` (Limrun on
the first `install` or `open`); normal commands run through the local daemon
afterwards; `close` then `disconnect` release it. Credentials come from the
provider's own environment variables: `LIMRUN_API_KEY` and `LIMRUN_REGION`,
`BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY`, the AWS CLI chain and
`AWS_DEVICE_FARM_*`.

`app.<platform>.device` accepts a provider object beside a device name,
because Limrun rejects `--device`, `--udid` and `--serial`:

```ts
android: {
  bundleId: 'com.example.app',
  appPath: 'android/app/build/outputs/apk/release/app-release.apk',
  device: {provider: 'limrun'},
}
```

With a provider object, the Phase 3 `globalSetup` runs
`agent-device connect limrun --platform android` once before the first test and
`agent-device disconnect` after the last, and the driver's `installApp` runs
`install <bundleId> <appPath>`, which is what allocates the instance. That is
two commands and no provider logic of ours. On iOS, Limrun cannot reverse a
port, so a dev client needs a public bundle URL; the docs say so and point at
release builds. `LIMRUN_KEEP_ALIVE=1` keeps an instance alive through a slow
suite. BrowserStack and AWS Device Farm work the same way with their flags
passed through `device.options`.

### 4.7 Device pools

```ts
android: {bundleId: 'com.example.app', devices: ['Pixel_8_API_35', 'Pixel_9_API_35']},
web: {url: 'http://localhost:8081', workers: 3},
```

The Phase 3 config computes the device config's root `maxWorkers` as the sum
of every platform's pool, with 1 for a platform that names none and always 1
for Windows, and turns `fileParallelism` on. Each test file runs in its own
forked worker, which is what the device layer already assumes: the driver is
made at the file's first use and closed in `afterAll`. A claim is therefore
per file, not per worker, and needs no worker index:

1. At the file's first `device.ready()`, the driver lists the platform's pool
   and tries each device in turn, starting at an offset from the file's hash so
   files spread out.
2. For each candidate it takes a lock file,
   `.harness/locks/<run>/<platform>/<device>`, opened with `O_EXCL`. A lock it
   cannot take means another file holds that device; move on.
3. It then opens the app with `--device <name>` in a session named
   `expo-vitest-<run>-<device>`. agent-device's host-local claims make a
   second `open` on a held device fail with `DEVICE_IN_USE`, which is the
   second line of defence against a stale lock; on that error the lock is
   dropped and the next device tried.
4. When every device is busy, the file waits, polling the lock folder every
   second, up to `poolTimeout` (default the test timeout), then fails with
   `DEVICE_POOL_EXHAUSTED` naming the holders.
5. `afterAll` closes the driver, which closes the session, and removes the
   lock. The `globalSetup` teardown removes `.harness/locks/<run>/` and runs
   `device release --stale` so a crashed worker leaves nothing behind.

Web needs no claims: a pool of `workers` is that many browsers, one per file.
Windows is one window and one worker. The run id is the `globalSetup`'s and
reaches workers through `provide`. This refines Phase 1's "one session per
run" into one session per claimed device, which is the same thing when the
pool has one entry.

### 4.8 `device.web`

A namespace on `device` that exists on every platform and answers `'skipped'`
everywhere but web, so a shared test file still runs and says what it could
not do. On web each call reaches the Playwright context or page the driver
holds.

| Method | Web | Elsewhere |
| --- | --- | --- |
| `route(pattern, handler)` | `context.route`; the handler gets `fulfill({status, json, body, headers})`, `continue()`, `abort()`; returns an `unroute` function | `'skipped'` |
| `onDialog('accept' \| 'dismiss' \| fn)` | `page.on('dialog')`; returns an off function | `'skipped'` |
| `evaluate(source, arg?)` | `page.evaluate` with a string or a function serialised by `toString()`, so it cannot close over test variables; `arg` is JSON | `'skipped'` |
| `setViewport({width, height})` | `page.setViewportSize` | `'skipped'` |
| `cookies()`, `setCookies(list)`, `clearCookies()` | the context's | `'skipped'` |
| `waitForDownload(trigger)` | `page.waitForEvent('download')` around `trigger()`, saved under the test's evidence folder, path returned | `'skipped'` |
| `frame(selector)` | a `screen` from Phase 2 scoped to that frame: the collection script runs in the frame, refs are prefixed `@f1e…`, actions resolve inside it | `'skipped'` |
| `selectOption(locator, value)` | `locator.selectOption` on the element the node maps to, by label, `{value}` or `{index}`, one option per call as e2e has it | `'skipped'` |
| `setInputFiles(locator, paths)` | `locator.setInputFiles`; paths resolve from the project root and must stay inside it, never a hidden path, the rule Phase 5 enforces for the agent's `upload` | `'skipped'` |
| `secondaryTap(locator)` | `page.mouse.click(x, y, {button: 'right'})` at the node's centre from the tree | `'skipped'` |

`device.can('web')` is the gate a test checks before relying on one. The
harness gains no steps for these; they are test-side conveniences.

### 4.9 Docs

New and changed pages, each describing the package as it is, with no history:

| Page | Sections |
| --- | --- |
| `docs/ci.md` | What CI needs per platform; GitHub Actions: a web job, an iOS job, an Android job, a Windows job; EAS Workflows; Bitrise; Codemagic; uploading `.harness/`; the reporter and the pull request comment; caching Playwright browsers and `~/.agent-device` |
| `docs/migrating.md` | From Detox, from Maestro, from Playwright, from e2e; one table each with columns "theirs", "here", "status" (same, renamed, by design, not yet) |
| `docs/performance.md` | What `bench` measures, the baselines per platform, the numbers after each phase, how to run it |
| `docs/evidence.md` | The results folder, `trace.md`, screenshots, video, the summary, what is committed and what is not |
| `docs/locators.md`, `docs/matchers.md`, `docs/controls.md` | `device-tests.md` split; the old page becomes the overview and links |
| `docs/coding-agents.md` | The skill, `guide`, `init`'s agent files, and in Phase 6 the MCP server |
| `docs/configuration.md` | `reporters`, `video`, `devices`, `workers`, `device: {provider}` on `deviceConfig` and `harness.config.ts` |
| `docs/harness.md` | `init`, `guide`, `--browser`, `--cdp` |
| `README.md` | feature rows for init, the reporter, video, hosted devices, pools |

**The GitHub Actions jobs** in `docs/ci.md`, one workflow, one job per
platform, each uploading `.harness/` with `if: ${{ !cancelled() }}`:

```yaml
name: device tests
on: [pull_request]
permissions:
  contents: read
  pull-requests: write

jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24}
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - run: npx vitest run --config vitest.config.device.mts --project device:web
        env: {GITHUB_TOKEN: '${{ github.token }}'}
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with: {name: harness-web, path: .harness}

  ios:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24}
      - run: npm ci && npm install -g agent-device
      - uses: actions/cache@v6
        with: {path: ~/.agent-device, key: agent-device-${{ runner.os }}-${{ hashFiles('package-lock.json') }}}
      - run: npx expo run:ios --configuration Release --no-bundler --no-install
      - name: Boot a simulator on a pinned runtime
        run: |
          UDID=$(xcrun simctl create ci "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-26-2)
          xcrun simctl bootstatus "$UDID" -b
          echo "HARNESS_TARGET=$UDID" >> "$GITHUB_ENV"
      - run: npx vitest run --config vitest.config.device.mts --project device:ios
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with: {name: harness-ios, path: .harness}

  android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24}
      - run: npm ci && npm install -g agent-device
      - name: Enable KVM
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm
      - run: cd android && ./gradlew :app:assembleRelease
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 35
          arch: x86_64
          profile: pixel_7
          emulator-options: -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim
          script: |
            adb install -r android/app/build/outputs/apk/release/app-release.apk
            npx vitest run --config vitest.config.device.mts --project device:android
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with: {name: harness-android, path: .harness}

  windows:
    runs-on: windows-2022
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24}
      - run: npm ci
      - uses: actions/download-artifact@v4
        with: {name: windows-release, path: windows/x64/Release}
      - run: Start-Process windows/x64/Release/MyApp.exe
      - run: npx vitest run --config vitest.config.device.mts --project device:windows
        env: {HARNESS_FORCE: '1'}
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with: {name: harness-windows, path: .harness}
```

The macOS runner image carries Xcode 26.x and iOS 26.2 simulator runtimes with
the iPhone 17 device type, and the docs tell the reader to pin the runtime by
name and boot by UDID, as e2e's page does, because the default changes with
the image. The Android job runs install and tests in one `script` because the
action stops the emulator when the step ends. The Windows job takes the app
from a build job's artifact rather than building: a react-native-windows build
needs Visual Studio 2022's native desktop and UWP workloads and the Windows
SDK, which `windows-2022` carries, but takes long enough that the page shows
the build as its own job and the test job downloading it. `HARNESS_FORCE` is
the Windows idle guard's override for a machine nobody is sitting at, which
the harness has as `--force` and the device layer gains as an environment
variable in Phase 3.

**EAS Workflows** follows the shape of agent-device's own template: a
`fingerprint` job, `get-build` with `repack` for an unchanged native build and
`build` otherwise, then a test job per platform on `macos-medium` and
`linux-medium-nested-virtualization` with `eas/checkout`,
`eas/install_node_modules`, `eas/download_build` and the app's
`artifact_path`, the simulator or emulator booted in a step of its own, the
tests, and `eas/upload_artifact` with `if: always()`. **Bitrise** uses
`xcode-build-for-simulator@3`, `xcode-start-simulator@0`, `avd-manager@2`,
`wait-for-android-emulator@1`, `custom-test-results-export@1` for JUnit and
`deploy-to-bitrise-io@2`. **Codemagic** uses `mac_mini_m2` and `linux_x2`,
creates the simulator with `xcrun simctl create` on a named runtime, starts
the `emulator-35` AVD headless, and publishes JUnit through `test_report`.
Each page is complete YAML that a reader copies.

**The migration tables.** From Detox: `by.id` → `screen.getByTestId`,
`by.label` → `getByLabelText`, `by.text` → `getByText`, `.tap()` →
`.press()`, `typeText` and `replaceText` → `.fill()`, `waitFor(el).toBeVisible().withTimeout(ms)`
→ `await expect(el).toBeVisible({timeout})`, `device.launchApp({newInstance})`
→ `device.restart()`, `device.reloadReactNative()` → `device.restart()` as the
nearest, `device.sendToHome()` → `device.home()`, `device.openURL` →
`device.openLink`, `device.setLocation` → `device.setLocation`,
`device.disableSynchronization()` → no equivalent by design,
`device.setStatusBar` → not yet. From Maestro: `launchApp` → `device.open`,
`clearState` → `device.clearState()`, `tapOn` → `getByText(...).press()`,
`tapOn: {id}` → `getByTestId`, positional `tapOn` → no equivalent by design,
`inputText` → `fill`, `eraseText` → `clear`, `hideKeyboard` →
`device.dismissKeyboard()`, `pressKey: Enter` → `locator.key('Enter')`,
`scrollUntilVisible` → `scrollIntoView`, `assertVisible` and
`assertNotVisible` → `toBeVisible` and `toBeHidden`, `extendedWaitUntil` →
`toBeVisible({timeout})`, `waitForAnimationToEnd` → `settle`, `openLink` →
`device.openLink`, `runFlow` → a function, `repeat` → a loop,
`takeScreenshot` → `device.screenshot`, `setLocation` → `device.setLocation`,
`assertWithAI` → `agent.assert` (Phase 5), `extractTextWithAI` →
`agent.extract` (Phase 5), `addMedia` → not yet, `assertDarkMode` → assert on
a themed control. From Playwright: the query names are the same shape with
RNTL spellings (`getByLabel` → `getByLabelText`, `getByPlaceholder` →
`getByPlaceholderText`), `click` → `press`, `page.goto` → `device.open`,
`page.route` → `device.web.route`, `page.on('dialog')` → `device.web.onDialog`,
`waitForEvent('download')` → `device.web.waitForDownload`, `toHaveScreenshot`
→ `toMatchScreenshot`, `storageState` → not yet, `test.describe` and hooks →
Vitest's own, `test.step` → not yet, `expect.poll` → Vitest's. From e2e:
`test` and `expect` from `e2e` → Vitest's, `screen.getByRole(role, name)` →
`screen.getByRole(role, {name})`, `.tap()` → `.press()`, `app.open` →
`device.open`, `app.restart` and `clearState` → the same on `device`,
`agent.*` → the same on `expo-vitest/agent` (Phase 5), `device.*` fixture →
the same on `device`, `requires` → `device.can` and `skipOn`, `targets` →
`platforms`, `e2e.config.ts` → `harness.config.ts`, `--target` →
`--project device:<platform>`, `.e2e/` → `.harness/`, `cache` → `HARNESS_CACHE`
(Phase 5), reporters → Vitest's plus `expo-vitest/reporter`. Each table's
"not yet" rows are honest and link to this plan.

## Compatibility

- `expo-harness` keeps every step, target and option. The three new command
  words are recognised in the first position only, and `doctor` already works
  that way.
- `init` never overwrites a file and never edits `AGENTS.md`, `CLAUDE.md` or a
  `tsconfig.json` it cannot parse as JSON.
- `expo-vitest/reporter` is a new subpath; `deviceConfig()` without
  `reporters` returns exactly what it returns today, which the Phase 0
  contract test checks.
- `HARNESS_VIDEO`, `HARNESS_CDP` and `HARNESS_BROWSER` are new variables with
  defaults that reproduce today's behaviour: no video, a launched Chromium.
- `device.web` is a new namespace; `device.can` is Phase 3's. Nothing on
  `device` changes meaning.
- A pool with one device behaves as today: one session, one file at a time.
- The skill is a folder the package ships and `init` copies. It changes
  nothing at runtime.

## Work items

Each is one commit, with a message that says why and what was verified.

1. `src/cli/detect.ts` and its tests: package manager, Expo SDK, RNTL major,
   platforms, TypeScript, app identity, existing tests. Join the coverage list.
2. `src/cli/templates.ts` and its tests: every file `init` writes as a function
   of the detection result, snapshot-tested by content.
3. `src/cli/init.ts`: the prompts, the per-file preview and confirmation, the
   diff for modified files, `--yes`, the install step, the closing lines. The
   plan-building part is pure and tested with a fake file list; the writing
   part is thin.
4. `src/harness/index.ts` and `package.json`: the `init`, `guide` and `bench`
   commands, the `expo-vitest` bin, `USAGE`.
5. `skills/expo-vitest/` with `SKILL.md`, `projects.md`, `device.md`,
   `evidence.md`, `harness.md`; `files` in `package.json`; `src/cli/guide.ts`
   reading them through `file()`; `init` copying them and comparing
   `metadata.version`.
6. `src/reporter/render.ts` and tests: the summary from plain test records,
   truncation, the artifact links, the file and job summary writers.
7. `src/reporter/github.ts` and tests with a fake `fetch`: the preconditions,
   the pull request number, the marker, find, update, create, the 403 path,
   the size cap.
8. `src/reporter/index.ts`, the `reporter` subpath in `SUBPATHS` and
   `exports`, `reporters` passed through `deviceConfig`.
9. Video: `HARNESS_VIDEO` and `video` in the config; the web driver's
   `recordVideo` context and page per test; the device driver's `record`
   start and stop; the evidence folder; `device.can('video')`; Windows
   `skipped`.
10. `HARNESS_CDP` and `HARNESS_BROWSER`, `--cdp` and `--browser`, `doctor`
    reporting each browser, the install hint in the error.
11. Hosted devices: the provider object on `device`, `connect` and
    `disconnect` in the `globalSetup`, the docs recipe for Limrun with a
    GitHub Actions job.
12. Device pools: `devices` and `workers` in the config, root `maxWorkers`,
    the claim algorithm in `src/device/pool.ts` with tests over a fake lock
    folder and a fake opener, `DEVICE_POOL_EXHAUSTED`, the teardown.
13. `device.web`: each method on web, `'skipped'` elsewhere, `frame` over the
    Phase 2 collection script.
14. Docs: `ci.md`, `migrating.md`, `performance.md`, `evidence.md`,
    `coding-agents.md`, the split of `device-tests.md`, `configuration.md`,
    `harness.md`, the README rows.
15. The fixture: an `init --yes` smoke in `scripts/fixture.js`, and the
    reporter in this repository's device CI job.

## Verification

Per the repository's rule: unit tests for what is logic, runs for the rest.

| What | Proved by |
| --- | --- |
| Detection, templates, the init plan and diffs | unit tests under the 100% gate; `src/cli/detect.ts`, `src/cli/templates.ts`, `src/cli/plan.ts` join the coverage `include` list |
| `init` end to end | `scripts/fixture.js` gains a step: copy the fixture without its config to a scratch folder, run `npx expo-vitest init --yes` there, then run `vitest run`. It proves the generated config works installed, which is the only place that can |
| The summary and the comment logic | unit tests with recorded test data and a fake `fetch`: existing comment found and updated, none found and created, 403 and silence, truncation at the cap; `src/reporter/render.ts`, `src/reporter/github.ts`, `src/reporter/context.ts` join the list |
| The comment, live | this repository's CI runs the fixture's web device suite from Phase 2 with `github()` configured, so every pull request here shows the comment and a rerun updates it |
| Video | the fixture's web device suite runs once with `HARNESS_VIDEO=retain-on-failure` and a deliberately failing test, and asserts a `video.webm` landed in its evidence folder; devices by hand on a phone and a simulator |
| CDP and browser choice | unit tests for the option resolution; by hand against a Chromium started with `--remote-debugging-port` and against Firefox and WebKit installed by Playwright |
| Hosted devices | by hand against a Limrun Android instance with the documented recipe; the docs page records the agent-device version it was run with |
| Pools | unit tests for the claim algorithm over a fake lock folder and a fake opener that fails with `DEVICE_IN_USE`; by hand with two Android emulators, checking two files run at once and no device is opened twice |
| `device.web` | the fixture's web device suite exercises `route`, `onDialog`, `evaluate`, `setViewport` and `frame` on its static page; a native run asserts each answers `'skipped'` |
| The skill | `guide` prints it in the fixture copy; Claude Code loads it from `.claude/skills/expo-vitest/` and `/expo-vitest` appears in the menu, checked by hand |

Every CI YAML in `docs/ci.md` is run once on a sample app before the page
ships, and the page names the runner images and versions it ran on.

## Docs

- `docs/ci.md`: new. Sections: what each platform needs in CI; GitHub Actions
  with the four jobs above; EAS Workflows; Bitrise; Codemagic; uploading
  `.harness/`; the summary reporter and the pull request comment, with the
  permissions block; caching Playwright's browsers and `~/.agent-device`;
  shards and reruns through Vitest's own `--shard` and `--retry`.
- `docs/migrating.md`: new. The four tables and one paragraph each on what
  differs by design.
- `docs/performance.md`: new. `bench`, the baselines, the per-phase numbers.
- `docs/evidence.md`: new. The results folder, `trace.md`, screenshots, video,
  the summary file, what to commit.
- `docs/coding-agents.md`: new. `init`'s agent files, the skill's topics,
  `guide`, and a pointer to Phase 6's MCP page when it exists.
- `docs/locators.md`, `docs/matchers.md`, `docs/controls.md`: `device-tests.md`
  split by topic; `device-tests.md` stays as the overview with the setup, the
  running section and the links.
- `docs/configuration.md`: `reporters`, `video`, `devices`, `workers`,
  `device: {provider}`.
- `docs/harness.md`: the `init`, `guide` and `bench` commands, `--browser`,
  `--cdp`.
- `docs/getting-started.md`: `npx expo-vitest init` as the first option in
  the install section, the manual steps kept below it.
- `README.md`: the quick start opens with `init`; feature rows for the
  reporter, video, hosted devices and pools.

## Risks and fallbacks

- **Vitest's reporter and project APIs move.** The hooks and `TestCase`
  fields used here are documented for Vitest 4 and still present in 5, but the
  reporter is written against the minimum: `onInit`, `onTestCaseResult`,
  `onTestRunEnd`, `result()`, `diagnostic()`, `annotations()`. Whether
  `maxWorkers` and `fileParallelism` can be set per project in Vitest 4 is
  checked when item 12 starts; the design sets them at the device config's
  root, which is allowed either way.
- **A fork's token cannot comment.** By design. The job summary carries the
  same text, and the reporter says in one line why nothing was posted.
- **Per-test video on web costs a page per test.** Default `off`; the docs
  say the cost. A per-file mode is a one-line option if a user asks.
- **`init` edits user files.** Only `package.json` scripts, `.gitignore` and a
  strict-JSON `tsconfig.json`, each additive and shown first. Anything else is
  printed, not written.
- **agent-device's claims and `connect` are 0.21.x behaviour.** The pool keeps
  its own lock files as the first line, so a change in agent-device's claim
  semantics degrades to the lock files, not to two files on one device. The
  version the recipes ran on is written into the docs page.
- **The skill goes stale.** `metadata.version` and `init`'s refresh offer; a
  line in the upgrade notes.
- **A GitHub comment cap or API version changes.** The cap and the version
  header are constants with a test each, and the reporter treats any non-2xx as
  "say why and continue".
- **A Windows CI job is slow to build.** The page shows the build as its own
  job and the test job consuming the artifact, which is how expo-windows's own
  CI will be set up before the page claims it works.

## Exit criteria

- A new Expo SDK 57 app with no tests goes from `npx expo-vitest init`,
  answering Enter to every question, to a green `npm test` and a green
  `npm run test:device` on web, with no other step.
- Rerunning `init` changes nothing and says so per file.
- A pull request on this repository shows one reporter comment with the
  fixture's device results, and a rerun updates that comment rather than
  adding one.
- `HARNESS_VIDEO=retain-on-failure` leaves `video.webm` beside the screenshot
  of a failing web test and nothing beside a passing one; the same on Android
  with `video.mp4`; Windows answers `skipped` with its reason.
- `HARNESS_BROWSER=webkit` runs the fixture's web device suite; `HARNESS_CDP`
  runs it against a Chromium the test did not launch.
- Two Android emulators in `devices` run two files at the same time, and
  agent-device's `device status` never shows one device claimed by two
  sessions.
- The four GitHub Actions jobs in `docs/ci.md` have each run green once on a
  sample app, and the page names the images they ran on.
- `docs/migrating.md` has at least every row e2e's Detox and Maestro guides
  have, plus the Playwright and e2e tables.

## References

- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code MCP configuration: https://code.claude.com/docs/en/mcp
- Cursor MCP configuration: https://cursor.com/docs/context/mcp
- Vitest reporters: https://vitest.dev/guide/reporters, https://vitest.dev/advanced/api/reporters, https://vitest.dev/advanced/api/test-case
- Vitest projects: https://vitest.dev/guide/projects
- GitHub REST, issue comments: https://docs.github.com/en/rest/issues/comments
- GitHub Actions variables: https://docs.github.com/en/actions/reference/workflows-and-actions/variables
- GitHub Actions job summaries: https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/adding-a-job-summary
- GitHub Actions token permissions: https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
- Playwright videos, browsers, `connectOverCDP`, `Video`: https://playwright.dev/docs/videos, https://playwright.dev/docs/browsers, https://playwright.dev/docs/api/class-browsertype, https://playwright.dev/docs/api/class-video, https://playwright.dev/docs/api/class-browsercontext
- agent-device sessions, device clouds, Limrun, commands, client API: https://oss.callstack.com/agent-device/docs/sessions, https://oss.callstack.com/agent-device/docs/device-clouds, https://oss.callstack.com/agent-device/docs/limrun, https://oss.callstack.com/agent-device/docs/commands, https://oss.callstack.com/agent-device/docs/client-api
- agent-device's EAS Workflows template: https://github.com/callstackincubator/eas-agent-device/blob/main/.eas/workflows/agent-qa-mobile.yml
- Android emulator action: https://github.com/ReactiveCircus/android-emulator-runner
- macOS runner image: https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md
- react-native-windows build requirements: https://microsoft.github.io/react-native-windows/docs/rnw-dependencies
- e2e: https://e2e.tester.army/docs/quickstart, https://e2e.tester.army/docs/coding-agents, https://e2e.tester.army/docs/github, https://e2e.tester.army/docs/ci, https://e2e.tester.army/docs/ci/github-actions, https://e2e.tester.army/docs/ci/eas-workflows, https://e2e.tester.army/docs/ci/bitrise, https://e2e.tester.army/docs/ci/codemagic, https://e2e.tester.army/docs/browser, https://e2e.tester.army/docs/migrate/detox, https://e2e.tester.army/docs/migrate/maestro, https://e2e.tester.army/docs/migrate/playwright

# Evidence

[Docs home](README.md) · [Device tests](device-tests.md) · [Matchers](matchers.md)

A device test that fails leaves what a person needs to see what went wrong:
the screen when it failed, the tree, and a trace of the steps it took, with
what each did to the screen. Nothing is to set up: the device project's setup
file records the steps and writes the evidence. A [recording](#video) of the
screen through the test is one setting away.

```
evidence: .harness/results/web/device/settings/opens-the-profile-form-3f9a1c/trace.md
```

## Where it goes

`.harness/results/<platform>/<test file>/<test>/`, under the project root:

| File | What it holds |
| --- | --- |
| `screenshot.png` | The screen when the test ended. |
| `tree.txt` | The tree then, as `expo-harness tree` prints it. |
| `tree.json` | The same tree as JSON. |
| `trace.md` | The test, its failure, its steps and the screen at the end. |
| `video.webm` or `video.mp4` | The screen through the test, where [video](#video) is on. |
| `agent-1.png` and on | The screen after an [agent's](agent.md) assertion, where one may be kept. |

The test file is its path from the project root without the extension, and
the test is its title, with the suites it sits in, made safe for a folder
name and given six characters of a hash, so two titles that clean up alike
never share a folder. A test's folder is replaced each time it is written to.

The trace, the screenshot and the recording are also recorded as a Vitest
artifact of type `expo-vitest:evidence`, with the files attached, which a
reporter sees in `onTestCaseArtifactRecord`, and their paths are on the
task's `meta.evidence`. Vitest keeps a copy of each file it is handed that
way, and the device config has it keep them in `.harness/attachments/`.

## The run's summary

The [summary reporters](ci.md#the-summary-and-the-pull-request-comment)
gather a run's failures on one page: `.harness/summary.md`, the job's
summary, and a comment on the pull request. Each failing test is a row with
its error and links to its screenshot, tree, trace and recording.

## What to commit

Nothing under `.harness/`: the results, the summary, the downloads, Vitest's
copies of the evidence, the [AI trace](agent.md#debugging-and-cost), and what the harness keeps for
itself between runs, such as a pool's locks and the desk's quiet on Windows.
`init` adds it to `.gitignore`. The one exception is the agent's replay
cache, `.harness/cache/`, which a team commits on purpose to share
[replays](agent.md#the-cache). A screenshot
baseline is committed, in `device/__screenshots__/<platform>/`, and only from
the machine that asserts it, since [a baseline belongs to the machine that
drew it](matchers.md#tomatchscreenshot).

## The trace

```markdown
# settings › opens the profile form

web · device/settings.test.ts · failed after 6.4 s · 2026-10-13T06:24:00Z

expected getByLabelText("Email address") to be visible within 5.0 s
  read 13 times; it was gone for 5.0 s
  no node matched; names like it: "E-mail address"

## Steps

| # | at | step | took | result | screen after |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.00 s | open / | 812 ms | ok | 38 nodes |
| 2 | 0.84 s | press getByRole("button", {name: "Settings"}) → @e7   button "Settings" #settings  at 24,612 | 96 ms | ok | +4 −1: appeared heading "Settings", textbox "name", textbox "email", button "save"; gone button "settings"; focus nowhere → textbox "name" |
| 3 | 0.95 s | assert expect(getByLabelText("Email address")) to be visible | 5.0 s | failed: not so within 5.0 s | polled 13 times, unchanged |

## Screen at failure

41 nodes, 6 interactive. Full tree in tree.txt, JSON in tree.json.
```

Each step is a press, a fill or another action, an `open`, a snapshot or a
screenshot the test took, a wait, or an assertion. A locator's step shows the
query as it was written and the node it came to. The screen after a step is
what changed from the step before: the nodes that came and went, by what
they are and their testID or name, and where the focus moved. It comes from
the trees the test read anyway, so recording costs no snapshot of its own.

A `verified` step follows an assertion or a wait that ended well, and names
the action before it, which it shows took effect.

Where the [React tree](device-tests.md#the-react-tree) can be read, the tree
at the end names the component behind each node, and a `## Component` part
names the one behind the node the failing step was for, with the end of the
chain of components above it:

```markdown
## Component

@e32 link "Settings" is drawn by TabLink:

    … › WebTabList › View › TabTrigger › Slot.Slot › TabLink › Pressable › View
```

A `## Console` part lists what the app wrote to its console during the
test, and the errors it did not catch, on web, the last fifty lines.

An [agent's](agent.md) steps each leave a line among the steps, its actions
before it, and a section of their own in an `## Agent` part: what the step
was, which agent ran it, how it ended and what it cost, and its last turns.

## Secrets

Where the harness config has [secrets](agent.md#secrets), every value is
hidden as `<secret:NAME>` in `trace.md`, `tree.txt` and `tree.json`: a
secret typed into a field that shows what it holds is in the tree. After a
secret was filled, the test keeps no screenshot and no recording, and the
trace says why.

## When

| `HARNESS_TRACE` | Writes evidence for |
| --- | --- |
| `retain-on-failure` | A test that failed. The default. |
| `on` | Every test that used the device. |
| `off` | None. |

The evidence is written after the test file's own `afterEach`. A test that
closes the driver there leaves no screenshot, and the trace says so, with
the last tree the test read. There is nothing to close: the device closes
by itself when its file ends, after the file's own hooks.

## Video

`video` in the [harness config](configuration.md#harnessconfigts), or
`HARNESS_VIDEO` over it, records the screen through each device test and
keeps the recording in the test's folder:

| `video` | Keeps a recording of |
| --- | --- |
| `retain-on-failure` | A test that failed. |
| `on` | Every test that used the device. |
| `off` | None. The default. |

Under either of the first two every test that uses the device is recorded,
since a test is known to fail only at its end, and a recording that is not
kept is thrown away. A recording starts at the test's first step, so a test
that never uses the device opens nothing and records nothing. Recording
changes nothing a test sees: each test starts where the one before it left
the app, as it does with video off.

| Platform | File | What records it |
| --- | --- | --- |
| Web | `video.webm` | Playwright's screencast of the page, at the page's size, from playwright-core 1.59 on. Playwright encodes it with its own build of ffmpeg, which `playwright install chromium` fetches with the browser. |
| Android, iOS | `video.mp4` | agent-device's recording of the whole screen, whichever app is on it. |
| Windows | none | Nothing: `device.can('video')` is false there, and the setting is passed over. |

On web a recording is of a page, and a test that replaces the page, with a
[restart or a clearState](controls.md), ends one part and starts the next:
the second is beside the first as `video-2.webm`, and so on.

A recording costs up to a quarter of a second a test on web, and about five
seconds a test on an Android emulator, most of it in ending the recording.
The [performance page](performance.md#video) has the measurements. A
recording that cannot start, such as on web where Playwright's ffmpeg is
missing, is said on the console once and in the trace's console part, and
the test goes on without one.

The same can be done by hand, with video off, for a part of a test:

```ts
await device.recordVideo();
await screen.getByRole('button', {name: 'Pay'}).press();
await device.saveVideo('.harness/pay.webm');
```

`recordVideo()` answers false where the platform records nothing.
`saveVideo(file)` ends the recording, keeps it at `file`, from the project
root, and answers where. The file is WebM on web and MP4 on a device,
whatever its name says. Without a file the recording is thrown away, and
the answer is null.

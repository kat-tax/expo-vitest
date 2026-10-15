# Evidence

[Docs home](README.md) · [Device tests](device-tests.md) · [Matchers](matchers.md)

A device test that fails leaves what a person needs to see what went wrong:
the screen when it failed, the tree, and a trace of the steps it took, with
what each did to the screen. Nothing is to set up: the device project's setup
file records the steps and writes the evidence.

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

The test file is its path from the project root without the extension, and
the test is its title, with the suites it sits in, made safe for a folder
name and given six characters of a hash, so two titles that clean up alike
never share a folder. A test's folder is replaced each time it runs.

The trace and the screenshot are also recorded as a Vitest artifact of type
`expo-vitest:evidence`, with the two files attached, which a reporter sees
in `onTestCaseArtifactRecord`, and their paths are on the task's
`meta.evidence`.

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

## When

| `HARNESS_TRACE` | Writes evidence for |
| --- | --- |
| `retain-on-failure` | A test that failed. The default. |
| `on` | Every test that used the device. |
| `off` | None. |

The evidence is written after the test file's own `afterEach`. A test that
closes the driver there leaves no screenshot, and the trace says so, with
the last tree the test read. Close it in `afterAll` instead:

```ts
afterAll(() => device.close());
```

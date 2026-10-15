# The harness

[Docs home](README.md)

Run an app on a platform, drive it, and look at what it drew. One command,
four platforms, the same steps everywhere.

Tests prove behaviour. The harness is how you see the thing itself, and it is
the only way to catch what only appears in a real renderer.

```sh
npx expo-harness doctor
```

```
what this machine can drive:

  yes  web      Chromium at chrome-headless-shell-win64
  no   windows  no app to drive: build one (`expo-windows run`) and pass --target <exe or process name>
  yes  android  1 device: 2B221FDH3S0HDK
  no   ios      the iOS simulator only runs on macOS

nothing here changes your machine; a "no" says what is missing.
```

## Setup

`expo-harness` comes with `expo-vitest`. What it drives with is optional, and
`doctor` says what is missing:

| Platform | Needs |
| --- | --- |
| web | `playwright-core` in the project, and a Chromium: `npx playwright install chromium` |
| windows | A Windows machine, and a built app |
| android, ios | `agent-device`: `npm install --global agent-device`, or in the project. The harness finds it in either, and in bun's global folder. |

Nothing is installed in the app itself.

## Usage

```sh
expo-harness doctor
expo-harness -p <platform> [options] <step>...
```

Steps run in order in one session, so a sequence is a flow rather than four
disconnected commands.

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

## Steps

| Step | What |
| --- | --- |
| `open <path or url>` | A route, as a deep link or a URL. |
| `tree` | The accessibility tree as indented text, as a screen reader reads it: names, roles, and what a platform adds past them, such as `(3 of 7)`, `h2`, `live:polite` and `help:"..."`. |
| `snapshot [file]` | The same tree as JSON, to stdout or a file. |
| `press <target>` | A press on what a ref or a selector names. |
| `tap <x> <y>` | A press at a point, in the window's own pixels from its top left, when nothing names the thing. |
| `fill <target> <text>` | Focus a field and put text in it. |
| `type <text>` | Into whatever has focus. |
| `screenshot <file>` | A PNG, under `.harness/` unless the path says otherwise. |
| `raise` | Bring the app to the front. Windows only. |
| `wait <ms>` | Let something settle. |
| `idle` | How long the machine has been quiet. |
| `bench [n]` | Time each operation `n` times, 20 by default. See [Timing a platform](#timing-a-platform). |

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
| `--scheme <scheme>` | The app's URI scheme, for deep links. |
| `--target <what>` | The device, simulator, exe or process to drive. |
| `--out <dir>` | Where screenshots go. `.harness` by default. |
| `-i`, `--interactive` | Snapshot only what can be acted on. |
| `--force` | On Windows, press, fill and type even when someone is using the machine. |
| `--iterations <n>` | How many times `bench` runs each operation. The same as `bench <n>`. |
| `--press <target>` | Something a press does nothing to, for `bench` to time `press` on. |
| `--field <target>` | A field for `bench` to time `fill` on. |
| `--json` | `bench` prints its result as JSON instead of a table. |
| `-h`, `--help` | The usage. |

Everything is relative to the project the command is run in, or to
`HARNESS_ROOT` when that is set.

## What each platform can do

| | web | windows | android | ios |
| --- | :-: | :-: | :-: | :-: |
| `open`, `screenshot` | yes | yes | yes | yes |
| `tree`, `snapshot` | yes | yes | yes | yes |
| `press`, `tap`, `fill`, `type` | yes | yes | yes | yes |
| `raise` | | yes | | |
| `bench` | yes | yes | yes | yes |
| Named keys, in [device tests](device-tests.md) | yes | yes | skipped | skipped |

A step a platform cannot do says so and is skipped rather than failed. The
same script then runs on all four and tells you what it could not do.

Windows fills the most of the tree: the help text, the position in a set, the
heading rank, live regions and status all come from UI Automation.

## Two things worth knowing

**Synthetic input goes to whatever is in front.** On Windows, if someone is
using the machine, a press meant for the app lands in their window instead and
nothing says so. So before `press`, `tap`, `fill` or `type` sends anything, the
Windows driver checks how long the machine has been quiet, and refuses if it
has been less than three minutes. A device test gets the same refusal.
Windows counts the harness's own input as use, so the driver does not count
what it sent itself: a second press is not refused because of the first.
Pass `--force` when you know the desk is free, or set `HARNESS_FORCE=1` for
a device test. A headless browser and a device are not the desktop, so the
check does not apply to them.

**A press on Windows goes through the control where it can.** A control that
implements Invoke, Toggle or SelectionItem is pressed through that UI
Automation pattern. That is not synthetic input, so it needs no window in
front and is not refused while someone is at the desk. The press stands only
when it shows. After a Toggle or a Select the control's state is read back,
and where it stayed as it was, the pointer presses it instead, with the check
above. react-native-windows leaves a view that way when the view declares no
accessibility action to answer the pattern. A field with a Value pattern is
filled by setting its text and reading it back, and a read-only one is
refused. In a device test, `press({via: 'pointer'})` and
`fill(text, {via: 'keys'})` ask for synthetic input instead.

**A screenshot does not raise the window.** Raising it would hide the flyout
or share sheet that is usually the thing being looked at. Use the `raise` step
when the app really does need to be in front, which is what synthetic input
needs.

On Windows the window draws its own picture, so another window over it on the
screen is not in it. While a menu or popup of the app's own is open over it,
the picture is what the screen shows instead, since a WinUI menu opens in a
window of its own, which the main window's picture would leave out. A window
that draws nothing is taken from the screen the same way. A minimized window
is refused, since it cannot be pictured without raising it.

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
bench on web (http://localhost:8083), 20 iterations, node 24.20.0, 2026-10-15T02:34:35Z

  operation         cold      p50      p95      min      max
  snapshot           6.6      2.1      5.3      1.6      7.0
  snapshot -i        1.9      1.8      2.2      1.6      2.2
  press              6.9      3.1      4.9      2.6      5.4
  fill         skipped: pass --field <target> to measure it
  screenshot        19.0     16.8     17.5     15.6     33.3
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
| `screenshot` | A PNG, deleted afterwards. |

`--press` has to name something a press does nothing to, since it is pressed
every time: a heading, or the tab that is already selected. Nothing in the
tree says what is safe to press. A container that responds to a press can
carry no role at all, so `bench` leaves the choice to you.

On Windows, `press` and `fill` wait for a quiet desk as the steps do, and ask
again before every call. While someone is using the machine they stop, with
that as the reason, and the rest is still timed.

Every run writes its result, every sample included, to
`.harness/bench/<platform>-<time>.json`, so a before and an after can be
compared. [Performance](performance.md) has the numbers for web, Windows and
Android on real apps.

## Getting an app to drive

| Platform | How |
| --- | --- |
| web | `npx expo start --web`, and pass its URL as `--url`. |
| windows | [`expo-windows run`](https://github.com/kat-tax/expo-windows) builds one. Point `--target` at the exe it leaves, or at a running process by name. |
| android | `npx expo run:android` onto a device or an emulator. |
| ios | `npx expo run:ios` into a simulator, on a Mac. |

Screenshots land in `.harness/`. Add it to `.gitignore`.

## Where each platform is driven from

| Platform | Driven by | Why |
| --- | --- | --- |
| windows | This package: the window manager, UI Automation and synthetic input, through one PowerShell process kept for the run, which reads the tree in one request, or an element at a time where UI Automation cannot read the cached tree back | `agent-device` has no Windows backend, and a react-native-windows app has no remote protocol. |
| web | A headless Chromium through `playwright-core` | A browser is already how the web build is tested. |
| ios, android | `agent-device`, through its Node client | It drives both, and installs its own runners without touching the app. A step is one request to its daemon; where the client cannot be loaded, the harness runs its command line instead. |

## On Windows, a flyout is not in the tree

The tree walks the descendants of the app's main window. A WinUI `MenuFlyout`
opens in a separate top-level window, so a menu plainly open on screen leaves
no trace in the tree. Look at menus with a screenshot on Windows. A tree that
says nothing happened is not evidence that nothing did.

## In Git Bash

Git Bash rewrites an argument that looks like an absolute POSIX path, so
`open /detail` would arrive as `C:/Program Files/Git/detail`. The harness
undoes that, so routes work as written.

## From Vitest

The same drivers back a test API, so a flow is a test rather than a shell
invocation. See [Device tests](device-tests.md).

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
| android, ios | `agent-device`: `npm install --global agent-device` |

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
| `--force` | Press even when someone is using the machine. |
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
| Named keys, in [device tests](device-tests.md) | yes | yes | skipped | skipped |

A step a platform cannot do says so and is skipped rather than failed. The
same script then runs on all four and tells you what it could not do.

Windows fills the most of the tree: the help text, the position in a set, the
heading rank, live regions and status all come from UI Automation.

## Two things worth knowing

**Synthetic input goes to whatever is in front.** On Windows, if someone is
using the machine, a press meant for the app lands in their window instead and
nothing says so. So `press`, `tap`, `fill` and `type` check first how long the
machine has been quiet, and refuse if it has been less than three minutes.
Pass `--force` when you know the desk is free. A headless browser and a device
are not the desktop, so the check does not apply to them.

**A screenshot does not raise the window.** Raising it would hide the flyout
or share sheet that is usually the thing being looked at. Use the `raise` step
when the app really does need to be in front, which is what synthetic input
needs.

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
| windows | This package: the window manager, UI Automation and synthetic input, through PowerShell | `agent-device` has no Windows backend, and a react-native-windows app has no remote protocol. |
| web | A headless Chromium through `playwright-core` | A browser is already how the web build is tested. |
| ios, android | `agent-device` | It drives both, and installs its own runners without touching the app. |

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

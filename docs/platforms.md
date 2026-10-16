# Platforms

[Docs home](README.md) · [Device tests](device-tests.md) · [The harness](harness.md)

Device tests and `expo-harness` drive the same four platforms with the same
steps. This page says, for each one, what a machine needs, how to get an app
up to drive, how the harness drives it, and what is worth knowing before a
test depends on it.

| Platform | Driven by | Needs |
| --- | --- | --- |
| web | `playwright-core`: a headless Chromium, its Firefox or WebKit, or a Chromium already running, over CDP | A browser `npx expo-harness install` fetched |
| windows | A host this package runs: UI Automation, and synthetic input where a control has no pattern | A Windows machine and a built app |
| android | [`agent-device`](https://www.npmjs.com/package/agent-device), through its Node client | An emulator or a phone over adb |
| ios | `agent-device`, through its Node client | A Mac and a simulator |

`playwright-core` and `agent-device` come with `expo-vitest`. Nothing is
installed in the app under test, and it needs no SDK and no rebuild. `npx expo-harness doctor` says what this machine can drive, and what
is missing:

```
what this machine can drive:

  yes  web      Chromium at chromium_headless_shell-1243
                chromium installed, chromium-1243, the one a run uses
                firefox  installed, firefox-1543
                webkit   not installed: run `npx expo-harness install webkit`
  no   windows  no app to drive: build one (`expo-windows run`) and pass --target <exe or process name>
  yes  android  1 device: emulator-5554
  no   ios      the iOS simulator only runs on macOS

nothing here changes your machine; a "no" says what is missing.
```

A step a platform has no counterpart for answers `'skipped'` rather than
failing, so one test runs on all four and says what it could not do.

## Web

### Setup

```sh
npx expo-harness install
```

That fetches the headless shell of Chromium, which a run launches, for the
playwright-core the harness loads. `npx expo-harness install chromium` fetches
the full browser, which a window to watch needs, and `firefox` or `webkit` the
others. A project that lists playwright-core itself has its own version
loaded, and this command fetches that version's builds.

Serve the app with `npx expo start --web`, or give the platform a
[command](configuration.md#the-command) in `harness.config.ts`, which starts
the dev server for the run and stops it after.

### The browser

The harness launches a headless Chromium. `HARNESS_BROWSER`, or `--browser`
for the command, picks `firefox` or `webkit` instead, and `HARNESS_CDP`, or
`--cdp`, drives a Chromium that is already running, at the endpoint of its
remote debugging.

```sh
expo-harness -p web --browser webkit open / tree
expo-harness -p web --cdp http://127.0.0.1:9222 open / tree
```

Firefox and WebKit are builds that work only with the `playwright-core` that
installed them, so fetch them with `npx expo-harness install webkit`, which
uses the one the harness loads. `doctor` lists each browser, installed or not,
and the one a run would use.

The tree, the steps, screenshots and video work in all three. What differs
is what a browser grants a page:

| | Chromium | WebKit | Firefox |
| --- | :-: | :-: | :-: |
| `clipboard`, `setClipboard` | yes | | |
| `camera`, `microphone` | yes | yes | |
| `motion` | yes | | |
| `notifications`, `location` | yes | yes | yes |

A browser refuses a whole context that names a permission it lacks, so a
permission in `app.web.permissions` the browser does not have is passed over,
and the run's first lines say which.

A browser at an endpoint is someone else's. The run opens contexts of its own
in it, so the browser's own tabs, cookies and profile are left alone, and the
end of the run leaves it running. `HARNESS_HEADED` and a browser named beside
the endpoint are passed over, since it has a window or not already. It must
reach the app's `url` from where it runs: a hosted browser does not see your
`localhost`. A Chromium takes `--remote-debugging-port=9222` with a
`--user-data-dir` of its own.

While one client of the browser is blocked, a page another opens does not
load. A test that runs `expo-harness` against the browser it is connected to
runs it without blocking, with `execFile` rather than `execFileSync`.

`HARNESS_HEADED=1` opens the browser in a window to watch, and
`HARNESS_SLOWMO=<ms>` slows each operation by that much. A window needs the
full Chromium rather than the headless shell, and `doctor` says when only the
shell is installed.

### What to know

- A snapshot is one evaluation in the page. A script in the page counts every
  change a snapshot could show, and while the count stands and nothing
  animates, a snapshot is the last one read, so an unchanged screen costs
  next to nothing.
- What a screen reader is told to pass over, under `aria-hidden="true"`, is
  not in the tree, as it is not on a device.
- A node keeps its ref for as long as it stays on the page, so a ref read
  earlier still presses it after the page changed around it.
- A press scrolls a node below the fold into view first, and refuses a node
  that something else covers, naming what is over it.
- `offscreen` is a node with no size, as Playwright counts what is visible,
  so a node below the fold is not off screen.
- [`device.web`](device-tests.md#deviceweb) has what a browser has and a
  device does not: routes, dialogs, cookies, downloads, a select, a file
  input, a right click and a frame.

## Windows

### Setup

A Windows machine and a built app. [`expo-windows
run`](https://github.com/kat-tax/expo-windows) builds one; point
`HARNESS_TARGET`, `app.windows.target` or `--target` at the exe it leaves, or
at a running process by name. An app that is not running is started by the
first `open` or `restart`, so `doctor` reports Windows ready once the exe is
known.

### How it is driven

One PowerShell process, kept for the run, compiles a small C# host once, and
the driver talks to it in JSON lines. The host reads and drives the app's
main window over UI Automation:

- **The tree** comes in one request for the whole window. Where UI
  Automation cannot read that cached tree back, as on some
  react-native-windows screens, the host walks the same tree an element at a
  time. A node keeps its ref for as long as its element lives.
- **A press** goes through the control's UI Automation pattern where it has
  one: Invoke, Toggle or SelectionItem. A pattern is not synthetic input, so
  it needs no window in front and no quiet desk. The press stands only when
  it shows: after a Toggle or a Select the control's state is read back, and
  where it stayed as it was, the pointer presses it instead.
  react-native-windows leaves a view that way when the view declares no
  accessibility action to answer the pattern.
- **A fill** sets a field's text through its Value pattern and reads it back.
  A read-only field is refused. A secure field reads back only a mask of its
  length, so one that holds text as long as the new text is emptied first.
- **A swipe** scrolls what scrolls under it through its Scroll pattern, by
  the share of what it can scroll that the distance is. Where nothing there
  has the pattern, as in react-native-windows, it turns the wheel, a notch
  for every 48 pixels.
- **Everything else** is synthetic input: the pointer and the keyboard. In a
  device test, `press({via: 'pointer'})` and `fill(text, {via: 'keys'})` ask
  for it in place of a pattern.

Windows fills the most of the tree: the help text, the position in a set, the
heading rank, live regions and status all come from UI Automation. The
placeholder is the one field it does not report.

### Synthetic input waits for a quiet desk

Synthetic input goes to whatever window is in front. If someone is using the
machine, a press meant for the app lands in their window and nothing says so.
So before the pointer or the keyboard is used, the driver checks how long the
machine has been quiet, and refuses if it has been less than three minutes.

- The harness's own input does not count as use, from one test file to the
  next too: what the guard has seen is kept in `.harness/windows-desk.json`.
- A click is sent only where the window at its point is the app's, and keys
  only while the app's window is in front, so neither lands in a window
  someone left open. The app is raised before any synthetic input.
- A window that reaches past the screen's work area, as one opened again and
  again at a step down and right of the last does, is moved inside it as far
  as it fits, keeping its size. A click at a point still off every screen is
  refused, since the pointer would stop at the edge and press whatever is
  there. A maximized window is left where it is.
- `HARNESS_FORCE=1`, or `--force` for the command, goes ahead without a quiet
  desk, as on a CI runner where no one is.

### Screenshots

A screenshot does not raise the window, since raising it would hide the
flyout or share sheet that is usually the thing being looked at. The window
draws its own picture, so another window over it is not in it. While a menu
or popup of the app's own is open over it, the picture is what the screen
shows instead, since a WinUI menu opens in a window of its own. A window that
draws nothing is taken from the screen the same way. A minimized window is
refused, since it cannot be pictured without raising it. The `raise` step of
`expo-harness` brings the app to the front when it has to be.

### What to know

- **A flyout is not in the tree.** The tree walks the descendants of the
  app's main window, and a WinUI `MenuFlyout` opens in a separate top-level
  window, so a menu plainly open on screen leaves no trace in it. Check menus
  with a screenshot. A tree that says nothing happened is not evidence that
  nothing did.
- **A switch and a toggle button are one control type**, with the Toggle
  pattern and no Invoke, and both read as `switch`.
- **A restarted window may not come to the front.** Windows lets a process in
  the background start a window, but not take the foreground from the one
  someone is using. `device.foregroundApp()` says what is in front.
- **The React tree** of a development build is joined to the native one by
  testID alone, since the walk finds no boxes there.
- **The screen of a CI runner** is 1024x768, smaller than most app windows.
  Set a larger one before the tests, as [CI](ci.md#github-actions) shows.
- **Git Bash** rewrites an argument that looks like an absolute POSIX path,
  so `open /detail` would arrive as `C:/Program Files/Git/detail`. The
  harness undoes that, so routes work as written.

## Android

### Setup

agent-device comes with expo-vitest, and the harness loads the project's own
where the project lists it. `HARNESS_AGENT_DEVICE` names an install
elsewhere. What the machine needs is an emulator or a phone that
`adb devices` lists, with the app installed:
`npx expo run:android`, or a release build with `adb install`. A development
build loads its JavaScript from a dev server, which the run can start for it:
[An Expo development build](controls.md#an-expo-development-build) has how.

Name the device with `HARNESS_TARGET`, or `app.android.device`, by the name
`agent-device devices` lists or its adb serial, such as `emulator-5554`.
With one device attached, that one is used.

### How it is driven

A step is one request to agent-device's daemon, through its Node client.
Where the client cannot be loaded, or `HARNESS_AGENT_DEVICE=cli` asks, the
harness runs agent-device's command line instead, which costs a process
start a step. The wait for the screen after a press or a fill is
agent-device's own, so a device that takes a second to read is not read
twice more.

The run's first call to agent-device starts its daemon and readies the
device, and is given three minutes; an `open` that boots a device and
installs agent-device's runner on it gets the same. Every other step has
30 seconds, or the harness config's `actionTimeout`.

### What to know

- **A node still moving is pressed where it comes to rest.** agent-device
  refuses a node that is still moving after a step that moved the screen, as
  a field does when it brings up the keyboard. A press, a long press or a
  fill then reads the screen again and acts on the node where it came to
  rest, up to twice more.
- **Compose names a button by its text.** A Compose button is a touch target
  around the label's text and a node with the button's role that cannot be
  pressed. The touch target is named by the text inside it, as TalkBack reads
  it, and takes the kind of the one control inside it. agent-device presses a
  ref only at a point that none of the node's controls covers; where there is
  none, as on a Compose button, the press goes to the node's middle.
- **A row not drawn yet is not in the tree.** `scrollIntoView` on a testID or
  a whole text or label has agent-device look for it as it scrolls, down and
  then up.
- **`selected` is on a selected node only**, since agent-device reports
  `false` on every Android node.
- **A long press on a row with no long press of its own** is taken as a press
  when the finger comes up.
- **Network** is Wi-Fi on or off, which leaves mobile data alone, and
  airplane mode needs Android 11.
- **Screenshots** are taken in demo mode, so the status bar is the same in
  every one, unless the harness config says `statusBar: 'real'`.
- **Driving from Windows with Volta.** When Node is started through Volta's
  `node` shim, a run that starts agent-device's daemon passes it a handle to
  the run's own output, which the daemon holds until it stops, about five
  minutes after its last request. Anything that reads the output to its end,
  such as a pipe or a CI log, waits that long after the tests have finished.
  Start the daemon first from outside the pipe, with any `agent-device`
  command, or run Node itself rather than the shim.

## iOS

### Setup

A Mac with Xcode, and a simulator with the app installed: `npx expo run:ios`, or a simulator build with `xcrun simctl
install`. Name the simulator with `HARNESS_TARGET` or `app.ios.device`, by
its name or its UDID.

### How it is driven

As on Android: one request a step to agent-device's daemon, which drives the
simulator through its own runner, with the same timeouts. The first call of a
run on a simulator just booted is the slowest by far, as the runner reaches
the app: [Performance](performance.md#ios) has the numbers.

### What to know

- **iOS asks before it opens a link in the app.** After an `open` or an
  `openLink`, iOS asks "Open in “App”?" and waits. The harness answers Open,
  as a person following the link does, for up to 10 seconds after the link.
- **Typing goes at a quick typist's pace**, 50 ms between characters. Typed
  any faster, a React Native field that keeps its text in state drops some.
- **An `accessible` container folds its children away.** Their testIDs and
  labels are not in the native tree. The [React
  tree](device-tests.md#the-react-tree) of a development build still has
  them.
- **Kinds.** A button in a tab bar or a segmented control is a `tab`. A
  node whose type the harness does not know, as a SwiftUI control read by its
  class, takes agent-device's own word for it.
- **Bounds are in points**, and are scaled to a screenshot's pixels for a
  clip, a mask or an element's picture.
- **Network and airplane mode** are skipped, since the simulator shares the
  Mac's network. **Biometrics** work on a simulator only.
- **Screenshots** have the simulator's status bar normalised, unless the
  harness config says `statusBar: 'real'`.
- **A development build is slow to come up.** Its first bundle can take a
  minute or more on a simulator, so give a suite that launches one a longer
  [`timeout`](configuration.md#deviceconfig).

## Hosted devices and pools

A device can be one a provider hosts, such as a Limrun, BrowserStack or AWS
Device Farm device, through agent-device's own connection to it. A platform's
test files can share a pool of devices, or of browsers on web. [Device
tests](device-tests.md#hosted-devices) has both.

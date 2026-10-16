# Roadmap

What is left to build, to check, or to report upstream, and what each item
waits on. A change that finishes an item takes it out of this file. What the
package does today is in the [README](README.md) and the [docs](docs/README.md).

## Waiting on hardware, an account or a key

### iOS, on a Mac

Every iOS feature is built. So far iOS has run in CI on a simulator, for the
test app's launch and onboarding and for the driver's timings. Still to run
on a simulator, and then on an iPhone:

- The locators, the matchers and the optional actions, recording each role's
  spelling and each `'skipped'` answer. A snapshot from a simulator, kept in
  `src/harness/lib/__fixtures__/`, would test the iOS role table, which maps
  XCUIElement type names that have not been read off a device yet.
- The app's life (`restart`, `clearState`, `back`, `home`, `installApp`,
  `openLink`, `foregroundApp`), the device's settings, gating, masked and
  element screenshots, and the normalised status bar.
- An Expo development build launched at the run's dev server, with no
  developer menu, onboarding sheet or floating button in its first
  screenshot. Then [Controls](docs/controls.md#an-expo-development-build)
  gets an iOS recipe beside Android's.
- Video, on a simulator and on a phone.
- The agent, the MCP server, `explore` and `bug-bash`.
- The bench a second time, and once through agent-device's command line, to
  compare with its Node client on the same simulator.
- The question iOS asks before it opens a link in the app can come later
  than the driver's 10 seconds on a run's first launch.

### The test app on iOS

The test app launches on a simulator and its onboarding passes, but it
cannot sign in. expo-interface's iOS `Button` in a form row reports the whole
row as its frame and takes a press only on what it draws, and a press goes
to the middle of the frame. The iOS job in `.github/workflows/testapp.yml`
is off (`if: false`) until the kit is fixed, and goes back on then.

### Hosted devices

Only the connection and its refusal without credentials have run. With an
account, run the Limrun recipe on [Device
tests](docs/device-tests.md#hosted-devices) and name the agent-device version
it ran with there, then BrowserStack and AWS Device Farm the same way, with
their flags through `device.options`.

### A live model

These wait on an API key, and the runs are billed.

- The agent's smoke, `fixture/device/agent.smoke.test.ts` under
  `HARNESS_AGENT_SMOKE=1`: one `act`, one `assert` with `vision`, one
  `waitFor` and one `extract`, with `claude-opus-5-5`, on web, Android and
  Windows. Then check that the provider's cache serves more than half of
  each request from the second turn on, that the cost line agrees with the
  price table, that a second run replays as `self-finalized`, and that
  `scripts/secret-grep.js` finds no secret in what the run left.
- The Claude adapter's first live calls: the server-side fallback, the
  nudge where a model takes no system message, a refusal, and each
  credential path (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and an
  `ant auth login` profile).
- `expo-harness explore` with a live model, and the cost it prints.

## Checks still to run

- **Android:** masked and element screenshots, and what `statusBar: 'fixed'`
  and `'real'` show, on an emulator that draws its screen; `setClipboard`;
  `fold` on a foldable; `installApp` with a real build; `bug-bash`.
- **Windows:** presses through Invoke and Toggle on a real app's buttons,
  switches and list items, with no `raise` while the keyboard is in use
  elsewhere; `installApp` of an `.msix`; `openLink`; a clipboard write; and
  whether a combo box opened through its pattern shows on the screen.
- **Web:** a fixture test that an unchanged screen is read once across a
  wait of ten polls.
- **Every platform:** that a backend that hangs fails a test with a 1 second
  timeout in under 2 seconds, which has been shown for agent-device only;
  three platforms in one run behind one Metro, which needs a Windows
  development build; and the device suites of expo-windows and
  expo-interface passing with no change to their tests.
- **CI recipes:** the EAS Workflows, Bitrise and Codemagic jobs on
  [CI](docs/ci.md) have not run, and the GitHub Actions jobs have run only
  as the test app's variants of them. Run each once on a sample app.

## Performance

- **Windows snapshots.** A snapshot of 94 nodes takes 242 ms at p50, where
  the aim is under 100 ms for 400 nodes. Most of it is the app's own UI
  Automation provider answering for every element, and on screens where the
  managed client cannot read its cache back, the host walks element by
  element, about 360 ms for 94 nodes. Time a screen of 400 nodes.
- **Windows presses.** Time a press through a pattern, with no `raise`, on
  an idle desk or with `--force`, and put the numbers on
  [Performance](docs/performance.md).
- **Web presses.** The check of where a press lands adds about half a
  millisecond to a press of about two. Make it cheaper.
- **The bench.** Add a `settle` operation, time `fill` on every platform,
  and run the bench again on every platform after a change to a driver.

## Not built yet

### Steps and controls

- What [Migrating](docs/migrating.md) marks "not yet": a double tap and a
  multi tap, a double click, a pinch, a drag, a picker column's value, ending
  the app, a shake, a second app in one test, the system keys (lock, power,
  volume, a TV remote), clearing the keychain, adding media, a route of
  locations, `getByAltText` and `getByTitle`, `storageState`, `test.step`,
  and JUnit `properties`.
- Named keys on iOS and Android, which answer `'skipped'`.
- A swipe and a wheel on Windows. Without them the agent offers no `scroll`
  or `scroll_to` there.
- A menu flyout in the Windows tree, by reading the app's other top-level
  windows. Two of the test app's tests are skipped on Windows for it.
- A swipe in a unit test, and a hover on iOS, Android and Windows there.
  Nothing is laid out in a unit test, so a swipe has no distance to draw.
- Quiet unit tests of an Expo Router app on Windows. There Expo Router takes
  the branches it takes off iOS and Android, which load packages through
  Node that also ship an ESM build, and vitest-native warns of each, as
  `'nanoid' resolves to two different files`. The test passes; the warnings
  are noise to stop, by having the engine load those packages one way.

### The agent and the MCP server

- `init --agent`, which would ask for the model provider and write the
  agent's entry in `harness.config.ts`. Today it says it is not there yet.
- More tools: `hover_at`, `type_at`, `press_at`, `select_at`, `double_tap`,
  `right_click`, `hover`, `select`, `drag`, `upload`, `home`,
  `start_recording` and `stop_recording`, and on a device `open_app` and
  `alert`.
- Progress notifications on a long MCP call. A cancellation now drops the
  answer of the call in flight, and the call still finishes.
- More than one MCP session at a time on Windows, Android and iOS, where a
  session's driver names no device. A pool could give each its own.
- `bug-bash` taking a device for each charter from a pool. On Android and
  iOS its charters run one at a time.
- Only the newest screenshots in the model's history. Each image stays,
  since editing a turn already sent breaks the thinking these models keep.
- The model options `maxInputTokens` and `providerOptions`.
- A network allowlist in CI, to show that the agent reaches nothing but the
  model and the app.

### Evidence and the React tree

- The file and line of the component behind a failed press. React 19 has no
  `_debugSource`; Metro's `/symbolicate` may give it from a stack.
- The app's console on a device, as web has it. It needs a connection held
  open with `Runtime.enable`.
- `identity` keying screenshot baselines, as it keys the replay cache.
- `statusBar` and `screenshot:element` in `device.capabilities`.

### The run

- Platforms side by side in one run. Vitest holds one file at a time for
  the whole run, so the platforms take turns; separate runs go side by side.
- This repository's unit tests, and a compile of the Windows host, on a
  Windows runner on every push. Today only the test app's Windows job
  compiles the host, on pull requests.

### Open questions

- Whether agent-device's `type` takes `--settle`, so typing waits for the
  screen as a press and a fill do.
- Which React Native release first says its app takes more than one
  debugger (0.86.3 does), and two checks of the React tree: that a
  developer's React Native DevTools stay connected while the harness reads
  it, and that an app that takes one debugger is refused with its reason.
- Why an MCP `open_session` on an Android emulator once took more than three
  minutes. It has not happened again.
- On Android, `scrollIntoView` looks for a row by agent-device's own labels,
  so a button the tree names from the text inside it is looked for by that
  text.

## Drivers to try again

- **agent-desktop's Windows adapter**, once its pull request #110 ships. Try
  it on a react-native-windows app, and offer it what it lacks for React
  Native: a pointer step after an Invoke, and a read back after a click.
- **argent** as a second mobile backend, once argent #1085, about its
  Windows console windows, is fixed.
- **A live trial** of Cua Driver, agent-desktop's Windows branch, Terminator
  and argent on a react-native-windows tab. Each changes the machine it is
  installed on (its PATH, a logon task, telemetry, a Rust build, global
  installs, an APK), so each waits for the owner's go-ahead.
- Whether UI Automation's `LegacyIAccessible.DoDefaultAction` does anything
  on a react-native-windows view with no Invoke.

## To report upstream

Filing an issue waits on the owner.

- **expo-interface 0.32.** Most of these have a test marked failing in
  `testapp/device/`, which fails the run once the kit is fixed, so its mark
  comes off then. The marks stand at 2 of 31 tests on web, 9 on Android and
  1 on Windows.
  - Web: a row with a menu of its own and a press is no button: it has no
    role and takes no focus.
  - Web: choosing an item in a row's menu presses the row as well.
  - Android: a `List` throws "The specified child already has a parent" as
    its rows change.
  - Android: a `TextField` is named by its placeholder alone, which goes
    once the field holds text.
  - Android: a `Switch`, `Checkbox` and `Slider` draw their label beside the
    control, so nothing names them, and a checkbox's label cannot be
    pressed.
  - Android: a `Picker` draws nothing to press.
  - Android: a `Chip` in React Native layout throws "must be rendered inside
    a Host". The test app wraps it in `NativeHost`, and no test is marked.
  - Windows: a `Switch` has no name.
  - iOS: a `TextField` is named by its placeholder alone, which iOS does not
    count as a name.
  - iOS: a `Button` in a form row reports the whole row as its frame, so a
    press at its middle misses Sign in, Create an account and a checkbox's
    row. The test app's iOS job is off for it.
  - iOS: a `Checkbox` is a button that reads as selected while it is on,
    with no checkbox role. The test app's helpers allow for it.
- **React Native 0.86.3.** An Android development build, on Expo SDK 57's
  development client, dies about one launch in thirty as it first draws:
  SIGSEGV, "trying to execute non-executable memory", on `mqt_v_js`, in
  Fabric's mounting in `libreactnative.so`. The create-expo-app template's
  home screen dies the same way. The test app relaunches once when it does.
- **react-native-windows 0.84.** A long-running app loses most of its tree
  until it is restarted. It reports no placeholder. Its page takes one
  debugger only. The WinUI pager names its dots "Page 1" and marks none
  selected. On an ordinary view, Toggle, Select and SetValue do nothing
  while UI Automation reports success. There is no release for React Native
  0.86 yet, so the test app's Windows build is on 0.84.
- **expo-windows.** Its debug build asks Metro for the bundle without
  `transform.routerRoot`, so an app whose routes are in `src/app` shows
  Expo Router's empty screen.
- **.NET's managed UI Automation client.** `CacheHelper.ParseTreeDescription`
  throws `IndexOutOfRangeException` reading a cached tree on some
  react-native-windows screens.
- **agent-device**, candidates the drivers work around:
  - `apps.open({url})` alone opens nothing and fails nothing;
  - every Android node reports `selected: false`;
  - `fold` is listed for a phone that does not fold;
  - its daemon keeps the folder it was started in for minutes, so the
    folder cannot be deleted;
  - with no `--device` it picks an emulator image that is not booted over a
    phone on adb;
  - its Node client has no `connect`;
  - adb's server can wedge after its runs;
  - an idea: adb's server protocol over its socket, in place of a process a
    call.

## Not planned

- **Other vendors' subscription sign-in**, such as ChatGPT or Copilot. It is
  OAuth plumbing for each vendor, and the `Model` interface takes any token.
  Claude's sign-in comes through its SDK's own credential chain.
- **Adapters for other model vendors** in the package. A model is an object
  with a `complete` method.
- **A decision-model package.** It would depend on one vendor's probability
  API. The executor slot accepts one.
- **Packages for hosted providers.** Browsers are reached over CDP, and
  devices through agent-device's own `connect`.
- **Telemetry, or a second test runner.** The packages that come with
  expo-vitest are the ones its tests run on: no Zod, no MCP SDK and no image
  library.
- **A maintained driver in place of ours.** None tried could press a
  react-native-windows view, or did better on web or mobile. agent-desktop's
  Windows adapter is the one to try again, above.
- **A compiled UIA3 host.** Its COM client read faster, but returned part of
  a tree with no error, where the managed client throws and the host walks.
- **Video on Windows.** There is no screen recorder without a dependency.
- **A breaking change** before a major version: renaming `role`, making
  `element` strict, or changing a default timeout.

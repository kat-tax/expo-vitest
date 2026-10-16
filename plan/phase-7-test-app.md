# Phase 7. The test app

Status: in progress. The app and its suite are built and run from the packed package: on web every test passes but the two expo-interface bugs mark; on the Android emulator two full runs each passed 19 tests and failed the 8 marked ones as marked, and each lost one test, a different one each time, when the app left for the home screen as the emulator stopped answering adb. An explore and the MCP server drove it on web. Open: Windows, which needs the .NET SDK and PowerShell 7 this machine lacks, and iOS (no Mac) · Size: L · Depends on: Phase 3, Phase 4, Phase 6 · Unblocks: the Windows checks the earlier phases left open

One app, kept in this repository, that behaves like a typical product app on
iOS, Android, web and Windows, so that the device layer, the agent, explore,
bug bash and the MCP server all run against the same real screens, and
expo-interface and expo-windows can build it too. It is fresh code, shaped
like a common app: Entz was read for how it uses the libraries and lays out
its screens, and nothing of it is copied.

## As built

On the `e2e` branch. Where the build differs from the design below, the
build is what holds.

- **Items 1 to 9.** `testapp/` as the routes table says, but for the notes:
  a row's favourite, archive and delete are the row's own menu
  (`ListItem`'s `swipeActions`), not an `IconToggle` in the row, which on
  web is a button inside a button whose press opened the note too. The filter
  chips sit in a `NativeHost`. The suite is 28 tests in 9 files in
  `testapp/device/`, over helpers for a first launch, a relaunch, a
  signed-in start, a row's own action, a menu item, an alert, a tab, the
  search field and a text field. `bun run test:testapp` copies the app
  outside this folder, installs it from its lockfile, unpacks the packed
  package into it, type-checks it and runs the suite.
- **Web.** 26 tests pass, and the two that choose from a row's menu fail as
  marked, from the packed package in Chromium.
- **Android.** A development build (`expo-dev-client`) made with
  `expo prebuild` and Gradle in `testapp/android/`, which is not kept, and
  installed on the Pixel_9_Pro_XL emulator. The suite runs with
  `TESTAPP_PLATFORMS=android HARNESS_TARGET=emulator-5554
  HARNESS_METRO=http://localhost:41752` after `adb reverse tcp:41752
  tcp:41752`, and each first launch opens the app through its
  `exp+testapp` link to that server. At the AVD's 2 GB the emulator
  stopped answering adb part of the way through a run; started with
  `-memory 4096`, it lasts most of one. Two full runs on it each passed 19
  tests and failed the 8 marked ones as marked, and each lost one test, a
  different one each time, when the app left for the home screen as the
  emulator stopped answering adb.
- **What the suite found in the harness, and fixed**, a commit each: an
  option a select lacks fails at once with the options it has; Vitest's
  copies of the evidence go under `.harness/attachments/`; the web tree
  leaves out what is under `aria-hidden` and keeps text that is not drawn out
  of a name; `HARNESS_TARGET` takes a device's id, its adb serial or UDID;
  Android's tree is read as TalkBack reads it where Compose splits a control
  in two; a press goes to a Compose button's middle where agent-device finds
  no point of its own; an Android field whose testID or name says search is a
  search box; a wait reads again after a read that fails.
- **What it found in the app, and fixed.** The search row sat under the web
  tab bar (`underBar` with content that does not pad itself), and a note's
  editor under the header (`native header`, now `native underBar`).
- **What it found in expo-interface 0.32, to report there.** Each but the
  chip's has a test marked failing on the platform, which fails the run once
  the kit is fixed; the chips sit in a `NativeHost` instead.
  - Web: a row with a menu of its own and a press is no button: no role and no
    focus, so a keyboard or a screen reader cannot open it.
  - Web: choosing an item in a row's menu presses the row as well, the item's
    click bubbling to the row's wrapper.
  - Android: a `Chip` in React Native layout throws "must be rendered inside a
    Host", where `Button` hosts itself.
  - Android: a `List` throws as its rows change, as a search or a filter
    narrows them: "The specified child already has a parent", from Compose's
    `AndroidViewHolder`.
  - Android: a `TextField` is named by its placeholder alone, so a field
    that holds text has no name.
  - Android: a `Switch`, a `Checkbox` and a `Slider` have their label
    beside the control rather than on it, so nothing names them, and a
    checkbox's label cannot be pressed. The `Picker` draws nothing to press.
- **The agent.** The harness config gives the agent a model of rules,
  `testapp/device/rules.mts`, which explores a sign-in with a wrong
  password. `expo-harness explore` on web took 7 model calls, reported
  nothing and concluded that the app said the password was wrong; the model
  waits two seconds before its look after the press, as a real model's answer
  would take, since the pretend server answers after 700 ms. A scripted MCP
  client over `expo-harness mcp` on web opened a session on the
  onboarding, tapped Skip, read the sign-in form and closed the session.
- **Where the platforms differ, which the tests say rather than hide.** On
  Android a chip is a checkbox where web draws a pressed button, a menu's
  items and the tab bar's tabs have no role, an alert is a window of its own
  that nothing marks a dialog, a screen's title is no heading, and
  `setNetwork` leaves an emulator on mobile data, so the offline test takes
  airplane mode there.
- **Open.** Windows: expo-windows' `ci/build.sh` stops at `expo-windows
  init`, since the react-native-windows CLI loads its commands through the
  .NET SDK and PowerShell 7, and this machine has neither. iOS needs a Mac.
  An explore and the MCP server on Android. On Android a
  scroll looks for a row by agent-device's own labels, so a button named by
  the tree's reading of its text is scrolled to by that text.

## Purpose and the claims it proves

- **The scenarios every app has.** Onboarding, sign-in and sign-up forms with
  validation, a forgotten password, a list with search, filters and
  favourites, a detail with an editor and unsaved changes, settings with
  every kind of control, confirmations, menus, toasts, an offline state and
  deep links. Each is a device test here, and each is a place for an explore
  charter.
- **Four platforms from one source.** iOS, Android and web on Expo SDK 57 and
  React Native 0.86. Windows through expo-windows, whose `ci/build.sh` copies
  an app's `src`, `assets`, `app.json` and `tsconfig.json` onto the
  react-native-windows 0.84 line, as expo-interface builds its example.
- **Accessible by construction.** Every control has an accessible name, a role
  and its state, and a `testID` where a test needs one, so the tree the
  harness reads is the assertion.
- **Nothing private, no backend.** The account is a demo one written in the
  app, the data is seeded on first launch, and nothing leaves the device.
- **What it finds is reported, not worked round.** A bug the suite finds in
  the app is fixed in the app; one in a library it uses is reported to that
  library, and the test that shows it is marked as failing on the platform
  until the library is fixed.

## Today

The fixture is a library the size of one constant with three static pages.
It proves the package installed, not an app. The device runs that closed
Phases 2, 3 and 6 used a fresh `create-expo-app` in a scratch folder, and the
Windows checks found no app on this machine to drive but the owner's own.

## Design

### Where it lives

`testapp/`, beside `fixture/`, with its own manifest and lockfile. It is not
in the package's `files`. Like the fixture, its tests run on a copy outside
this folder with the packed package installed, so the app is a consumer as a
user's app is (`scripts/testapp.js`, `bun run test:testapp`).

### Libraries

Expo Router with `src/app`, expo-interface 0.32 for every control (its
`Screen`, `Stack`, `Tabs`, `FieldGroup` and controls), `@expo/ui`,
`@react-native-async-storage/async-storage` for the session and the
onboarding flag, and `expo-network` for the offline state. Each is one that
expo-windows lists as working on Windows.

### Routes

| Route | Scenario | Controls |
| --- | --- | --- |
| `/` | Redirects: to onboarding on a first launch, to sign-in without a session, else home | |
| `/onboarding` | Three pages with dots, Skip, Next and Get started; seen once | `Pager`, `Button` |
| `/sign-in` | Email and password, validation, a wrong password, a slow server, remember me | `TextField`, `Checkbox`, `Button` with `loading` |
| `/sign-up` | Name, email, password strength, confirmation, birth date, country, terms | `TextField`, `Progress`, `DateTimePicker`, `Picker`, `Checkbox` |
| `/forgot-password` | An email, then a confirmation | `TextField`, `Button` |
| `/(tabs)/notes` | Search, filters, each row's own menu to favourite, archive or delete it, an empty state, a new note | `SearchField`, `Chip`, `List`, `ListItem` with `swipeActions`, `Icon`, `EmptyState`, `Fab`, `Toast` |
| `/notes/[id]` | Read, edit, save with a toast, unsaved changes, a menu with delete | `TextField`, `Button`, `Toast`, `Menu`, `Alert` |
| `/(tabs)/settings` | Every control type, sign out, delete the account | `Switch`, `Checkbox`, `SegmentedControl`, `Picker`, `Slider`, `Stepper`, `DateTimePicker`, `ColorPicker`, `TextField`, `Button`, `Alert` |

The scheme is `testapp`, so `testapp://notes/3` opens a note.

### The demo account

`ada@example.com` with the password `testapp-demo-pass`, written in the app,
since it is a test app's. A wrong password says so after a moment, as a
server would. A test that needs a secret uses the agent's `secret()` with
the same value in its harness config.

## Work items

1. This plan, and a row in the README's table.
2. The scaffold: manifest, `app.json`, `tsconfig.json`, `metro.config.js`,
   `+html.tsx`, the root layout with `AccentProvider` and the kit's `Stack`,
   the lockfile.
3. The session and the data: the store, the seeded notes, the redirects.
4. Onboarding.
5. Sign in, sign up and the forgotten password.
6. The notes list, the detail and the editor.
7. Settings.
8. The offline banner.
9. The device suite in `testapp/device/`, its harness and device configs, and
   `scripts/testapp.js`.
10. By hand: the Android emulator with a development build, and Windows
    through expo-windows' `ci/build.sh`, its desk idle.
11. Docs: the test app in `docs/contributing.md`, and the README.

## Verification

- The device suite on web, from the packed package, on every check run.
- The same suite on the Android emulator with a development build, its dev
  server on a port of its own, and on Windows with the expo-windows build,
  run only while the desk is idle.
- An explore and the MCP server against it, with models of rules.

## Risks

- **Windows lags.** React Native 0.86 has no react-native-windows release, so
  Windows builds the app on the 0.84 line through expo-windows. A screen that
  uses something 0.84 lacks fails there first.
- **The kit is young.** expo-interface follows `@expo/ui`, which changes
  between minors. The app pins both.
- **Size.** The app brings Expo and React Native into this repository. They
  stay in `testapp/`, its own manifest and lockfile, out of the package.

## Exit criteria

- Every route above renders on web and Android, and on Windows through the
  expo-windows build.
- The device suite passes on web from the packed package, and on the Android
  emulator and Windows by hand.
- Phase 6's first exit criterion on Windows: a coding agent writes a passing
  device test for a flow in this app over the MCP server alone.

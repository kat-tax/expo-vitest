# Phase 7. The test app

Status: in progress · Size: L · Depends on: Phase 3, Phase 4, Phase 6 · Unblocks: the Windows checks the earlier phases left open

One app, kept in this repository, that behaves like a typical product app on
iOS, Android, web and Windows, so that the device layer, the agent, explore,
bug bash and the MCP server all run against the same real screens, and
expo-interface and expo-windows can build it too. It is fresh code, shaped
like a common app: Entz was read for how it uses the libraries and lays out
its screens, and nothing of it is copied.

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

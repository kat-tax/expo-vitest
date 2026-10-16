# Contributing

[Docs home](README.md)

## The repository

| Path | What |
| --- | --- |
| `src/projects.ts` | `expoProjects`, `nodeProject` and `deviceConfig`. |
| `src/forbid-modules.ts`, `src/windows-resolution.ts`, `src/metro-compat.ts` | The Vite plugins the projects are made of. |
| `src/setup/` | Each project's setup file. |
| `src/native.ts`, `src/windows.ts`, `src/router.tsx` | The helpers. |
| `src/device/` | The device test API and its matchers. |
| `src/harness/` | The drivers and the `expo-harness` command. |
| `fixture/` | A library the size of one constant, tested against the packed package. |
| `testapp/` | An Expo app of the usual kind, with a device suite, run against the packed package. |
| `scripts/` | The build, and the fixture and test app runs. |

`AGENTS.md` at the root has the conventions.

## Checks

```sh
bun install             # bun 1.4 or later
bun run lint            # oxlint, zero warnings
bun run typecheck
bun run test:coverage   # 100% on the files the gate names
bun run test:fixture    # the package, packed and installed
```

## The public surface

`src/device/contract.test.ts` pins what a consumer depends on: the members of
`device` and `element` and what each takes, the selector and tree shapes, the
four matchers, what `deviceConfig()` returns, the environment variables, the
`expo-harness` steps and options, and the messages a person reads most. An
addition passes it. A rename, a removal, a changed default or a changed
message fails it, and a changed type fails `bun run typecheck`, which checks
the tests too.

A failure there means the change would break someone. Edit the test only on
purpose, in the commit that makes the change, and say why in the message.

## It runs from source here, and from `dist` installed

The package runs from its TypeScript source in this repository, which Node
allows outside `node_modules`. Node will not strip types under `node_modules`,
so installed it has to be JavaScript. `prepack` compiles `src` to `dist`, and
the `exports` map points there.

Inside the package, a file is named through `file()` in `src/projects.ts`,
which answers the `.ts` from source and the `.js` when compiled.

## The fixture

`fixture/` is a library the size of one constant, with a file per platform and
one test for each rule a test file's name follows. Its manifest is what an app
that tests with `expo-vitest` has installed.

```sh
bun run test:fixture
```

This copies the fixture to a folder outside the package, installs it there
from `bun.lock`, packs the package as `npm publish` would, unpacks that into
the copy's `node_modules`, names it in the copy's manifest, and runs the tests
against it by name. Then it runs `fixture/device/`, device tests on web as an
app's device tests run: a project per platform, with the page they drive
served by the command `fixture/harness.config.ts` names. They touch the
queries, the actions, the matchers, the evidence, a screenshot and the
`expo-harness` command. Beside web is a platform the machine cannot drive,
whose tests are skipped with the driver's reason, and fail when the run
requires it. Web needs a Chromium in place:

```sh
bunx playwright-core install chromium --only-shell
```

`HARNESS_BROWSER=webkit` or `firefox` runs the device tests in that browser
instead, and `HARNESS_CDP` in a Chromium already running. The copy's own
`playwright-core` fetches the browser named, and the ffmpeg it records video
with, since it takes no build but its own.

Last, it takes the copy's configs and tests away, runs `init --yes` from the
packed package's command, and runs the component tests on what `init` wrote,
which proves that a project set up that way runs.

It is how the package is known to work installed, which its source cannot
say. Three things differ for an installed package:

- Node will not strip types under `node_modules`.
- Vitest leaves what is there out of its module graph unless told otherwise.
- The engine treats a dependency differently from the project it runs in. It
  compiles any dependency named `expo-*` as React Native source, which is why
  the projects exclude `expo-vitest` from that transform.

The fixture has to be copied out because the engine skips any package whose
folder contains the test run, taking it for the project itself. A fixture
inside the package folder is never treated as a consumer's dependency.

After changing `fixture/package.json`:

```sh
node scripts/fixture.js --update-lockfile
```

## The test app

`testapp/` is an app of the kind this package is for, on Expo Router and
expo-interface: onboarding, sign-in, sign-up and a forgotten password, notes
with a search, filters and each row's own menu, a note's editor that asks
before it throws an edit away, and settings with one of each kind of
control, a field checked as it changes, and actions behind a confirmation.
Its data stays on the device, seeded on the first launch, and it signs in
with a demo account written in the app: `ada@example.com`, password
`testapp-demo-pass`. `testapp/device/` is the suite an app would write
for it.

```sh
bun run test:testapp                                  # on web
TESTAPP_PLATFORMS=android,web bun run test:testapp    # and on a device
```

As with the fixture, the app is copied outside the package and installed
there from its own lockfile, with the packed package unpacked into its
`node_modules`. Web is served by Expo's dev server, which the run starts on a
port of its own.

On Android the suite drives the app's development build, which loads its
JavaScript from the dev server the run starts on port 41752, reached
through `adb reverse`:

```sh
cd testapp && npx expo prebuild --platform android --no-install
cd android && ./gradlew app:assembleDebug -PreactNativeArchitectures=x86_64
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 reverse tcp:41752 tcp:41752
cd ../.. && TESTAPP_PLATFORMS=android HARNESS_TARGET=emulator-5554 HARNESS_METRO=http://localhost:41752 bun run test:testapp
```

Each first launch opens the build through its `exp+testapp` link to that
server, so a dev server someone has on 8081 is never used, and
`HARNESS_METRO` keeps the React tree's reads on it too. A whole run needs an
emulator with 4 GB (`emulator -avd <name> -memory 4096`). The tests that
show expo-interface's Android bugs are marked failing there, as two are on
web.

Its harness config gives the agent a model of rules, `testapp/device/rules.mts`,
which explores a sign-in with a wrong password, so `expo-harness explore`
runs against the app with no key, as `expo-harness mcp` serves it to a
coding agent.

After changing `testapp/package.json`:

```sh
node scripts/testapp.js --update-lockfile
```

## CI

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` | Pushes to `master` and pull requests | Lint, typecheck, the tests with coverage, the fixture with its device tests on web. |
| `release.yml` | A `v*` tag matching `package.json` | Re-runs the checks, publishes to npm with provenance, creates a GitHub release. |

## Commits and writing

One change per commit, with a message that says why the change was needed and
what was verified. Plain sentences, no em dashes.

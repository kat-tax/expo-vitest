# Phase 3. App and device control

Status: in progress (items 1 to 12 done, and the start of 13) · Size: M · Depends on: Phase 0, Phase 1, Phase 2 · Unblocks: Phase 4, Phase 5

[Back to the index](README.md). The compatibility contract, the dependency
policy and the shared facts (README sections 3, 4 and 11) apply throughout and
are not repeated here.

## As built

On the `e2e` branch, after Phase 2. Where the build differs from the design
below, the build is what holds.

- **Item 1: the spike,** in a scratch consumer on Vitest 4.1.11 with three
  projects of two files each, every file taking 1.5 s.
  - **The loader:** a project's `globalSetup` imported a `.ts` file, with
    an interface and a type annotation, by a path worked out at run time,
    through Vitest's module runner, and `provide` carried what it read to
    the tests. Node's own `import()` is not needed.
  - **Parallel platforms:** not to be had this way.
    - With `fileParallelism: false` in each project, all six files ran one
      after another, so the setting holds for the whole run.
    - With `maxWorkers: 1` in each, the same.
    - With `maxWorkers: 1` in one project only, the other two ran together
      first, and that project's files ran one at a time after them.
    - With a `sequence.groupOrder` per project, each group ran its files
      one at a time and no two files overlapped, though not in the order
      the groups were given.
  - So the projects run one platform after another, each one file at a
    time, which is the plan's fallback. Platforms in parallel wait for
    Phase 4's pools, as separate runs.
- **Item 2: `src/device/config.ts`.**
  - `defineHarness`, `findHarnessFile`, `validate`, `serialisable`, and
    `resolveRun`, which is the design's `resolveApp` and resolves the waits
    as well as the app.
  - `loadHarness` takes the import from its caller, because only an
    `import()` written in a file the module runner loads goes through it.
  - `sameConfig` is the worker's hash check.
  - `validate` names the first key it does not take, with the keys it
    does, and the first value of the wrong kind. `agents`, `tools`,
    `secrets` and `cache` are refused by name until Phase 5.
  - `device` takes a name only; the pool and the hosted device wait for
    Phase 4.
  - Two more failures than the design names, both `INVALID_CONFIG`: a
    command whose arguments have `{port}` on a platform with no url, and
    a command with neither a `readyUrl` nor a url to tell it has started.
  - The environment applies to every platform in a run, so a value that
    differs by platform goes in the file.
  - `HarnessCode` gains `INVALID_CONFIG`. The docs gain its row with the
    file that throws it.
- **Item 3: the command, in `src/device/app-process.ts` and
  `src/device/global-setup.ts`.**
  - **No run-wide global setup.** The spike showed a root global setup
    runs after the projects' own, so each platform's global setup starts
    its command. They share a registry on the global object, since every
    project's setup runs in the one main process. The first platform to
    name a command starts it, and the last to finish stops it.
  - **Ready** is Playwright's rule for its web server: 2xx, 3xx, and 400 to
    403. The looks are 100 ms apart, doubling to 1 s. A command that ends
    before it answers fails at once, saying how it ended.
  - **Windows:** a `.cmd` or `.bat`, such as `npx`, goes through cmd.exe,
    since nothing else can run one. Each argument is escaped twice, because
    a batch file's `%*` has cmd read its arguments again. Seen live: an npm
    shim and a plain `.cmd` each received 15 awkward arguments intact, and
    `npx` ran.
  - A reused command reports no log. `HarnessCode` gains
    `APP_ALREADY_RUNNING`.
  - **Seen live,** in a scratch consumer where web and windows share a
    command through a `.cmd`, and its server starts a grandchild:
    - one start, and one pid for both platforms;
    - after the run, the server, the grandchild and the port were gone;
    - with a server already up, it was used, and left running;
    - with `CI` set, `APP_ALREADY_RUNNING`;
    - a command that never listened failed with `APP_UNREACHABLE` and the
      end of its log, and left nothing running;
    - a program not on `PATH` failed with `APP_UNREACHABLE` naming it.
  - **Not built:** a `SIGINT` handler. The teardown and an `exit` hook stop
    the command. A hard kill of Vitest leaves it running, and a local run
    then uses it.
- **Item 4: `deviceConfig` with `platforms`, `harness` and `root`.**
  - The root config holds only `test.projects`. Each project carries:
    - Vite's `root` and Vitest's;
    - the global setup;
    - `provide`;
    - `maxWorkers: 1` beside `fileParallelism: false`, as the single
      form has;
    - `server.deps.inline`;
    - `HARNESS_PLATFORM` in its environment, so the worker's `device` is
      on the project's platform whatever the shell says.
  - The platforms are taken once each, in the order given. One it does not
    know, or none, is `INVALID_ARGUMENT`, and so are `harness` or `root`
    without `platforms`.
  - The harness file is `harness`, else `HARNESS_CONFIG`, else the first
    at the root. The root is `root`, else `HARNESS_ROOT`, else the working
    directory.
  - **Seen live** in the scratch consumer, from source:
    - two projects, each worker on its own platform;
    - one command for both;
    - `--project device:web` ran that one alone.
- **Item 5: `src/device/setup.ts` and `src/device/warm-up.ts`.**
  - Each project has two global setups, the command's and then the
    warm-up, and two setup files, `setup.ts` and then the matchers. Vitest
    runs setup files side by side unless told otherwise, so the projects set
    `sequence.setupFiles: 'list'`.
  - The device's config is also worked out when it is first used, not when
    the module loads. A first live run showed why: the matchers loaded the
    device while `setup.ts` was still loading the file.
  - `setup.ts` hands the device the resolved run through the global object.
    `configFromRun` maps it to `DeviceConfig`, with `HARNESS_FORCE` from
    the environment. `HARNESS_ROOT` goes in each project's environment, which
    is where the three modules that keep files under the root read it.
  - **The warm-up** opens the base route and does not fail the run when that
    fails: a test that opens a route of its own reports it better.
  - **Unavailable:** `HARNESS_REQUIRE` of `1` fails, `0` skips, and unset
    follows CI. CI of `0` or `false` is not CI.
  - `defineHarness` and the config's types are exported from
    `expo-vitest/device`.
  - **Seen live,** from source:
    - web on the file's url and timeout, served by the file's command;
    - iOS skipped with "Apple tools are only available on macOS";
    - under `HARNESS_REQUIRE=1`, iOS failed with `DRIVER_UNAVAILABLE`.
- **Item 6: the app's life.**
  - **One driver member,** `control(request)`, for the lifecycle now and
    the device controls next, rather than a member per verb. A request is a
    tagged object. What the drivers say about a control is in
    `src/harness/lib/controls.ts`: the design's `src/device/controls.ts`,
    moved under the harness, since the drivers are its code.
  - `device.restart`, `clearState`, `back`, `home`, `installApp` and
    `openLink` answer `'done'` or `'skipped'`, `foregroundApp` a string or
    null, and `device.lastSkip` holds the reason. Each is a `control` step
    in the journal, and the timing wrapper waits after the ones that change
    the screen.
  - **agent-device** 0.21.27 has `--launch-args`, repeatable, and its client
    takes `launchArgs`, so no `simctl` or `am start` fallback was needed.
    Back is agent-device's default back, not `--in-app`.
  - **Web:** a page lives in a context of its own, which a restart closes.
    The granted permissions, mapped from agent-device's names to Chromium's,
    go to every context.
  - **Windows:**
    - `open` and the lifecycle share one start. When the app was not
      running it waits up to 60 s for the window, and with no exe it fails
      rather than crashes.
    - An exe that is not running is ready, since the first open starts it.
    - The host gains `foreground`; the per-step scripts answer skipped.
    - `installApp` runs `Add-AppxPackage` for an `.msix`.
  - **Seen live:**
    - Web, in a scratch consumer:
      - restart and clearState gave a fresh context, with no storage and
        the location permission granted;
      - back, openLink and foregroundApp worked;
      - home, installApp and a `mailto:` link were skipped, each with its
        reason.
    - The Android emulator's Settings app, through the client and through
      the command line: restart with a permission and launch arguments,
      home, back, clearState, and the install's missing build.
    - Windows, on Entz:
      - restart ended it and started it again, with its tree whole after;
      - back, home, clearState without a `stateDir`, and a `.zip` install
        were skipped, each with its reason;
      - `foregroundApp` named the editor in front, since a process in the
        background cannot take the foreground.
  - **Not seen:** iOS; `installApp` on a device and on Windows; `openLink`
    on a device and on Windows.
- **Item 7: the device's settings.**
  - The fourteen controls of 3.5 go through the same `control` member,
    with one table: what changes the screen, what each platform lacks and
    why, and the sensors each platform's simulator or emulator has.
  - `setClipboard` is journalled by its length, so a trace holds no
    clipboard.
  - **agent-device:** a location on Android takes no app, and agent-device
    refuses one; on an iOS simulator it is the app's.
  - **On a device without the control,** the call throws with
    agent-device's reason:
    - `fold` on a phone that does not fold is `UNSUPPORTED_CAPABILITY`;
    - `alert` with no alert on the screen is `ACTION_FAILED`.
    - Item 8's `requires` is how a test steps around them.
  - **Web:**
    - `alert` sets how the next dialog is answered;
    - `dismissKeyboard` blurs what has the focus;
    - a permission's `reset` clears every grant, since Chromium has no
      single one to clear.
  - **Windows:** the host gains `clipboard` and `setClipboard`, on a
    thread of a single-threaded apartment of their own.
  - **Seen live:**
    - Web, nine tests:
      - appearance and orientation, offline and back;
      - a grant and its reset, and a skipped deny;
      - a location and none;
      - the clipboard, the focus taken off a field;
      - the next dialog accepted, then one dismissed;
      - the four web lacks.
      - The headless shell keeps `Notification.permission` at `denied`,
        so the page read the Permissions API.
    - The Android emulator, through the client and the command line:
      - appearance, orientation, Wi-Fi and airplane mode, each set and put
        back;
      - a permission, a location with a negative longitude, and no
        location;
      - the fingerprint, and the face ID and enrol skips;
      - the keyboard dismissed;
      - the alert and the fold throwing as above.
      - The emulator's settings were put back after.
    - Windows: the host read the clipboard, the text unprinted, and the
      twelve desktop lacks were skipped with their reasons.
  - **Not seen:**
    - iOS;
    - the clipboard written on Windows or Android, since both are, or may
      be, the machine's own;
    - a fold on a foldable.
- **Item 8: gating.**
  - `src/device/capabilities.ts` holds the table:
    - each platform's steps, from the drivers' optional members;
    - every control less the platform's lacks;
    - the predicates over the device. `fold` needs a name with Fold,
      Flip or Duo in it. Airplane mode needs Android 11 or later.
      Biometrics need a simulator or an emulator. On Windows the host
      steps need the host, `installApp` an `.msix` and `clearState` a
      `stateDir`.
  - `statusBar`, `video` and `screenshot:element` wait for their items.
  - **The device's facts** come from agent-device's capabilities: its
    name, its kind and its version. agent-device's list of commands is the
    platform's, and names `fold` on a phone that does not fold, so the
    name decides. The facts travel with the warm-up's availability, so a
    worker knows them before its driver opens.
  - `device.can`, `device.capabilities` and `device.cannot`, the
    sentence a skip says.
  - `onlyOn` and `skipOn` are `describe.skipIf`. `requires` is a
    `describe` with a `beforeEach` that opens the driver and skips with
    that sentence.
  - The device module now imports Vitest at run time; a scratch consumer
    showed a harness config that does so still loads in a global setup.
  - **Seen live:**
    - On the Android emulator: the facts known before the driver opened;
      `requires(['fold'])` skipped with "android cannot fold, since Pixel
      9 Pro XL does not fold"; airplane mode ran; `onlyOn` and `skipOn`
      routed.
    - In the fixture, installed: `requires(['home'])` skipped on web
      with its reason, which `scripts/fixture.js` now checks, and a block
      for phones skipped.
- **Item 9: the geometry, in `src/harness/lib/image.ts`** rather than
  `png.ts`, so the gate covers it without the decoder's defensive reads,
  which no input reaches.
  - `scaleRect` rounds outward, so what a rectangle covered stays
    covered.
  - `clampRect` keeps what is inside the picture.
  - `maskImage` paints magenta by default.
  - `cropImage` answers null for a rectangle wholly outside.
  - `png.ts` gains `compareImages` over pictures already read, which
    `comparePng` now calls.
- **Item 10: the screenshot matcher.**
  - `src/device/screenshots.ts` holds what it decides:
    - the allowance, `maxRatio`, `maxDiffPixels` and `threshold`, each
      checked;
    - whether baselines are written;
    - the scale factor;
    - the region and its masks;
    - the still picture;
    - the mismatch's sentence.
    - It is under the gate.
  - **The matcher** reads the tree only for a mask, a clip or an element,
    so an object that only takes pictures still works.
  - **The baseline** is the region compared, without its masks, so a mask
    needs no new one.
  - **The pictures:**
    - `.actual.png` is the picture as compared, and `.expected.png` the
      baseline as compared, written on a mismatch.
    - On a mismatch the matcher throws a `HarnessError` with
      `SCREENSHOT_MISMATCH` and the diff as its `evidence`, rather than
      answer `pass: false`, so a script can branch on the code. Under
      `.not` it answers as a matcher does.
  - **Recording:** `HARNESS_UPDATE_SCREENSHOTS` and `vitest -u` record a
    missing baseline and replace one that differs. A unit test pins
    `snapshotState._updateSnapshot` under Vitest 4.1.
  - **The box:** the snapshot gains `viewport`, the box its bounds are
    measured in: the page's viewport on web, and agent-device's viewport
    beside the nodes. Windows gives none, and its bounds are its picture's
    pixels.
  - **Seen live** on web, from no baselines:
    - a masked baseline recorded and matched with the clock moved on;
    - without the mask, `SCREENSHOT_MISMATCH` with the three pictures;
    - the stricter of a share and a count;
    - an element's baseline exactly its bounds, 83 by 41;
    - a clip by role;
    - a mask that named nothing, `LOCATOR_NOT_FOUND`;
    - `vitest run <file> --update` recording with no variable set, where
      the same run without it recorded nothing.
  - **The fixture** has the masked screenshot over a clock its page starts
    on purpose, recorded and compared in the one run, since a baseline
    belongs to the machine that drew it.
  - **Found on the way:** agent-device's daemon, started in the fixture's
    copy to say whether it can drive iOS, keeps that folder as its own
    for minutes. `scripts/fixture.js` now retries the cleanup, then leaves
    the copy and says so, rather than fail a run whose tests passed.
- **Item 11: the status bar,** without a warm-up sequence.
  - agent-device 0.21.27 already makes it the same per picture:
    - it puts an Android device in demo mode for every screenshot unless
      given `--no-stabilize`;
    - it normalises an iOS simulator's under `--normalize-status-bar`.
  - So `statusBar` reaches the screenshot:
    - `fixed` asks iOS to normalise and leaves Android's default;
    - `real` turns Android's stabilising off.
  - The spellings for the client and the command line are in the mapping,
    under the gate. No `simctl` or demo-mode broadcasts of the harness's
    own were needed.
  - **Seen live:** the emulator took a picture in each mode, through the
    client and through the command line.
  - **Not seen:** what either mode shows. This headless emulator composites
    nothing, so even `adb screencap` gives a picture of transparent black,
    though Settings has the focus and its tree reads. Nor iOS.
- **Item 12, its start.** The fixture's device suite runs a project per
  platform from `fixture/harness.config.ts`, whose command,
  `fixture/device/serve.mjs`, serves the page on a fixed port, 41731,
  since a port chosen at random would differ between the two loads of the
  file. Beside web is a platform the machine cannot drive: iOS, or Windows
  on a Mac. `scripts/fixture.js` checks that its tests are skipped with the
  driver's reason, and that they fail with `DRIVER_UNAVAILABLE` under
  `HARNESS_REQUIRE=1`.
  - **Then the rest,** with items 6 to 10 built:
    - `requires(['home'])` skipped on web with its reason, which the
      runner checks;
    - the masked screenshot over a clock;
    - a restart in a fresh context, and a cleared state;
    - back from a link, with the page in front each time;
    - the appearance and the network, each set and put back;
    - the clipboard.
    - Its page shows its colour scheme and whether it is online, as the
      device's settings look from inside it.
  - **The absent platform** is iOS beside web, rather than Windows as the
    design has it, since this Windows machine can drive Windows. On a Mac
    it is Windows.
- **Item 13, its start.** `docs/configuration.md` has the three options, a
  project per platform, and `harness.config.ts` with the precedence and the
  command. `docs/device-tests.md` has `HARNESS_CONFIG`, `HARNESS_REQUIRE`
  and the two new codes, and the README a row. The keys the file takes
  ahead of their items, `bundleId`, `appPath`, `identity`,
  `launchArguments`, `permissions`, `stateDir`, `statusBar` and
  `actionTimeout`, are documented with their items.

## Purpose and the claims it proves

After this phase a device test suite is configured once, starts its own app,
runs on every platform the machine can drive in one `vitest run`, and can put
the device into the states a flow depends on: dark mode, offline, a granted
permission, a location, a folded screen. The screenshot matcher learns masks
and element crops. Nothing a consumer wrote before this phase changes meaning.

The claims, against the bar in README section 2:

- **Friendlier.** One command to a green run: `vitest run` starts the dev
  server, waits for it, drives three platforms, stops it. e2e needs `app.command`
  in its config and a `--target` per run; we need neither.
- **Wider.** Every device control e2e offers on iOS and Android exists on four
  platforms, answering `'done'` on the ones that have it and `'skipped'` with a
  reason on the ones that do not. Web gains controls through Playwright that
  e2e's device fixture does not expose on its web engine.
- **Lighter.** No new dependency. Masks and crops are done on the RGBA buffers
  `src/harness/lib/png.ts` already decodes.
- **Safer.** A screenshot baseline is still recorded only on purpose.

## What e2e does

From the references in the README appendix, checked 2026-10-13:

- **Config.** `targets[].app` holds `url`, `bundleId`, `appPath`, `identity`,
  `environment`, `launchArguments`, `permissions`, `command` and `readyUrl`.
  `command` has `executable` (resolved on `PATH`, no shell), `args` (`{port}`
  expands), `cwd`, `env` (added to a short inherited set: `PATH`, `HOME`,
  `TMPDIR`, `TMP`, `TEMP`, `SystemRoot`, `COMSPEC`), `startupTimeout` 60 s,
  `shutdownTimeout` 10 s, `log` (discarded by default), `reuseExisting` (off,
  and ignored in CI). `readyUrl` defaults to `url`. One process per run, started
  before the first test and stopped afterward.
- **Targets.** Each test runs once per target. `--target <name>` selects. A
  test's `platforms` and `requires` skip it at selection with a reason.
- **App fixture.** `open(path?)`, `restart()`, `clearState()`, `back()`,
  `screenshot(label?)`, `baseUrl`. On a device `open()` launches the pinned
  app; `restart` recreates the context keeping persisted state; `clearState`
  clears it. Launch arguments and permissions apply to every fresh launch, so
  no system prompt appears; `deny` on iOS answers no silently, on Android
  revokes so the OS asks again.
- **Device fixture** (`@e2e-dev/mobile`): `setNetwork`, `setAirplaneMode`
  (Android 11 and later; iOS fails with `UNSUPPORTED_CAPABILITY`),
  `setPermission`, `setLocation`, `clearLocation`, `setAppearance`,
  `setOrientation`, `fold` (poses `closed`, `half-open`, `open`),
  `setBiometrics`, `enrollBiometrics`, `installApp(path?, {reinstall})`,
  `openApp`, `openLink`, `closeApp`, `clearKeychain` (iOS only),
  `foregroundApp`, `home`, `back`, `alert`, `dismissKeyboard`, `clipboard`,
  `setClipboard`, `locator(selector)`. Nothing restores itself; the docs say
  to restore in `afterEach`. The engine installs nothing on its own.
- **Dev client.** The documented Expo development build setup points the
  launcher at the dev server with launch arguments on an iOS simulator and
  turns off the dev menu, its onboarding sheet and its floating button; on
  Android the launcher ignores `--initialUrl`, so the recipe opens
  `exp+<slug>://expo-development-client/?url=<encoded server URL>` with
  `device.openLink`. The first launch waits for bundling, so the first check
  needs a longer timeout.
- **Visual comparison.** `expect(screen).toHaveScreenshot(name?, options)` and
  `expect(locator).toHaveScreenshot(...)` which scrolls the element into view
  and compares its box. Options `threshold` 0.2, `maxDiffPixels` 0,
  `maxDiffPixelRatio` 0, `mask` (locators painted over before comparison),
  `maskColor` `#ff00ff`, `timeout`. Baselines live in
  `<test-file>-snapshots/` named per target and OS; the first run writes and
  fails; `--update-snapshots` rewrites; a mismatch writes `-diff`, `-actual`
  and `-expected`; a baseline is written only after two consecutive identical
  screenshots; on web animations are stopped and the caret hidden; on iOS and
  Android the status bar is fixed.

## What this package has today

- `deviceConfig` in `src/projects.ts:307-326` returns one `ViteUserConfig`:
  project name `device`, `include: ['device/**/*.test.ts']`, the matchers as
  the only setup file, `testTimeout` and `hookTimeout` 120 s,
  `fileParallelism: false`, `pool: 'forks'`, `maxWorkers: 1`. No
  `globalSetup`, no `provide`, no `server.deps.inline`.
- `src/device/index.ts`: `configFromEnvironment` reads `HARNESS_PLATFORM`
  (default `web`), `HARNESS_URL`, `HARNESS_SCHEME`, `HARNESS_TARGET` once at
  import time; `device` is a module-level singleton over `driverFor`;
  `Device.ready()` throws when `available()` is false; `open`, `snapshot`,
  `fullSnapshot`, `screenshot(name)` to `.harness/<name>.png`, `type`, `key`
  (answers `'skipped'` when the driver has none), `waitFor`, `close`.
- `src/harness/lib/types.ts`: the `Driver` interface with `open`, `snapshot`,
  `press`, `fill`, `type`, optional `key`, `screenshot`, `idleSeconds`,
  `close`, and `DriverOptions {root, url, scheme, target}`.
- `src/harness/platforms/web.ts`: one Chromium, one page at 1280 by 900,
  `open` is `page.goto`. Nothing emulated.
- `src/harness/platforms/windows.ts`: `open` spawns the exe with the deep link
  as its argument, detached, and relies on the app's single-instance redirect;
  `available()` needs the process running already.
- `src/harness/platforms/agent-device.ts`: `open` is `agent-device open <to>`;
  no install, no settings, no relaunch.
- `src/device/matchers.ts`: `toMatchScreenshot(name, {maxRatio})` on the
  device only. Baseline at `device/__screenshots__/<platform>/<name>.png`;
  actual at `.harness/<platform>-<name>.actual.png`; diff at
  `.harness/<platform>-<name>.diff.png`; `comparePng(..., {tolerance: 8})`;
  records only under `HARNESS_UPDATE_SCREENSHOTS`.
- `src/harness/lib/png.ts`: `decodePng` to RGBA, `encodePng` from RGBA,
  `comparePng` with a per-channel `tolerance` and a red-on-faded diff. No
  mask, no crop.
- `src/harness/windows/screen.ps1`: captures the window's rectangle in
  physical pixels. `snapshot.ps1` reports bounds relative to the same
  rectangle in the same units, so a tree rectangle maps onto the screenshot
  one to one on Windows.

## Design

### 3.1 A project per platform

`deviceConfig` keeps its signature and gains three options:

```ts
export function deviceConfig(options: {
  include?: string[];
  timeout?: number;
  /** New. One Vitest project per platform. Without it, today's single project. */
  platforms?: Platform[];
  /** New. The harness config file, from the root. `harness.config.{ts,mts,js,mjs}` found at the root unless given. */
  harness?: string;
  /** New. The project's folder. The working directory unless given. */
  root?: string;
} = {}): ViteUserConfig
```

Without `platforms`, the function returns the object it returns today, byte
for byte. The Phase 0 contract test snapshots that object and fails the build
on any drift.

With `platforms`, it returns a root config with `test.projects`, one entry per
platform, in the order given:

```ts
{
  test: {
    pool: 'forks',
    // The command lifecycle (3.3), once per run.
    globalSetup: [file('device/global-setup.ts')],
    projects: platforms.map(platform => ({
      resolve: {alias: selfAliases()},
      test: {
        name: `device:${platform}`,
        globals: true,
        environment: 'node',
        include: options.include ?? ['device/**/*.test.ts'],
        setupFiles: [file('device/matchers.ts'), file('device/setup.ts')],
        // The warm-up (3.3), once per platform.
        globalSetup: [file('device/warm-up.ts')],
        provide: {'harness.platform': platform, 'harness.root': root, 'harness.file': harnessFile},
        testTimeout: timeout,
        hookTimeout: timeout,
        // One app per platform: its files run one at a time.
        fileParallelism: false,
        server: {deps: {inline: [SELF]}},
      },
    })),
  },
}
```

`device:web`, `device:windows`, `device:android` and `device:ios` are the
names; `vitest run --project device:web` picks one, `--project 'device:*'`
all. Different platforms share nothing, so they run at the same time:
`sequence.groupOrder` stays at its default, which runs every project together.
Within a project `fileParallelism: false` keeps one file at a time on the one
app. Vitest documents that `fileParallelism: false` "will override `maxWorkers`
option to `1`"; whether that override is per project or run-wide in projects
mode is the first work item's spike. If it is run-wide, the fallback is
`sequence.groupOrder` per platform, which serialises platforms and still keeps
one `vitest run`.

A platform the machine cannot drive does not fail the run by default. The
warm-up provides `harness.<platform>.available` and the setup file's
`beforeEach` calls `context.skip(reason)`, so every test in that project is
reported skipped with the driver's own reason, the same sentence `doctor`
prints. `HARNESS_REQUIRE=1`, or `CI` set, turns that into a failure with
`DRIVER_UNAVAILABLE`, because a CI job that silently skips its device tests is
worse than one that fails.

`server.deps.inline: [SELF]` matters here for the first time in a device
project: the setup file and the global setups import a consumer file by a
computed path (3.2), and that import is rewritten by Vite only when the
importing file is in the Vite graph rather than externalised as a package.

### 3.2 `harness.config.ts`

One file at the project root holds what the runner needs that is not Vitest
config. `defineHarness` is an identity function with the type:

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
    windows: {target: 'windows/x64/Release/MyApp.exe', scheme: 'myapp', launchArguments: []},
    android: {
      bundleId: 'com.example.app',
      scheme: 'myapp',
      appPath: 'android/app/build/outputs/apk/release/app-release.apk',
      permissions: {camera: 'grant', notifications: 'deny'},
    },
    ios: {bundleId: 'com.example.app', scheme: 'myapp', device: 'iPhone 17', launchArguments: ['--initialUrl', 'http://localhost:8081']},
  },
  assertionTimeout: 5_000,
  settle: 150,
  transition: 500,
});
```

The full shape, with defaults:

```ts
export interface HarnessConfig {
  app?: Partial<Record<Platform, AppConfig>>;
  assertionTimeout?: number;   // 5_000, from Phase 2
  settle?: number | false;     // 150, from Phase 1
  transition?: number;         // 500, from Phase 1
  statusBar?: 'fixed' | 'real'; // 'fixed': normalised before screenshots on devices
  actionTimeout?: number;      // 30_000: the deadline for one driver call, passed to Phase 0's runAsync and to the client's signal
  // Reserved for Phase 5, which defines the types. Until it lands the
  // validator rejects them by name, so a typo is caught rather than ignored.
  agents?: HarnessAgents;
  tools?: ToolDefinition[];
  secrets?: Record<string, string | undefined>;
  cache?: 'off' | 'read-only' | 'read-write' | {mode?: 'off' | 'read-only' | 'read-write'; dir?: string; strict?: boolean};
}

export interface AppConfig {
  url?: string;                 // web: where the app is served. HARNESS_URL
  target?: string;              // windows: exe or process; devices: simulator, emulator or phone. HARNESS_TARGET
  device?: string | string[] | HostedDevice;
                                // devices: an alias of target, e2e's word for it. A list is a pool,
                                // one worker per entry (Phase 4). A HostedDevice, `{provider: 'limrun' | 'browserstack' | 'aws-device-farm', ...}`,
                                // is leased through agent-device's `connect` (Phase 4); Limrun rejects a name, so the union is needed.
  scheme?: string;              // deep links. HARNESS_SCHEME
  bundleId?: string;            // ios and android: the installed app
  appPath?: string;             // ios and android: a build to install; windows: an .msix to install
  identity?: string;            // keys replay entries and baselines, Phase 5. Defaults to bundleId or url
  launchArguments?: string[];   // every fresh launch: process arguments on ios, am start extras on android, exe arguments on windows
  permissions?: Record<string, 'grant' | 'deny' | 'reset'>;  // applied before each fresh launch on ios and android, granted on web
  stateDir?: string;            // windows: the folder clearState deletes between kill and relaunch
  command?: CommandConfig;      // a process started once per run
  readyUrl?: string;            // polled until command is ready. Defaults to url
}

export interface CommandConfig {
  executable: string;           // resolved on PATH, never through a shell
  args?: string[];              // '{port}' expands to the port of url
  cwd?: string;                 // the project root
  env?: Record<string, string>; // added to the whole inherited environment
  startupTimeout?: number;      // 60_000
  shutdownTimeout?: number;     // 10_000
  log?: string | false;         // '.harness/app-<platform>.log'. false discards
  reuseExisting?: boolean;      // true locally, false when CI is set
}
```

Two differences from e2e are deliberate. The child inherits the whole
environment plus `env`, because `expo start` needs `ANDROID_HOME`,
`JAVA_HOME`, `EXPO_TOKEN` and whatever else the user's shell has, and a short
allowlist is a footgun that shows up as an unexplained bundler failure.
`reuseExisting` is on locally, because a developer with Metro already running
should not get a second one and a port collision; CI turns it off, as e2e does.

**Precedence.** From strongest to weakest:

| Source | Example |
| --- | --- |
| A per-call option | `device.setAppearance('dark')`, `toMatchScreenshot(name, {maxRatio})` |
| An environment variable | `HARNESS_URL`, `HARNESS_TARGET`, `HARNESS_SCHEME`, `HARNESS_PLATFORM` (single-project form only), `HARNESS_UPDATE_SCREENSHOTS`, `HARNESS_CONFIG` (the file), `HARNESS_FORCE` (built in Phase 1: the environment form of the harness's `--force`, since a device test on Windows cannot pass a flag; without it the idle guard applies to device tests as it does to the command) |
| `harness.config.ts` | `app.web.url` |
| The built-in default | `http://localhost:8081`, `assertionTimeout` 5 s |

Environment above file, so every invocation that works today keeps working
unchanged, and a CI job can override one value without editing the file.

**Loading.** The file is loaded twice, on purpose, and never by `deviceConfig`:

1. In the main process, by the run-wide global setup and the per-platform
   warm-up. Vitest runs global setup files through its own module runner,
   which transforms TypeScript, so a dynamic `import(/* @vite-ignore */ file)`
   from `src/device/global-setup.ts` loads a `.ts` consumer file without Node
   type stripping. The first work item checks this on Vitest 4.1. If it does
   not hold, the fallback is Node's own `import()`, which the package's new
   floor of 22.18 (README decision 3) already allows for a `.ts` file.
2. In the worker, by `src/device/setup.ts`, which imports the same path from
   `inject('harness.file')`. Only the serialisable parts cross `provide`
   (strings, numbers, plain objects); functions, which arrive in Phase 5
   (models, tools, executors), are read from this second load. The setup file
   hashes the serialisable half of what it loaded and compares it with what
   was provided, and fails with `INVALID_CONFIG` if the two differ, which
   catches a file edited between global setup and the test.

`deviceConfig` itself stays synchronous and only computes the file's path:
`options.harness` resolved from the root, else the first of
`harness.config.ts`, `.mts`, `.js`, `.mjs` that exists, else none. With no file,
everything comes from the environment and the defaults, as today.

### 3.3 The app command and the warm-up

`src/device/global-setup.ts` runs once per `vitest run`:

1. Load the harness config. Collect every distinct `command` across
   `app.<platform>` (distinct by `executable`, `args`, `cwd`), so two platforms
   that share one Metro start it once.
2. For each: probe `readyUrl` with one GET and a 2 s timeout. If it answers
   and `reuseExisting` is true, record `{reused: true}` and do not spawn. If it
   answers and `reuseExisting` is false, fail with `APP_ALREADY_RUNNING`, as
   e2e does, because a stale server would make the run test the wrong build.
3. Spawn with `child_process.spawn(executable, args, {cwd, env, stdio:
   ['ignore', log, log], shell: false, windowsHide: true, detached:
   process.platform !== 'win32'})`. `detached` on POSIX makes the child a
   process group leader so the whole tree can be signalled; on Windows
   `detached` would open a console, so it is off and the tree is killed by pid.
4. Poll `readyUrl` with a backoff from 100 ms to 1 s until `startupTimeout`.
   On timeout, kill what was started and fail with `APP_UNREACHABLE`, the
   message carrying the last twenty lines of the log.
5. `provide('harness.commands', [{key, pid, reused, log}])`.
6. On teardown, for each spawned command: POSIX `process.kill(-pid, 'SIGTERM')`,
   wait `shutdownTimeout`, then `SIGKILL`; Windows `taskkill /PID <pid> /T /F`
   through `spawnSync`, since Node's `kill` on Windows ends only the one
   process and Metro's children would outlive it. `SIGINT` in the main process
   runs the same teardown.

The readiness and backoff logic lives in `src/device/app-process.ts` as pure
functions over an injectable `fetch` and clock, so the unit tests drive it
against a fake server; the spawn and kill calls are a thin shell around it.

`src/device/warm-up.ts` runs once per platform project. It makes the driver
with the resolved options, calls `available()`, and when ready opens the base
route once so the first test starts on a launched app, a booted simulator and
a loaded page. On iOS and Android with `statusBar: 'fixed'` it also applies the
status bar override (3.7). It provides `harness.<platform>.available` and
`harness.<platform>.found`. It does not apply launch arguments or permissions;
those belong to a fresh launch, so a test that needs them starts with
`device.restart()`, as e2e's docs say of its warm-up.

### 3.4 App lifecycle

New optional members on `Driver` in `src/harness/lib/types.ts`, each answering
a `StepResult` so a backend without one is `skipped`, and new methods on
`Device` returning `'done' | 'skipped'`:

| `device.` | iOS and Android, through agent-device | Web, through Playwright | Windows |
| --- | --- | --- | --- |
| `restart()` | `open <bundleId> --relaunch`, with `launchArguments` and `permissions` applied first | a new browser context, then `goto` the base URL | kill the process, delete nothing, spawn the exe with the base deep link and `launchArguments`, wait for the window |
| `clearState()` | `settings clear-app-state <bundleId>`, then `restart()` | `context.clearCookies()`, `clearPermissions()`, a new context (storage goes with the old one), then `goto` the base URL | `skipped` unless `app.windows.stateDir` is set, in which case kill, delete that folder, relaunch |
| `back()` | `back --in-app` | `page.goBack()` | `skipped`: react-native-windows has no system back |
| `home()` | `home` | `skipped` | `skipped` |
| `installApp(path?, {reinstall})` | `install` or `reinstall <bundleId> <path>`, `path` defaulting to `appPath` | `skipped` | `Add-AppxPackage -Path` when the path ends in `.msix`, else `skipped` |
| `openLink(url)` | `open <url>` | `page.goto(url)` for `http:` and `https:`, else `skipped` | spawn the exe with the URL, as `open` does today |
| `foregroundApp()` | `appstate` | the page's URL and title | the foreground window's process name from the host |

Launch arguments and permissions apply only to a fresh launch, which is
`restart()`, `clearState()` and the first `open` after `installApp`. On iOS
they are process arguments; on Android `am start` extras; on Windows arguments
after the deep link. Permissions on iOS and Android go through
`settings permission grant|deny|reset <name> --app <bundleId>` before the
launch, so no prompt appears; on web the granted ones go through
`context.grantPermissions(names, {origin: url})` once per context, and `deny`
and `reset` are `skipped` with the note that Chromium has no deny through
Playwright. The exact flag agent-device 0.21 takes for process arguments on
`open` is confirmed in work item 6; the fallback is `xcrun simctl launch` and
`adb shell am start` run directly, which the driver can do because both tools
are already on the machine that runs agent-device.

**The Expo development build recipe**, documented in `docs/controls.md`:

- iOS simulator: `app.ios.launchArguments` points the launcher at the dev
  server and turns off its UI, as e2e documents; `app.ios.command` starts
  `npx expo start --port 8081` with `readyUrl` `http://localhost:8081/status`.
  The Expo CLI sets `EXPO_NO_DEV_MENU=1` itself when it is not interactive,
  which adds the same parameters to every launch URL; the recipe sets it
  explicitly in `command.env` so a run from a terminal behaves like CI.
- Android: the launcher does not read `--initialUrl`. The recipe is
  `device.openLink('exp+<slug>://expo-development-client/?url=' +
  encodeURIComponent(serverUrl) + '&disableOnboarding=1&disableFab=1&disableAutoLaunch=1')`,
  the legacy link form for SDK 57, which Expo documents as still working on
  later SDKs beside the `__expo_url` form.
- Web: `command` is `npx expo start --web`; nothing else.
- Windows: `scheme://route` as the exe's argument, which the single-instance
  redirect delivers as React Native's `url` event; `launchArguments` follow it.
- The first launch waits for the bundler, so the recipe's first assertion
  passes `{timeout: 60_000}`.

### 3.5 Device control

`src/device/controls.ts` defines the names, the argument types and the
per-platform mapping; each driver gains one optional member,
`control?(name, args): Promise<StepResult>`, so adding a control is a table
row and a driver case, not a new interface method each time.

| `device.` | iOS and Android | Web | Windows |
| --- | --- | --- | --- |
| `setAppearance('light' \| 'dark')` | `settings appearance <mode>` | `page.emulateMedia({colorScheme})` | `skipped`: the app follows the Windows theme |
| `setOrientation(o)` | `orientation <o>` | `setViewportSize` with width and height swapped | `skipped` |
| `setNetwork('online' \| 'offline')` | Android: `settings wifi on\|off` (Wi-Fi only, as e2e notes); iOS: `skipped`, the simulator shares the Mac's network | `context.setOffline(bool)` | `skipped` |
| `setAirplaneMode(bool)` | Android 11 and later: `settings airplane on\|off`; iOS `skipped` | `skipped` | `skipped` |
| `setPermission(name, state)` | `settings permission <state> <name> --app <bundleId>` | `grant`: `context.grantPermissions([name])`; `reset`: `clearPermissions()`; `deny`: `skipped` | `skipped` |
| `setLocation({latitude, longitude})` | `settings location set <lat> <lon>` | `grantPermissions(['geolocation'])` then `context.setGeolocation(...)` | `skipped` |
| `clearLocation()` | `settings location off` | `context.setGeolocation(null)` | `skipped` |
| `setBiometrics(sensor, result)` | iOS simulator: `settings faceid\|touchid match\|nonmatch`; Android: `settings fingerprint match\|nonmatch` | `skipped` | `skipped` |
| `enrollBiometrics(sensor, enrolled)` | iOS simulator: `settings faceid\|touchid enroll\|unenroll`; Android `skipped` | `skipped` | `skipped` |
| `fold(pose)` | `fold closed\|half-open\|open` on foldable simulators and emulators | `skipped` | `skipped` |
| `clipboard()` | `clipboard read` | `navigator.clipboard.readText()` in the page with `clipboard-read` granted | `Get-Clipboard` through the host |
| `setClipboard(text)` | `clipboard write <text>` | `navigator.clipboard.writeText` with `clipboard-write` granted | `Set-Clipboard` through the host |
| `dismissKeyboard()` | `keyboard dismiss` | `document.activeElement.blur()` in the page | `skipped` |
| `alert('accept' \| 'dismiss')` | `alert accept\|dismiss` | sets the dialog policy the driver's `page.on('dialog')` handler applies to the next dialog, since Playwright decides a dialog when it opens | `skipped`: a WinUI dialog is in the tree, press its button by label |
| `foregroundApp()` | `appstate` | the page's URL and title | the foreground window's process |

Rules the table follows:

- A control that a platform has answers `'done'`. One it lacks answers
  `'skipped'`, and `device.lastSkip` holds the reason sentence, which the
  evidence trace (Phase 2) records. Nothing throws for a missing control.
- Nothing restores itself. A test that sets dark mode sets light mode back in
  `afterEach`; the docs say so, with the example.
- Through agent-device the driver uses the Node client's `settings`,
  `command` and `interactions` namespaces when the client is loaded (Phase 1),
  and the CLI spellings in the table otherwise. Both paths produce the same
  `StepResult`.
- Through PowerShell the two clipboard calls and the foreground query are
  three more commands of the Phase 1 host; no new script.

### 3.6 Gating

`src/device/capabilities.ts` holds the static table: capability name by
platform, with `true`, `false`, or a predicate over what `available()`
reported (the Android API level for `airplane`, a foldable device name for
`fold`, `.msix` for `installApp` on Windows). The names are the method names
above plus `key`, `hover`, `swipe`, `longPress`, `video` (Phase 4),
`statusBar`, and `screenshot:element`, and the step verbs every driver has
today, `open`, `press`, `fill`, `type` and `screenshot`, so that Phase 5 can
derive the agent's tool list and Phase 6 the MCP catalog from this one table.

```ts
device.capabilities;            // ReadonlySet<Capability> for this platform
device.can('setAirplaneMode');  // boolean

onlyOn(['windows', 'web'], () => { /* describe block */ });
skipOn(['ios'], () => { /* describe block */ });
requires(['setLocation', 'fold'], () => { /* describe block */ });
```

`onlyOn` and `skipOn` wrap `describe.skipIf` on `device.platform`. `requires`
registers a `beforeEach` that calls `context.skip(reason)` with the sentence
naming the missing capability and the platform, so the skip and its reason
appear in Vitest's report and in a reporter's `onTestCaseResult`. All three
are additive exports of `expo-vitest/device`; `it.skipIf` keeps working.

### 3.7 Screenshots

`toMatchScreenshot` keeps its signature and gains options and a second
receiver:

```ts
await expect(device).toMatchScreenshot('settings');                                   // unchanged
await expect(device).toMatchScreenshot('settings', {mask: [by.testID('clock')]});    // paint over, then compare
await expect(device).toMatchScreenshot('header', {clip: by.role('banner')});         // compare one rectangle
await expect(screen.getByRole('button', {name: 'Pay'})).toMatchScreenshot('pay');     // crop to the element
await expect(device).toMatchScreenshot('chart', {threshold: 0.1, maxDiffPixels: 50, maxRatio: 0.01});
```

| Option | Meaning | Default |
| --- | --- | --- |
| `maxRatio` | the share of pixels that may differ | 0.002, unchanged |
| `maxDiffPixels` | an absolute count that may differ; the stricter of the two applies when both are set | unset |
| `threshold` | per-channel drift that still counts as the same pixel, 0 to 1, mapped to `comparePng`'s `tolerance` as `round(threshold * 255)` | the current 8 of 255 |
| `mask` | selectors or locators whose bounds are painted `#ff00ff` in both images before comparing | none |
| `clip` | a selector, locator or `{x, y, width, height}` in tree units; only that rectangle is compared | none |

The algorithm, in `src/device/matchers.ts` over new pure functions in
`src/harness/lib/png.ts`:

1. Stabilise. On web the driver takes the picture with
   `page.screenshot({animations: 'disabled', caret: 'hide'})`. On every
   platform the matcher takes up to five pictures 100 ms apart and stops at
   the first two whose bytes match, bounded by `assertionTimeout`, and
   compares the last one; e2e does this only when writing a baseline, and a
   screen that never settles is exactly the one that fails for the wrong
   reason without it.
2. Snapshot the full tree in the same step and resolve every `mask` and the
   `clip` to bounds with `findNode`. A selector that matches nothing fails the
   matcher with `LOCATOR_NOT_FOUND` rather than silently masking nothing.
3. Scale. Tree bounds are in the window's units; a picture may be in device
   pixels. The factor is `image.width / viewport.width`, where the viewport is
   the page's on web, the window rectangle `snapshot.ps1` already reports on
   Windows, and the `viewport` box agent-device returns beside its nodes on
   devices. The factor is applied to every rectangle before painting.
4. `maskImage(image, rects, colour)` fills the rectangles in the RGBA buffer
   of the baseline and of the picture, so adding a mask never forces a new
   baseline. `cropImage(image, rect)` copies the rows and columns of a
   rectangle into a new `Image`. Both are pure and under the gate.
5. `comparePng` as today, on the processed buffers.
6. On mismatch write three files beside the ones written today:
   `.harness/<platform>-<name>.expected.png` (the baseline after masking),
   the existing `.actual.png`, and the existing `.diff.png`. The message names
   all three and the counts.

Element screenshots crop to the locator's bounds after `scrollIntoView` where
the platform can (web and devices) and after nothing on Windows, where a
react-native-windows list does not expose a scroll pattern the host drives
yet. The baseline is `device/__screenshots__/<platform>/<name>.png`, the same
folder as a whole-screen one.

Status bar. With `statusBar: 'fixed'` (the default) the warm-up applies, once
per run: on iOS `xcrun simctl status_bar <udid> override --time 9:41
--batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4`, and
on Android demo mode, `settings put global sysui_demo_allowed 1`, then the
`enter`, `clock -e hhmm 0941`, `battery -e plugged false -e level 100`,
`network -e wifi show -e level 4`, `notifications -e visible false` broadcasts,
with `exit` and `status_bar clear` in teardown. When agent-device's
`screenshot --normalize-status-bar` is available through the loaded client,
the driver uses it per picture instead and the warm-up does nothing.

Recording stays deliberate. A missing baseline is written only under
`HARNESS_UPDATE_SCREENSHOTS`, or when the run was started with `vitest -u`,
which the matcher reads from `expect.getState().snapshotState._updateSnapshot
=== 'all'`. That field is how Vitest's own snapshot matchers learn of `-u`; it
is private, so work item 10 pins it with a test and the fallback is the
environment variable alone. In CI neither is set and a missing baseline keeps
the picture as evidence and passes on the tree, as today.

## Compatibility

- `deviceConfig()` and `deviceConfig({include, timeout})` return exactly
  today's object; the contract test pins it. `platforms`, `harness` and
  `root` are new and optional.
- `configFromEnvironment` and the `HARNESS_*` variables keep their meaning,
  and an environment variable always beats the file.
- `device.open`, `snapshot`, `fullSnapshot`, `screenshot`, `type`, `key`,
  `waitFor`, `close`, `element`, `by` and the four matchers are untouched.
  `toMatchScreenshot(name)` with no options behaves as it does today, and the
  two evidence files it writes keep their names; one more appears beside them.
- New `Device` methods return `'done' | 'skipped'`, never throw for a missing
  capability. New `Driver` members are optional.
- No rename. `device` stays `device`; the new query object is `screen` (Phase
  2), and `onlyOn`, `skipOn`, `requires`, `defineHarness` are new exports.
- `engines.node` becomes `>=22.18` in this phase (README decision 3). It is
  the first floor the package declares. agent-device already needs 22.12, so
  the step is small, and `docs/getting-started.md` says why.

## Work items

Each is one commit, in this order, with lint, typecheck, the unit gate and the
fixture green before it lands.

1. **Spike the two unknowns.** In a scratch consumer on Vitest 4.1: a project's
   global setup imports a `.ts` file by a computed path through the module
   runner; and three projects with `fileParallelism: false` run concurrently
   with each other while serial within. Record both outcomes at the top of
   this file. The Node floor is decided regardless (README decision 3); the
   spike only picks the loader. No package change.
2. **`src/device/config.ts`.** `HarnessConfig`, `AppConfig`, `CommandConfig`,
   `defineHarness`, the defaults, `findHarnessFile(root, named?)`,
   `resolveApp(platform, file, env)` applying the precedence table, and
   `serialisable(config)`. Unit tests for every precedence row and for the
   serialisable split. Joins the coverage include list.
3. **`src/device/app-process.ts` and `src/device/global-setup.ts`.** The
   command registry (distinct commands), `probe`, `waitUntilReady` with
   backoff, `tail(log, 20)`, the kill sequence by platform behind an
   injectable `spawn` and `fetch`. Unit tests against an `http.createServer`
   that answers late, never, or at once, and a fake process that ignores
   `SIGTERM`. `app-process.ts` joins the include list; `global-setup.ts` is
   the thin shell the fixture proves.
4. **`src/projects.ts`: `deviceConfig` with `platforms`.** The projects per
   platform, `provide`, `server.deps.inline`, the single-project fallback
   untouched. Unit tests assert each project's `name`, `include`,
   `setupFiles`, `globalSetup`, `provide` and `fileParallelism`, and that the
   no-option call deep-equals the contract snapshot.
5. **`src/device/setup.ts` and `src/device/warm-up.ts`.** The worker reads
   `inject`, loads the file, verifies the hash, resolves the device config
   lazily (so `device` keeps working as a module singleton), skips with the
   availability reason or fails under `HARNESS_REQUIRE`. The warm-up makes the
   driver, opens the base route, provides availability. The fixture proves
   both on web.
6. **Lifecycle on the drivers and `Device`.** `restart`, `clearState`, `back`,
   `home`, `installApp`, `openLink`, `foregroundApp`; launch arguments and
   permissions on a fresh launch; the agent-device flag for process arguments
   confirmed against 0.21 or replaced by the `simctl` and `am start` fallback.
   Proved on web by the fixture, on a Windows build by hand, on a phone and an
   emulator by the device suite in a consumer.
7. **`src/device/controls.ts` and `Driver.control`.** The table in 3.5 across
   the three drivers; the host gains `clipboard-read`, `clipboard-write` and
   `foreground`. Unit tests cover the mapping table (name and platform to the
   agent-device spelling or the skip sentence) as data; the drivers are
   proved by running.
8. **`src/device/capabilities.ts`, `device.can`, `onlyOn`, `skipOn`,
   `requires`.** Unit tests for the table and the predicates. Joins the
   include list.
9. **`src/harness/lib/png.ts`: `maskImage`, `cropImage`, `scaleRect`.** Unit
   tests on synthetic 8 by 8 images: a mask hides a changed pixel, a crop
   compares only its rectangle, a scale of 2 doubles a rectangle, an
   out-of-range rectangle is clamped.
10. **`toMatchScreenshot` options, the locator receiver, the triple, the
    stabilisation loop, `-u`.** A unit test on the option resolution (the
    stricter of `maxRatio` and `maxDiffPixels`, `threshold` to tolerance) and
    one pinning `snapshotState._updateSnapshot` under Vitest 4.1. The fixture
    gains the masked screenshot test (3.7 and the verification section).
    `HarnessCode` gains `SCREENSHOT_MISMATCH` here, with `errors.test.ts`'s
    pin of the union edited in the same commit.
11. **Status bar normalisation in the warm-up.** The `simctl` and demo mode
    sequences behind a capability check; agent-device's flag when present.
    Proved on a simulator and an emulator by hand, recorded in the docs.
12. **The fixture's `device/` suite.** `fixture/harness.config.ts` with a
    `command` that starts `fixture/serve.mjs`, a dependency-free static server
    on a free port, `readyUrl` on it, `platforms: ['web']`, a page with a
    clock element, tests for `restart`, `clearState`, `back`, `setAppearance`,
    `setNetwork`, `clipboard`, the skip reasons, and the masked screenshot.
    CI installs Chromium with `npx playwright install chromium` before
    `test:fixture`.
13. **Docs.** As listed below. README feature rows for app command, lifecycle,
    device fixture, launch arguments and the dev client, gating, visual
    comparison.
14. **`engines.node`.** Set to `>=22.18` in `package.json`, with
    `docs/getting-started.md` saying which Node the device layer needs and why.

## Verification

Under the 100% gate (`vitest.config.mts` `coverage.include` grows by):
`src/device/config.ts`, `src/device/app-process.ts`,
`src/device/controls.ts` (the table and the mapping), `src/device/capabilities.ts`,
and the new functions in `src/harness/lib/png.ts`. The project generation in
`src/projects.ts` is already under the gate and its tests grow with it.

What the unit tests prove:

- Every row of the precedence table, including an environment variable
  beating the file and a per-call option beating both.
- `deviceConfig()` with no options deep-equals the Phase 0 contract snapshot;
  with `platforms` each project carries the documented `name`, `include`,
  `setupFiles`, `globalSetup`, `provide` and `fileParallelism: false`.
- The command lifecycle against a fake server: ready at once, ready after
  three polls, never ready within `startupTimeout` (fails with
  `APP_UNREACHABLE` and the log tail), already answering with
  `reuseExisting` on (reused) and off (`APP_ALREADY_RUNNING`), and the kill
  order against a fake child that ignores the first signal.
- The capability table and the control mapping as data: for each name and
  platform, the agent-device spelling, the Playwright call, or the skip
  sentence.
- Mask, crop and scale geometry on synthetic images, and the option
  resolution of the matcher.

What the fixture proves on web, in CI on every push: the command starts and
is stopped, `readyUrl` gates the run, the warm-up opens the base route, the
skip reason appears for a project whose platform is unavailable (the fixture
configures `platforms: ['web', 'windows']` and the Linux runner reports
Windows unavailable), `restart`, `clearState`, `back`, `setAppearance`,
`setNetwork`, `clipboard`, and the masked screenshot on a page with a clock,
recorded once under `HARNESS_UPDATE_SCREENSHOTS` on the runner image and
committed for that image only.

What is proved by running, before the phase closes, and written into the docs
as verified: the Windows lifecycle against expo-windows's example app, the
device controls on an Android emulator and an iOS simulator through the device
suite in a consumer, the dev client recipe on both, and the status bar
normalisation.

## Docs

- `docs/configuration.md`: the three new `deviceConfig` options, the project
  names, `--project`, and a new `harness.config.ts` section with the full
  shape, defaults and the precedence table.
- `docs/controls.md`, new: the lifecycle and control tables with the
  per-platform answer, the restore-in-`afterEach` rule, `can`, `onlyOn`,
  `skipOn`, `requires`, and the Expo development build recipe for the four
  platforms.
- `docs/device-tests.md`: running on several platforms at once, the warm-up,
  what the command does, and the screenshot options, the triple, the status
  bar rule and `-u`.
- `docs/getting-started.md`: the Node requirement for the device layer.
- `docs/contributing.md` and `.claude/rules/harness.md`: the fixture's
  `device/` suite and the new include list entries.
- `README.md`: the feature rows named in work item 13.

Every page describes the package as it is, with no history.

## Risks and fallbacks

- **Per-project `fileParallelism` may serialise the whole run.** Spiked
  first. Fallback: `sequence.groupOrder` per platform; the run stays one
  command and loses only the overlap.
- **The module runner may not transform a computed dynamic import from a
  global setup.** Spiked first. Fallback: Node's `import()`, which the
  declared floor of 22.18 already allows for a `.ts` file, so the fallback
  costs nothing a user would notice.
- **agent-device's process-argument flag on `open` may not exist in 0.21.**
  Fallback in 3.4: `simctl launch` and `am start` run directly.
- **`taskkill` may leave a grandchild.** The teardown probes `readyUrl` after
  the kill and reports a survivor with its pid rather than exiting green.
- **`snapshotState._updateSnapshot` is private.** Pinned by a test; if it
  moves, `HARNESS_UPDATE_SCREENSHOTS` alone still works and the docs say so.
- **The iOS status bar override needs a booted simulator and a UDID.** The
  warm-up resolves the UDID from agent-device's `devices` or `simctl list`;
  without one it skips the override and notes it in the trace.
- **Clipboard on web is Chromium only.** Firefox and WebKit (Phase 4) answer
  `skipped` for `clipboard` and `setClipboard`.
- **Two loads of `harness.config.ts` can disagree** when the file changes
  mid-run in watch mode. The hash check fails loudly with `INVALID_CONFIG`
  rather than running with two configs.

## Exit criteria

- `vitest run` with `platforms: ['web', 'windows', 'android']` configured on a
  machine that can drive all three runs the three projects in one invocation,
  starts one Metro, and stops it; `expo-harness doctor` reports the same three
  as ready.
- On a machine missing one of them the project is reported skipped with the
  driver's reason, and with `HARNESS_REQUIRE=1` it fails with
  `DRIVER_UNAVAILABLE`.
- A masked screenshot passes on a page with a running clock on web, Android
  and iOS, and an element screenshot of a button passes on all four platforms.
- `device.setAppearance('dark')` answers `'done'` on web, Android and iOS and
  `'skipped'` on Windows with its reason in the trace; `device.back()` answers
  `'done'` on three and `'skipped'` on Windows.
- The Expo development build recipe opens the dev server build on an iOS
  simulator and an Android emulator with no dev menu, onboarding sheet or
  floating button visible in the first screenshot.
- `deviceConfig()` with no options is unchanged, as the contract test shows.

## References

- e2e config, app and mobile: https://e2e.tester.army/docs/reference/config,
  https://e2e.tester.army/docs/reference/app,
  https://e2e.tester.army/docs/reference/mobile,
  https://e2e.tester.army/docs/mobile, https://e2e.tester.army/docs/visual-testing
- agent-device commands and client: https://oss.callstack.com/agent-device/docs/commands,
  https://oss.callstack.com/agent-device/docs/client-api
- Vitest: https://v4.vitest.dev/config/globalsetup, https://v4.vitest.dev/config/provide,
  https://v4.vitest.dev/config/fileparallelism, https://v4.vitest.dev/config/maxworkers,
  https://v4.vitest.dev/config/sequence, https://vitest.dev/guide/projects,
  https://vitest.dev/guide/test-context (`context.skip`, `onTestFailed`)
- Node: https://nodejs.org/api/child_process.html (`detached`, `kill`,
  `unref`), https://nodejs.org/api/typescript.html (type stripping on by
  default from 22.18.0 and 23.6.0, refused under `node_modules`)
- Playwright: https://playwright.dev/docs/api/class-browsercontext
  (`grantPermissions`, `clearPermissions`, `setGeolocation`, `setOffline`,
  `clearCookies`, `addInitScript`), https://playwright.dev/docs/api/class-page
  (`emulateMedia`, `goBack`, `setViewportSize`, `screenshot` with `animations`
  and `caret`), https://playwright.dev/docs/api/class-browsertype
- Expo development builds: https://docs.expo.dev/develop/development-builds/development-workflows/
  (the `expo-development-client` link form for SDK 57, `disableOnboarding`,
  `disableFab`, `disableAutoLaunch`, `EXPO_NO_DEV_MENU`)
- Android demo mode: https://android.googlesource.com/platform/frameworks/base/+/master/packages/SystemUI/docs/demo_mode.md
- `xcrun simctl status_bar`: `xcrun simctl status_bar --help` on a Mac with
  Xcode; subcommands `override` and `clear`.
- This repository: `src/projects.ts`, `src/device/index.ts`,
  `src/device/matchers.ts`, `src/harness/lib/png.ts`, `src/harness/lib/types.ts`,
  `src/harness/platforms/*.ts`, `src/harness/windows/screen.ps1`,
  `scripts/fixture.js`, `fixture/vitest.config.mts`.

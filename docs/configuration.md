# Configuration

[Docs home](README.md)

`expo-vitest/config` exports three functions that make Vitest configuration,
and `defineHarness`, which types the [harness config](#harnessconfigts):

| Function | What it makes |
| --- | --- |
| [`expoProjects(options)`](#expoprojects) | One Vitest project per platform. |
| [`nodeProject(options)`](#node-code-beside-it) | A plain Node project, for code beside the Expo code. |
| [`deviceConfig(options)`](#deviceconfig) | A whole config for [device tests](device-tests.md). |

## expoProjects

```ts
import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest/config';

export default defineConfig({
  test: {projects: expoProjects()},
});
```

### Options

Every option is optional. These are the defaults:

```ts
expoProjects({
  root: process.cwd(),
  platforms: ['ios', 'android', 'windows', 'web'],
  include: ['src'],
  transformPackages: [],
  timeout: 15_000,
  windows: {name: 'windows', forbid: [], resolveIn: [], include: undefined},
  web: {optimize: [], alias: []},
});
```

| Option | What it does |
| --- | --- |
| `root` | The project's folder. Set it when Vitest runs from a folder above, as in a monorepo. |
| `platforms` | Which projects to make. |
| `include` | The folders that hold tests, from the root. |
| `transformPackages` | More packages that ship TypeScript or untranspiled sources, besides Expo's. |
| `timeout` | How long one test may take, in milliseconds. Fifteen seconds, since the projects run in parallel and coverage slows each. `TEST_TIMEOUT` is exported for a config that wants the same number elsewhere. |
| `windows.forbid` | Modules with no Windows implementation. Importing one throws, with the module's name. See [below](#forbidden-modules). |
| `windows.resolveIn` | More folders whose relative imports resolve `.windows.*` first, from the root. An app names the source of a library it installed: `node_modules/a-kit/src`. |
| `windows.include` | The test files, in place of the ones the names pick. A package for Windows alone runs every test there. |
| `windows.name` | The project's name. `windows` by default. |
| `web.optimize` | More packages for Vite's dependency optimizer to pre-bundle, besides Expo's. |
| `web.alias` | More aliases for the web project. |

Projects do not inherit the root `test` block in Vitest, so each one carries
its own globals, mock clearing and timeout. Coverage and reporters stay in the
root block, which is yours.

### Forbidden modules

A module with no implementation on a platform usually calls
`requireNativeModule` as it loads, and throws without the native side. A
component that imports one kills an app before its first render. And a test on
an engine that happens to have the module would pass.

Name those modules, and the import fails the test instead:

```ts
expoProjects({windows: {forbid: ['@expo/ui', 'expo-image', 'expo-symbols']}});
```

```
expo-image has no Windows implementation and must not be imported by a file that loads there.
```

Type-only imports are erased and stay fine. A test can still `vi.mock` a
forbidden module for itself.

A good habit for a library with Windows files is one test that imports the
whole package in the Windows project. If any Windows file reaches for a
forbidden module, that test fails and names it.

### A monorepo

```ts
// packages/kit/vitest.config.mts, run from the repository root
import path from 'node:path';
import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest/config';

export default defineConfig({
  test: {projects: expoProjects({root: path.resolve(import.meta.dirname)})},
});
```

### A package for Windows alone

Every test there is a Windows test, whatever its name:

```ts
expoProjects({
  platforms: ['windows'],
  windows: {name: 'my-runtime', include: ['src/**/*.test.{ts,tsx}']},
});
```

## Node code beside it

A CLI, a Metro config or a build script is Node code, not React Native.
`nodeProject` makes a plain Node project for it with the same globals and mock
clearing:

```ts
import {expoProjects, nodeProject} from 'expo-vitest/config';

export default defineConfig({
  test: {
    projects: [
      ...expoProjects(),
      nodeProject({name: 'cli', include: ['cli/**/*.test.js']}),
    ],
  },
});
```

| Option | What it does |
| --- | --- |
| `name` | The project's name. Required. |
| `include` | The test files. Required. |
| `root` | The project's folder. |
| `timeout` | How long one test may take. |

## deviceConfig

Device tests drive a real app, so they get a config of their own and never run
with the unit tests.

```ts
// vitest.config.device.mts
import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest/config';

export default defineConfig(deviceConfig());
```

| Option | What it does | Default |
| --- | --- | --- |
| `include` | The test files. | `['device/**/*.test.ts']` |
| `timeout` | How long one test or hook may take. A real app is slower than a unit test by a lot. | 120 seconds |
| `settle` | How long the screen must hold still after a step before the next one, in ms; `0` or `false` for no wait. See [waiting for the screen](device-tests.md#waiting-for-the-screen). | 150 |
| `transition` | How long a control the last step brought in or moved is given before it is pressed, in ms; `0` or `false` for none. | 500 |
| `assertionTimeout` | How long an action looks for its node, and a `findBy*` or a `waitFor` waits, in ms. See [waiting](locators.md#waiting). | 5000 |
| `stable` | How long something must stay gone before a wait for it to go passes, in ms. | 1000 |
| `platforms` | A project for each platform named, which reads the [harness config](#harnessconfigts) and starts what serves each app. | one project, for `HARNESS_PLATFORM` |
| `harness` | With `platforms`: the harness config, from the root. | `HARNESS_CONFIG`, else `harness.config.ts`, `.mts`, `.js` or `.mjs` at the root |
| `root` | With `platforms`: the project's folder. Screenshots, baselines and evidence are kept under it. | `HARNESS_ROOT`, else the working directory |
| `reporters` | Vitest's reporters, kept at the config's root where Vitest reads them: `summary()` and `github()` from `expo-vitest/reporter` beside Vitest's own. See [CI](ci.md#the-summary-and-the-pull-request-comment). | Vitest's default |

A platform's files run one at a time in one worker, since there is one app
and one driver, and two files must not press the same window at once. A
[pool](device-tests.md#pools) of devices or browsers runs them side by side.

### A project per platform

```ts
export default defineConfig(deviceConfig({platforms: ['web', 'windows', 'android']}));
```

Each project is named `device:<platform>`, so `--project device:web` runs one
of them and `--project 'device:*'` all. Before the first test, each project:

1. loads the [harness config](#harnessconfigts);
2. starts the [command](#the-command) that serves its app, unless one already
   answers;
3. asks its driver whether it can work on this machine, and where it can,
   opens the app's base route once, so the first test does not wait for a
   bundle to be built or an app to launch.

Each test file then takes its app and its waits from the harness config and
the environment. A platform this machine cannot drive has its tests skipped,
with the driver's reason, as `expo-harness doctor` gives it. Under
`HARNESS_REQUIRE=1`, or in CI, they fail with `DRIVER_UNAVAILABLE` instead,
since a CI job that skips its device tests in silence is worse than one that
fails. `HARNESS_REQUIRE=0` skips them in CI too.

Vitest holds the one file at a time for the whole run, so the platforms take
turns rather than running side by side. A test can read the run's id with
`inject('harness.runId')`: the same for every platform in a run, it sorts by
when the run began.

[Device tests](device-tests.md) has the rest.

## harness.config.ts

With `platforms`, the run reads one file at the project root for what is not
Vitest config: which app each platform drives, the command that serves it,
and the waits.

```ts
// harness.config.ts
import {defineHarness} from 'expo-vitest/config';

export default defineHarness({
  app: {
    web: {
      url: 'http://localhost:8081',
      command: {executable: 'npx', args: ['expo', 'start', '--web', '--port', '{port}']},
    },
    windows: {target: 'windows/x64/Release/MyApp.exe', scheme: 'myapp'},
    android: {scheme: 'myapp', device: 'Pixel_9'},
  },
  assertionTimeout: 8000,
});
```

`defineHarness` only gives the object its type. Keep the file to TypeScript
that Node's type stripping can erase: no enums, no namespaces and no
parameter properties.

| Key | What it is | Default |
| --- | --- | --- |
| `app.<platform>.url` | Where the app is served. | `http://localhost:8081` on web |
| `app.<platform>.target` | The exe or process on Windows; the simulator, emulator or phone on a device. | the driver's own choice |
| `app.<platform>.device` | The same as `target`, the word for it on a device; or on iOS and Android a [hosted device](device-tests.md#hosted-devices), `{provider, options}`. | |
| `app.<platform>.scheme` | The app's URI scheme, for deep links. | |
| `app.<platform>.bundleId` | iOS and Android: the installed app, which a [restart](controls.md) relaunches. | |
| `app.<platform>.appPath` | iOS and Android: a build `installApp` installs; Windows: an `.msix`. From the root. | |
| `app.<platform>.identity` | What keeps this app's [screenshot baselines](matchers.md#tomatchscreenshot), in a folder of its own, and keys the agent's [replay cache](agent.md), so two apps, or two builds of one, keep their own. | for the cache, the `bundleId` or the `url` |
| `app.<platform>.launchArguments` | What each [fresh launch](controls.md#a-fresh-launch) is given. | none |
| `app.<platform>.permissions` | `grant`, `deny` or `reset` by permission, set before each fresh launch. | none |
| `app.<platform>.stateDir` | Windows: the folder `clearState` deletes, from the root. | |
| `app.<platform>.storageState` | Web: a file of cookies and storage, as [`device.web.storageState`](device-tests.md#a-signed-in-session) keeps them, that each fresh context begins from where the file is there, but `clearState`'s. From the root. | |
| `app.<platform>.command` | What serves the app, started for the run. See [the command](#the-command). | none |
| `app.<platform>.readyUrl` | Where the run looks until the command answers. | the `url` |
| `app.<platform>.devices` | iOS and Android: a [pool](device-tests.md#pools) of devices the platform's test files share, a file to a device at a time, in place of one `device`. | |
| `app.<platform>.workers` | Web: how many test files run at once, each in a browser of its own. | 1 |
| `assertionTimeout` | How long an action looks for its node and a matcher waits, in ms. | 5000 |
| `stable` | How long something must stay gone before a wait for it to go passes, in ms. | 1000 |
| `settle` | How long the screen must hold still after a step, in ms, or `false`. | 150 |
| `transition` | How long a control the last step brought in is given before it is pressed, in ms, or `false`. | 500 |
| `statusBar` | On a device, `fixed` makes the status bar the same in every screenshot, and `real` leaves it as it is. | `fixed` |
| `actionTimeout` | How long one call to a driver may take before it is given up on, in ms: a step through agent-device, and a page's navigation on web. | 30000 |
| `video` | Which device tests keep a [recording](evidence.md#video) of the screen: `on`, `retain-on-failure` or `off`. `HARNESS_VIDEO` wins over it. | `off` |
| `poolTimeout` | How long a test file waits for a device of a [pool](device-tests.md#pools) when every one is held, in ms. | 60000 |

A key the file does not take, or a value of the wrong kind, fails the run
with `INVALID_CONFIG`, naming it and what the file takes there. So does a
file that changes while the run is going, since the tests would then be
reading a different one from the run that started their apps.

### The agent

Three keys are the [agent's](agent.md):

| Key | What it is | Default |
| --- | --- | --- |
| `agents` | The agents by name, each with its model, context and limits; `default` runs a step that names none. See [several agents](agent.md#several-agents). | none |
| `secrets` | Each secret's value by name: a string, or a function that answers one. `HARNESS_SECRET_<NAME>` wins over it. At least 6 characters. See [secrets](agent.md#secrets). | none |
| `cache` | Whether a verified act is recorded and replayed: `'read-write'`, `'read-only'`, `'off'`, or `{mode, dir, strict}`. `HARNESS_CACHE` wins over it. See [the cache](agent.md#the-cache). | `read-write`, or `read-only` where `CI` is set |

An agent's models and tools are functions, which cannot cross from the run's
own process to the workers, so the device project's setup file loads the file
again in each worker, and the agent reads that load.

### What wins

From strongest to weakest:

| Source | For example |
| --- | --- |
| An option of the call | `screen.getByText('Saved').waitFor({timeout: 1000})` |
| The environment, and `deviceConfig`'s options, which reach the tests through it | `HARNESS_URL`, `HARNESS_TARGET`, `HARNESS_SCHEME`, `HARNESS_ASSERTION_TIMEOUT` |
| `harness.config.ts` | `app.web.url` |
| The defaults | `http://localhost:8081`, 5 seconds |

So a run that works without the file keeps working with it, and a CI job can
change one value without editing it. In a run of several platforms a
variable applies to each of them, so a value that differs by platform goes in
the file.

### The command

A platform's `command` is started once, before the first test, and stopped
after the last, with everything it started. Platforms that name the same
command, the same program with the same arguments in the same folder, share
one.

| Key | What it is | Default |
| --- | --- | --- |
| `executable` | The program, found on `PATH`. | |
| `args` | Its arguments. `{port}` becomes the port of the platform's `url`. | none |
| `cwd` | The folder it runs in, from the root. | the root |
| `env` | Variables added to the run's own environment, which it has all of. | none |
| `startupTimeout` | How long it has to answer at `readyUrl`, in ms. | 60000 |
| `shutdownTimeout` | How long it has to stop before it is killed, in ms. | 10000 |
| `log` | Where its output goes, from the root, or `false` for nowhere. | `.harness/app-<platform>.log` |
| `reuseExisting` | Whether a server already answering at `readyUrl` is used rather than another started. | yes, but in CI |

It runs without a shell, so nothing in its arguments is read as shell
syntax. The exception is a `.cmd` or `.bat` on Windows, such as `npx`, which
only cmd.exe can run: it goes through cmd with every argument escaped.

The run looks at `readyUrl` until it answers with a 2xx, a 3xx, or 400 to
403, as Playwright's web server does. A command that ends first, or does not
answer within `startupTimeout`, is stopped, and the run fails with
`APP_UNREACHABLE` and the end of its log.

A server already answering at `readyUrl` is used, so a Metro you started
yourself is not started twice. With `reuseExisting` off, as it is in CI, the
run fails with `APP_ALREADY_RUNNING` instead, since a server left from before
would be testing whatever build it serves.

At the end, on macOS and Linux the command's process group is sent SIGTERM,
then SIGKILL after `shutdownTimeout`. On Windows its tree is ended with
`taskkill`, since a dev server's workers outlive the one process Node would
end. Something still answering at `readyUrl` after that fails the run,
naming the process.

A run that ends without its teardown, killed or with its terminal closed,
still ends the command. The command runs under a small Node process of the
package's that holds a channel to the run, and when the run's process goes,
that process ends the command the same way, so the next run does not find
it still answering.

## The plugins, on their own

`expoProjects` is made of Vite plugins that are exported for a config that
builds its own projects:

| Export | What it does |
| --- | --- |
| `forbidModules(names, platform?)` | Makes importing a named module throw. `platform` is the name in the message, `Windows` by default. |
| `windowsResolution(project, named?)` | Resolves `.windows.*` files first for relative imports under the project's folder and the folders named. |
| `metroCompat()` | The Metro behaviours Expo's packages rely on, for Vite. See [The web pipeline](web-pipeline.md). |
| `EXPO_WEB_PACKAGES` | The Expo packages the web project pre-bundles. |
| `TEST_TIMEOUT` | Fifteen seconds. |

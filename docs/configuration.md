# Configuration

[Docs home](README.md)

`expo-vitest` exports three functions that make Vitest configuration:

| Function | What it makes |
| --- | --- |
| [`expoProjects(options)`](#expoprojects) | One Vitest project per platform. |
| [`nodeProject(options)`](#node-code-beside-it) | A plain Node project, for code beside the Expo code. |
| [`deviceConfig(options)`](#deviceconfig) | A whole config for [device tests](device-tests.md). |

## expoProjects

```ts
import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest';

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
import {expoProjects} from 'expo-vitest';

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
import {expoProjects, nodeProject} from 'expo-vitest';

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
with the component tests.

```ts
// vitest.config.device.mts
import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest';

export default defineConfig(deviceConfig());
```

| Option | What it does | Default |
| --- | --- | --- |
| `include` | The test files. | `['device/**/*.test.ts']` |
| `timeout` | How long one test or hook may take. A real app is slower than a component test by a lot. | 120 seconds |

The config runs one file at a time in one worker. There is one app and one
driver, and two files must not press the same window at once.

[Device tests](device-tests.md) has the rest.

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

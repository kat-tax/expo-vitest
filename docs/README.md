# expo-vitest documentation

`expo-vitest` tests Expo code with Vitest on iOS, Android, web and Windows,
with one project per platform. New here? Start with
[Getting started](getting-started.md).

## Start

| Page | What is in it |
| --- | --- |
| [Getting started](getting-started.md) | Install, configure, a test for each platform, coverage, CI, troubleshooting. |

## Component tests

| Page | What is in it |
| --- | --- |
| [Projects](projects.md) | The four projects, which tests run where, how each platform's project works, the limits. |
| [Configuration](configuration.md) | Every option of `expoProjects`, forbidden modules, monorepos, `nodeProject`, the plugins on their own. |
| [Helpers](helpers.md) | `expo-vitest/native`, `expo-vitest/windows` and `expo-vitest/router`. |

## A real app

| Page | What is in it |
| --- | --- |
| [Device tests](device-tests.md) | Drive a running app from Vitest: setup, running, `device`, waiting for the screen, the tree, errors. |
| [Locators](locators.md) | `screen` and `within`: RNTL's queries over the running app, the locator they give, how it waits. |
| [Matchers](matchers.md) | The eighteen matchers on a locator, which wait for the tree, what a failure says, and the four on a snapshot or the device, screenshots among them. |
| [Controls](controls.md) | The app's life from a test, and the device's settings: appearance, orientation, network, permissions, location, biometrics, the clipboard and alerts, on each platform. |
| [Evidence](evidence.md) | The screenshot, tree and trace a failing device test leaves, and `HARNESS_TRACE`. |
| [The harness](harness.md) | The `expo-harness` command: steps, targets, options, what each platform can do, timing a platform. |
| [Performance](performance.md) | What each driver costs on a real app on web, Windows and Android, and how that was measured. |

## Build on it

| Page | What is in it |
| --- | --- |
| [The web pipeline](web-pipeline.md) | `metroCompat` and `EXPO_WEB_PACKAGES`, for a web Storybook or anything else that runs Expo code through Vite. |
| [Contributing](contributing.md) | How the package runs from source and from `dist`, and the fixture that proves it installed. |

## What it exports

| Import | Exports |
| --- | --- |
| `expo-vitest` | `expoProjects`, `nodeProject`, `deviceConfig`, `forbidModules`, `windowsResolution`, `metroCompat`, `EXPO_WEB_PACKAGES`, `TEST_TIMEOUT` |
| `expo-vitest/native` | `nodes`, `host`, `modifier`, `byComposeTestID`, `stackHeaders` |
| `expo-vitest/windows` | `island`, `islands`, `fireIsland` |
| `expo-vitest/router` | `renderApp` |
| `expo-vitest/device` | `device`, `element`, `by`, `screen`, `within`, `Locator`, `withComponents`, `reactNodeOf`, `Journal`, `configFromEnvironment`, `defineHarness`, `onlyOn`, `skipOn`, `requires`, `HarnessError`, `isHarnessError` |
| `expo-vitest/device/matchers` | A setup file that registers the device matchers. |
| `expo-vitest/metro-compat` | `metroCompat`, `EXPO_WEB_PACKAGES` |
| `expo-vitest/types` | Types for `tsconfig.json`: the jest-dom matchers on `expect`. |
| `expo-harness` | The command. |

## Related projects

- [expo-interface](https://github.com/kat-tax/expo-interface): a UI kit with a
  file per platform for every component, tested with this package.
- [expo-windows](https://github.com/kat-tax/expo-windows): the Windows
  platform for Expo apps. It builds the app the harness drives on Windows.

# expo-vitest documentation

`expo-vitest` tests Expo code with Vitest on iOS, Android, web and Windows:
component tests in a project per platform, and device tests that drive the
running app. New here? Start with [Getting started](getting-started.md).

## Component tests

| Page | What is in it |
| --- | --- |
| [Getting started](getting-started.md) | Install, configure, a test for each platform, coverage, CI, troubleshooting. |
| [Projects](projects.md) | The four projects, which tests run where, how each platform's project works, and the limits. |
| [Configuration](configuration.md) | Every option of `expoProjects`, `nodeProject` and `deviceConfig`, and the harness config. |
| [Helpers](helpers.md) | `expo-vitest/native`, `expo-vitest/windows` and `expo-vitest/router`. |

## Device tests

| Page | What is in it |
| --- | --- |
| [Device tests](device-tests.md) | Driving a running app from Vitest: setup, running, `device`, waiting for the screen, the tree, errors, pools and hosted devices. |
| [Platforms](platforms.md) | What each platform needs, how to get an app up on it, how it is driven, and what to know about it. |
| [Locators](locators.md) | `screen` and `within`: React Native Testing Library's queries over the running app, and the locator they give. |
| [Matchers](matchers.md) | The matchers that wait for the tree, and the four on a snapshot or the device, screenshot comparison among them. |
| [Controls](controls.md) | The app's life from a test, and the device's settings: appearance, orientation, network, permissions, location and the rest. |
| [Evidence](evidence.md) | The screenshot, tree, trace and recording a failing test leaves. |
| [CI](ci.md) | A job for each platform on GitHub Actions, EAS Workflows, Bitrise and Codemagic, and the pull request comment. |
| [Performance](performance.md) | What each driver's steps cost on a real app, and how to time your own. |
| [Migrating](migrating.md) | From Detox, Maestro and Playwright: each call and what it is here. |

## Agents

| Page | What is in it |
| --- | --- |
| [The agent](agent.md) | Steps in words, run by a model on the device: setup, the four calls, secrets, the replay cache, several agents, tools, executors, models, errors and cost. |
| [Coding agents](coding-agents.md) | The skill the package ships, `guide`, the MCP server, explore and bug bash. |

## Tools

| Page | What is in it |
| --- | --- |
| [The harness](harness.md) | The `expo-harness` command: `doctor`, `init`, steps, targets, options, the browser, timing a platform. |
| [The web pipeline](web-pipeline.md) | `metroCompat` and `EXPO_WEB_PACKAGES`, for a web Storybook or anything else that runs Expo code through Vite. |
| [Contributing](contributing.md) | How the package runs from source and installed, the fixture and the test app it is checked against, and CI. |

## What it exports

| Import | Exports |
| --- | --- |
| `expo-vitest` | What a test imports: `device`, `screen`, `within`, `element`, `by`, `Locator`, `onlyOn`, `skipOn`, `requires`, `withComponents`, `reactNodeOf`, `Journal`, `configFromEnvironment`, `HarnessError`, `isHarnessError` |
| `expo-vitest/config` | What a config imports: `expoProjects`, `nodeProject`, `deviceConfig`, `defineHarness`, `forbidModules`, `windowsResolution`, `metroCompat`, `EXPO_WEB_PACKAGES`, `TEST_TIMEOUT` |
| `expo-vitest/matchers` | A setup file that registers the device matchers, for a config of your own. |
| `expo-vitest/native` | `nodes`, `host`, `modifier`, `byComposeTestID`, `stackHeaders` |
| `expo-vitest/windows` | `island`, `islands`, `fireIsland` |
| `expo-vitest/router` | `renderApp` |
| `expo-vitest/agent` | `agent`, `forEachAgent`, `secret`, `unique`, `isSecret`, `isUnique`, `defineTool`, `toolLoopExecutor`, `AgentError`, `isAgentError`, `AGENT_CODES`, `BLOCKED_CODES` |
| `expo-vitest/agent/anthropic` | `anthropic`, the Claude adapter. |
| `expo-vitest/reporter` | `summary`, `github`: the [run's summary](ci.md#the-summary-and-the-pull-request-comment) as a file, a job summary and a pull request comment. |
| `expo-vitest/metro-compat` | `metroCompat`, `EXPO_WEB_PACKAGES` |
| `expo-vitest/types` | Types for `tsconfig.json`: the jest-dom matchers on `expect`. |
| `expo-harness`, `expo-vitest` | The command, by either name. |

## Related projects

- [expo-interface](https://github.com/kat-tax/expo-interface): a UI kit with a
  file per platform for every component, tested with this package.
- [expo-windows](https://github.com/kat-tax/expo-windows): the Windows
  platform for Expo apps. It builds the app a device test drives on Windows.

# expo-vitest

Test Expo code with [Vitest](https://vitest.dev) on every platform it runs on:
iOS, Android, web and Windows.

An Expo library or app often has a file per platform: `index.ios.tsx`,
`index.android.tsx`, `index.web.tsx`, `index.windows.tsx`. A single test run
sees only one of them. `expo-vitest` makes one Vitest project per platform, so
each file is tested as the platform that loads it.

| You get | |
| --- | --- |
| A project per platform | One call, `expoProjects()`, makes the `ios`, `android`, `web` and `windows` projects. |
| Tests routed by file name | `button.test.tsx` runs on three platforms, `button.windows.test.tsx` on one. No config per file. |
| Helpers | Assert on the props handed to SwiftUI, Compose or a Windows native component. Mount an Expo Router app from memory. |
| Device tests | Drive a running app from Vitest and assert on the accessibility tree a screen reader reads. |
| A harness | `expo-harness`: open a route, press, type, screenshot and read the tree, on web, Windows, Android and iOS. |

It is built on [`vitest-expo`](https://github.com/niondigital/vitest-expo) and
[`vitest-native`](https://github.com/danfry1/vitest-native), which run React
Native's real JavaScript for iOS and Android under Vitest. This package adds
the Windows project, the web project, the file-name rule, the helpers and the
device layer.

## Quick start

Requires Expo SDK 57 and Vitest 4.

### 1. Install

```sh
npx expo install --dev expo-vitest vitest vitest-expo vitest-native \
  @testing-library/react-native test-renderer \
  @testing-library/react @testing-library/jest-dom jsdom
```

The last three are for the web project. An app with a web target already has
`react-dom` and `react-native-web`, which that project also needs.

### 2. Configure

```ts
// vitest.config.mts
import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest';

export default defineConfig({
  test: {projects: expoProjects()},
});
```

For the globals (`describe`, `it`, `expect`, `vi`) and the jest-dom matchers
on `expect`, add the types:

```json
// tsconfig.json
{"compilerOptions": {"types": ["vitest-expo/types", "expo-vitest/types"]}}
```

Not every platform? Name the ones you have:
`expoProjects({platforms: ['ios', 'android', 'web']})`.

### 3. Write a test

Name the file for the platforms it is about. This one runs twice, once as iOS
and once as Android:

```tsx
// src/greeting.native.test.tsx
import {render, screen} from '@testing-library/react-native';
import {Text} from 'react-native';

it('renders', async () => {
  await render(<Text>Hello</Text>);
  expect(screen.getByText('Hello')).toBeOnTheScreen();
});
```

React Native Testing Library 14 is asynchronous: `await render(...)`,
`await fireEvent(...)`.

This one runs on web, against the DOM react-native-web renders:

```tsx
// src/greeting.web.test.tsx
import {render, screen} from '@testing-library/react';
import {Text} from 'react-native';

it('renders', () => {
  render(<Text>Hello</Text>);
  expect(screen.getByText('Hello')).toBeInTheDocument();
});
```

And logic with nothing rendered runs on all four:

```ts
// src/where.test.ts
import {Platform} from 'react-native';
import {where} from './where';   // where.ts, and a where.<platform>.ts for each platform

it('is the file the platform resolves', () => {
  expect(where).toBe(Platform.OS);
});
```

### 4. Run

```sh
npx vitest run                          # every project
npx vitest run --project windows        # one platform
npx vitest run src/greeting.test.tsx    # one file, on the platforms its name picks
npx vitest                              # watch mode
```

## Which tests run where

| File name | Runs on |
| --- | --- |
| `*.test.ts` | iOS, Android, web and Windows |
| `*.test.tsx` | iOS, Android and web |
| `*.native.test.tsx` | iOS and Android |
| `*.ios.test.tsx` | iOS |
| `*.android.test.tsx` | Android |
| `*.web.test.tsx` | web |
| `*.windows.test.tsx` | Windows |

A `.test.ts` file holds logic with nothing rendered, which is the same
everywhere, so it runs everywhere. A `.test.tsx` file renders, and what it
renders on Windows is a different tree from the other three, so Windows takes
only the files named for it. [Projects](docs/projects.md) explains each
platform's project.

## Features

| Feature | What it does | Guide |
| --- | --- | --- |
| iOS and Android projects | React Native's own JavaScript with the native boundary mocked, `Platform.OS` set, and platform files resolved in Metro's order. | [Projects](docs/projects.md#ios-and-android) |
| Web project | react-native-web in jsdom, with Expo's packages pre-bundled with the Metro behaviours they rely on. | [Projects](docs/projects.md#web) |
| Windows project | The code under test is told it is Windows, and `.windows.*` files resolve first. A native component renders as a host view whose props are what C++ receives. | [Projects](docs/projects.md#windows) |
| Forbidden modules | Name the modules with no Windows implementation. Importing one fails the test, instead of the app at launch. | [Configuration](docs/configuration.md#forbidden-modules) |
| Options | Root, platforms, test folders, packages to transform, timeouts, web aliases. | [Configuration](docs/configuration.md) |
| Node code beside it | `nodeProject()` adds a plain Node project for a CLI or a Metro config. | [Configuration](docs/configuration.md#node-code-beside-it) |
| Native helpers | `host`, `nodes`, `modifier`, `byComposeTestID`, `stackHeaders`: assert on the payload handed to SwiftUI or Compose. | [Helpers](docs/helpers.md#expo-vitestnative) |
| Windows helpers | `island`, `islands`, `fireIsland`: find a native component and fire its events as C++ would. | [Helpers](docs/helpers.md#expo-vitestwindows) |
| Router helper | `renderApp` mounts an Expo Router app from an in-memory `app/` folder, on every platform. | [Helpers](docs/helpers.md#expo-vitestrouter) |
| Device tests | `device`, `element`, `by` and four matchers, over a real app on web, Windows, Android or iOS. | [Device tests](docs/device-tests.md) |
| The harness | `expo-harness`, the same drivers as a command, for looking at a screen by hand. | [The harness](docs/harness.md) |
| The web pipeline | `metroCompat` for anything else that runs Expo code through Vite, such as a web Storybook. | [The web pipeline](docs/web-pipeline.md) |

## Documentation

| Page | What is in it |
| --- | --- |
| [Getting started](docs/getting-started.md) | The quick start in full, a test for each platform, coverage, CI, troubleshooting. |
| [Projects](docs/projects.md) | How each platform's project works, the file-name rule, the limits. |
| [Configuration](docs/configuration.md) | Every option of `expoProjects`, `nodeProject` and `deviceConfig`. |
| [Helpers](docs/helpers.md) | `expo-vitest/native`, `expo-vitest/windows` and `expo-vitest/router`. |
| [Device tests](docs/device-tests.md) | The device API, selectors, matchers, screenshots, environment variables. |
| [The harness](docs/harness.md) | The `expo-harness` command: steps, targets, options, what each platform can do. |
| [The web pipeline](docs/web-pipeline.md) | `metroCompat` and `EXPO_WEB_PACKAGES`. |
| [Contributing](docs/contributing.md) | How the package runs from source, and the fixture that proves it installed. |

## Versions

| | |
| --- | --- |
| Expo SDK | 57 |
| Vitest | 4 |
| `vitest-expo` | 57.1 |
| `vitest-native` | 0.13 |
| React Native Testing Library | 13 or 14 |

## Limits worth knowing first

- The Windows project is React Native's iOS JavaScript told it is Windows. It
  proves the props and events of a native component and the logic around them.
  It does not run react-native-windows. What only that renderer does is for a
  [device test](docs/device-tests.md).
- Jest compatibility is off. Tests use `vi`, not `jest`.

## Used by

[expo-interface](https://github.com/kat-tax/expo-interface), a UI kit with a
file per platform for every component, and
[expo-windows](https://github.com/kat-tax/expo-windows), the Windows platform
for Expo apps. Both hold 100% coverage with it.

## License

MIT

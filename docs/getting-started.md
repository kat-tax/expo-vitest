# Getting started

[Docs home](README.md)

This page sets up Vitest in an Expo SDK 57 project and writes one test for each
kind of platform.

## 1. Install

```sh
npx expo install --dev expo-vitest vitest vitest-expo vitest-native \
  @testing-library/react-native test-renderer \
  @testing-library/react @testing-library/jest-dom jsdom
```

| Package | Why |
| --- | --- |
| `vitest`, `vitest-expo`, `vitest-native` | The runner, and the engines that run React Native's JavaScript under it. |
| `@testing-library/react-native`, `test-renderer` | Rendering and queries for the iOS, Android and Windows projects. Version 14 uses `test-renderer`. |
| `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` | The same for the web project. Leave them out if you have no web project. |

The web project also needs `react-dom` and `react-native-web`, which an app
with a web target has.

## 2. Configure

```ts
// vitest.config.mts
import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest';

export default defineConfig({
  test: {projects: expoProjects()},
});
```

By default the projects look for tests under `src`. Name other folders with
`include`, and the platforms you have with `platforms`:

```ts
expoProjects({include: ['app', 'components'], platforms: ['ios', 'android', 'web']});
```

[Configuration](configuration.md) has every option.

Add the types, for the globals (`describe`, `it`, `expect`, `vi`) and the
jest-dom matchers on `expect`:

```json
{"compilerOptions": {"types": ["vitest-expo/types", "expo-vitest/types"]}}
```

And a script:

```json
{"scripts": {"test": "vitest run", "test:watch": "vitest"}}
```

## 3. Name the test for its platforms

| File name | Runs on |
| --- | --- |
| `*.test.ts` | iOS, Android, web and Windows |
| `*.test.tsx` | iOS, Android and web |
| `*.native.test.tsx` | iOS and Android |
| `*.ios.test.tsx`, `*.android.test.tsx`, `*.web.test.tsx`, `*.windows.test.tsx` | one platform |

[Projects](projects.md#which-tests-run-where) explains the rule.

## 4. Write tests

### Logic, on every platform

A `.test.ts` file renders nothing, so it runs on all four. It is the place to
prove that each platform resolves the right file.

```ts
// src/where/where.test.ts
import {Platform} from 'react-native';
import {where} from '.';   // index.ts, index.ios.ts, index.android.ts, index.web.ts, index.windows.ts

it('is the file the platform resolves', () => {
  expect(where).toBe(Platform.OS);
});
```

### iOS and Android

```tsx
// src/where/host.native.test.tsx
import {render, screen} from '@testing-library/react-native';
import {Text, View} from 'react-native';
import {host} from 'expo-vitest/native';

it('reads the host views it rendered', async () => {
  await render(<View testID="box"><Text>Inside</Text></View>);
  expect(screen.getByText('Inside')).toBeOnTheScreen();
  expect(host(props => props.testID === 'box').type).toBe('RCTView');
});
```

React Native Testing Library 14 is asynchronous. Always `await render(...)`
and `await fireEvent(...)`, or an update lands in the next test.

### Web

```tsx
// src/where/dom.web.test.tsx
import {render, screen} from '@testing-library/react';
import {Text} from 'react-native';

it('has the DOM and the jest-dom matchers', () => {
  render(<Text>In the document</Text>);
  expect(screen.getByText('In the document')).toBeInTheDocument();
});
```

### Windows

```tsx
// src/where/island.windows.test.tsx
import {render} from '@testing-library/react-native';
import {Platform, Pressable} from 'react-native';
import {fireIsland, island} from 'expo-vitest/windows';

it('is told it is Windows', () => {
  expect(Platform.OS).toBe('windows');
  expect(process.env.EXPO_OS).toBe('windows');
});

it('finds a host view by its name and fires its events', async () => {
  const onPress = vi.fn();
  await render(<Pressable onPress={onPress}/>);
  await fireIsland(island('RCTView'), 'press');
  expect(onPress).toHaveBeenCalledTimes(1);
});
```

### One test on three platforms

A `.test.tsx` file runs on iOS, Android and web. The two testing libraries
differ, so import the one for the platform when the test needs it:

```tsx
// src/where/shared.test.tsx
import {Platform, Text} from 'react-native';
import {renderApp} from 'expo-vitest/router';

it('mounts an in-memory Expo Router app', async () => {
  await renderApp({index: () => <Text>Home</Text>});
  if (Platform.OS === 'web') {
    const {screen} = await import('@testing-library/react');
    expect(await screen.findByText('Home')).toBeTruthy();
  } else {
    const {screen} = await import('@testing-library/react-native');
    expect(await screen.findByText('Home')).toBeOnTheScreen();
  }
});
```

These five are the tests in this repository's `fixture/`, which run against the
packed package on every change.

## 5. Run

```sh
npx vitest run                          # every project
npx vitest run --project windows        # one platform
npx vitest run src/where                # one folder, on the platforms each name picks
npx vitest                              # watch mode
```

## Coverage

Coverage and reporters stay in the root `test` block, which is yours:

```ts
export default defineConfig({
  test: {
    projects: expoProjects(),
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {lines: 100, branches: 100, functions: 100, statements: 100},
    },
  },
});
```

```sh
npm install --save-dev @vitest/coverage-v8
npx vitest run --coverage
```

Coverage merges across the projects, so a branch taken only on Android counts
once the Android project has run it. To find what is uncovered, parse
`coverage/lcov.info` for `DA:...,0` and `BRDA:...,0` lines rather than reading
the text table.

## In CI

The projects need no simulator, emulator or Windows machine. They run on a
Linux runner:

```yaml
- run: npm ci
- run: npx vitest run --coverage
```

## Next steps

- Keep native-only modules out of Windows files with
  [forbidden modules](configuration.md#forbidden-modules).
- Assert on what SwiftUI, Compose or C++ receives with the
  [helpers](helpers.md).
- Drive a real build with [device tests](device-tests.md).

## Troubleshooting

**`jest is not defined`.** Jest compatibility is off. Use `vi.fn()`,
`vi.mock()` and `vi.spyOn()`.

**An update lands in the next test, or `act` warnings.** A `render` or
`fireEvent` from React Native Testing Library 14 was not awaited.

**A Windows test loads `index.tsx` instead of `index.windows.tsx`.** Only
relative imports of the code under test resolve `.windows.*` first. For a
library installed in `node_modules`, name its source folder in
[`windows.resolveIn`](configuration.md#options).

**A package fails to parse in the iOS or Android project.** It ships
TypeScript or untranspiled source. Name it in
[`transformPackages`](configuration.md#options).

**An Expo package fails to load in the web project.** It has not been
pre-bundled. Name it in [`web.optimize`](configuration.md#options).

**`toBeInTheDocument` is not a function on `expect`.** Add
`expo-vitest/types` to the `types` in `tsconfig.json`. At run time the matchers
are registered by the web project's setup file, so this is a type error only.

**Tests time out under coverage.** The projects run in parallel, and coverage
slows each. Raise [`timeout`](configuration.md#options) from its fifteen
seconds.

**Vitest runs from a folder above the project, as in a monorepo.** Set
[`root`](configuration.md#options) to the project's folder.

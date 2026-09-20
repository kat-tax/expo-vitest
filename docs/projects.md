# Projects

[Docs home](README.md)

`expoProjects()` makes one Vitest project per platform. Each project loads the
files that platform would load, and a test file's name decides which projects
run it.

```ts
import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest';

export default defineConfig({
  test: {projects: expoProjects()},
});
```

| Project | Engine | `Platform.OS` | Testing library |
| --- | --- | --- | --- |
| `ios` | vitest-native's iOS engine | `ios` | `@testing-library/react-native` |
| `android` | vitest-native's Android engine | `android` | `@testing-library/react-native` |
| `web` | react-native-web in jsdom | `web` | `@testing-library/react` with jest-dom |
| `windows` | The iOS engine, told it is Windows | `windows` | `@testing-library/react-native` |

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
only the files named for it.

A platform name works on a `.ts` test too: `colors.web.test.ts` runs on web
only.

A package that exists for Windows alone can run every test there. See
[`windows.include`](configuration.md#options).

## iOS and Android

These run on vitest-native's engine, through `vitest-expo`: React Native's own
JavaScript with the native boundary mocked, `Platform.OS` set, and platform
files resolved in Metro's order (`.ios.tsx`, then `.native.tsx`, then `.tsx`).

Tests use React Native Testing Library, which is asynchronous in version 14:
`await render(...)`, `await fireEvent(...)`.

The native setup gives `@expo/ui` the two things its generic mock lacks:
`ObservableState`, behind `useNativeState`, and `getMaterialColors`, which the
Compose `Host` calls. A test file can still `vi.mock('expo', ...)` for itself.

`@expo/ui` components render as `ViewManagerAdapter_ExpoUI_*` host views whose
props are the payload handed to SwiftUI or Compose.
[`expo-vitest/native`](helpers.md#expo-vitestnative) reads them.

## Web

The web project is react-native-web in jsdom. Tests use
`@testing-library/react` and the jest-dom matchers, which the project's setup
registers.

Expo's packages only load there once Vite's dependency optimizer has
pre-bundled them with the Metro behaviours they rely on. `metroCompat`
supplies those:

- Source extensions are appended past an apparent extension.
- The `.web` twin of a file is preferred.
- An ambient type file is served as an empty module.

Only the packages that are installed are pre-bundled.
[The web pipeline](web-pipeline.md) says how to reuse this outside the tests.

## Windows

react-native-windows has no test renderer, and vitest-native has no Windows
engine. So the Windows project runs on the iOS engine, and what the code under
test branches on says Windows:

- `Platform.OS` is `'windows'`, and `Platform.select` picks `windows`.
- `process.env.EXPO_OS` is `'windows'`.
- `.windows.*` files resolve first, for the project's own code.

React Native's own files keep the iOS order, since they have no Windows
variants outside react-native-windows.

A native component renders as a host view named after it
(`ExpoInterfaceButton`, `ExpoWindowsWebView`), whose props are the payload
handed to the C++ side. That is what a Windows test asserts on, with
[`expo-vitest/windows`](helpers.md#expo-vitestwindows).

### What it proves, and what it does not

It proves the props and events of a native component, and the logic around
them: that a Windows file resolves, imports nothing the platform lacks, and
hands C++ the right payload.

It does not run react-native-windows. What only that renderer does (layout,
focus, what a XAML island draws) is for a [device test](device-tests.md).

### Resolution reaches your code only

Only relative imports of the code under test resolve `.windows.*` first. A
package in `node_modules` resolves as the engine would. An app that tests a
library it installed names the library's source folder in
[`windows.resolveIn`](configuration.md#options).

## What every project carries

Projects do not inherit the root `test` block in Vitest. So each one carries
its own globals, mock clearing and timeout. Coverage and reporters stay in the
root block, which is yours.

| Setting | Value |
| --- | --- |
| Globals | On: `describe`, `it`, `expect`, `vi`. |
| Mocks | Cleared between tests. |
| Timeout | Fifteen seconds a test, since the projects run in parallel and coverage slows each. |
| Jest compatibility | Off. Tests use `vi`. |

## Limits

- The Windows project is React Native's iOS JavaScript told it is Windows. It
  does not run react-native-windows.
- Only relative imports of the code under test resolve `.windows.*` first,
  unless the folder is named in `windows.resolveIn`.
- Jest compatibility is off.

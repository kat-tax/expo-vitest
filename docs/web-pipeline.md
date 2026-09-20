# The web pipeline

[Docs home](README.md)

Expo's packages are written for Metro. Run them through Vite and
react-native-web instead, and several fail to load, because they rely on
things Metro does and Vite does not. The web project handles this for tests.
`expo-vitest/metro-compat` exports the same pieces for anything else that runs
Expo code through Vite, such as a web Storybook.

```ts
import {EXPO_WEB_PACKAGES, metroCompat} from 'expo-vitest/metro-compat';
```

## What Metro does that Vite does not

| Metro behaviour | What breaks without it |
| --- | --- |
| It appends source extensions even when a specifier already looks like it has one. `import './Asset.fx'` finds `Asset.fx.js` in `expo-asset`. | Vite treats `.fx` as the extension and gives up. |
| It prefers the platform twin of a file: `ensureNativeModulesAreInstalled.ts` resolves to its `.web.ts`, which installs the JavaScript core behind `globalThis.expo`. | The native file loads and finds no host. |
| Babel strips a file of ambient `declare class` types to nothing. `expo-modules-core/src/ts-declarations/global` imports them as values. | The import fails. |

`metroCompat()` is a Vite plugin that supplies all three. It serves the
ambient file as an empty module.

## Pre-bundling

The Expo packages only load once Vite's dependency optimizer has pre-bundled
them, with `metroCompat` applied inside the optimizer as well as in the main
pipeline. `EXPO_WEB_PACKAGES` is the list the web project pre-bundles:

`expo`, `expo-router`, `expo-asset`, `expo-modules-core`, `expo-constants`,
`expo-linking`, `expo-font`, `expo-status-bar`, `expo-system-ui`,
`expo-symbols`, `expo-image`, `expo-web-browser`, `@expo/ui`,
`react-native-safe-area-context` and `react-native-screens`.

In the tests, only the packages that are installed are pre-bundled. Add more
with [`web.optimize`](configuration.md#options).

## In a web Storybook

This is how [expo-interface](https://github.com/kat-tax/expo-interface)'s web
Storybook is configured, in `viteFinal`:

```ts
import {mergeConfig} from 'vite';
import {EXPO_WEB_PACKAGES, metroCompat} from 'expo-vitest/metro-compat';

export default {
  // ...
  viteFinal: config =>
    mergeConfig(config, {
      plugins: [metroCompat()],
      optimizeDeps: {
        include: EXPO_WEB_PACKAGES,
        rolldownOptions: {
          plugins: [metroCompat()],
          shimMissingExports: true,
        },
      },
    }),
};
```

`shimMissingExports` is for files without a `.web` twin that import
native-only names from `react-native`, which react-native-web lacks.
`expo-symbols` imports `PlatformColor` and only calls it on Android. Metro
tolerates that, and the optimizer treats it as a build error unless it is
shimmed.

List only the packages your project has installed in `optimizeDeps.include`.

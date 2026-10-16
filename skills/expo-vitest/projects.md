# The unit projects

`expoProjects()` in `vitest.config.mts` makes one Vitest project per platform.
`npx vitest run --project <name>` runs one of them.

| Project | What runs the code | `Platform.OS` | Renders through |
| --- | --- | --- | --- |
| `ios`, `android` | React Native's own JavaScript with the native boundary mocked, through `vitest-expo` | the platform | React Native Testing Library 14 |
| `web` | react-native-web in jsdom | `web` | Testing Library, with the jest-dom matchers |
| `windows` | React Native's JavaScript, told it is Windows, with `.windows.*` files resolved first | `windows` | React Native Testing Library 14 |

Every project reads a render through `render` and `screen` from
`expo-vitest`, the same way.

## The file-name rule

| File name | Runs on |
| --- | --- |
| `*.test.ts`, `*.test.tsx` | iOS, Android, web and Windows |
| `*.native.test.tsx` | iOS and Android |
| `*.ios.test.tsx` | iOS |
| `*.android.test.tsx` | Android |
| `*.web.test.tsx` | web |
| `*.windows.test.tsx` | Windows |

A platform name works on a `.ts` test too: `colors.web.test.ts` runs on web
only. Files resolve in Metro's order: `.ios.tsx`, then `.native.tsx`, then
`.tsx`.

## Writing one

- Globals: `describe`, `it`, `expect`, `vi`. No `jest.*`.
- `await render(<Button/>)`, then `await screen.getByRole('button').press()`
  and `await expect(screen.getByText('Done')).toBeVisible()`, from
  `expo-vitest`. A matcher waits for the tree to agree.
- `expect(await screen.tree()).toMatchSnapshot()` keeps the tree; each
  platform keeps its own, in `__snapshots__/<platform>/`.
- Mock a module for one file with `vi.mock('expo-haptics', () => ({...}))`.
- A module with no Windows implementation can be forbidden in the config, so
  importing it fails the Windows test rather than the app at launch.

## Helpers

| Import | What it is for |
| --- | --- |
| `expo-vitest/native` | `host`, `nodes`, `modifier`, `byComposeTestID`, `stackHeaders`: the props an `@expo/ui` component hands to SwiftUI or Compose. |
| `expo-vitest/windows` | `island`, `islands`, `fireIsland`: find a Windows native component and fire its events as C++ would. |
| `expo-vitest/router` | `renderApp`: mount an Expo Router app from an in-memory `app/` folder. |

More: `node_modules/expo-vitest/docs/unit-tests.md`, `projects.md`,
`configuration.md` and `helpers.md`.

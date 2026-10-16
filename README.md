# expo-vitest

Test Expo apps and libraries with [Vitest](https://vitest.dev) on iOS,
Android, web and Windows.

- **Component tests** run in Node, with one Vitest project per platform. A
  test file's name picks the platforms it runs on, and each platform loads
  its own files, such as `button.ios.tsx` or `button.windows.tsx`.
- **Device tests** drive the running app in a browser, a simulator, an
  emulator, a phone or a Windows window. They use React Native Testing
  Library's queries, and the matchers wait for the screen to update.
- **Agents** carry out steps written in words, and a coding agent can drive
  the app through an MCP server.

There are no runtime dependencies, and nothing is added to your app.

## Setup

You need Node 22.18 or later, Expo SDK 57 and Vitest 4. In your project's
folder:

```sh
npx expo-vitest init
```

`init` reads what the project has, and asks which platforms to set up and
whether to add device tests. It shows each file before it writes it, and
installs the packages if you say yes. Then:

```sh
npm test               # the component tests
npm run test:device    # the device tests, if you added them
```

### By hand

Install the package and the runner. Everything else comes with
`expo-vitest`: the engines, the testing libraries, jsdom, and what drives
each platform. Web tests also need the `react-dom` and `react-native-web` an
app with a web target already has.

```sh
npx expo install --dev expo-vitest vitest
```

Add a Vitest config:

```ts
// vitest.config.mts
import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest/config';

export default defineConfig({
  test: {projects: expoProjects()},
});
```

Add the types for the globals (`describe`, `it`, `expect`, `vi`) and the
matchers:

```json
// tsconfig.json
{"compilerOptions": {"types": ["expo-vitest/types"]}}
```

Run the tests:

```sh
npx vitest run                     # every platform
npx vitest run --project android   # one platform
npx vitest                         # watch mode
```

Tests are looked for under `src`. Name other folders with
`expoProjects({include: ['app', 'components']})`, and only the platforms you
build for with `expoProjects({platforms: ['ios', 'android', 'web']})`.

## Which tests run where

| File name | Runs on |
| --- | --- |
| `*.test.ts`, `*.test.tsx` | iOS, Android, web and Windows |
| `*.native.test.tsx` | iOS and Android |
| `*.ios.test.tsx` | iOS |
| `*.android.test.tsx` | Android |
| `*.web.test.tsx` | web |
| `*.windows.test.tsx` | Windows |

A test runs on every platform unless its name picks some. Each platform
loads its own files of the code under test, such as `button.windows.tsx`, so
one test checks each platform's version.

## Common scenarios

### Test a component on iOS and Android

```tsx
// src/greeting.native.test.tsx
import {render, screen} from '@testing-library/react-native';
import {Greeting} from './greeting';

it('greets by name', async () => {
  await render(<Greeting name="Ada"/>);
  expect(screen.getByText('Hello, Ada')).toBeOnTheScreen();
});
```

React Native Testing Library 14 is asynchronous, so await `render` and
`fireEvent`.

### Test a component on web

```tsx
// src/greeting.web.test.tsx
import {render, screen} from '@testing-library/react';
import {Greeting} from './greeting';

it('greets by name', () => {
  render(<Greeting name="Ada"/>);
  expect(screen.getByText('Hello, Ada')).toBeInTheDocument();
});
```

The web project is react-native-web in jsdom, with the jest-dom matchers.

### Test that each platform loads its own file

```ts
// src/where.test.ts, beside where.ts and a where.<platform>.ts for each platform
import {Platform} from 'react-native';
import {where} from './where';

it('is the file the platform resolves', () => {
  expect(where).toBe(Platform.OS);
});
```

### Check what a native control is given

A SwiftUI, Compose or WinUI control has no DOM to query. The helpers read the
props React Native hands to the native side, and fire its events.

```tsx
// src/wifi.windows.test.tsx
import {render} from '@testing-library/react-native';
import {fireIsland, island} from 'expo-vitest/windows';
import {WifiSwitch} from './wifi';

it('reports the value the switch was toggled to', async () => {
  const onValueChange = vi.fn();
  await render(<WifiSwitch value={false} onValueChange={onValueChange}/>);
  await fireIsland(island('ExpoInterfaceToggleSwitch'), 'valueChange', {value: true});
  expect(onValueChange).toHaveBeenCalledWith(true);
});
```

On iOS and Android, `host`, `modifier` and `byComposeTestID` from
`expo-vitest/native` do the same for `@expo/ui` controls.
[Helpers](docs/helpers.md) has them all.

### Test an Expo Router app

```tsx
// src/settings.native.test.tsx
import {screen} from '@testing-library/react-native';
import {Text} from 'react-native';
import {renderApp} from 'expo-vitest/router';

it('opens the settings route', async () => {
  await renderApp({index: () => <Text>Home</Text>, settings: () => <Text>Settings</Text>}, '/settings');
  expect(await screen.findByText('Settings')).toBeOnTheScreen();
});
```

### Drive the running app

A device test drives a real build and checks the accessibility tree that a
screen reader reads. What drives each platform comes with `expo-vitest`, and
each needs only what it runs on:

| Platform | Needs |
| --- | --- |
| web | A browser: `npx expo-harness install` fetches Chromium |
| iOS, Android | A simulator, an emulator or a phone, with the app installed |
| Windows | A Windows machine and a built app |

`npx expo-harness doctor` says what this machine can drive.

Say where each app is, in `harness.config.ts`. The web dev server is started
for the run and stopped after it:

```ts
// harness.config.ts
import {defineHarness} from 'expo-vitest/config';

export default defineHarness({
  app: {
    web: {url: 'http://localhost:8081', command: {executable: 'npx', args: ['expo', 'start', '--web', '--port', '{port}']}},
    android: {bundleId: 'com.example.app', scheme: 'myapp'},
  },
});
```

Give the device tests a config of their own:

```ts
// vitest.config.device.mts
import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest/config';

export default defineConfig(deviceConfig({platforms: ['web', 'android']}));
```

Write the tests in `device/`:

```ts
// device/sign-in.test.ts
import {device, screen} from 'expo-vitest';

it('signs in', async () => {
  await device.open('/sign-in');
  await screen.getByRole('textbox', {name: 'Email'}).fill('ada@example.com');
  await screen.getByRole('textbox', {name: 'Password'}).fill('correct horse');
  await screen.getByRole('button', {name: 'Sign in'}).press();
  await expect(screen.getByText('Welcome, Ada')).toBeVisible();
});
```

Run them:

```sh
npx vitest run --config vitest.config.device.mts                        # every platform
npx vitest run --config vitest.config.device.mts --project device:web   # one platform
```

Each step waits for the screen to hold still, and each matcher waits until
the screen agrees. A platform this machine cannot drive is skipped, with the
reason. A failing test leaves its screenshot, its tree and a trace of its
steps in `.harness/results/`. [Device tests](docs/device-tests.md) has the
rest, and [Platforms](docs/platforms.md) how to get an app up on each one.

### Run device tests in CI

Give each platform a job: web on Linux, Android on Linux with an emulator,
iOS on macOS with a simulator, and Windows on a Windows runner. The reporters
write a summary of the run, and comment on the pull request with each
failure and links to its evidence:

```ts
// vitest.config.device.mts
import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest/config';
import {github, summary} from 'expo-vitest/reporter';

export default defineConfig(deviceConfig({platforms: ['web', 'android'], reporters: ['default', summary(), github()]}));
```

[CI](docs/ci.md) has whole jobs for GitHub Actions, EAS Workflows, Bitrise
and Codemagic.

### Write a step in words

```ts
// device/billing.test.ts
import {device} from 'expo-vitest';
import {agent} from 'expo-vitest/agent';

it('upgrades the plan', async () => {
  await device.open('/settings/billing');
  await agent.act('upgrade the workspace to the Pro plan');
  await agent.assert('the invoice preview shows a prorated amount');
});
```

A model reads the screen and acts through the same driver as the rest of
the test. A step that was seen to work is replayed on the next run with no
model call. Claude is built in, and any other model is an object with a
`complete` method. [The agent](docs/agent.md) has the setup.

### Let a coding agent work on the app

`init` can add a skill that tells a coding agent how to write, run and read
these tests. It can also register `expo-harness mcp` for Claude Code and
Cursor: an MCP server through which the agent drives the running app.
`npx expo-vitest guide` prints the skill.
[Coding agents](docs/coding-agents.md) has the details.

## Documentation

| Page | What is in it |
| --- | --- |
| [Getting started](docs/getting-started.md) | Setup in full, a test for each platform, coverage, troubleshooting. |
| [Projects](docs/projects.md) | How each platform's component project works, and its limits. |
| [Configuration](docs/configuration.md) | Every option of `expoProjects`, `nodeProject`, `deviceConfig` and `harness.config.ts`. |
| [Helpers](docs/helpers.md) | `expo-vitest/native`, `expo-vitest/windows` and `expo-vitest/router`. |
| [Device tests](docs/device-tests.md) | Running device tests, the device, waiting, the tree, errors, pools, hosted devices. |
| [Platforms](docs/platforms.md) | What each platform needs, how it is driven, and what to know about it. |
| [Locators](docs/locators.md) | `screen`, `within` and the locator they give. |
| [Matchers](docs/matchers.md) | The matchers that wait, and screenshot comparison. |
| [Controls](docs/controls.md) | Restart, clear state, deep links, and the device's settings. |
| [Evidence](docs/evidence.md) | What a failing device test leaves, and video. |
| [The agent](docs/agent.md) | Steps in words, secrets, the replay cache, tools, models and cost. |
| [Coding agents](docs/coding-agents.md) | The skill, the MCP server, explore and bug bash. |
| [The harness](docs/harness.md) | The `expo-harness` command. |
| [CI](docs/ci.md) | A job for each platform, and the pull request comment. |
| [Performance](docs/performance.md) | What each driver's steps cost. |
| [Migrating](docs/migrating.md) | From Detox, Maestro and Playwright. |
| [The web pipeline](docs/web-pipeline.md) | Expo's packages in Vite, as for a web Storybook. |
| [Contributing](docs/contributing.md) | Working on this package. |

What is left to build is in the [roadmap](ROADMAP.md).

## Versions

| | |
| --- | --- |
| Node | 22.18 or later |
| Expo SDK | 57 |
| Vitest | 4 |
| `vitest-expo` | 57.1 |
| `vitest-native` | 0.13 |
| React Native Testing Library | 13 or 14 |

The component projects are built on
[`vitest-expo`](https://github.com/niondigital/vitest-expo) and
[`vitest-native`](https://github.com/danfry1/vitest-native), which run React
Native's JavaScript for iOS and Android under Vitest.

## Good to know

- The Windows component project runs React Native's iOS JavaScript, told it
  is Windows. It checks the props and events a native component gets, and
  the logic around them, but not what react-native-windows draws. A device
  test checks that.
- Jest compatibility is off. Use `vi`, not `jest`.

## Used by

[expo-interface](https://github.com/kat-tax/expo-interface), a UI kit with a
file per platform for every component, and
[expo-windows](https://github.com/kat-tax/expo-windows), the Windows platform
for Expo apps.

## License

MIT

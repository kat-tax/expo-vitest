---
name: expo-vitest
description: "Test Expo code with Vitest on iOS, Android, web and Windows: unit tests routed by file name, device tests against a running app, and the expo-harness command. Use when writing or running a test in a project that uses expo-vitest, or when a device test failed and left evidence under .harness/."
argument-hint: "[projects|device|evidence|harness|agent|mcp|explore|bug-bash]"
allowed-tools: Bash(npx vitest *), Bash(npx expo-harness *), Bash(npx expo-vitest *), Bash(bunx vitest *), Bash(bunx expo-harness *), Bash(bunx expo-vitest *), Read, Grep
metadata:
  version: 0.2.1
---

# expo-vitest

This project tests its Expo code with Vitest through `expo-vitest`. There are
two kinds of test, each with its own config:

- **Unit tests**, `vitest.config.mts`: a Vitest project per platform,
  `ios`, `android`, `web` and `windows`. The name of a test file says which
  of them run it. Nothing native runs: React Native's JavaScript renders with
  the native boundary mocked, and a test reads the render as a device test
  reads the app.
- **Device tests**, `vitest.config.device.mts`, under `device/`: they drive
  the real app and assert on its accessibility tree, the one a screen reader
  reads. Web is a headless Chromium, or Firefox or WebKit under
  HARNESS_BROWSER, Windows is UI Automation, and iOS and Android are
  agent-device.

## Run

| What | Command |
| --- | --- |
| Every unit test | `npx vitest run` |
| One platform | `npx vitest run --project ios` |
| One file | `npx vitest run src/button.test.tsx` |
| The device tests | `npx vitest run --config vitest.config.device.mts` |
| One platform's device tests | `npx vitest run --config vitest.config.device.mts --project device:web` |

The device tests start the app themselves where `harness.config.ts` names a
command for it, such as `expo start --web`, and stop it after.

## Name a test for its platforms

| File name | Runs on |
| --- | --- |
| `*.test.ts`, `*.test.tsx` | iOS, Android, web and Windows |
| `*.native.test.tsx` | iOS and Android |
| `*.ios.test.tsx`, `*.android.test.tsx`, `*.web.test.tsx`, `*.windows.test.tsx` | that one |

A test runs on every platform unless its name picks some. Each platform
loads its own files of the code under test, and keeps its own snapshots, in
`__snapshots__/<platform>/`.

## Write a unit test

```tsx
import {render, screen} from 'expo-vitest';
import {Settings} from './settings';

it('saves the name', async () => {
  await render(<Settings/>);
  await screen.getByRole('textbox', {name: 'Name'}).fill('Ada');
  await screen.getByRole('button', {name: 'Save'}).press();
  await expect(screen.getByText('Saved')).toBeVisible();
  expect(await screen.tree()).toMatchSnapshot();
});
```

- `render` and `screen` come from `expo-vitest`, the same `screen`, actions
  and matchers as a device test's, on every platform. Await `render`, each
  action and each matcher.
- `screen.tree()` is the accessibility tree as text, the same on every
  platform, for a snapshot.
- `describe`, `it`, `expect` and `vi` are globals. Jest compatibility is off:
  `vi.fn()`, `vi.mock()`, `vi.spyOn()`, never `jest.*`.
- An Expo Router app: `renderApp(routes)` from `expo-vitest/router`, then
  `device.open(route)` to move to a route.

## Write a device test

```ts
import {device, screen} from 'expo-vitest';

it('saves the profile', async () => {
  await device.open('/settings');
  await screen.getByRole('textbox', {name: 'Name'}).fill('Ada');
  await screen.getByRole('button', {name: 'Save'}).press();
  await expect(screen.getByText('Saved')).toBeVisible();
});
```

- `screen` has React Native Testing Library's queries over the running app.
  `getBy*` gives a locator, which waits for its node when acted on and is
  strict: several matches fail, listing them.
- The matchers on a locator wait for the tree to agree: `toBeVisible`,
  `toBeHidden`, `toHaveText`, `toBeChecked`, `toHaveCount` and more.
- Each step waits for the screen to hold still. Do not add sleeps.
- A step a platform cannot take answers `'skipped'` rather than failing, so
  one test runs on all four.

## When a device test fails

Read `.harness/results/<platform>/<test file>/<test>/trace.md` first. It has
the failure, every step with what it did to the screen, and the screen at the
end. `screenshot.png` and `tree.txt` are beside it. A screenshot baseline is
recorded only under `HARNESS_UPDATE_SCREENSHOTS=1` or `vitest -u`, never by a
run on its own.

## For a coding agent

- To find a flow before writing its test, drive the app over the MCP server
  (`mcp`): observe, act by ref, and `locate` the node, which answers the
  `screen.*` call to write.
- To look for bugs, `explore` runs the agent with a goal, and `bug-bash`
  runs many goals at once and writes a test for each issue it finds.
- A step in words is `agent.act` (`agent`); follow it with a check.

## Topics

Each prints with `npx expo-vitest guide <topic>`:

| Topic | What it holds |
| --- | --- |
| `projects` | The four projects, the file-name rule, mocks, and the helpers for native and Windows components. |
| `device` | Device tests: the configs, `harness.config.ts`, queries, actions, matchers, the app's life, the device's settings, gating, screenshots. |
| `evidence` | What a failing device test leaves, and how to read it. |
| `harness` | The `expo-harness` command, for looking at a running app by hand. |
| `agent` | Steps in words: `agent.act`, `assert`, `waitFor`, `extract`, secrets and the replay cache. |
| `mcp` | The MCP server a coding agent drives the app through, and its loop. |
| `explore` | The agent with a goal: writing one, and reading its report against its evidence. |
| `bug-bash` | Many explores at once, the feature map, and promoting a skeleton to a test. |

The package's whole documentation is in `node_modules/expo-vitest/docs/`.

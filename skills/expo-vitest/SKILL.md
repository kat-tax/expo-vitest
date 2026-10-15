---
name: expo-vitest
description: "Test Expo code with Vitest on iOS, Android, web and Windows: component tests routed by file name, device tests against a running app, and the expo-harness command. Use when writing or running a test in a project that uses expo-vitest, or when a device test failed and left evidence under .harness/."
argument-hint: "[projects|device|evidence|harness]"
allowed-tools: Bash(npx vitest *), Bash(npx expo-harness *), Bash(npx expo-vitest *), Bash(bunx vitest *), Bash(bunx expo-harness *), Bash(bunx expo-vitest *), Read, Grep
metadata:
  version: 0.1.0
---

# expo-vitest

This project tests its Expo code with Vitest through `expo-vitest`. There are
two kinds of test, each with its own config:

- **Component tests**, `vitest.config.mts`: a Vitest project per platform,
  `ios`, `android`, `web` and `windows`. The name of a test file says which
  of them run it. Nothing native runs: React Native's JavaScript renders with
  the native boundary mocked.
- **Device tests**, `vitest.config.device.mts`, under `device/`: they drive
  the real app and assert on its accessibility tree, the one a screen reader
  reads. Web is a headless Chromium, or Firefox or WebKit under
  HARNESS_BROWSER, Windows is UI Automation, and iOS and Android are
  agent-device.

## Run

| What | Command |
| --- | --- |
| Every component test | `npx vitest run` |
| One platform | `npx vitest run --project ios` |
| One file | `npx vitest run src/button.test.tsx` |
| The device tests | `npx vitest run --config vitest.config.device.mts` |
| One platform's device tests | `npx vitest run --config vitest.config.device.mts --project device:web` |

The device tests start the app themselves where `harness.config.ts` names a
command for it, such as `expo start --web`, and stop it after.

## Name a test for its platforms

| File name | Runs on |
| --- | --- |
| `*.test.ts` | iOS, Android, web and Windows |
| `*.test.tsx` | iOS, Android and web |
| `*.native.test.tsx` | iOS and Android |
| `*.ios.test.tsx`, `*.android.test.tsx`, `*.web.test.tsx`, `*.windows.test.tsx` | that one |

A `.test.ts` file holds logic, which is the same everywhere. A `.test.tsx`
file renders, and Windows renders a different tree, so it runs only the files
named for it.

## Write a component test

- `describe`, `it`, `expect` and `vi` are globals. Jest compatibility is off:
  `vi.fn()`, `vi.mock()`, `vi.spyOn()`, never `jest.*`.
- React Native Testing Library 14 is asynchronous: `await render(...)`,
  `await fireEvent(...)`.
- Web tests use `@testing-library/react` and the jest-dom matchers.

## Write a device test

```ts
import {device, screen} from 'expo-vitest/device';

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

## Topics

Each prints with `npx expo-vitest guide <topic>`:

| Topic | What it holds |
| --- | --- |
| `projects` | The four projects, the file-name rule, mocks, and the helpers for native and Windows components. |
| `device` | Device tests: the configs, `harness.config.ts`, queries, actions, matchers, the app's life, the device's settings, gating, screenshots. |
| `evidence` | What a failing device test leaves, and how to read it. |
| `harness` | The `expo-harness` command, for looking at a running app by hand. |

The package's whole documentation is in `node_modules/expo-vitest/docs/`.

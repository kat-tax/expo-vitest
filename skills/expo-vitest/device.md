# Device tests

Device tests drive the real app and read its accessibility tree. Nothing is
installed in the app.

## The configs

`vitest.config.device.mts`:

```ts
import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest/config';

export default defineConfig(deviceConfig({platforms: ['web', 'android']}));
```

Each platform is a project, `device:web`, `device:android`, and so on. A
platform this machine cannot drive has its tests skipped with the reason, or
failed with `DRIVER_UNAVAILABLE` in CI or under `HARNESS_REQUIRE=1`.

`harness.config.ts` names each platform's app:

```ts
import {defineHarness} from 'expo-vitest/config';

export default defineHarness({
  app: {
    web: {url: 'http://localhost:8081', command: {executable: 'npx', args: ['expo', 'start', '--web', '--port', '{port}']}},
    android: {bundleId: 'com.example.app', scheme: 'myapp'},
  },
});
```

An environment variable beats the file: `HARNESS_URL`, `HARNESS_TARGET`,
`HARNESS_SCHEME`, `HARNESS_ASSERTION_TIMEOUT`.

## Finding a node

`screen` has React Native Testing Library's queries: `getByRole`, `getByText`,
`getByLabelText`, `getByPlaceholderText`, `getByDisplayValue`, `getByTestId`
and `getByHintText`, and Testing Library's `getByAltText` and `getByTitle`,
each in the `getAllBy`, `queryBy`, `findBy` families too.
`within(locator)` scopes the queries to one node.

`getByRole('button', {name: 'Save'})` reads the node's kind, the same word on
every platform. Prefer a role with a name, then a testID; a coordinate only as
a last resort.

## Acting on it

A locator acts and waits: `.press()`, `.press({count: 2})` for a double tap
or double click, `.fill(text)`, `.clear()`, `.type(text)`, `.check()`,
`.uncheck()`, `.longPress()`, `.hover()`, `.focus()`, `.key('Enter')`,
`.scrollIntoView()`, `.swipe('up')`, `.dragTo(other)`, `.pinch(2)`. It is strict:
`.first()`, `.nth(i)` or `.filter({hasText})` narrows one that matches
several.

## Asserting

The matchers on a locator wait, five seconds by default:

```ts
await expect(screen.getByText('Saved')).toBeVisible();
await expect(screen.getByRole('progressbar')).toBeHidden();
await expect(screen.getAllByRole('listitem')).toHaveCount(3);
await expect(screen.getByRole('checkbox', {name: 'News'})).toBeChecked();
```

`toBeHidden` waits for the node to be gone and to stay gone for a second, so a
flicker does not pass it.

## The app's life and the device's settings

`device.restart()`, `clearState()`, `stopApp()`, `back()`, `home()`,
`installApp()`, `openLink(url)` and `foregroundApp()`;
`setAppearance('dark')`, `setOrientation()`, `setNetwork('offline')`,
`setPermission()`, `setLocation()`, `setClipboard()`, `dismissKeyboard()`,
`alert('accept')` and the rest. Each answers `'skipped'` where a platform has
no counterpart, and `device.lastSkip` says why. A setting stays until it is
changed back: put it back in `afterEach`.

On web, `device.web` has what a browser has and a device does not:
`route(pattern, handler)` to answer requests, `onDialog`, `evaluate`,
`setViewport`, the cookies, `waitForDownload`, `selectOption`,
`setInputFiles`, `secondaryTap`, and `frame(selector)`, a screen of an
iframe. Off web each answers `'skipped'`; gate on `device.can('web')`.

## Gating

```ts
import {onlyOn, requires, skipOn} from 'expo-vitest';

requires(['setLocation'], () => {
  it('shows the map', async () => {});
});
```

`device.can('fold')` answers for this platform and this device.

## Screenshots

```ts
await expect(device).toMatchScreenshot('home', {mask: [by.testID('clock')]});
await expect(screen.getByRole('button', {name: 'Pay'})).toMatchScreenshot('pay');
```

Without a baseline the picture is kept as evidence and the test passes. A
baseline is recorded only under `HARNESS_UPDATE_SCREENSHOTS=1` or `vitest -u`.
A baseline belongs to the machine that drew it.

More: `node_modules/expo-vitest/docs/device-tests.md`, `platforms.md`,
`locators.md`, `matchers.md`, `controls.md` and `configuration.md`.

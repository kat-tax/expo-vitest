# Unit tests

[Docs home](README.md) · [Projects](projects.md) · [Locators](locators.md) · [Matchers](matchers.md)

A unit test renders a component in Node, in the project of each platform it
runs on, and reads it the way a device test reads a running app: the same
`screen`, the same actions, the same matchers that wait, and the same tree.
A test written for a component reads like one written for the app.

```tsx
// src/settings.test.tsx
import {render, screen} from 'expo-vitest';
import {Settings} from './settings';

it('saves the name', async () => {
  await render(<Settings/>);
  await screen.getByRole('textbox', {name: 'Name'}).fill('Ada');
  await screen.getByRole('switch', {name: 'Newsletter'}).check();
  await screen.getByRole('button', {name: 'Save'}).press();
  await expect(screen.getByText('Saved')).toBeVisible();
  expect(await screen.tree()).toMatchSnapshot();
});
```

A `.test.tsx` file runs on iOS, Android, web and Windows unless its
[name](projects.md#which-tests-run-where) picks some, and this one passes on
all four.

## render

`render(element, {wrapper})` mounts the element for the test, in place of
what the test rendered before, inside `wrapper` where one is given, such as
the app's providers. It answers `rerender(element)`, which renders again in
place, and `unmount()`. A test's render is taken away when the test ends.

`renderApp(routes, url)` from [`expo-vitest/router`](helpers.md#expo-vitestrouter)
mounts an Expo Router app from an in-memory `app/` folder instead, and
`device.open(route)` then goes to a route of it, as it opens one on a
device:

```tsx
import {Text} from 'react-native';
import {device, screen} from 'expo-vitest';
import {renderApp} from 'expo-vitest/router';

it('opens the settings', async () => {
  await renderApp({index: () => <Text>Home</Text>, settings: () => <Text>Settings</Text>});
  await device.open('/settings');
  await expect(screen.getByText('Settings')).toBeVisible();
});
```

`render` belongs to unit tests. A device test has the app already, and
`render` there fails with `INVALID_ARGUMENT`.

## Reading and acting

Everything on [Locators](locators.md) and [Matchers](matchers.md) works on
a render: the queries and `within`, a locator's actions, the matchers that
wait, `device.snapshot()` and the four matchers on a snapshot, such as
`toBeFullyLabelled`. A wait reads the tree again until it agrees, so a test
waits for a state update or a promise the component starts, as it would on
a device.

| Platform | The tree is read from | An action goes through |
| --- | --- | --- |
| iOS, Android, Windows | the host views React Native Testing Library rendered: each one's role, label, state and value, as a screen reader reads them | React Native Testing Library's events: a press, a long press, focus and blur, a change of text, a submit for Enter. A switch is told the value it changes to. |
| web | the DOM react-native-web rendered into jsdom, by the script the web driver reads a browser's page with | user-event: a click, typing, a key, a hover and a held pointer, as a person's pointer and keyboard act |

The tree of a component reads the same on every platform: a field is a
`textbox`, a switch a `switch`, a pressable with a role of `button` a
`button`, each named as a screen reader names it.

| A unit test | Unlike a device |
| --- | --- |
| lays nothing out | Everything rendered is on the screen, and has no bounds. `scrollIntoView` has nothing to do, a node is off the screen only where it is hidden, and a swipe or a drag, which draw across the screen, is for a device test. |
| draws nothing | `device.screenshot` fails with `UNSUPPORTED_CAPABILITY`, and `toMatchScreenshot` passes, saying nothing was compared, so a test shared with a device test still runs. `device.can('screenshot')` is false. |
| has no device | Restarting the app, its settings and the rest of [Controls](controls.md) are for a device test, and `device.can` says so for each. |
| moves the focus as its platform does | On web a press focuses what it pressed, as a browser does; on iOS and Android the field a person typed in keeps the focus. |

A test that fails leaves its [evidence](evidence.md): the trace of its steps
and the tree, as a device test does, with no screenshot.

## Snapshots

`screen.tree()` is the tree as text, a node a line, with no refs, named by
the kind every platform shares:

```
textbox "Name" (value:"Ada" placeholder:"Your name")
switch "Newsletter" [checked]
button "Save"
  text "Save"
text "Saved"
```

`expect(await screen.tree()).toMatchSnapshot()` keeps it. Each platform
keeps its snapshots apart, in `__snapshots__/<platform>/` beside the test,
so the four runs of one test compare against their own. `within(locator).tree()`
is the tree from that node down.

## Native components

A component the platform draws itself renders as a host view named after
it, such as `ExpoInterfaceToggleSwitch` in the Windows project, with the
props its native side is handed. It is in the tree where it has a role, a
label or a testID, named by its type. The helpers of
[`expo-vitest/native`](helpers.md#expo-vitestnative) and
[`expo-vitest/windows`](helpers.md#expo-vitestwindows) read those props and
fire its events, beside `screen`.

## The testing libraries' own API

React Native Testing Library and Testing Library come with expo-vitest, and
a test can still use them: `render` and `screen` from either, and their
matchers on what they return. A matcher both have, such as `toBeVisible`,
waits on a locator and takes an element as the library's does.

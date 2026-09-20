# Helpers

[Docs home](README.md)

A native control has no DOM to query. What a test can see is the host view
React Native renders for it, and the props on that view are the payload handed
to SwiftUI, Jetpack Compose or C++. These helpers find those views.

| Import | For |
| --- | --- |
| [`expo-vitest/native`](#expo-vitestnative) | iOS and Android tests |
| [`expo-vitest/windows`](#expo-vitestwindows) | Windows tests |
| [`expo-vitest/router`](#expo-vitestrouter) | Every platform |

## expo-vitest/native

For iOS and Android. `@expo/ui` components render as
`ViewManagerAdapter_ExpoUI_*` host views (`_HostView`, `_ToggleView` and so on)
whose props are the payload handed to SwiftUI or Compose.

| Function | What it does |
| --- | --- |
| `nodes(root?)` | Every host node of the rendered tree, flattened. Each has `type`, `props` and `children`. |
| `host(predicate, root?)` | The first host node whose props match. Throws with an outline of the tree when none does, so a failure shows what was rendered. |
| `modifier(props, type)` | The SwiftUI or Compose modifier of that `$type` from a `modifiers` prop, or `undefined`. |
| `byComposeTestID(id)` | The host node carrying a Compose `testID` modifier. Android. |
| `stackHeaders()` | The `headerConfig` of each mounted native stack item, which is where the native stack's header options end up. |

```tsx
import {render, screen} from '@testing-library/react-native';
import {Platform} from 'react-native';
import {byComposeTestID, host, modifier} from 'expo-vitest/native';

it('hands SwiftUI the prominent style', async () => {
  await render(<Button testID="save" label="Save" variant="filled"/>);
  const button = Platform.OS === 'ios' ? screen.getByTestId('save') : byComposeTestID('save');
  if (Platform.OS === 'ios') {
    expect(modifier(button.props, 'buttonStyle')).toEqual({$type: 'buttonStyle', style: 'borderedProminent'});
  }
});

it('finds a view by any prop', async () => {
  await render(<Switch label="Wi-Fi" value onValueChange={() => {}}/>);
  expect(host(props => props.text === 'Wi-Fi')).toBeTruthy();
});
```

`Button` and `Switch` here are
[expo-interface](https://github.com/kat-tax/expo-interface)'s, which render
`@expo/ui` controls. The props you match on are whatever your component hands
its native view.

Why a Compose `testID` needs its own finder: on Android a `testID` reaches
Compose as a modifier, not as a prop on the host view, so
`screen.getByTestId` does not see it.

## expo-vitest/windows

For Windows native components. In the Windows project a native component
renders as a host view named after it (`ExpoInterfaceButton`,
`ExpoWindowsWebView`), whose props are the payload handed to the C++ side.

| Function | What it does |
| --- | --- |
| `island(name, index?)` | The host view of a native component by its name. Throws when there is none, and says how many were rendered. |
| `islands(name)` | Every one, in order. |
| `fireIsland(view, event, payload?)` | Fires a native event as the C++ side dispatches it, with the payload as `nativeEvent`. Always awaited. |

```tsx
import {render} from '@testing-library/react-native';
import {fireIsland, island} from 'expo-vitest/windows';

const TOGGLE = 'ExpoInterfaceToggleSwitch';

it('hands WinUI the value and the name', async () => {
  await render(<Switch label="Wi-Fi" value onValueChange={vi.fn()}/>);
  expect(island(TOGGLE).props.value).toBe(true);
  expect(island(TOGGLE).props.accessibilityLabel).toBe('Wi-Fi');
});

it('reports the toggled value from the island', async () => {
  const onValueChange = vi.fn();
  await render(<Switch label="Wi-Fi" value={false} onValueChange={onValueChange}/>);
  await fireIsland(island(TOGGLE), 'valueChange', {value: true});
  expect(onValueChange).toHaveBeenCalledWith(true);
});
```

This is expo-interface's `Switch`, whose Windows file renders a native
component called `ExpoInterfaceToggleSwitch`. The event names and the props are
your component's own. They come from its spec, the file the C++ codegen reads.
An event declared as `onValueChange` is fired as `valueChange`.

`fireIsland` is asynchronous because Testing Library flushes React in an async
act. Await it, or the update lands in the next test.

## expo-vitest/router

On every platform.

| Function | What it does |
| --- | --- |
| `renderApp(routes, initialUrl?)` | Mounts an Expo Router app from an in-memory `app/` folder: a route name to a screen. `initialUrl` is `/` by default. |

```tsx
import {Stack} from 'expo-router';
import {Text} from 'react-native';
import {renderApp} from 'expo-vitest/router';

it('opens the settings route', async () => {
  await renderApp(
    {
      _layout: () => <Stack/>,
      index: () => <Text>Home</Text>,
      settings: () => <Text>Settings</Text>,
    },
    '/settings',
  );
});
```

Query with React Native Testing Library's `screen` on iOS, Android and
Windows, and with `@testing-library/react`'s on web. In a test that runs on
both kinds, import the one for the platform:

```tsx
if (Platform.OS === 'web') {
  const {screen} = await import('@testing-library/react');
  expect(await screen.findByText('Settings')).toBeTruthy();
} else {
  const {screen} = await import('@testing-library/react-native');
  expect(await screen.findByText('Settings')).toBeOnTheScreen();
}
```

On web it renders `ExpoRoot` into the DOM, since React Native Testing
Library's renderer produces no DOM for react-native-web's output. It also
supplies the `ResizeObserver` jsdom lacks, which a stack header measures with.

`expo-router` is an optional peer. Install it to use this helper.

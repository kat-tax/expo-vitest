# Controls

[Docs home](README.md)

A device test can start the app again, clear what it kept, go back or home,
install a build, open a link, and ask which app is in front. It can also set
the device: its appearance, orientation and network, a permission, its
location, biometrics, a fold, the clipboard, the keyboard and an alert. Each
is a method of `device`, and each runs on every platform. A platform with no counterpart
for one answers `'skipped'` rather than failing, and `device.lastSkip` says
why, so one test runs on all four platforms and says what it could not do.

```ts
import {device, screen} from 'expo-vitest';

it('starts signed out once its state is cleared', async () => {
  await device.clearState();
  await expect(screen.getByRole('button', {name: 'Sign in'})).toBeVisible();
});
```

## The app's life

| `device.` | iOS and Android | Web | Windows |
| --- | --- | --- | --- |
| `restart()` | The app relaunched, with its permissions set first and its launch arguments | A new browser context at the base url, with its permissions granted | The exe ended with everything it started, then started with the base link and the launch arguments, and its window waited for |
| `clearState()` | The app's data cleared, then a restart | A restart: a new context keeps no cookies and no storage | The folder `app.windows.stateDir` names deleted between the end and the start; skipped without one |
| `stopApp()` | The app ended, its data kept, through agent-device's close of the harness config's `bundleId` | The page left for a blank one: the app's script ends, and its cookies and storage stay | The exe ended with everything it started, and its window waited for |
| `back()` | The device's back | The page before, in the history | Skipped: react-native-windows has no system back |
| `home()` | The home screen, with the app left running behind it | Skipped | Skipped |
| `resumeApp()` | The app in front again where it left off, opened without a relaunch through agent-device: back from the background after `home` or another app, or started where it is not running | The page brought to the front, and opened at the app again where `stopApp` left it blank | The window raised where it is open, or the exe started where it is not |
| `installApp(path?, {reinstall})` | The build at `path`, or the harness config's `appPath`, installed over the one there, which keeps its data, or with `reinstall` in place of it, which takes its data with it | Skipped | An `.msix` installed with `Add-AppxPackage`; skipped for anything else |
| `openLink(url)` | The link opened as the device opens one, which may be in another app. iOS first asks whether to open it in the app, which is answered Open, as a person following the link does | An `http` or `https` url opened; skipped for anything else | The exe started with the url, which the window already open receives |
| `foregroundApp()` | The package on Android, the bundle id on iOS | The page's url | The process whose window is in front |

Each answers `'done'` or `'skipped'`, and `foregroundApp` answers `null`
where it cannot tell. A control a platform has, but that cannot be done,
throws a `HarnessError` as any step does. A restart needs
`app.<platform>.bundleId` on a device and the exe as the target on Windows,
and an install needs a build, and each says so when the harness config has
none.

## The device's settings

None of these puts itself back. A test that changes one changes it back in
`afterEach`, or the next test starts where it left off:

```ts
afterEach(async () => {
  await device.setAppearance('light');
  await device.setNetwork('online');
});
```

| `device.` | iOS and Android | Web | Windows |
| --- | --- | --- | --- |
| `setAppearance('light' \| 'dark')` | The system's appearance | The page's colour scheme | Skipped: the app follows the Windows theme, which is the whole machine's |
| `setOrientation(orientation)` | The device turned to `portrait`, `portrait-upside-down`, `landscape-left` or `landscape-right` | The viewport turned, its long side down for a portrait | Skipped |
| `setNetwork('online' \| 'offline')` | Android: Wi-Fi on or off, which leaves mobile data alone. iOS: skipped, since the simulator shares the Mac's network | The browser context online or offline | Skipped |
| `setAirplaneMode(on)` | Android: airplane mode. iOS: skipped | Skipped | Skipped |
| `setPermission(name, state)` | The app's permission set to `grant`, `deny` or `reset` | `grant` granted to the context, and `reset` clears every grant. `deny` is skipped | Skipped |
| `setLocation({latitude, longitude})` | Where the device says it is | Where the page's geolocation says it is, with the permission granted | Skipped |
| `travel(places, {speed})` | The device moved along a route of two places or more, at `speed` metres a second, 100 by default: put at a position on the way each second, through `setLocation`, and on the last place at the end | The page moved the same way | Skipped |
| `clearLocation()` | Location off: on Android for the whole device, on an iOS simulator for the app | No position for the page to read | Skipped |
| `setBiometrics(sensor, result)` | The next prompt answered with a `match` or a `nonmatch`: `faceid` or `touchid` on an iOS simulator, `fingerprint` on an Android emulator. Another sensor is skipped | Skipped | Skipped |
| `enrollBiometrics(sensor, enrolled)` | iOS simulator: Face ID or Touch ID enrolled or not. Android: skipped | Skipped | Skipped |
| `fold(pose)` | A foldable simulator or emulator put `closed`, `half-open` or `open` | Skipped | Skipped |
| `clipboard()`, `setClipboard(text)` | The device's clipboard. Android 16 has no clipboard command for agent-device to use, so there it is not among `device.capabilities` | The browser's own clipboard | The machine's clipboard, through the host |
| `dismissKeyboard()` | The keyboard on the screen put away | The focus taken off what had it | Skipped |
| `alert('accept' \| 'dismiss')` | The system alert on the screen answered | The next dialog the page opens answered, since a browser decides one as it opens | Skipped: a WinUI dialog is in the tree, so press its button by its label |

Where the platform has a control but the device does not, the call throws
with agent-device's reason, and [`requires`](#what-a-device-can-do) is how a
block of tests steps around it: `fold` on a phone that does not fold is
`UNSUPPORTED_CAPABILITY`, and `alert` with no alert on the screen is
`ACTION_FAILED`.

What goes on the clipboard is not written to the [trace](evidence.md): the
step says how many characters. On Windows the clipboard is the machine's, and
an Android emulator may share its clipboard with the machine it runs on, so a
test that sets it replaces what someone copied. On web the clipboard is
Chromium's alone: Firefox grants a page no clipboard permission, and WebKit
none to write with, so under [either](platforms.md#the-browser) the two are
not in `device.capabilities`.

The headless Chromium has no notifications, so `Notification.permission`
stays `denied` whatever is granted. A page that asks
`navigator.permissions.query` sees the grant.

## What a device can do

`device.can(name)` says whether this platform and this device have a step or
a control, and `device.capabilities` is the set of every one they have. The
names are the steps, `open`, `press`, `fill`, `type`, `screenshot`, `key`,
`longPress`, `hover`, `focus`, `scrollIntoView`, `swipe`, `drag` and `pinch`, then
`video` for a [recording](evidence.md#video), `web` for
[`device.web`](device-tests.md#deviceweb), which web alone has,
`screenshot:element` for a [picture of one element](matchers.md#tomatchscreenshot),
`statusBar` for a status bar made the same in every picture, which iOS and
Android have, and the controls by their method names.

A control a platform has no counterpart for is not in the set, and neither
is one this device lacks:

- `fold` on a phone or simulator whose name does not say it folds;
- `setAirplaneMode` on Android before 11;
- biometrics on a physical device;
- `statusBar` on a physical iPhone, whose status bar agent-device leaves as
  it is;
- on Windows, `installApp` without an `.msix`, and `clearState` without a
  `stateDir`.

The device is known once its driver has opened, or before then from the
warm-up of a project per platform.

Three wrappers make a block of tests depend on it:

```ts
import {onlyOn, requires, skipOn} from 'expo-vitest';

onlyOn(['windows', 'web'], () => {
  it('has a menu bar', async () => {});
});

skipOn(['ios'], () => {
  it('reads the network from the app', async () => {});
});

requires(['setLocation', 'fold'], () => {
  it('shows the map on the inner screen', async () => {});
});
```

`onlyOn` and `skipOn` report their block skipped on the other platforms.
`requires` skips each test in its block where something is missing, and the
reason names it: `android cannot fold, since Pixel 9 Pro XL does not fold`.
`device.cannot(names)` gives that sentence, or null, to a test that decides
for itself.

## A fresh launch

Launch arguments and permissions come from the app's entry in
[`harness.config.ts`](configuration.md#harnessconfigts), and apply to a fresh
launch only: `restart()`, `clearState()`, and on Windows an `open` that has
to start the app.

```ts
// harness.config.ts
export default defineHarness({
  app: {
    android: {bundleId: 'com.example.app', launchArguments: ['--es', 'from', 'tests'], permissions: {camera: 'grant', notifications: 'deny'}},
    web: {permissions: {location: 'grant'}},
  },
});
```

- **Launch arguments** are the app process's arguments on iOS, and `am start`
  arguments on Android, such as an extra. On Windows they follow the link on
  the exe's command line, each quoted as a Windows program reads its
  arguments back. The exe is started with none of the harness's handles, so
  a pipeline the harness writes into, as `| tee` in Git Bash, ends with the
  harness rather than with the app.
- **Permissions** take agent-device's names: `camera`, `microphone`,
  `photos`, `contacts`, `notifications`, `calendar`, `location` and the
  rest. On a device each is set to `grant`, `deny` or `reset` before the
  launch, so no prompt asks. On web the granted ones the browser has are
  granted to every browser context the harness makes, `location` as
  `geolocation`: Chromium has the six there are on web, WebKit all but
  `motion`, and Firefox `notifications` and `location` alone. One the
  browser lacks is passed over, and the run says so. Playwright has no deny,
  so `deny` and `reset` leave the default.

## An Expo development build

A development build loads its JavaScript from a dev server, so the run
starts the server, the way it starts a web app's, and opens the build
pointed at it. On Android:

```ts
// harness.config.ts
export default defineHarness({
  app: {
    android: {
      bundleId: 'com.example.app',
      scheme: 'myapp',
      url: 'http://localhost:8099',
      command: {executable: 'npx', args: ['expo', 'start', '--dev-client', '--port', '{port}'], env: {EXPO_NO_DEV_MENU: '1'}},
    },
  },
});
```

```ts
// device/home.test.ts
const server = 'http://localhost:8099';

beforeAll(async () => {
  await device.openLink(`exp+my-app://expo-development-client/?url=${encodeURIComponent(server)}&disableOnboarding=1&disableFab=1&disableAutoLaunch=1`);
  // The first bundle takes a while.
  await expect(screen.getByText('Welcome')).toBeVisible({timeout: 100_000});
});
```

- The link is the one `expo-dev-client` registers, `exp+<slug>`, the app
  config's `slug`. The launcher on Android reads no launch arguments, so the
  link is how it learns where the server is.
- `disableOnboarding=1` keeps the developer menu's first sheet away, which
  otherwise covers the app on its first launch; `disableFab=1` hides the
  menu's floating button, and `disableAutoLaunch=1` keeps the launcher from
  opening the last server by itself.
- The device reaches the server at the url the link gives. On an emulator,
  or a device over USB, `adb reverse tcp:8099 tcp:8099` makes the device's
  `localhost` the machine's, until the device restarts.
- After it, `device.open('/settings')` opens a route through the app's
  `scheme`, and `device.react()` reads the [React tree](device-tests.md#the-react-tree)
  through the same server, with `HARNESS_METRO` set to its url.
- A port of its own keeps the run off the dev server a person may have
  running on 8081.

## On Windows

A Windows app that is not running is started by the first `open` or
`restart`, so `expo-harness doctor` reports Windows ready once the app's exe
is known.

A restarted window may not come to the front. Windows lets a process in the
background start a window but not take the foreground from the one someone is
using, and `foregroundApp()` says what is in front. The harness raises the
app before it sends any synthetic input, as it always does.

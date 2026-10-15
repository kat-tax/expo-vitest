# Controls

[Docs home](README.md)

A device test can start the app again, clear what it kept, go back or home,
install a build, open a link, and ask which app is in front. Each is a method
of `device`, and each runs on every platform. A platform with no counterpart
for one answers `'skipped'` rather than failing, and `device.lastSkip` says
why, so one test runs on all four platforms and says what it could not do.

```ts
import {device, screen} from 'expo-vitest/device';

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
| `back()` | The device's back | The page before, in the history | Skipped: react-native-windows has no system back |
| `home()` | The home screen, with the app left running behind it | Skipped | Skipped |
| `installApp(path?, {reinstall})` | The build at `path`, or the harness config's `appPath`, installed, in place of the one there with `reinstall` | Skipped | An `.msix` installed with `Add-AppxPackage`; skipped for anything else |
| `openLink(url)` | The link opened as the device opens one, which may be in another app | An `http` or `https` url opened; skipped for anything else | The exe started with the url, which the window already open receives |
| `foregroundApp()` | The package on Android, the bundle id on iOS | The page's url | The process whose window is in front |

Each answers `'done'` or `'skipped'`, and `foregroundApp` answers `null`
where it cannot tell. A control a platform has, but that cannot be done,
throws a `HarnessError` as any step does. A restart needs
`app.<platform>.bundleId` on a device and the exe as the target on Windows,
and an install needs a build, and each says so when the harness config has
none.

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
  the exe's command line.
- **Permissions** take agent-device's names: `camera`, `microphone`,
  `photos`, `contacts`, `notifications`, `calendar`, `location` and the
  rest. On a device each is set to `grant`, `deny` or `reset` before the
  launch, so no prompt asks. On web the granted ones Chromium has are granted
  to every browser context the harness makes, `location` as `geolocation`.
  Chromium has no deny through Playwright, so `deny` and `reset` leave the
  default.

## On Windows

A Windows app that is not running is started by the first `open` or
`restart`, so `expo-harness doctor` reports Windows ready once the app's exe
is known.

A restarted window may not come to the front. Windows lets a process in the
background start a window but not take the foreground from the one someone is
using, and `foregroundApp()` says what is in front. The harness raises the
app before it sends any synthetic input, as it always does.

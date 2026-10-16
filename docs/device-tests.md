# Device tests

[Docs home](README.md)

Component tests cannot see a whole app: its own Babel configuration, a real
renderer, a real screen reader tree. Device tests drive a running build and
read what it actually drew.

The assertion is the accessibility tree rather than the pixels. A tree is
stable across machines and scale factors, it diffs legibly in review, and it
is what a screen reader reads, so a regression in it is one a person would
feel.

The app under test needs no SDK and no rebuild. Nothing is installed in it.

| Platform | Driven by |
| --- | --- |
| web | A headless Chromium through `playwright-core`, its Firefox or WebKit, or a Chromium already running, over CDP: [the browser](harness.md#the-browser) |
| windows | UI Automation and synthetic input, from this package |
| android, ios | [`agent-device`](https://www.npmjs.com/package/agent-device) |

| Page | What is in it |
| --- | --- |
| [Locators](locators.md) | `screen` and `within`: React Native Testing Library's queries over the running app, the locator they give, its actions on each platform, and `element` with `by`. |
| [Matchers](matchers.md) | The matchers that wait for the tree, and the four that take a snapshot or the device. |
| [Controls](controls.md) | The app's life, and the device's settings: appearance, orientation, network, permissions, location, the clipboard and the rest. |
| [Evidence](evidence.md) | The screenshot, tree and trace a failing test leaves. |
| [The harness](harness.md) | The same drivers as a command, for looking at a screen by hand. |

## Setup

```sh
npm install --save-dev playwright-core   # for web
npm install --global agent-device        # for iOS and Android
```

Both are optional. `expo-harness doctor` says what this machine can drive, and
what is missing.

```ts
// vitest.config.device.mts
import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest';

export default defineConfig(deviceConfig());
```

The config picks up `device/**/*.test.ts`, registers the matchers and the
hook that leaves evidence, and runs one file at a time, since there is one
app and one driver. [Configuration](configuration.md#deviceconfig) has its
options.

```json
{"scripts": {"test:device": "vitest run --config vitest.config.device.mts"}}
```

Device tests are opt-in and never part of the component test run, because
they need a real app somewhere.

To run on several platforms at once, with the dev server each app needs
started for the run, give `deviceConfig` its `platforms` and keep each
app's details in `harness.config.ts`. [A project per
platform](configuration.md#a-project-per-platform) has how.

## A test

```ts
// device/settings.test.ts
import {device, screen} from 'expo-vitest/device';

it('opens settings', async () => {
  await device.open('/');
  await screen.getByRole('button', {name: 'Settings'}).press();
  await screen.getByRole('textbox', {name: 'Name'}).fill('Ada');
  await expect(screen.getByRole('textbox', {name: 'Name'})).toHaveValue('Ada');

  expect(await device.snapshot()).toBeFullyLabelled();
  await expect(device).toMatchScreenshot('settings');
});
```

The device opens at the file's first step and closes when the file ends,
after the file's own hooks. A locator waits for its node, and a matcher on
one waits for the tree to agree. A test written for four platforms runs on all of them: a step a
platform has no counterpart for answers `'skipped'`, or fails saying so where
going on would hide a mistake.

## Running

Start the app, then point the run at it with environment variables. With
`platforms`, the run reads [`harness.config.ts`](configuration.md#harnessconfigts)
too, and a variable here beats it.

```sh
HARNESS_PLATFORM=web HARNESS_URL=http://localhost:8081 npm run test:device
HARNESS_PLATFORM=windows HARNESS_TARGET=path/to/App.exe npm run test:device
HARNESS_PLATFORM=android HARNESS_SCHEME=myapp npm run test:device
```

| Variable | What it is |
| --- | --- |
| `HARNESS_PLATFORM` | `web`, `windows`, `android` or `ios`. `web` by default. |
| `HARNESS_URL` | Where the app is served, for web. |
| `HARNESS_TARGET` | The device, simulator, exe or process to drive. On Android and iOS, a name `agent-device devices` lists, or the id it lists beside it: the adb serial, as `emulator-5554`, or the UDID. |
| `HARNESS_SCHEME` | The app's URI scheme, for deep links on a device. |
| `HARNESS_ROOT` | The project under test, when the tests are run from somewhere else. Screenshots, baselines and evidence are kept under it. |
| `HARNESS_CONFIG` | The harness config, from the root, when it is not `harness.config.ts` there. |
| `HARNESS_REQUIRE` | `1` to fail the tests of a platform this machine cannot drive, rather than skip them; `0` to skip them in CI, where they fail otherwise. |
| `HARNESS_UPDATE_SCREENSHOTS` | Set it to record screenshot baselines, and replace ones that differ, as `vitest -u` does. |
| `HARNESS_AGENT_DEVICE` | Where `agent-device` is installed, when that is somewhere the harness does not look; or `cli` to drive it through its command line rather than its Node client. |
| `HARNESS_WINDOWS_HOST` | `0` to drive Windows with a PowerShell script per step rather than the one process the harness keeps for the run. |
| `HARNESS_SETTLE`, `HARNESS_TRANSITION` | How long a step waits for the screen, and gives a control that just came in, in ms. `deviceConfig`'s `settle` and `transition` set them. |
| `HARNESS_ASSERTION_TIMEOUT`, `HARNESS_STABLE` | How long a locator's wait looks, and how long something must stay gone, in ms. `deviceConfig`'s `assertionTimeout` and `stable` set them. |
| `HARNESS_TRACE` | When a test leaves [evidence](evidence.md): `retain-on-failure` (the default), `on` or `off`. |
| `HARNESS_VIDEO` | When a test keeps a [recording](evidence.md#video) of the screen: `on`, `retain-on-failure` or `off`, over the harness config's `video`, which is `off` unless set. |
| `HARNESS_HEADED`, `HARNESS_SLOWMO` | On web, `1` opens the browser in a window to watch, and a number of ms slows each operation by that much. A window needs the full Chromium, not only the headless shell. |
| `HARNESS_BROWSER` | On web, `chromium`, the default, `firefox` or `webkit`. See [the browser](harness.md#the-browser). |
| `HARNESS_CDP` | On web, the endpoint of a Chromium already running, such as `http://127.0.0.1:9222`, to drive rather than launch one. |
| `HARNESS_METRO` | Where Metro runs, for the React tree of a development build: `http://localhost:8081` by default. |
| `HARNESS_REACT` | `take` to read the React tree of an app that takes one debugger only, which closes React Native DevTools if it is open. |
| `HARNESS_FORCE` | `1` to press, fill, type and send keys on Windows even when someone used the machine in the last three minutes. Without it, those refuse while the desk is in use, since synthetic input goes to whatever window is in front. The harness's own input does not count, from one test file to the next too: what the guard has seen is kept in `.harness/windows-desk.json`. |

On Windows, when Node is started through Volta's `node` shim, a run that
starts agent-device's daemon passes it a handle to the run's own output, and
the daemon holds it until it stops, about five minutes after its last
request. A terminal does not notice. Anything that reads the output to its
end, such as a pipe or a CI log, waits that long after the tests have
finished. Start the daemon first from outside the pipe, with any
`agent-device` command, or run Node itself rather than the shim.

[The harness](harness.md#getting-an-app-to-drive) says how to get an app up on
each platform.

## Hosted devices

On iOS and Android the device can be one a provider hosts, such as a Limrun
emulator, rather than one on this machine. Name the provider in place of a
device:

```ts
// harness.config.ts
export default defineHarness({
  app: {
    android: {
      bundleId: 'com.example.app',
      appPath: 'android/app/build/outputs/apk/release/app-release.apk',
      device: {provider: 'limrun'},
    },
  },
});
```

There is no provider code here: agent-device connects to the provider, and
the run gives it two commands. Before the first test, `agent-device connect
limrun --platform android --no-login`, which checks the credentials and
saves the connection. The warm-up's first command then allocates the
device, the warm-up installs `appPath`, since a hosted device starts
without the app, and opens it. Each test file's session runs on the one
connection, and after the last test `agent-device disconnect` releases the
device. A connection that fails skips the platform's tests with
agent-device's reason, as an absent device does, or fails them under
`HARNESS_REQUIRE=1`. `--no-login` is always passed, since no one is there to
answer a login prompt in a test run.

Credentials come from the provider's own variables: `LIMRUN_API_KEY` for
Limrun, `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` for
BrowserStack, and the AWS chain for AWS Device Farm. `LIMRUN_KEEP_ALIVE=1`
keeps a Limrun instance from timing out while a slow suite is idle. A
provider that wants more says so in flags to `connect`, and `options` passes
them, named without their dashes:

```ts
device: {provider: 'browserstack', options: {device: 'Google Pixel 8', 'provider-os-version': '14.0', 'provider-app': 'bs://app-id'}},
```

`agent-device help connect` lists the flags. A device named by
`HARNESS_TARGET`, or by `target`, is this machine's, and wins over a hosted
one, so a run can go back to a local emulator without editing the config.
The connection, and its refusal without credentials, are what this
package's own tests exercise; a provider's device is not in them.

## Pools

A platform's test files run one at a time, unless the platform has more
than one of what they run on. On iOS and Android that is a pool of devices,
and on web a number of browsers:

```ts
// harness.config.ts
export default defineHarness({
  app: {
    android: {bundleId: 'com.example.app', devices: ['Pixel_8_API_35', 'Pixel_9_API_35']},
    web: {url: 'http://localhost:8081', workers: 3},
  },
});
```

The project then runs as many files at once as the pool has devices, or
`workers` says, each in a worker of its own. On web each has its own
browser. Windows is one window, so its files take turns, and the platforms
take turns too, a pooled one in a group of its own.

On a device, each file claims a device of the pool at its first step and
holds it until the file ends. It tries them from an offset its name gives,
so files spread out: first the device's lock in `.harness/locks/<run>/`,
which no two files can hold, then a session of its own on the device,
`expo-vitest-<run>-<device>`. agent-device refuses a session on a device
another session holds with `DEVICE_IN_USE`, so a device in use from outside
the run is passed over too. When every device is held, the file looks again
each second, for up to `poolTimeout`, a minute unless the config says, and
then fails with `DEVICE_POOL_EXHAUSTED`, naming who holds each device. Keep
`poolTimeout` under the test's timeout, or the timeout says it first.

The warm-up opens each device of the pool by name before the first test, so
none is left to agent-device's choice, and a device of the pool that is not
there makes the platform unavailable, naming it. After the run the locks
go, and agent-device releases any claim whose owner is gone. A device
`HARNESS_TARGET` names runs the platform's files on that one device alone.

The pool's size is read from the harness config while Vitest's config is
built, which is synchronous, so the file loads with Node's own type
stripping there. A file that will not load so, as with a top-level await,
runs one file at a time.

## device

| Call | What it does |
| --- | --- |
| `device.platform` | The platform under test. |
| `device.open(route)` | Opens a route, as a deep link or a URL. iOS first asks whether to open a deep link in the app, which is answered Open. |
| `device.snapshot({interactive})` | The accessibility tree. By default only what a person can act on. |
| `device.fullSnapshot()` | The whole tree, including what cannot be acted on. |
| `device.screenshot(name)` | Saves `.harness/<name>.png` and returns its path. |
| `device.type(text)` | Types into whatever has focus. |
| `device.key(name)` | A named key where the focus is: `ArrowDown`, `Home`, `Enter`. Answers `'pressed'`, or `'skipped'` on a backend that cannot send one. |
| `device.waitFor(selector, {timeout, interval})` | Waits until a [selector](locators.md#by-and-element) is in the tree. Ten seconds by default. The error says how many nodes the tree had. |
| `device.close()` | Closes the driver, which the device does by itself when its file ends. A device of a [pool](#pools) goes back then. |
| `device.react()` | The [React tree](#the-react-tree) behind the native one. |
| `device.journal` | The record of the current test's steps and the app's console, which [evidence](evidence.md) is written from. |
| `device.web` | What a browser has and a device does not, [below](#deviceweb). |

The driver is made on first use and kept for the file's tests.

### device.web

The browser's own controls, on every platform. On web each call reaches
the page or the context the driver holds; anywhere else each answers
`'skipped'` and opens nothing, so a file shared with a device still runs and
says what it could not do. `device.can('web')` is the gate a test checks
before relying on one. Each is a step in the [trace](evidence.md), after
which the screen is read afresh.

| Call | What it does |
| --- | --- |
| `route(pattern, handler)` | Answers the requests a glob matches, as `**/api/**`, until the function it answers is called. The handler has the `request`, and `fulfill({status, json, body, headers})`, `continue()` or `abort()`; one that calls none lets the request through, and one that throws fails it. A restart's new context keeps the route. |
| `onDialog(answer)` | Answers every dialog the page opens with `'accept'`, `'dismiss'`, or a function of `{type, message}` that says which, until the function it answers is called. [`device.alert`](controls.md) still answers the next one. |
| `evaluate(fn, arg)`, `evaluate(expression)` | Runs a function in the page with `arg`, or an expression, and answers the value, which must be JSON. A function goes by its source alone, so it can use nothing of the test's but `arg`. |
| `setViewport({width, height})` | The page's size. |
| `cookies()`, `setCookies(list)`, `clearCookies()` | The context's cookies. One set needs a `url`, or a `domain` and a `path`. |
| `waitForDownload(trigger, file?)` | Runs `trigger`, waits for the download it starts, and keeps the file at `file`, from the root, or in `.harness/downloads/` by the name the page gave it. Answers where. |
| `selectOption(locator, option)` | Chooses an option of a select by its label, `{value}` or `{index}`. One the select lacks fails at once with `ACTION_FAILED`, which names the options it has. |
| `setInputFiles(locator, files)` | Gives a file input files from the project, which may not be outside it, hidden, or in a hidden folder. |
| `secondaryTap(locator)` | Presses with the secondary button, as a right click does. |
| `frame(selector)` | A [screen](locators.md) of the frame a CSS selector names. Its queries read the frame's tree and its locators act in the frame, of any origin; the page's own screen does not reach into it. |

```ts
const unroute = await device.web.route('**/api/profile', route => route.fulfill({json: {name: 'Ada'}}));
await device.web.selectOption(screen.getByRole('combobox', {name: 'Colour'}), 'Blue');

const card = device.web.frame('iframe[title="Card"]');
if (card !== 'skipped') await card.getByRole('textbox', {name: 'Card number'}).fill('4242');
```

The locator calls wait for their node as a press does. A frame's refs name
the frame, as `@f1e3`, so a node read through it is acted on there.

## Waiting for the screen

After a press, a fill, typing, a key or an open, the next step waits until
the screen holds still: two reads of the tree in a row agree, 150 ms apart.
A screen that never holds still, such as one with a spinner, is given 2
seconds, and the step goes on with a note saying so. Before a press or a
fill, a control that the last step brought in or moved, such as the button
on a sheet that slid up, is given what is left of 500 ms first. That comes
from the reads the wait already made, so it costs no read of its own.

```ts
// vitest.config.device.mts: for the whole run
export default defineConfig(deviceConfig({settle: 300, transition: 0}));

// one step
await screen.getByTestId('save').press({settle: 0});
```

`0` or `false` turns either wait off. On iOS and Android the wait after a
press or a fill is agent-device's own (`--settle`), so a device that takes a
second to read is not read twice more. On web a read costs next to nothing
while the page is unchanged and nothing on it animates. On Windows each read
is a walk of the tree, so a step costs two of them more.

A change that comes once the screen has held still, such as the answer to a
network request, is what a [matcher](matchers.md) waits for.

## The tree

A snapshot is `{platform, source, nodes}`. On web, what a screen reader is told to pass over, under `aria-hidden="true"`, is not in it, as it is not on a device: an icon drawn as a font's ligature is its name as text there. Each node has:

| Field | What it is |
| --- | --- |
| `ref` | `@e1`, `@e2` and so on. Stable within one snapshot, not across snapshots. On web and Windows a node has the same ref in an interactive snapshot as in a full one of the same screen, so a ref read from an interactive snapshot presses that node while the screen stays as it was. On web a node keeps its ref for as long as it stays on the page, so a ref read earlier still presses it after the page has changed around it. |
| `role` | The platform's own word for what this is. |
| `kind` | One word for it on every platform, from a fixed list: `button`, `textbox`, `checkbox`, `switch`, `tab`, `tablist`, `link`, `heading`, `listitem`, `menuitem`, `radio`, `slider`, `progressbar`, `dialog`, `text`, `image`, `group`, `list`, `combobox`, `searchbox`, `spinbutton`, `status`, `alert`, `toolbar`, `menu`, `radiogroup`. Absent where the platform's word is not one the harness knows. On Windows a switch and a toggle button are the same control type, with the Toggle pattern and no Invoke, and both read as `switch`. The tree prints it beside the role where the two differ: `Button/switch`. |
| `name` | The accessible name: what a screen reader says. On web a name made from an element's text leaves out what is not drawn, such as a menu that is shut. |
| `testId` | The `testID` from the source. |
| `depth` | Depth in the tree. |
| `parent` | The ref of the nearest node in the same snapshot that this one sits inside. Absent at the top, and where the platform does not say: on iOS and Android, a node whose parent an interactive snapshot left out. |
| `interactive` | Whether a person can act on it. On web that includes a react-native-web Pressable with no role, which is drawn as a div that takes the focus. |
| `focused`, `focusable`, `enabled`, `offscreen` | State, where the platform reports it. `offscreen` on Windows and on a device is a node outside the screen, scrolled out of view or clipped; on web it is a node with no size, as Playwright counts what is visible, so a node below the fold is not off screen there. |
| `help` | The hint or description: `HelpText` on Windows, `aria-description` on web. |
| `inSet` | A position in a set, as it is announced: `"2 of 5"`. |
| `heading` | The heading rank, 1 to 6. |
| `live` | A live region, and how urgent: `polite` or `assertive`. |
| `status` | The item's status, such as "Busy" while something loads. |
| `dialog` | Whether the platform treats this as a dialog. |
| `checked` | A checkbox, radio or switch: `true`, `false`, or `'mixed'` in between. From `ToggleState` on Windows, `aria-checked` or the input's own state on web, agent-device's `checked` on Android and iOS. |
| `selected` | A tab, option or item: whether it is the one selected. `SelectionItem` on Windows, `aria-selected` on web. On Android and iOS only a selected node carries it, since agent-device reports `false` on every Android node. |
| `expanded` | A combo box, menu button or disclosure: whether it is open. `ExpandCollapse` on Windows, `aria-expanded` on web. |
| `pressed` | A toggle button: whether it is pressed in, or `'mixed'`. `aria-pressed` on web; on Windows, `ToggleState` on a `Button` that also invokes. |
| `value` | What a field holds, or a slider's value. Never set on a secure field. |
| `placeholder` | The hint an empty field shows. Not on Windows, where react-native-windows does not report it. |
| `secure` | `true` on a field whose text is hidden, such as a password. |
| `bounds` | The rectangle, in the window's own pixels from its top left. |
| `patterns` | The UI Automation patterns a Windows control implements, each a way to drive it without a pointer: `Invoke`, `Toggle`, `SelectionItem`, `Value`, `ScrollItem`, `ExpandCollapse`. Windows only. |

The fields from `help` down are absent unless the platform reported them. A
control that sets none reads differently in the tree from one that sets them.
Nothing else in a test run can see them, and a missing `live` or `inSet` is
invisible in a component test and obvious to a user. Windows fills all of them
but `placeholder` through UI Automation. The other platforms fill what their
own trees carry.

### On Windows, a flyout is not in the tree

The tree walks the descendants of the app's main window. A WinUI `MenuFlyout`
opens in a separate top-level window, so a menu plainly open on screen leaves
no trace in the tree. Verify menus with a screenshot on Windows. A tree that
says nothing happened is not evidence that nothing did.

## The React tree

`device.react()` reads the React tree behind the native one: for each node
the platform draws, the component that drew it, such as `SaveButton`, every
named component above it, and its `testID`, label and text as written. An
iOS `accessible` container folds its children's testIDs and labels away from
the native tree, and the React tree still has them.

```ts
import {device, withComponents} from 'expo-vitest/device';

const tree = withComponents(await device.fullSnapshot(), await device.react());
// each node now has its component: tree.nodes[0].component === 'SaveButton'
```

`withComponents` matches each native node to the React node behind it: by
its ref on web, else by its testID, else by the box they share. On Windows
the walk finds no boxes, so a node is matched there by its testID alone. The
tree prints the component beside the name: `@e7 button "Save" <SaveButton>`.

It is read from React's DevTools hook, which only a development build has.
On web the page is the runtime, and the harness puts the hook in place before
React loads. On iOS, Android and Windows the walk runs in the app through
Metro's inspector, at `HARNESS_METRO`; a run that starts its own dev server,
as an [Expo development build](controls.md#an-expo-development-build) does,
sets it to that server's url. On a device only the page of the app under
test, by its `bundleId`, is read, and a Metro serving another app is refused.
Metro closes every other debugger connected to an app when one more
connects, unless the app says it takes more than one, as React Native 0.86's
development builds do, so the harness reads only such an app, and says so
otherwise: `HARNESS_REACT=take` reads it anyway, at the price of a React
Native DevTools window that was open. The walk is all that runs in the app,
and what it leaves there for the harness is taken away when it is read.
Expo Router's screens read as their route's component and file, such as
`Explore(./explore.tsx)`.

Where the tree can be read, a failing test's [evidence](evidence.md) names
the component behind the node its failing step was for.

## Errors

A call that cannot do what it was asked rejects with a `HarnessError`. The
`message` is what to read. The `code` says what kind of failure it was, for a
test or a script that has to decide what to do next, and `platform` says
where it happened.

```ts
import {isHarnessError, screen} from 'expo-vitest/device';

// A banner that only some accounts see: dismiss it if it is there.
try {
  await screen.getByTestId('banner-dismiss').press({timeout: 1000});
} catch (error) {
  if (!isHarnessError(error) || error.code !== 'LOCATOR_NOT_FOUND') throw error;
}
```

| Code | What happened |
| --- | --- |
| `DRIVER_UNAVAILABLE` | No backend for the platform here: not installed, not running, or not a Windows machine. |
| `APP_UNREACHABLE` | The app did not open: a URL that does not answer, a deep link with no exe to launch, or a command that ended or did not answer before its startup timeout. |
| `APP_ALREADY_RUNNING` | Something already answers where the run's command would serve the app, and `reuseExisting` is off, as it is in CI. |
| `LOCATOR_NOT_FOUND` | Nothing in the tree matched, within the time allowed. The message says what was there instead: that it is off screen, the names in the role asked for, names like the one asked for, the testIDs, or what can be acted on. |
| `LOCATOR_AMBIGUOUS` | A [locator](locators.md) that names one node named several. The message lists them. |
| `NOT_ACTIONABLE` | The node is there but cannot be acted on: it stayed disabled, has no bounds, is off screen, is a field that is read-only, or, on web, is covered, so that a press would land on what is over it, which the message names. |
| `ACTION_FAILED` | The backend refused the step, or failed it, or a locator's `check` did not take. |
| `ASSERTION_FAILED` | The screen did not come to say what a test waited for, such as a node that never went, within the time allowed. |
| `SCREENSHOT_MISMATCH` | A [screenshot](matchers.md#tomatchscreenshot) differs from its baseline by more than was allowed, or cannot be compared with it. Its `evidence` is the diff. |
| `UNSUPPORTED_CAPABILITY` | Something the platform has no counterpart for, where skipping would hide a mistake: a long press or the focus where a platform has neither, or a key the Windows harness cannot send. |
| `INVALID_ARGUMENT` | A call that cannot be acted on as it stands. |
| `INVALID_CONFIG` | A harness config with a key it does not take or a value of the wrong kind, which the message names, or one that changed while the run was going. |
| `DEVICE_POOL_EXHAUSTED` | Every device of a [pool](#pools) stayed held, by the run's other files or a session outside it, for `poolTimeout`. The message names who held each. |

`isHarnessError` checks the name and the code rather than using
`instanceof`, so it still answers when a project has loaded two copies of the
package. An error from the browser or the device tool underneath, such as a
browser that crashed, passes through as it was thrown.

## Using the matchers elsewhere

`deviceConfig` registers the matchers and the evidence hook. A config of your
own registers them with a setup file:

```ts
setupFiles: ['expo-vitest/device/matchers']
```

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
| web | A headless Chromium, through `playwright-core` |
| windows | UI Automation and synthetic input, from this package |
| android, ios | [`agent-device`](https://www.npmjs.com/package/agent-device) |

[Locators](locators.md) finds nodes with React Native Testing Library's
queries: `screen.getByRole('button', {name: 'Save'})`. [The harness](harness.md)
is the same drivers as a command, for looking at a screen by hand.

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

The config picks up `device/**/*.test.ts`, registers the matchers, and runs
one file at a time, since there is one app and one driver.
[Configuration](configuration.md#deviceconfig) has its options.

```json
{"scripts": {"test:device": "vitest run --config vitest.config.device.mts"}}
```

Device tests are opt-in and never part of the component test run, because
they need a real app somewhere.

## A test

```ts
// device/settings.test.ts
import {by, device, element} from 'expo-vitest/device';

afterAll(() => device.close());

it('opens settings', async () => {
  await device.open('/');
  await element(by.label('Settings')).press();
  await element(by.label('Name')).waitFor();

  const tree = await device.fullSnapshot();
  expect(tree).toHaveElement(by.label('Email'));
  expect(await device.snapshot()).toBeFullyLabelled();
  await expect(device).toMatchScreenshot('settings');
});
```

## Running

Start the app, then point the run at it with environment variables:

```sh
HARNESS_PLATFORM=web HARNESS_URL=http://localhost:8081 npm run test:device
HARNESS_PLATFORM=windows HARNESS_TARGET=path/to/App.exe npm run test:device
HARNESS_PLATFORM=android HARNESS_SCHEME=myapp npm run test:device
```

| Variable | What it is |
| --- | --- |
| `HARNESS_PLATFORM` | `web`, `windows`, `android` or `ios`. `web` by default. |
| `HARNESS_URL` | Where the app is served, for web. |
| `HARNESS_TARGET` | The device, simulator, exe or process to drive. |
| `HARNESS_SCHEME` | The app's URI scheme, for deep links on a device. |
| `HARNESS_ROOT` | The project under test, when the tests are run from somewhere else. Screenshots and baselines are kept under it. |
| `HARNESS_UPDATE_SCREENSHOTS` | Set it to record screenshot baselines. |
| `HARNESS_AGENT_DEVICE` | Where `agent-device` is installed, when that is somewhere the harness does not look; or `cli` to drive it through its command line rather than its Node client. |
| `HARNESS_WINDOWS_HOST` | `0` to drive Windows with a PowerShell script per step rather than the one process the harness keeps for the run. |
| `HARNESS_SETTLE`, `HARNESS_TRANSITION` | How long a step waits for the screen, and gives a control that just came in, in ms. `deviceConfig`'s `settle` and `transition` set them. |
| `HARNESS_ASSERTION_TIMEOUT`, `HARNESS_STABLE` | How long a locator's wait looks, and how long something must stay gone, in ms. `deviceConfig`'s `assertionTimeout` and `stable` set them. |
| `HARNESS_FORCE` | `1` to press, fill, type and send keys on Windows even when someone used the machine in the last three minutes. Without it, those refuse while the desk is in use, since synthetic input goes to whatever window is in front. |

On Windows, when Node is started through Volta's `node` shim, a run that
starts agent-device's daemon passes it a handle to the run's own output, and
the daemon holds it until it stops, about five minutes after its last
request. A terminal does not notice. Anything that reads the output to its
end, such as a pipe or a CI log, waits that long after the tests have
finished. Start the daemon first from outside the pipe, with any
`agent-device` command, or run Node itself rather than the shim.

[The harness](harness.md#getting-an-app-to-drive) says how to get an app up on
each platform.

## device

| Call | What it does |
| --- | --- |
| `device.platform` | The platform under test. |
| `device.open(route)` | Opens a route, as a deep link or a URL. |
| `device.snapshot({interactive})` | The accessibility tree. By default only what a person can act on. |
| `device.fullSnapshot()` | The whole tree, including what cannot be acted on. |
| `device.screenshot(name)` | Saves `.harness/<name>.png` and returns its path. |
| `device.type(text)` | Types into whatever has focus. |
| `device.key(name)` | A named key where the focus is: `ArrowDown`, `Home`, `Enter`. Answers `'pressed'`, or `'skipped'` on a backend that cannot send one. |
| `device.waitFor(selector, {timeout, interval})` | Waits until the selector is in the tree. Ten seconds by default. The error says how many nodes the tree had. |
| `device.close()` | Closes the driver. |

The driver is made on first use and kept for the file's tests.

A step a platform cannot do answers `'skipped'` rather than failing. A test
written for four platforms then still runs on all of them and says what it
could not do, instead of failing for the wrong reason.

## element

`element(selector)` names one element. It is found fresh each time it is acted
on, since a ref from an old tree is stale.

| Call | What it does |
| --- | --- |
| `.press({via, settle, transition})` | Presses it. On Windows, through the control's UI Automation pattern where it has one and the press shows, which needs no quiet desk; `{via: 'pointer'}` presses with the pointer, and `settle` and `transition` change [the waits](#waiting-for-the-screen) for this step. |
| `.fill(text, {via, settle, transition})` | Puts text in a field, in place of what it held. On Windows, a field with a Value pattern gets the text set and read back; `{via: 'keys'}` clicks the field, selects what it holds and types over it. `settle` and `transition` as for a press. |
| `.node()` | The node now, or `undefined`. |
| `.waitFor({timeout})` | Waits until it is in the tree. |

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
await element(by.testID('save')).press({settle: 0});
```

`0` or `false` turns either wait off. On iOS and Android the wait after a
press or a fill is agent-device's own (`--settle`), so a device that takes a
second to read is not read twice more. On web a read costs next to nothing
while the page is unchanged and nothing on it animates. On Windows each read
is a walk of the tree, so a step costs two of them more.

A change that comes once the screen has held still, such as the answer to a
network request, is not waited for. Use `device.waitFor`, or a matcher, for
that.

## Selectors

| Selector | Matches |
| --- | --- |
| `by.testID(id)` | The `testID` the component was given. It reaches `data-testid` on web and `AutomationId` on Windows. |
| `by.label(name)` | The accessible name, exactly. |
| `by.text(part)` | The accessible name, loosely: `New` finds `New drop`. |
| `by.role(role)` | What it is: the platform's own word (`Button`, `TabItem`, `link`), or its kind, the one word every platform shares (`button`, `tab`, `switch`). |
| `by.ref(ref)` | A ref from a snapshot (`@e7`). Good for that snapshot only. |

Prefer `by.testID`. A label is copy and changes with wording and language, a
ref is only good for one snapshot, and a role finds every button on the screen.

## The tree

A snapshot is `{platform, source, nodes}`. Each node has:

| Field | What it is |
| --- | --- |
| `ref` | `@e1`, `@e2` and so on. Stable within one snapshot, not across snapshots. On web and Windows a node has the same ref in an interactive snapshot as in a full one of the same screen, so a ref read from an interactive snapshot presses that node while the screen stays as it was. On web a node keeps its ref for as long as it stays on the page, so a ref read earlier still presses it after the page has changed around it. |
| `role` | The platform's own word for what this is. |
| `kind` | One word for it on every platform, from a fixed list: `button`, `textbox`, `checkbox`, `switch`, `tab`, `tablist`, `link`, `heading`, `listitem`, `menuitem`, `radio`, `slider`, `progressbar`, `dialog`, `text`, `image`, `group`, `list`, `combobox`, `searchbox`, `spinbutton`, `status`, `alert`, `toolbar`, `menu`, `radiogroup`. Absent where the platform's word is not one the harness knows. On Windows a switch and a toggle button are the same control type, with the Toggle pattern and no Invoke, and both read as `switch`. The tree prints it beside the role where the two differ: `Button/switch`. |
| `name` | The accessible name: what a screen reader says. |
| `testId` | The `testID` from the source. |
| `depth` | Depth in the tree. |
| `parent` | The ref of the nearest node in the same snapshot that this one sits inside. Absent at the top, and where the platform does not say: on iOS and Android, a node whose parent an interactive snapshot left out. |
| `interactive` | Whether a person can act on it. On web that includes a react-native-web Pressable with no role, which is drawn as a div that takes the focus. |
| `focused`, `focusable`, `enabled`, `offscreen` | State, where the platform reports it. |
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

## Matchers

| Matcher | Takes | What it asserts |
| --- | --- | --- |
| `toHaveElement(selector)` | A snapshot | The tree contains something the selector names. |
| `toBeFullyLabelled()` | A snapshot | Every element a person can act on carries an accessible name. |
| `toSupportArrowNavigation(key?)` | The device, awaited | Pressing the key (`ArrowDown` by default) moves the focus. |
| `toMatchScreenshot(name, {maxRatio})` | The device, awaited | The screen matches a recorded baseline. |

### toBeFullyLabelled

It fails with the ref and position of every control a screen reader would
announce as its role alone. On Windows a button made of a glyph and a text
block names nothing by itself, which is what this matcher catches.

```ts
expect(await device.snapshot({interactive: true})).toBeFullyLabelled();
```

### toSupportArrowNavigation

This is the half of a composite ARIA role that a static checker such as axe
cannot check. A `role="menu"` or `role="radiogroup"` with no arrow keys behind
it passes every static check while being unusable without a pointer. Only a
real renderer can answer it.

Focus something first. With nothing focused, the matcher fails and says so.

```ts
await element(by.label('Layout')).press();
await expect(device).toSupportArrowNavigation('ArrowRight');
```

On a backend that cannot send keys the matcher passes and says it was not
checked.

### toMatchScreenshot

Use a screenshot for what a tree cannot see: spacing, colour, the thing
actually being drawn. The tree is still the better assertion for behaviour.

```ts
await expect(device).toMatchScreenshot('settings');
await expect(device).toMatchScreenshot('chart', {maxRatio: 0.01});
```

Baselines are kept at `device/__screenshots__/<platform>/<name>.png`.
`maxRatio` is how much of the picture may differ before the test fails, 0.2%
by default. A small tolerance per channel absorbs the drift text rendering
produces between runs.

A baseline belongs to the machine that drew it. The same page renders
differently under a different font stack, so one recorded on a desk cannot be
asserted on a Linux runner. Recording is therefore deliberate and never a side
effect of a run:

```sh
HARNESS_UPDATE_SCREENSHOTS=1 npm run test:device   # record
npm run test:device                                # assert against what was recorded
```

| Situation | What happens |
| --- | --- |
| No baseline | The picture is kept under `.harness/` as evidence, and the test passes on its tree assertions. |
| No baseline, with `HARNESS_UPDATE_SCREENSHOTS` | The baseline is recorded. |
| A baseline that matches | The test passes. |
| A baseline that differs | The test fails. `.harness/` has the picture it took and a diff with the changed pixels in red over a faded copy. |

Commit a baseline only when the machine that asserts it is the machine that
drew it. `.harness/` is not for committing.

The comparison reads the 8-bit non-interlaced PNGs that Chromium, GDI+ and
`adb` write, with Node's own zlib and no image dependency, and says so plainly
for anything else.

### On Windows, a flyout is not in the tree

The tree walks the descendants of the app's main window. A WinUI `MenuFlyout`
opens in a separate top-level window, so a menu plainly open on screen leaves
no trace in the tree. Verify menus with a screenshot on Windows. A tree that
says nothing happened is not evidence that nothing did.

## Errors

A call that cannot do what it was asked rejects with a `HarnessError`. The
`message` is what to read. The `code` says what kind of failure it was, for a
test or a script that has to decide what to do next, and `platform` says
where it happened.

```ts
import {by, element, isHarnessError} from 'expo-vitest/device';

// A banner that only some accounts see: dismiss it if it is there.
try {
  await element(by.testID('banner-dismiss')).press();
} catch (error) {
  if (!isHarnessError(error) || error.code !== 'LOCATOR_NOT_FOUND') throw error;
}
```

| Code | What happened |
| --- | --- |
| `DRIVER_UNAVAILABLE` | No backend for the platform here: not installed, not running, or not a Windows machine. |
| `APP_UNREACHABLE` | The app did not open: a URL that does not answer, or a deep link with no exe to launch. |
| `LOCATOR_NOT_FOUND` | Nothing in the tree matched, within the time allowed. The message says what was there instead: the names in the role asked for, the testIDs, or what can be acted on. |
| `LOCATOR_AMBIGUOUS` | A [locator](locators.md) that names one node named several. The message lists them. |
| `NOT_ACTIONABLE` | The node is there but cannot be acted on: it has no bounds, is off screen, is a field that is read-only, or, on web, is covered, so that a press would land on what is over it, which the message names. |
| `ACTION_FAILED` | The backend refused the step, or failed it, or a locator's `check` did not take. |
| `ASSERTION_FAILED` | The screen did not come to say what a test waited for, such as a node that never went, within the time allowed. |
| `UNSUPPORTED_CAPABILITY` | Something the platform has no counterpart for, where skipping would hide a mistake: a key the Windows harness cannot send. |
| `INVALID_ARGUMENT` | A call that cannot be acted on as it stands. |

`isHarnessError` checks the name and the code rather than using
`instanceof`, so it still answers when a project has loaded two copies of the
package. An error from the browser or the device tool underneath, such as a
browser that crashed, passes through as it was thrown.

## Using the matchers elsewhere

`deviceConfig` registers the matchers. A config of your own registers them
with a setup file:

```ts
setupFiles: ['expo-vitest/device/matchers']
```

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

[The harness](harness.md) is the same drivers as a command, for looking at a
screen by hand.

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
| `.press()` | Presses it. |
| `.fill(text)` | Focuses a field and puts text in it. |
| `.node()` | The node now, or `undefined`. |
| `.waitFor({timeout})` | Waits until it is in the tree. |

## Selectors

| Selector | Matches |
| --- | --- |
| `by.testID(id)` | The `testID` the component was given. It reaches `data-testid` on web and `AutomationId` on Windows. |
| `by.label(name)` | The accessible name, exactly. |
| `by.text(part)` | The accessible name, loosely: `New` finds `New drop`. |
| `by.role(role)` | The platform's own word for what it is: `Button`, `TabItem`, `link`, `menuitem`. |
| `by.ref(ref)` | A ref from a snapshot (`@e7`). Good for that snapshot only. |

Prefer `by.testID`. A label is copy and changes with wording and language, a
ref is only good for one snapshot, and a role finds every button on the screen.

## The tree

A snapshot is `{platform, source, nodes}`. Each node has:

| Field | What it is |
| --- | --- |
| `ref` | `@e1`, `@e2` and so on. Stable within one snapshot, not across snapshots. |
| `role` | The platform's own word for what this is. |
| `name` | The accessible name: what a screen reader says. |
| `testId` | The `testID` from the source. |
| `depth` | Depth in the tree. |
| `interactive` | Whether a person can act on it. |
| `focused`, `focusable`, `enabled`, `offscreen` | State, where the platform reports it. |
| `help` | The hint or description: `HelpText` on Windows, `aria-description` on web. |
| `inSet` | A position in a set, as it is announced: `"2 of 5"`. |
| `heading` | The heading rank, 1 to 6. |
| `live` | A live region, and how urgent: `polite` or `assertive`. |
| `status` | The item's status, such as "Busy" while something loads. |
| `dialog` | Whether the platform treats this as a dialog. |
| `bounds` | The rectangle, in the window's own pixels from its top left. |

The fields from `help` down are absent unless the platform reported them. A
control that sets none reads differently in the tree from one that sets them.
Nothing else in a test run can see them, and a missing `live` or `inSet` is
invisible in a component test and obvious to a user. Windows fills all of them
through UI Automation. The other platforms fill what their own trees carry.

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
block names nothing by itself, which is what this matcher keeps catching.

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

## Using the matchers elsewhere

`deviceConfig` registers the matchers. A config of your own registers them
with a setup file:

```ts
setupFiles: ['expo-vitest/device/matchers']
```

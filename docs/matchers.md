# Matchers

[Docs home](README.md) · [Locators](locators.md) · [Device tests](device-tests.md)

The matchers on a [locator](locators.md) wait for the tree, as Playwright's
do: each reads it until it says what the matcher asks, or until the time is
up. Await them.

```ts
import {device, screen} from 'expo-vitest/device';

it('saves the name', async () => {
  await device.open('/settings');
  await screen.getByRole('textbox', {name: 'Name'}).fill('Ada');
  await screen.getByRole('button', {name: 'Save'}).press();
  await expect(screen.getByText('Saving')).toBeHidden();
  await expect(screen.getByRole('textbox', {name: 'Name'})).toHaveValue('Ada');
  await expect(screen.getByRole('switch', {name: 'Newsletter'})).toBeChecked(false);
});
```

`deviceConfig` registers them, beside [the four that take a snapshot or the
device](#on-a-snapshot-or-the-device).

| Matcher | Passes when | With nothing matching |
| --- | --- | --- |
| `toBeVisible()` | one node is on screen | waits |
| `toBeHidden()` | no node is on screen | passes |
| `toBeAttached()` | at least one node is in the tree, on screen or off | waits |
| `toBeDetached()` | no node is in the tree | passes |
| `toBeEnabled()`, `toBeDisabled()` | the node is enabled, or disabled | waits |
| `toBeChecked(value = true)` | the node's `checked` is `value`: `true`, `false` or `'mixed'` | waits |
| `toBeSelected()`, `toBeExpanded()`, `toBePressed()`, `toBeFocused()` | that state is `true` | waits |
| `toHaveText(match)` | the node's name matches, by [RNTL's text rules](locators.md#matching-text) | waits |
| `toHaveText([match, ...])` | the nodes' names match, one each, in the tree's order | waits |
| `toContainText(match)` | the node's name holds the text, in any case | waits |
| `toHaveValue(match?)` | the field holds the value, or any value when none is given | waits |
| `toHaveAccessibleName(match?)` | the node's name matches, or it has one when none is given | waits |
| `toHaveRole(role)` | the node's role or kind is `role`, in any case, or matches a pattern | waits |
| `toHaveCount(count)` | the locator names `count` nodes | passes for `0` |
| `toHaveAttribute(name, match?)` | the tree field `name` is there, and matches: `help`, `inSet`, `heading`, `live`, `status`, `dialog`, `testId`, `placeholder`, `role` or `kind` | waits |

A node's name is worked out [as a role's is](locators.md#what-a-node-is-called):
its own, or for a control with none, the text inside it. A matcher about one
node fails at once with `LOCATOR_AMBIGUOUS` where the locator names several,
as an action does. `toBeVisible` and `toBeHidden` read nodes off screen as
well, and the rest read what the locator does, which leaves them out unless
it was given `{hidden: true}`.

Each takes `{timeout}` as its last argument, over the run's
`assertionTimeout`: `toBeChecked(false, {timeout: 10_000})`.

## Waiting for something to be gone

A wait for something to be gone, `toBeHidden`, `toBeDetached`,
`toHaveCount(0)` or any matcher with `.not`, passes only once it has been so
on every reading for a second, or `deviceConfig({stable})`. Right after an
action, a spinner may not have come in yet, and a single reading would let
the test carry on into it:

```ts
await screen.getByRole('button', {name: 'Refresh'}).press();
await expect(screen.getByText('Loading')).toBeHidden();
```

With the spinner coming in at 100 ms and leaving at 900, the first reading,
at 0 ms, comes before it. Those at 100, 250, 475 and 813 ms see it, those at
1213, 1613 and 2013 ms do not, and the matcher passes on the reading at
2213 ms, a second after the first that saw it gone.

## What a failure says

```
expected getByTestId("email") to have value "a@b.c" within 5.0 s
  read 16 times; it was "" for 1.2 s, then "a@b" for 3.8 s
  the node: @e9   textbox "Email" #email  at 24,300
```

It names the locator as it was written, what each run of readings saw, and
the node it read, or, where nothing matched, what the tree held instead:

```
expected getByRole("slider") to be enabled within 5.0 s
  read 16 times; it was gone for 5.0 s
  no node matched; a node off screen matches; {hidden: true} takes it
```

A wait for something to be gone that did not hold says how long it must.

## Types

`expo-vitest/device` brings the matchers' types with it. React Native Testing
Library and jest-dom name some of them too: `toBeVisible`, `toBeEnabled`,
`toBeDisabled`, `toBeChecked`, `toBeSelected`, `toBeExpanded`, `toBePressed`,
`toHaveAccessibleName`, `toHaveValue`, `toHaveRole` and `toHaveAttribute`.
Where a project loads their types as well, a component test reads them as it
did, and a device test takes the forms above. A call with no timeout then
types as theirs, which is the same call.

## On a snapshot or the device

These take a snapshot or the device, and read it once.

| Matcher | Takes | What it asserts |
| --- | --- | --- |
| `toHaveElement(selector)` | A snapshot | The tree contains something the [selector](locators.md#by-and-element) names. |
| `toBeFullyLabelled()` | A snapshot | Every element a person can act on carries an accessible name. |
| `toSupportArrowNavigation(key?)` | The device, awaited | Pressing the key (`ArrowDown` by default) moves the focus. |
| `toMatchScreenshot(name, options)` | The device or a locator, awaited | The screen, or one element of it, matches a recorded baseline. |

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
await screen.getByRole('radio', {name: 'Grid'}).focus();
await expect(device).toSupportArrowNavigation('ArrowRight');
```

On a backend that cannot send keys the matcher passes and says it was not
checked.

### toMatchScreenshot

Use a screenshot for what a tree cannot see: spacing, colour, the thing
actually being drawn. The tree is still the better assertion for behaviour.

```ts
await expect(device).toMatchScreenshot('settings');
await expect(device).toMatchScreenshot('settings', {mask: [by.testID('clock')]});
await expect(device).toMatchScreenshot('header', {clip: by.role('banner')});
await expect(screen.getByRole('button', {name: 'Pay'})).toMatchScreenshot('pay');
await expect(device).toMatchScreenshot('chart', {threshold: 0.1, maxDiffPixels: 50});
```

Baselines are kept at `device/__screenshots__/<platform>/<name>.png`.

| Option | What it is | Default |
| --- | --- | --- |
| `maxRatio` | The share of the picture that may differ. | 0.002 |
| `maxDiffPixels` | How many pixels may differ. Given with `maxRatio`, the stricter applies. | none |
| `threshold` | How far a channel may drift, 0 to 1, and its pixel still count as the same. | 8 of 255 |
| `mask` | What is painted magenta in the baseline and the picture alike before they are compared: the first node a selector names, or every node a locator names. | none |
| `clip` | The one rectangle compared: a node, by a selector or a locator, or `{x, y, width, height}` in the tree's units. | the whole screen |

A mask is painted at compare time, so adding one needs no new baseline. A
mask or a clip that names nothing fails with `LOCATOR_NOT_FOUND` rather than
masking nothing. A locator as the receiver compares that element alone: it is
scrolled into view where the platform scrolls, found as an action finds its
node, and its picture is its bounds. Bounds are in the tree's units, and are
scaled to the picture's pixels where the driver says what box it measured
them in, as on an iOS screen measured in points.

The matcher takes pictures until two in a row are the same, as compared,
with masks painted, up to five of them 100 ms apart. A screen still moving
after that is compared as it last was, and a failure says it never held
still. On web a picture is taken with animations stopped and the caret
hidden. On a device the status bar is made the same in every picture:
agent-device puts Android in demo mode for each one, and normalises an iOS
simulator's. `statusBar: 'real'` in the [harness
config](configuration.md#harnessconfigts) leaves it as it is.

A baseline belongs to the machine that drew it. The same page renders
differently under a different font stack, so one recorded on a desk cannot be
asserted on a Linux runner. Recording is therefore deliberate and never a side
effect of a run:

```sh
HARNESS_UPDATE_SCREENSHOTS=1 npm run test:device   # record
npm run test:device -- --update                    # the same, as Vitest's own snapshots are updated
npm run test:device                                # assert against what was recorded
```

| Situation | What happens |
| --- | --- |
| No baseline | What would be compared is kept as `.harness/<platform>-<name>.actual.png`, as evidence, and the test passes on its tree assertions. |
| `HARNESS_UPDATE_SCREENSHOTS`, or `vitest -u` | The baseline is recorded, or replaced: the region compared, without its masks. |
| A baseline within what is allowed | The test passes. |
| A baseline that differs by more | The test fails with `SCREENSHOT_MISMATCH`, whose `evidence` is the diff. Beside each other in `.harness/` are `<platform>-<name>.expected.png`, the baseline as compared, `.actual.png`, the picture as compared, and `.diff.png`, the changed pixels in red over a faded copy. |

Commit a baseline only when the machine that asserts it is the machine that
drew it. `.harness/` is not for committing.

The comparison reads the 8-bit non-interlaced PNGs that Chromium, GDI+ and
`adb` write, with Node's own zlib and no image dependency, and says so plainly
for anything else.

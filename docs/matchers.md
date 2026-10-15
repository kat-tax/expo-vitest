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
device](device-tests.md#matchers).

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

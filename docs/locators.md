# Locators

[Docs home](README.md) · [Device tests](device-tests.md) · [Matchers](matchers.md)

`screen` finds nodes in a running app's accessibility tree with React Native
Testing Library's queries, so a device test reads like a component test. A
`getBy*` query gives a locator: a query held, not yet run. Each action and
each read resolves it against the tree as it is then, so a locator made
before the screen changed still finds what is on it after.

```ts
// device/profile.test.ts
import {device, screen, within} from 'expo-vitest/device';

afterAll(() => device.close());

it('saves a new name', async () => {
  await device.open('/');
  await screen.getByText('Settings').press();
  await screen.getByRole('textbox', {name: 'Name'}).fill('Ada');
  await screen.getByRole('switch', {name: 'Newsletter'}).check();
  await within(screen.getByRole('dialog')).getByRole('button', {name: 'Save'}).press();
  expect(await screen.findByText('Saved')).toBeTruthy();
});
```

Device test files do not import React Native Testing Library. One that did
would have two `screen`s.

## The queries

Seven predicates, each in RNTL's six families: `getByRole`, `getAllByRole`,
`queryByRole`, `queryAllByRole`, `findByRole`, `findAllByRole`, and the same
for `Text`, `LabelText`, `PlaceholderText`, `DisplayValue`, `TestId` and
`HintText`.

| Family | Matches | Gives | Fails |
| --- | --- | --- | --- |
| `getBy*` | one | a locator | when acted on or read: nothing after waiting, or several at once |
| `getAllBy*` | at least one | a locator | nothing after waiting |
| `queryBy*` | none or one | the node or `null`, without waiting | several |
| `queryAllBy*` | any number | the nodes, without waiting | never |
| `findBy*` | one | the node, waited for | nothing, or still several, after the timeout |
| `findAllBy*` | at least one | the nodes, waited for | nothing after the timeout |

`queryBy*` and `findBy*` give nodes rather than locators, as RNTL gives
elements, because what a test does with them is read them. A `findBy*` takes
a third argument, `{timeout, interval}`: how long to wait, and a fixed gap
between readings in place of the growing one.

| Predicate | Reads | Notes |
| --- | --- | --- |
| `Role` | the node's `kind`, or its `role` | Either word, in any case: `button` finds a UIA `Button`, a `link` and anything whose kind is `button`. Options `name`, `level` for a heading, `checked` (`true`, `false` or `'mixed'`), `selected`, `expanded`, `pressed`, `disabled`. |
| `Text` | the text a person reads | A text or a heading where one matches. Only where none does, any node, which on iOS is a button that draws its own text. Of those, the innermost, so a button holding the text `Save` is found as the text. |
| `LabelText` | the name of anything but text | A button and the text inside it often share a name, and the button is the one that is labelled. |
| `PlaceholderText` | `placeholder` | The hint an empty field shows. react-native-windows reports none. |
| `DisplayValue` | `value` | What a field holds. A secure field never has one. |
| `TestId` | `testId` | The `testID` the component was given. |
| `HintText` | `help` | The hint: `HelpText` on Windows, `aria-description` on web. Elsewhere it matches nothing. |

Every predicate leaves out a node that is off screen, unless the query is
given `{hidden: true}`. RNTL's spelling, `includeHiddenElements`, works too.

### Matching text

A query's text is a string or a pattern, with RNTL's rules:

- A string matches the whole text, after both are trimmed and each run of
  whitespace becomes one space. Case matters.
- `{exact: false}` matches a string as a part of the text, in any case.
- A pattern is tested against the text as normalised, from its start each
  time, so a global pattern matches every node it should.
- `{normalizer}` replaces the normalising.

### What a node is called

A role's `name` and a label read the node's own name, or, for a control with
none, the text inside it, joined with spaces. That is how a screen reader
reads an Android row, whose pressable view has no name of its own and whose
title and summary are text views inside it. The text of a control inside the
control is that control's own, so a list that scrolls is not named after its
rows. On iOS and Android, agent-device names a node with no label after its
testID; that counts as no name.

## within

`within` keeps the queries inside one node:

```ts
within(screen.getByRole('dialog')).getByRole('button', {name: 'OK'});
within(await screen.findByTestId('row-3')).getByText('Delete');
```

It takes a locator, which is resolved afresh each time, or a node a query
gave, which is found again by its testID, or by its role and name. A scope
that names no node, or several, has nothing inside it.

## A locator

| Call | What it does |
| --- | --- |
| `.first()`, `.last()`, `.nth(index)` | One of the nodes the locator names, as a new locator. |
| `.filter({hasText, has})` | Only the nodes with the text somewhere in them, in any case, or with a node inside that another locator names. |
| `.press({via, settle, transition, timeout})` | Presses the node. |
| `.fill(text, {via, settle, transition, timeout})` | Puts text in the field, in place of what it held. |
| `.clear({timeout})` | Empties the field. |
| `.type(text, {timeout})` | Presses the field to focus it, and types where the press put the caret. To replace what a field holds, `fill` it. |
| `.check({timeout})`, `.uncheck({timeout})` | Presses a checkbox or a switch only if it is not already as asked, then waits to read it back. |
| `.longPress({duration, timeout})` | Holds a press, 800 ms by default, as for a context menu. Fails where the platform has no counterpart. |
| `.hover({timeout})` | Moves the pointer over the node without pressing. `'skipped'` on iOS and Android, which have no pointer. |
| `.focus({timeout})` | Gives the node the keyboard focus without pressing it: through the page on web and through UI Automation on Windows. On iOS and Android, agent-device gives the focus with a touch. |
| `.key(name, {timeout})` | Sends a named key, `ArrowDown`, `Enter`, with the node focused, focusing it first. `'skipped'` where the platform sends no keys. |
| `.scrollIntoView({timeout})` | Scrolls the node onto the screen where it is not there already. |
| `.swipe(direction, {distance, timeout})` | Draws a finger across the node the way `direction` says, over half of it by default. A finger drawn up scrolls the content down. A wheel on web; `'skipped'` on Windows. |
| `.waitFor({state, timeout})` | Waits until the nodes are `visible` (the default), `attached` (in the tree at all), `hidden` (none on screen) or `detached` (none in the tree). Gives the node, or `null` for the two states that have none. |
| `.node()` | The node now, or `undefined`. |
| `.all()`, `.count()` | Every node it names now, and how many. |
| `.text()` | What the node is called, worked out as a role's name is. |
| `.value()` | What the field holds. |
| `.isVisible()` | Whether there is a node, and it is on screen. |
| `.boundingBox()` | Where the node is, or `null`. |
| `.resolve(snapshot)` | The nodes it names in a snapshot of your own. |

A locator is strict. An action or a read of one node on a locator that names
several fails at once, listing them:

```
LOCATOR_AMBIGUOUS: getByRole("button", {name: "Save"}) matches 2 nodes; narrow it with first(), nth() or filter(), or use getAllByRole:
  @e7   button "Save" #save-draft  at 24,612
  @e12  button "Save" #save-final  at 24,720
```

An action waits for its node, and for the node to be enabled, as
Playwright's do. A node that never comes fails with what the tree held
instead:

```
LOCATOR_NOT_FOUND: getByRole("button", {name: "Delete"}) matched nothing within 5.0 s; the tree has 42 nodes; 2 nodes have role button: "Save", "Cancel"
```

A node that stays disabled is `NOT_ACTIONABLE`. A `check` that the press did
not take, as on a switch with nothing behind it, is `ACTION_FAILED`, with the
state it read. A `waitFor` for a node to go that never goes is
`ASSERTION_FAILED`, with what each reading saw.

### How an action reaches the app

An action presses the node by its ref, from the snapshot the locator just
read, on every platform: agent-device keeps that snapshot's refs until the
next, a web ref lasts as long as its element, and a Windows ref names the
same node in every snapshot of a screen. A press then works as
[`element`'s does](device-tests.md#element): through a control's UI
Automation pattern on Windows where it has one, and as a person would
elsewhere.

A press on a Windows text goes to the control it sits in when that control
has the Invoke pattern, so it needs no quiet desk. A press on a text
anywhere else lands on its middle, which is inside the control it belongs to.
On web, a node below the fold is scrolled to before it is pressed, as
Playwright does.

### Scrolling

`scrollIntoView` scrolls a node in the tree onto the screen: on web the
page, on Windows through the control's ScrollItem pattern, and on iOS and
Android with agent-device, which scrolls until it sees the node. A row of an
Android list that is not drawn yet is not in the tree at all. For a plain
query, a testID or a whole text or label with no scope or filter, agent-device
looks for it as it scrolls, down and then up:

```ts
await screen.getByText('About phone').scrollIntoView();
await screen.getByText('About phone').press();
```

A long press is a finger held down, so on Android a row with no long press
of its own takes it as a press when the finger comes up.

## Waiting

Every wait reads the tree at once, then again 100 ms later, the gap growing
by half each time to 400 ms, until the time is up: five seconds, or
`deviceConfig({assertionTimeout})`, or a call's own `timeout`. A screen that
answers at once costs one read. Waits running at the same moment share a
read, and nothing read before an action answers a wait after it.

A wait for something to be gone passes only once it has been gone on every
reading for a second, or `deviceConfig({stable})`. Right after an action, a
spinner may not have come in yet, and a single reading would let the test
carry on into it.

| Option | What it does | Default |
| --- | --- | --- |
| `assertionTimeout` | How long an action looks for its node, a `findBy*` waits and a `waitFor` waits, in ms. | 5000 |
| `stable` | How long something must stay gone before a wait for it to go passes, in ms. | 1000 |

Both reach the tests as `HARNESS_ASSERTION_TIMEOUT` and `HARNESS_STABLE`,
which a run can set without the config.

`element(by.…)` and `device.waitFor` keep their own rules: `element` acts on
the first node a selector names, and `device.waitFor` waits ten seconds.

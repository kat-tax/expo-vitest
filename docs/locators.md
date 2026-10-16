# Locators

[Docs home](README.md) · [Device tests](device-tests.md) · [Matchers](matchers.md)

`screen` finds nodes in the accessibility tree with React Native Testing
Library's queries: a running app's in a device test, and in a [unit
test](unit-tests.md) what the test rendered, read as a device's. A `getBy*`
query gives a locator: a query held, not yet run. Each action and each read
resolves it against the tree as it is then, so a locator made before the
screen changed still finds what is on it after.

```ts
// device/profile.test.ts
import {device, screen, within} from 'expo-vitest';

it('saves a new name', async () => {
  await device.open('/');
  await screen.getByText('Settings').press();
  await screen.getByRole('textbox', {name: 'Name'}).fill('Ada');
  await screen.getByRole('switch', {name: 'Newsletter'}).check();
  await within(screen.getByRole('dialog')).getByRole('button', {name: 'Save'}).press();
  expect(await screen.findByText('Saved')).toBeTruthy();
});
```

A test that imports React Native Testing Library's or Testing Library's
`screen` as well has two, so it names one of them apart.

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

On Android the tree itself does this for a node that can be pressed and
says nothing, which is how Compose draws a button: a touch target around the
label's text and a node with the button's role that cannot be pressed. The
touch target is named by the text inside it that cannot be pressed, as
TalkBack reads it, and takes the kind of the one control inside it.

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
| `.press({count, via, settle, transition, timeout})` | Presses the node. `{count: 2}` presses twice in quick succession, as one press: a double tap on iOS and Android, a double click on web and Windows. On Windows a press of more than one goes by the pointer, which needs a quiet desk. |
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
next, and a web or a Windows ref lasts as long as its element, however the
nodes around it come and go. A press then works as
[`element`'s does](#by-and-element): through a control's UI Automation
pattern on Windows where it has one, and as a person would elsewhere.

On Android and iOS, agent-device presses a ref only at a point of the node
that none of the node's controls covers. Where there is none, as on a
Compose button, whose role fills its touch target, a press or a long press
goes to the node's middle, so long as nothing inside the node can be
pressed in the tree. agent-device also refuses a node still moving after a
step that moved the screen, as a field does when it brings up the keyboard.
A press, a long press or a fill then reads the screen again and acts on the
node where it came to rest, up to twice more.

A press on a Windows text goes to the control it sits in when that control
has the Invoke pattern, so it needs no quiet desk. A press on a text
anywhere else lands on its middle, which is inside the control it belongs to.
On web, a node below the fold is scrolled to before it is pressed, as
Playwright does.

| Action | web | Windows | Android and iOS |
| --- | --- | --- | --- |
| `press` | a click at its middle | the control's pattern where it has one, else the pointer | a tap |
| `fill`, `clear` | a click, select all, then typing | the Value pattern, else a click, select all, then typing | agent-device's `fill` |
| `type` | a press, then typing | a press, then typing | a press, then agent-device's `type` |
| `check`, `uncheck` | a press, read back | a press, read back | a press, read back |
| `longPress` | the mouse held down | the pointer held down | agent-device's `longpress` |
| `hover` | the mouse moved over it | the pointer moved over it | `'skipped'` |
| `focus` | the element's own focus | UI Automation's SetFocus | a touch at its middle |
| `scrollIntoView` | the page scrolled | the ScrollItem pattern | a scroll until it is seen |
| `swipe` | a wheel | `'skipped'` | a swipe |
| `key` | the keyboard | the keyboard | `'skipped'` |

On Windows, the pointer and the keyboard are synthetic input, which waits
for a quiet desk; a pattern needs none.

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

## Roles and kinds

`getByRole` takes either word a node carries: `role`, the platform's own,
or `kind`, the [one word every platform shares](device-tests.md#the-tree).
Each platform's word becomes a kind like this:

| Platform | From | Where it reads more than the word |
| --- | --- | --- |
| Windows | the UI Automation control type | a `Button` that toggles and does not invoke is a `switch`; a `Button` in a `Tab` is a `tab`; an `Edit` named for searching is a `searchbox` |
| Android | the widget's class | a named child of a tab bar is a `tab`; an `EditText` whose testID or name says search is a `searchbox`; a node that can be pressed and says nothing takes the kind of the one control inside it that cannot be pressed; a class the table lacks takes agent-device's own word for it |
| iOS | the XCUIElement type | a button in a tab bar or a segmented control is a `tab`; a type the table lacks, as a SwiftUI control read by its class, takes agent-device's own word for it |
| web | the ARIA role, given or implied by the tag | a plain element kept for its text is `text` |

## by and element

The shorter spelling: `element(by.…)` names a node with a selector, and acts
on the first node it matches, without waiting.

```ts
import {by, element} from 'expo-vitest';

await element(by.testID('save')).press();
```

| Call | What it does |
| --- | --- |
| `.press({count, via, settle, transition})` | Presses it. On Windows, through the control's UI Automation pattern where it has one and the press shows, which needs no quiet desk; `{via: 'pointer'}` presses with the pointer, and `settle` and `transition` change [the waits](device-tests.md#waiting-for-the-screen) for this step. `{count: 2}` is a double press, as on a locator. On web, a node below the fold is scrolled to first. |
| `.fill(text, {via, settle, transition})` | Puts text in a field, in place of what it held. On Windows, a field with a Value pattern gets the text set and read back; `{via: 'keys'}` clicks the field, selects what it holds and types over it. `settle` and `transition` as for a press. |
| `.node()` | The node now, or `undefined`. |
| `.waitFor({timeout})` | Waits until it is in the tree, ten seconds by default. |

| Selector | Matches |
| --- | --- |
| `by.testID(id)` | The `testID` the component was given. It reaches `data-testid` on web and `AutomationId` on Windows. |
| `by.label(name)` | The accessible name, exactly first, then in any case, then as a part of it. |
| `by.text(part)` | The accessible name, loosely: `New` finds `New drop`. |
| `by.role(role)` | What it is: the platform's own word (`Button`, `TabItem`, `link`), or its kind (`button`, `tab`, `switch`). |
| `by.ref(ref)` | A ref from a snapshot (`@e7`). Good for that snapshot only. |

Each platform matches a selector by the same rules. On iOS and Android a
label, a role or a part of a name is found in a fresh tree first, as it is on
web and Windows, and the step goes to that node, since agent-device matches a
label only whole and one key of a selector alone.

Prefer `by.testID`. A label is copy and changes with wording and language, a
ref is only good for one snapshot, and a role finds every button on the screen.

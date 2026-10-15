# Phase 2. Locators, matchers, evidence

Status: in progress (items 1 to 13 done; the React tree from section 5 is next) · Size: M · Depends on: Phase 0, Phase 1 · Unblocks: Phase 3, Phase 5

The developer experience core. After this phase a device test reads like a
React Native Testing Library test, an assertion waits the way Playwright's
does, and a failing test leaves behind what a person needs to see what went
wrong. Everything is additive beside `element` and `by`; the contract in
[README.md section 3](README.md#3-the-compatibility-contract) holds.

## As built

On the `e2e` branch, after Phase 1. Where the build differs from the design
below, the build is what holds.

- **Phase 1 changed what an action can pass.** Web refs now last as long
  as their element, and a Windows ref means the same node in an
  interactive and a full snapshot. A Windows press also needs the node,
  not a point, to go through the control's pattern. So item 5's
  `targetFor` passes the ref everywhere, not a point on web and Windows.
- **Item 1: the state fields.**
  - **Windows** reads them through the host and the scripts, asking UI
    Automation without its defaults. Otherwise every node reads as a
    toggle switched off, a selection not made and an empty value. A
    toggle on a `Button` is `pressed`.
  - **react-native-windows** reports no placeholder, so a Windows node has
    none.
  - **agent-device:**
    - `checked` passes through.
    - `password` becomes `secure`, and `hint` becomes `placeholder`.
    - `value` comes only from an editable node, and is empty while Android
      shows the hint in place of the text.
    - `selected` stays only when true: agent-device reports
      `selected: false` on every Android node, as a snapshot of the phone
      showed, 62 nodes and every one of them false.
  - **Seen live:**
    - Every state on a web page of one control each.
    - Entz's tabs, favourite stars, fields, theme choice and combo boxes,
      on its Documents and Settings screens, with the host and the scripts
      agreeing on every node.
  - **Not seen:** iOS, which needs a Mac.
- **Item 2: the fixtures are in `src/harness/lib/__fixtures__/`.**
  - **Android:** three screens of a clean emulator's Settings app, as
    agent-device printed them. They showed the field is called
    `placeholder`, not `hint`, which corrected item 1.
  - **Windows:** two screens of a react-native-windows app, with the app's
    words replaced.
  - **Web:** react-native-web's output, and a page of controls in each
    state.
  - Capturing the web one showed icon-font glyphs read as text, which is
    fixed in a commit of its own.
  - There is no iOS fixture.
- **Item 3: `kind`.**
  - Each backend sets it where it has the native facts:
    - **Windows:** the driver, from the host's control types and patterns,
      with each node's parent.
    - **agent-device:** the mapping, from the Android class or the
      XCUIElement type, the parent's, and agent-device's own `kind` for a
      class the table lacks.
    - **Web:** the driver, from the ARIA role the page gives or the tag
      implies.
  - react-native-windows gives `switch` and `togglebutton` the same
    control type, `Button`, and sets no localized type to tell them apart.
    So a toggling `Button` without Invoke is a `switch` and reads
    `checked`, and item 1's `pressed` there was changed. `pressed` is kept
    for a `Button` that also invokes.
  - Every node of the Windows and Android fixtures has a kind, but the
    window and custom views.
  - The iOS table is XCUIElement's type names, unread off a device.
- **Item 4: the queries, `src/device/queries.ts`.**
  - A query is data, with its scope and a `has` filter as queries too, so
    resolving one needs no device and the locator only holds one.
  - **Names.** A role's `name` and a label read the node's own name, or,
    for a control with none, the text inside it that is not inside a
    control within it. An Android row has no name of its own, as every
    row of the emulator fixtures showed, and a list that scrolls is
    interactive too, so without the second half it took every row's text.
    agent-device names a node with no label after its testID, which on
    iOS and Android counts as no name.
  - **`getByText`** takes a text or a heading where one matches, and
    only where none does, any node, then the innermost of those. The
    design's rule took any node, and on the emulator's Display screen a
    switch carries the name of the text beside it.
  - **`getByLabelText`** leaves text and headings out. A button and the
    text inside it share a name on Windows and web: 68 of the 94 nodes
    of the Windows fixture are text inside a button.
  - `getByTestId` follows RNTL's text rules, as RNTL does, rather than
    only exact. A string is normalised on both sides, and a global pattern
    is tested from the start every time, as in RNTL.
  - `filter({hasText})` looks inside the node too, as Playwright does.
  - The web fixtures were captured again once nodes carried `kind`, and
    match the first capture node for node apart from it.
- **Item 7 came before item 5,** so the locator's waits use the
  scheduler from the start.
  - `assertionTimeout` and `stable` reach the worker through the
    environment, `HARNESS_ASSERTION_TIMEOUT` and `HARNESS_STABLE`, as
    `settle` and `transition` do, rather than `provide`. A run started
    without `deviceConfig` can set them too.
  - An action invalidates the feed, a read in flight included, so nothing
    read before an action answers a wait after it. Spacing alone would let
    a wait read the tree from before a fast press.
  - A negated wait times its next reading to the moment its condition
    will have held for `stable`. The worked example then passes at
    2213 ms on the ninth reading, as worked.
- **Item 5: `src/device/locator.ts` and `src/device/screen.ts`.**
  - Seven predicates in six families make 42 queries.
  - `element` stays on its own path. Moved under the locator, it would
    wait before failing, change its messages, and pass a ref where the
    contract pins the selector it was given.
  - `targetFor` passes the ref, except that a press on a Windows text
    goes to the control it sits in when that control has Invoke. In the
    Windows fixtures, 2 of the 70 texts in a button have one. The rest
    are in buttons a press reaches only with the pointer either way, and
    the text's own middle is the safer point.
  - An action waits for its node to be enabled, as Playwright's do, and a
    node that stays disabled is `NOT_ACTIONABLE`.
  - `check` reads the control back by following it into the next
    snapshot: by its ref where that still names it, else by its place
    among the nodes alike, since agent-device numbers refs afresh.
  - `within` takes a locator, or a node, found again by its testID or
    its role and name.
  - `ASSERTION_FAILED` arrived here, with `LOCATOR_AMBIGUOUS`, since a
    `waitFor` for a node to go produces it.
  - The locator's `key`, `longPress`, `hover`, `focus`,
    `scrollIntoView` and `swipe` come with item 6.
  - `docs/locators.md` came with the feature, as AGENTS.md asks.
  - **Seen live:**
    - Web, on the page of controls: a native checkbox checked and
      unchecked with each state read back, an uncheck the page ignores
      failing as it should, and strictness, suggestions, `findBy`,
      `within` and a held `hidden`.
    - Web, on the Expo Router example: a press on the text inside a link
      navigated, and back.
    - Windows, on a react-native-windows app: tabs pressed through
      SelectionItem, and a search field filled through Value and through
      keys.
    - Android, on the emulator's Settings: a row found by the text it
      holds and pressed, and the Dark theme switch checked and unchecked
      with each state read back.
  - **Not seen:** iOS.
  - The live runs found two driver bugs, fixed in commits of their own.
    A fill appended on web and through keys on Windows, where agent-device
    and the Value pattern replace. The Windows driver handed typed text
    to SendKeys as syntax, so `1+1` typed `1!`.
- **Item 6: the actions a backend may not have.**
  - `longPress`, `hover`, `focus`, `scrollIntoView` and `swipe` are
    optional on `Driver`, and the locator has them and `key`.
    `longPress` and `focus` fail with UNSUPPORTED_CAPABILITY where a
    platform has none, since a test that went on as if a context menu had
    opened would fail later for the wrong reason. The other three answer
    `skipped`.
  - `swipe` takes two points. The locator works the path out across its
    node, so every backend is given the same thing.
  - **Web:** the mouse holds and hovers. The page focuses and scrolls the
    element the ref names. A swipe is a wheel.
  - **agent-device:** `longpress` takes a ref. Its `focus` takes only a
    point and its `scroll --until` only a selector, so the driver reads
    the node off a fresh tree for those. On iOS and Android the focus is
    given with a touch.
  - **Windows:**
    - The host's `hold` now checks that the window under the point is
      the app's, as a click does.
    - A new `move` is an absolute pointer move, since SetCursorPos alone
      raises no pointer move.
    - A new `focus` is UI Automation's SetFocus, read back.
    - `scrollIntoView` is the ScrollItem pattern, and there is no swipe.
    - The script-per-step backend skips all of them.
  - `offscreen` on web means a node with no size, as Playwright counts
    what is visible, so whether a node needs scrolling is each backend's
    to tell. That showed that a web press below the fold landed on
    nothing. It now scrolls first, in a commit of its own.
  - An Android list's rows leave the tree as it scrolls. So a plain query
    (a testID, or a whole text or label) that finds nothing asks the
    backend to scroll until it sees it, down and then up.
  - On Android, a long press on a row with no long press of its own is a
    press when the finger comes up. Live, it opened the row.
  - Each device test file makes its own driver, so the Windows idle guard
    refused the second of two files for the first one's input. What the
    guard has seen is now kept in `.harness/windows-desk.json`, in a
    commit of its own.
  - **Seen live:**
    - Web: all six, with a below-the-fold press.
    - Windows, on a react-native-windows app: focus through UI
      Automation, a key, a hover, a long press, ScrollItem on a node off
      screen, a swipe skipped, and two files run back to back.
    - Android, on the emulator: a swipe both ways, a long press, and a
      Settings row swiped out of the tree brought back by its text in
      6.5 s.
  - **Not seen:** iOS.
- **Item 8: the matchers, `src/device/expectations.ts`.**
  - There are eighteen, since the design's table names eighteen. The
    logic is a module of its own, in the coverage gate, and
    `src/device/matchers.ts` registers it.
  - Their types are declared there too, and `expo-vitest/device`
    re-exports a type from it, so a program that imports the device
    layer has them. Before, the four tree matchers' types reached only a
    program that included the setup file.
  - React Native Testing Library (through vitest-native's types) and
    jest-dom declare eleven of the names on `Assertion`, with no
    timeout, and theirs won over these on `Matchers`. Those eleven are
    declared on `Assertion` itself, theirs first, so a component test
    types as it did and a device call with options takes these. The
    implementations take what their forms pass: any attribute name, any
    value, a name left out.
  - Vitest leaves `isNot` unset without `.not`, which at first read as
    negated and held every positive matcher a second.
  - A locator carries its device under a `Symbol.for` key. A module-level
    map broke the contract test, which loads a second copy of the module
    after `vi.resetModules()`.
  - A not-found message says first when what a query names is off
    screen, and that `{hidden: true}` takes it.
  - **Seen live:**
    - Web: every matcher on the page of controls, a failure's message,
      and a `.not` held for a second.
    - Windows: tabs selected, a count, the tabs' texts, a field's value
      and role, and a node off screen hidden.
    - Android: a row visible and holding its text, the Dark theme switch
      checked both ways around a check and an uncheck, and a node in the
      tree.
  - **Not seen:** iOS.
- **Items 9 and 10: the journal, the trace and the hook.**
  - The journal is on the device (`device.journal`), and steps are
    recorded where their meaning is known: the device for its own calls
    and `element`'s, a locator for its actions with the query and the
    node, `findBy*` and a locator's `waitFor` as waits, and each matcher
    as an assertion with its polls and readings.
  - Steps gain `check`, `hover`, `focus`, `scroll` and `swipe` events
    for item 6's actions.
  - Every full snapshot the device reads is digested into the step under
    way, or the last step with none. The driver's `snapshot` is left as
    it is, since the contract pins that it reads straight through, so a
    press's screen after comes from the next read, which happens anyway.
  - A `verified` step names the last action that went through. A
    skipped one did nothing to see.
  - The hook skips a test that never used the device.
  - **Seen live:** a failing test left its screenshot, both trees and a
    trace on web, on a react-native-windows app and on an Android
    emulator.
  - Vitest takes no annotation from a test that has finished, which it
    has by `afterEach`. So the evidence is an artifact of type
    `expo-vitest:evidence`, through `recordArtifact`, with the trace and
    the screenshot attached, and its paths on `meta.evidence`. Found by the
    fixture's device suite; Phase 4's reporter reads the artifact.
  - **Still to build from section 5:** the React tree.
- **Item 11: headed web.** The browser search is
  `src/harness/platforms/web-browsers.ts`, in the gate. It looked for the
  full Chromium under `chrome-win` only, and Playwright now installs it
  under `chrome-win64`, so it knows each platform's layouts of both builds.
  It also looks where `PLAYWRIGHT_BROWSERS_PATH` says. Playwright may find
  a browser of its own, so `available()` says only a shell is installed
  only where the search found a shell and no full browser. **Seen live:**
  a headed run slowed by 50 ms opened, pressed and read the page of
  controls, `doctor` said so, and with only a shell faked in its place,
  `doctor` gave the message.
- **Item 12: the fixture's device suite.** `fixture/device/` drives a page
  its `globalSetup` serves, with the packed package. Its six tests cover
  the queries and actions, the matchers, waiting for a node to go, a
  screenshot with no baseline, the traces the tests before it left, and
  `expo-harness` run from the installed `dist`. It found that the web
  collector never read a `ul`, an `ol`, an `img`, a `progress`, an
  `output` or an `h5` or `h6`, though it knew their roles, and that
  Vitest refuses an annotation after a test. Both are fixed in commits of
  their own. CI installs the headless shell before the fixture.
- **Item 13: the docs.** `docs/device-tests.md` is the front page: setup,
  a test with `screen`, running, `device`, waiting for the screen, the
  tree and the errors. `element` and `by` moved to `docs/locators.md` as
  the shorter spelling, beside a table of each action on each platform and
  how each platform's words become a kind. The four snapshot matchers
  moved to `docs/matchers.md`. The README's rows name `screen`, the
  matchers that wait, and evidence.

## Purpose and the claims it proves

Three of the criteria in [README.md section 2](README.md#2-what-better-means-concretely):

- **Friendlier.** Query names an RNTL user already knows (`getByRole`,
  `findByText`, `queryByTestId`), with RNTL's option names and RNTL's three
  families (`get`, `query`, `find`) meaning what they mean there. e2e asks a
  React Native developer to learn Playwright's names.
- **The tree is the evidence.** A failing test writes its screenshot, its tree
  as text and JSON, and a trace of every step with what changed in the tree
  after it. e2e's trace has steps and a screenshot; ours has the tree diffs.
- **Wider.** Every query, action and matcher runs on all four platforms. The
  one thing e2e has here that we do not is strict single-match locators and
  polling matchers, and this phase closes that.

## What e2e does

From the `screen`, `expect` and debugging references, checked 2026-10-13:

- Queries are lazy and return a `Locator` synchronously: `getByRole(role, name?,
  options?)`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByDisplayValue`,
  `getByTestId`, refined with `filter({hasText, has})`, `first()`, `last()`,
  `nth(i)`. A string matches the whole text, case-sensitive; `{exact: false}`
  is a case-insensitive substring; a RegExp tests. `getByText` returns the
  innermost match. An unknown option is `INVALID_LOCATOR`.
- Actions poll to `actionTimeout` (30 s), then `LOCATOR_NOT_FOUND` on zero
  matches. Several matches throw `LOCATOR_AMBIGUOUS` at once. Reads do not wait.
- Matchers poll to `assertionTimeout` (5 s), each accepting `timeout`. Positive
  matchers need exactly one match. Negated matchers pass after 1000 ms of
  continuous truth. `toHaveCount` and the list forms accept zero matches.
- The matcher list: `toBeVisible`, `toBeHidden`, `toBeAttached`, `toBeEnabled`,
  `toBeDisabled`, `toBeChecked`, `toBeSelected`, `toBeExpanded`, `toBeFocused`,
  `toHaveText`, `toContainText`, `toHaveValue`, `toHaveAttribute`,
  `toHaveAccessibleName`, `toHaveCount`, `toHaveScreenshot`. There is no
  `expect.extend`, so an accessibility audit cannot be added by a user.
- Roles are normalised: iOS `Button` is `button`, `TextField` is `textbox`,
  `Cell` is `listitem`, `TabBar` is `tablist` with `tab` children; Android
  `EditText` is `textbox`, `RecyclerView` is `list`. Other types pass through
  lower-cased. On devices a node has only `placeholder` as an attribute.
- A failed test gets `.e2e/results/<test>-<hash>/trace.md` with the steps (the
  node each action hit, the values an assertion read while waiting, how the
  screen changed), the app log, the agent's last turns, and the screen at
  failure as a screenshot and a semantic tree captured within 5 s. The
  terminal prints the path under the failure. `--trace` keeps one for every
  test, `--trace off` writes none. `--headed` shows the browser.

## What this package has today

- `src/device/index.ts:47` `Device`, with `snapshot`, `fullSnapshot`,
  `waitFor` at `:111` polling a full snapshot every 400 ms for 10 s, and
  `element(selector)` at `:133` resolving fresh per action through
  `driver.press(selector)` and `driver.fill(selector, text)`.
- `src/harness/lib/snapshot.ts:15` `SnapshotNode` with `ref`, `role`, `name`,
  `testId`, `depth`, `interactive`, `focused`, `focusable`, `enabled`,
  `offscreen`, `help`, `inSet`, `heading`, `live`, `status`, `dialog`,
  `bounds`. `Selector` at `:73` (`ref`, `testId`, `label`, `role`,
  `contains`), `by` at `:89`, `parseTarget` at `:111`, `findNode` at `:137`
  (first match; a label matches whole, then case-insensitive, then substring;
  `role` compares the native word case-insensitively), `renderSnapshot` at
  `:163`.
- `src/device/matchers.ts:41` to `:182`: `toHaveElement`, `toBeFullyLabelled`
  on a snapshot, `toSupportArrowNavigation` and `toMatchScreenshot` on the
  device, registered with `expect.extend`, typed by augmenting `Matchers<T>`
  in `@vitest/expect`. This file is the device project's setup file
  (`src/projects.ts:316`) and the public `expo-vitest/device/matchers`.
- `src/harness/platforms/web.ts:43` `COLLECT`: the role is the `role`
  attribute or the tag name (`:56`); interactive is a fixed set (`:49`);
  `offscreen` is a zero-size box; the name follows `aria-label`,
  `aria-labelledby`, `labels`, then text content.
- `src/harness/windows/snapshot.ps1:74`: the role is UI Automation's
  `ControlType` programmatic name (`Button`, `Edit`, `TabItem`); `:38` the
  actionable set; `:77` `IsOffscreen`; `:85` `HeadingLevel`; `HasKeyboardFocus`,
  `IsEnabled`, `HelpText`, `PositionInSet`, `ItemStatus`, `IsDialog`,
  `LiveSetting` already read.
- `src/harness/platforms/agent-device.ts:12` `AgentNode` (`role`, `type`,
  `label`, `value`, `identifier`, `rect`, `enabled`, `focused`, `hittable`,
  `visibleToUser`), converted at `:28`. The native role word is whatever
  agent-device reports.
- No notion of hierarchy beyond `depth`, no state beyond `focused` and
  `enabled`, no normalised role, no polling matcher, nothing written on
  failure, no headed mode.

## Design

### 1. `screen`, with RNTL's names

A new export from `expo-vitest/device`, built on the same `device`:

```ts
import {by, device, element, screen, within} from 'expo-vitest/device';

screen.getByRole('button', {name: 'Save'});          // Locator, lazy, strict
screen.getAllByRole('listitem');                      // Locator over many
await screen.findByText('Saved');                     // SnapshotNode, waits
await screen.queryByText('Error');                    // SnapshotNode | null, no wait
within(screen.getByRole('dialog')).getByText('OK');  // scoped
```

Six predicates, each in six variants, plus one the tree already carries:

| Predicate | Reads | Notes |
| --- | --- | --- |
| `Role` | `kind`, then `role` | Case-insensitive on either. Options `name`, `level`, `checked`, `selected`, `expanded`, `pressed`, `disabled`, `hidden`. |
| `Text` | `name` of a non-interactive node | RNTL's `getByText` matches text content; here a node with `kind` `text` or `heading`, or any node when none has that role. |
| `LabelText` | `name` of any node | The accessible name, which is what `aria-label`, `accessibilityLabel` and a `<label>` become. |
| `PlaceholderText` | `placeholder` | New field, section 3. |
| `DisplayValue` | `value` | New field, section 3. A secure field never carries one. |
| `TestId` | `testId` | Exact, as `by.testID` is. |
| `HintText` | `help` | RNTL's `getByHintText`. Windows fills `help` from `HelpText`, web from `aria-description`; elsewhere it matches nothing, which is the honest answer. |

RNTL's semantics, kept exactly:

| Family | Matches | Returns | Throws |
| --- | --- | --- | --- |
| `getBy*` | exactly one | `Locator` | on action or read: zero after waiting is `LOCATOR_NOT_FOUND`, several is `LOCATOR_AMBIGUOUS` at once |
| `getAllBy*` | at least one | `Locator` | zero after waiting |
| `queryBy*` | zero or one | `Promise<SnapshotNode \| null>` | several, at once |
| `queryAllBy*` | any | `Promise<SnapshotNode[]>` | never |
| `findBy*` | exactly one | `Promise<SnapshotNode>` | zero or several after `timeout` |
| `findAllBy*` | at least one | `Promise<SnapshotNode[]>` | zero after `timeout` |

`query*` and `find*` return nodes, not locators, because that is what RNTL
returns and what a test does with them is read. A `getBy*` locator is lazy,
so `screen.getByText('Saved')` costs nothing until it is acted on or asserted.

Text matching (`TextMatch = string | RegExp`), RNTL's rules:

- A string matches the whole value after normalisation: trim, and collapse
  runs of whitespace to one space. Case-sensitive.
- `{exact: false}` is a case-insensitive substring match.
- A RegExp is tested against the normalised value; `exact` has no effect.
- `{normalizer}` replaces the normalisation, as in RNTL.

`hidden` defaults to `false` and excludes nodes with `offscreen: true`. RNTL
calls the option `includeHiddenElements` with `hidden` as an alias; both are
accepted. `findBy*` takes `{timeout, interval}` with `timeout` defaulting to
`assertionTimeout`, not RNTL's 1000 ms, because a real app is slower than a
rendered tree and e2e's default is 5 s.

### 2. The `Locator`

```ts
// src/device/locator.ts
export interface LocatorQuery {
  predicate: 'role' | 'text' | 'label' | 'placeholder' | 'value' | 'testId' | 'hint';
  match: string | RegExp;
  options: QueryOptions;             // exact, hidden, name, level, checked, ...
  scope?: Locator;                   // from within()
  refinements: Refinement[];         // filter({hasText, has}), first, last, nth
  cardinality: 'one' | 'many';       // getBy versus getAllBy
}

export class Locator {
  constructor(private readonly device: Device, readonly query: LocatorQuery) {}

  // Refinement, lazy
  first(): Locator; last(): Locator; nth(index: number): Locator;
  filter(options: {hasText?: string | RegExp; has?: Locator}): Locator;

  // Actions, each resolved fresh, strict for 'one'
  press(options?: {timeout?: number}): Promise<void>;
  longPress(options?: {duration?: number; timeout?: number}): Promise<void>;
  fill(text: string, options?: {timeout?: number}): Promise<void>;
  clear(options?: {timeout?: number}): Promise<void>;
  type(text: string, options?: {timeout?: number}): Promise<void>;
  key(name: string, options?: {timeout?: number}): Promise<'pressed' | 'skipped'>;
  check(options?: {timeout?: number}): Promise<void>;
  uncheck(options?: {timeout?: number}): Promise<void>;
  hover(options?: {timeout?: number}): Promise<'done' | 'skipped'>;
  focus(options?: {timeout?: number}): Promise<void>;
  scrollIntoView(options?: {timeout?: number}): Promise<'done' | 'skipped'>;
  swipe(direction: 'up' | 'down' | 'left' | 'right', options?: {timeout?: number}): Promise<'done' | 'skipped'>;
  waitFor(options?: {state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number}): Promise<SnapshotNode | null>;

  // Reads, never waiting
  node(): Promise<SnapshotNode | undefined>;
  all(): Promise<SnapshotNode[]>;
  count(): Promise<number>;
  text(): Promise<string>;
  value(): Promise<string | undefined>;
  isVisible(): Promise<boolean>;
  boundingBox(): Promise<Bounds | null>;

  // The resolver every action and matcher goes through
  resolve(snapshot: Snapshot): SnapshotNode[];
}
```

Resolution is pure: `resolve(snapshot)` filters the flat node list by scope,
predicate, options and refinements, in that order, and is what the unit tests
exercise. `scope` keeps the descendants of the scoping locator's one match:
nodes whose `parent` chain (Phase 1) reaches it, or, on a snapshot without
`parent`, the nodes that follow it in the list with a greater `depth` until
one with a depth at or below its own, which is the same thing on the pre-order
walk all three backends produce. `filter({has})` resolves the inner locator
within each candidate the same way.

Strictness. An action or a single-node read on a `'one'` locator with several
matches fails at once with `LOCATOR_AMBIGUOUS` and lists the candidates:

```
LOCATOR_AMBIGUOUS: getByRole("button", {name: "Save"}) matches 2 nodes; narrow it with first(), nth() or filter(), or use getAllByRole:
  @e7  button "Save" #save-draft  at 24,612
  @e12 button "Save" #save-final  at 24,720
```

Zero matches waits to `timeout` (default `assertionTimeout` for actions, since
a press that waits 30 s like e2e's `actionTimeout` is a slow failure), then
`LOCATOR_NOT_FOUND` with the tree's node count and the nearest names by
substring, which is what today's `waitFor` message does plus the suggestions.

How an action reaches the driver. A locator resolves against a snapshot it
takes, then acts on the one node. The `Driver` shape in
`src/harness/lib/types.ts` takes a `Target`, and a ref is only valid against
the latest snapshot the backend produced. For agent-device that snapshot is
the one the locator just took, so the locator passes `by.ref(node.ref)` and
the press lands through the accessibility action, which works on a node a
coordinate would miss. For web and Windows the drivers press a point, and
their `pointFor` would take a second snapshot and renumber the refs, so the
locator passes the node's centre point from `centreOf(node)`. One snapshot per
action instead of today's two. `targetFor(node, platform)` in
`src/device/locator.ts` holds that rule, with the reason beside it.

What each action is on each backend:

| Action | agent-device | web | Windows |
| --- | --- | --- | --- |
| `press` | `press` by ref | `mouse.click` at the centre | click at the centre |
| `longPress` | `longpress` | `mouse.down`, wait, `mouse.up` | new host op `hold` (Phase 1 host) |
| `fill` | `fill` by ref | click, select all, type | click, `^a`, type |
| `clear` | `fill` with `''` | click, select all, `Backspace` | click, `^a`, `{BACKSPACE}` |
| `type` | focus then `type` | click then `keyboard.type` | click then `SendKeys` |
| `key` | `skipped` (as today) | `keyboard.press` | `SendKeys` from the table in `windows.ts` |
| `check`, `uncheck` | read `checked`, press if it differs | same | same |
| `hover` | `skipped` | `mouse.move` | `SetCursorPos` |
| `focus` | `focus` by ref | `element.focus()` through evaluate | click |
| `scrollIntoView` | `scroll --until` | `scrollIntoView` through evaluate | `skipped` |
| `swipe` | `swipe` | `mouse.wheel` | `skipped` |

`longPress`, `hover`, `focus`, `scrollIntoView` and `swipe` become optional
`Driver` members beside `key?`, answered `skipped` where absent, which is the
existing rule for a backend with no counterpart. `check` is composed: read the
node's `checked`, press only when it differs, read again, fail with
`ACTION_FAILED` if it did not change. `element(by.…)` keeps its four methods
and its first-match behaviour; underneath it becomes a `Locator` with
`cardinality: 'many'` and a `first()` refinement, so the two share one code
path and the contract test still sees the same results.

### 3. `kind` and the state fields

Every node gains, where the platform reports it:

| Field | Type | Source |
| --- | --- | --- |
| `kind` | one of the vocabulary below | the role map |
| `checked` | `boolean \| 'mixed'` | UIA `ToggleState`; DOM `checked` and `aria-checked`; agent-device `value` on a switch or checkbox |
| `selected` | `boolean` | UIA `SelectionItem.IsSelected`; DOM `aria-selected` and `option.selected`; agent-device `selected` |
| `expanded` | `boolean` | UIA `ExpandCollapseState`; DOM `aria-expanded` and `details.open` |
| `pressed` | `boolean` | DOM `aria-pressed`; UIA `ToggleState` on a `Button` |
| `value` | `string` | UIA `Value` pattern; DOM `value` of an input; agent-device `value`. Never set on a secure field. |
| `placeholder` | `string` | DOM `placeholder`; UIA `HelpText` only when WinUI puts the placeholder there, else absent; agent-device `placeholder` where present |
| `secure` | `true` | UIA `IsPassword`; DOM `type=password`; XCUIElement `SecureTextField` |

Absent unless reported, the same rule as `help` and `inSet`, and the reason is
the same: a missing state on an interactive control is a finding, not a
default. `src/harness/windows/snapshot.ps1` reads `IsPasswordProperty`,
`ToggleStateProperty`, `SelectionItemIsSelectedProperty`,
`ExpandCollapseStateProperty` and `ValueValueProperty` through its `Prop`
helper, which already answers `$null` for `NotSupported`. The web `COLLECT`
script reads the attributes and properties named above. The agent-device
driver passes through what its node carries and adds nothing.

The vocabulary, fixed: `button`, `textbox`, `checkbox`, `switch`, `tab`,
`tablist`, `link`, `heading`, `listitem`, `menuitem`, `radio`, `slider`,
`progressbar`, `dialog`, `text`, `image`, `group`, `list`, `combobox`,
`searchbox`, `spinbutton`, `status`, `alert`, `toolbar`, `menu`, `radiogroup`.
A native type outside it leaves `kind` absent. `role` is untouched.

The map is data in `src/harness/lib/roles.ts`, one table per platform, with a
small predicate where one native type means two things:

| Native | Platform source | `kind` |
| --- | --- | --- |
| `Button` | UIA `UIA_ButtonControlTypeId` | `button`; `switch` when the Toggle pattern is available and Invoke is not (WinUI `ToggleSwitch`); `tab` when the parent is a `Tab` |
| `Edit` | UIA | `textbox`; `searchbox` when the AutomationId or name says search |
| `CheckBox`, `RadioButton`, `ComboBox`, `Hyperlink`, `Image`, `List`, `ListItem`, `Menu`, `MenuBar`, `MenuItem`, `ProgressBar`, `Slider`, `Spinner`, `Tab`, `TabItem`, `ToolBar`, `Group`, `Pane`, `StatusBar` | UIA | `checkbox`, `radio`, `combobox`, `link`, `image`, `list`, `listitem`, `menu`, `menu`, `menuitem`, `progressbar`, `slider`, `spinbutton`, `tablist`, `tab`, `toolbar`, `group`, `group`, `status` |
| `Text` | UIA | `heading` when `HeadingLevel` is set, else `text` |
| `Window` | UIA | `dialog` when `IsDialog`, else absent |
| `role` attribute | DOM | the attribute's first token when it is in the vocabulary; `img` becomes `image` |
| `button`, `a[href]`, `input` by type, `select`, `textarea`, `h1` to `h6`, `img`, `ul`, `ol`, `li`, `dialog`, `progress`, `output`, `menu` | DOM implicit roles | `button`, `link`, `textbox` / `checkbox` / `radio` / `slider` / `spinbutton` / `searchbox`, `combobox`, `textbox`, `heading` with `level`, `image`, `list`, `list`, `listitem`, `dialog`, `progressbar`, `status`, `menu` |
| `p`, `span`, `div`, `label`, `td`, `li` leaf with text | DOM | `text` |
| `Button`, `TextField`, `SearchField`, `SecureTextField`, `TextView`, `StaticText`, `Switch`, `Toggle`, `Slider`, `Link`, `Image`, `Cell`, `Table`, `CollectionView`, `TabBar`, `SegmentedControl`, `ProgressIndicator`, `ActivityIndicator`, `Stepper`, `Toolbar`, `Menu`, `MenuItem`, `RadioButton`, `RadioGroup`, `CheckBox`, `Alert`, `Sheet`, `Dialog`, `Other`, `Group`, `ScrollView` | XCUIElement types as agent-device reports them on iOS | `button`, `textbox`, `searchbox`, `textbox` plus `secure`, `textbox`, `text`, `switch`, `switch`, `slider`, `link`, `image`, `listitem`, `list`, `list`, `tablist`, `tablist`, `progressbar`, `status`, `spinbutton`, `toolbar`, `menu`, `menuitem`, `radio`, `radiogroup`, `checkbox`, `dialog`, `dialog`, `dialog`, absent, `group`, `group`; a `Button` whose parent is a `TabBar` or `SegmentedControl` is `tab` |
| `Button`, `ImageButton`, `EditText`, `TextView`, `CheckBox`, `Switch`, `SwitchCompat`, `ToggleButton`, `RadioButton`, `RadioGroup`, `SeekBar`, `ProgressBar`, `ImageView`, `RecyclerView`, `ListView`, `Spinner`, `TabLayout`, `BottomNavigationView`, `Toolbar`, `NumberPicker`, the layouts and `ViewGroup` | Android class simple names as agent-device reports them | `button`, `button`, `textbox`, `text`, `checkbox`, `switch`, `switch`, `switch`, `radio`, `radiogroup`, `slider`, `progressbar`, `image`, `list`, `list`, `combobox`, `tablist`, `tablist`, `toolbar`, `spinbutton`, `group`; a child of a `TabLayout` or `BottomNavigationView` with a name is `tab` |

The iOS and Android key spellings are confirmed against a real snapshot on a
simulator and an emulator in the first work item, and the snapshots are kept
as fixtures under `src/harness/lib/__fixtures__/` so the map's tests run
against what agent-device actually prints rather than what a document says.

`by.role(x)` matches `role` or `kind`, case-insensitively, in `findNode`.
That is the one widening of an existing selector, flagged in README.md.

### 4. Polling matchers

Seventeen matchers on a `Locator`, registered in `src/device/matchers.ts`
beside the four that exist, which do not change:

| Matcher | Passes when, on the resolved node | Zero matches |
| --- | --- | --- |
| `toBeVisible` | one match, `offscreen` not `true` | keeps polling |
| `toBeHidden` | no match, or every match `offscreen` | passes |
| `toBeAttached` | at least one match | keeps polling |
| `toBeDetached` | no match | passes |
| `toBeEnabled`, `toBeDisabled` | `enabled` not `false` / `enabled === false` | keeps polling |
| `toBeChecked(value = true)` | `checked === value`, `'mixed'` allowed | keeps polling |
| `toBeSelected`, `toBeExpanded`, `toBePressed`, `toBeFocused` | the field is `true` | keeps polling |
| `toHaveText(match)` | `name` matches, RNTL rules; a list form takes an array against `all()` | keeps polling |
| `toContainText(match)` | `name` contains, case-insensitive | keeps polling |
| `toHaveValue(match)` | `value` matches | keeps polling |
| `toHaveAccessibleName(match)` | `name` matches | keeps polling |
| `toHaveRole(role)` | `kind` or `role` matches | keeps polling |
| `toHaveCount(n)` | `all().length === n` | passes when `n === 0` |
| `toHaveAttribute(name, match?)` | the tree field `name` (`help`, `inSet`, `heading`, `live`, `status`, `dialog`, `testId`, `placeholder`, `role`, `kind`) is present and matches | keeps polling |

Each accepts `{timeout}`. A matcher needing one node on a `'one'` locator with
several matches fails at once with `LOCATOR_AMBIGUOUS`, as an action does.

The scheduler, `src/device/polling.ts`, is one function and one feed:

```ts
export async function poll<T>(
  read: (snapshot: Snapshot) => T,
  passes: (value: T) => boolean,
  options: {timeout: number; stable: number; negated: boolean; feed: SnapshotFeed; signal?: AbortSignal},
): Promise<{pass: boolean; last: T; polls: number; readings: T[]}>;
```

- The feed, `SnapshotFeed`, wraps `device.fullSnapshot()`. A request while a
  snapshot is in flight joins it rather than starting another, so three
  matchers awaited together cost one snapshot per tick. A request within
  `minSpacing` (50 ms) of the last completed snapshot gets that snapshot.
- The interval starts at 100 ms and grows by half each tick to a cap of 400
  ms: 100, 150, 225, 338, 400, 400. A screen that answers at once costs one
  snapshot; one that takes four seconds costs about twelve, not forty.
- The deadline is `timeout`, default `assertionTimeout` from `deviceConfig`
  (5 s) or the per-call option. The first reading is taken immediately.
- Positive: pass on the first reading where `passes` is true.
- Negated: `passes` inverted, and the inverted condition must hold on every
  reading for `stable` ms (default 1 s, `deviceConfig({stable})`) before the
  matcher passes. A single reading proves little right after an action:
  `toBeHidden` on a spinner that has not appeared yet would pass and the test
  would move on into the spinner.

A worked timeline for `await expect(screen.getByText('Loading')).toBeHidden()`
with `stable` 1000 ms, where the spinner appears at 120 ms and leaves at 900:

```
t=0      reading 1: no match         held-false since 0
t=100    reading 2: "Loading" visible  reset
t=250    reading 3: visible            reset
t=475    reading 4: visible            reset
t=813    reading 5: visible            reset
t=1213   reading 6: no match           held-false since 1213
t=1613   reading 7: no match
t=2013   reading 8: no match
t=2213   held-false for 1000 ms        pass, 8 polls, 2.2 s
```

Without the rule, the matcher passes at `t=0` and the test presses the next
button into the spinner. The same scheduler serves `findBy*`, `waitFor` on a
locator, and `device.waitFor`, which keeps its 10 s default and 400 ms
interval unchanged for compatibility and is left as it is.

Phase 1's `settle` runs inside the driver after an action, so a matcher's
first reading comes after the screen has stopped moving. With change-aware
polling (Phase 1) a tick on an unchanged screen costs a counter read on web
and a dirty-flag read on Windows rather than a walk.

Messages name the locator, the readings, and the tree:

```
expected getByTestId("email") to have value "a@b.c" within 5000 ms
  read 14 times; the value was "" for 1.2 s, then "a@b" for 3.8 s
  the node: @e9 textbox "Email" #email at 24,300 [focused]
  evidence: .harness/results/web/settings/fills-the-email/trace.md
```

The matcher state Vitest provides (`this.isNot`, `this.utils.printExpected`
and `printReceived`) builds the message; `pass` ignores `isNot` because Vitest
inverts it, as its extending-matchers guide says. Each async matcher's type is
declared returning `Promise<void>` on the `@vitest/expect` `Matchers<T>`
augmentation that `src/device/matchers.ts:177` already uses, narrowed to a
`Locator` receiver by the `T` parameter.

### 5. Failure evidence

**The journal.** `Device` in `src/device/index.ts` wraps every driver call and
records a step:

```ts
// src/device/evidence.ts
export interface Step {
  index: number;
  event: 'open' | 'press' | 'longPress' | 'fill' | 'clear' | 'type' | 'key' | 'snapshot' | 'screenshot' | 'assert' | 'wait' | 'control' | 'agent' | 'verified';
  what: string;                    // describeTarget(), or the matcher's text
  resolved?: string;               // "@e7 button \"Settings\" #settings at 24,612"
  startedAt: number;               // ms since the test began
  durationMs: number;
  result: 'ok' | 'skipped' | 'failed';
  message: string;                 // the StepResult message, or the error
  polls?: number;                  // for assert and wait
  verifies?: number;               // for verified: the index of the step it verifies
  readings?: string[];             // the distinct values a poll read, in order
  treeAfter?: TreeDigest;          // identities after the step: `${kind ?? role} ${testId ?? name}` and the focused one
}
```

Every snapshot the test takes is digested into the step that took it, so the
diff between two steps is computed when the trace is written, from digests,
and no extra snapshot is taken for evidence. The digest keeps identities, not
refs, since refs renumber per snapshot. The journal lives on the `Device` for
the current test and is cleared in `beforeEach`.

**The `verified` event.** A step whose `event` is `verified` is appended when a polling
matcher passes, when `Locator.waitFor` resolves, and, from Phase 5, when
`agent.assert` or `agent.waitFor` passes. Its `verifies` field is the index of
the most recent step whose `event` is `press`, `longPress`, `fill`, `clear`, `type`,
`key`, `control` or `agent` before it. Phase 5's replay cache records an
`agent` step only once a `verified` event names it, which is e2e's rule for
what counts as a verified action, so the hook lives here and not in the agent.
A step whose `event` is `agent` carries the model's summary in `message` and its action
count in `polls`, and the trace renders it like any other step. The journal
also exposes `onStep(listener)` so Phase 5 can subscribe without reaching into
the array.

**The hook.** `src/device/matchers.ts` is the device project's setup file and
the public `expo-vitest/device/matchers`, and a Vitest setup file may call
`afterEach`. It imports `./evidence-hook.ts`, which registers:

```ts
beforeEach(context => device.beginTest(titleOf(context.task)));
afterEach(async context => {
  const failed = context.task.result?.state === 'fail';
  const mode = process.env.HARNESS_TRACE ?? 'retain-on-failure';
  if (mode === 'off' || (mode === 'retain-on-failure' && !failed)) return;
  const written = await writeEvidence(device, context.task, {failed, errors: context.task.result?.errors ?? []});
  console.log(`evidence: ${path.relative(ROOT, written.trace)}`);
  await context.annotate('screen at failure', 'evidence', {path: written.screenshot, contentType: 'image/png'});
  await context.annotate('trace', 'evidence', {path: written.trace, contentType: 'text/markdown'});
});
```

`afterEach` hooks run in reverse registration order, so a hook from a setup
file runs after the test file's own `afterEach`. A test that closes the
driver in `afterEach` rather than `afterAll` would close it before the
screenshot. The writer tolerates that: it keeps the last digest from the
journal, writes `tree.txt` from the last full snapshot the journal kept, and
notes `screenshot: not taken, the driver was closed` in the trace. The docs
show `afterAll(() => device.close())`, which keeps the driver alive for the
hook. `annotate` makes the two files attachments that Vitest's reporters see
through `onTestCaseAnnotate`, which Phase 4's reporter and pull request
comment use.

**The layout.** `.harness/results/<platform>/<file stem>/<test>/`:

```
.harness/results/web/settings/opens-the-profile-form-3f9a1c/
  screenshot.png     the screen when the hook ran
  tree.txt           renderSnapshot of the last full snapshot
  tree.json          the same snapshot as JSON
  trace.md           the steps, the error, the screen
```

`<file stem>` is the test file's path from the project root without the
extension, slashes kept as folders. `<test>` is the full title path (suites
then the test name) lower-cased, every run of characters outside
`[a-z0-9._-]` replaced with one `-`, trimmed of `-`, cut at 80 characters, and
suffixed with the first six hex characters of a SHA-1 of the untouched title,
so two titles that sanitise alike never share a folder. A test's folder is
replaced on each run; the whole `results/` folder is emptied at the start of
a run by Phase 3's `globalSetup`, and until then grows.

**`trace.md`**, with an example:

```markdown
# settings › opens the profile form

web · device/settings.test.ts · failed after 6.4 s · 2026-10-13T06:24:00Z

LOCATOR_NOT_FOUND: nothing matches getByLabelText("Email") within 5000 ms; the tree has 42 nodes.
Nearest names: "E-mail address", "Emails"

## Steps

| # | at | step | took | result | screen after |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.00 s | open / | 812 ms | ok | 38 nodes |
| 2 | 0.84 s | press getByRole("button", {name: "Settings"}) → @e7 button "Settings" #settings | 96 ms | ok | +5 −1: appeared heading "Settings", textbox "Name", textbox "E-mail address", button "Save", text "Profile"; gone button "Settings"; focus button "Settings" → textbox "Name" |
| 3 | 0.95 s | expect(getByLabelText("Email")).toBeVisible() | 5003 ms | failed | polled 13 times, unchanged |

## Screen at failure

42 nodes, 6 interactive. Full tree in tree.txt, JSON in tree.json.

  @e1 group "" 
    @e2 heading "Settings" (h1)
    @e3 textbox "Name" #name [focused]
    @e4 textbox "E-mail address" #email
    ...
```

The "screen after" column is the diff of consecutive digests: appeared,
gone, focus moved. e2e's trace says `screen: unchanged` or lists changed
controls; ours names them with their roles, which is what a reader needs to
see that "Email" is labelled "E-mail address".

`HARNESS_TRACE`: `retain-on-failure` (default) writes for a failing test,
`on` for every test, `off` for none. The screenshot path and trace path are
also set on `context.task.meta.evidence` for anything that reads task meta.

**The React tree.** Phase 1 designed it (section 7 of
`phase-1-faster-backends.md`), and it is built here: `device.react()`, a
`component` on a native node, the console in the journal, and the component
chain at a failed press, with file and line. It connects to a development
build through Metro's inspector proxy, and only where the page allows a
second debugger, unless `HARNESS_REACT=take`.

### 6. Headed web

`HARNESS_HEADED=1` launches with `headless: false`, and `HARNESS_SLOWMO=<ms>`
passes `slowMo`. Playwright ships two Chromium builds, a headless shell for
headless runs and a full browser for headed ones, and `shells()` in
`src/harness/platforms/web.ts` prefers the shell. In headed mode the fallback
list skips `chrome-headless-shell-*` and `headless_shell` entries, and when
only the shell is installed the driver's `available()` says so:
`headed mode needs the full Chromium; run npx playwright install chromium
without --only-shell`. `expo-harness doctor` prints the same line when
`HARNESS_HEADED` is set.

## Compatibility

- `device.*`, `element(by.…)`, `by.*`, `findNode`, `parseTarget`,
  `renderSnapshot`, the four matchers and `deviceConfig()`'s object are
  unchanged. The contract test from Phase 0 passes without edits.
- `by.role(x)` also matches `kind`. Nothing that matched before stops
  matching.
- The tree gains `kind`, `checked`, `selected`, `expanded`, `pressed`,
  `value`, `placeholder`, `secure`, and from Phase 1 `parent`. Every one is
  optional and absent unless reported. `renderSnapshot` prints `checked`,
  `selected`, `expanded` and `pressed` in the state brackets, which changes
  the text output only where a platform reports them, which it did not before.
- `Driver` gains optional `longPress`, `hover`, `focus`, `scrollIntoView` and
  `swipe`, the way `key` is optional. A driver without one answers `skipped`.
- `deviceConfig` gains `assertionTimeout` (5000) and `stable` (1000). Without
  them the returned object is identical to today's.
- `expo-vitest/device/matchers` as a consumer's `setupFiles` entry now also
  registers the evidence hook. It writes only on failure by default and only
  under `.harness/`, which the docs already say to ignore in git.
- No renames. `screen` and `within` are new names in the subpath; a device
  test file that also imported RNTL's `screen` would alias one, and none does.

## Work items

Each is one commit, in this order.

`HarnessCode` gains `LOCATOR_AMBIGUOUS` in the work item that adds the
strict `Locator`, and `ASSERTION_FAILED` in the one that adds the polling
matchers, each with `errors.test.ts`'s pin of the union edited in the same
commit. Phase 0 left them out until something could produce them.

1. **State fields on the three backends.** `snapshot.ps1` reads `IsPassword`,
   `ToggleState`, `SelectionItem.IsSelected`, `ExpandCollapseState`, `Value`;
   `COLLECT` reads `checked`, `aria-checked`, `aria-selected`, `aria-expanded`,
   `aria-pressed`, `value`, `placeholder`, `type=password`; the agent-device
   driver passes `value`, `selected`, `placeholder` through. `SnapshotNode`
   gains the fields, `renderSnapshot` prints the booleans. Files:
   `src/harness/lib/snapshot.ts`, `src/harness/windows/snapshot.ps1`,
   `src/harness/platforms/web.ts`, `src/harness/platforms/agent-device.ts`.
2. **Snapshot fixtures from real devices.** One `snapshot --json` each from
   an iOS simulator, an Android emulator, a Windows app and a web page, saved
   under `src/harness/lib/__fixtures__/`, with the native role spellings they
   contain listed in the commit message. These are the inputs for the role
   map's tests.
3. **The role map.** `src/harness/lib/roles.ts`: the vocabulary type, the
   four tables, the predicates, `kindOf(node, platform, parent?)`, and
   each backend setting `kind`. `findNode` matches `role` or `kind`.
   Tests on the fixtures. Files: `src/harness/lib/roles.ts`,
   `src/harness/lib/roles.test.ts`, the three backends,
   `src/harness/lib/snapshot.ts`.
4. **Query resolution.** `src/device/queries.ts`: `TextMatch`, the
   normaliser, the seven predicates, the options, `scopeOf` through `parent`
   or depth, refinements, `resolve(query, snapshot)`. Pure. Tests on hand
   trees and the fixtures. Files: `src/device/queries.ts`,
   `src/device/queries.test.ts`.
5. **The `Locator` and `screen`.** `src/device/locator.ts` with the class,
   `targetFor`, the composed actions and the strictness errors;
   `src/device/screen.ts` with the thirty-six query functions generated from
   the six predicates and six families, plus `within`; exports from
   `src/device/index.ts`; `element` re-implemented over `Locator`. Files as
   named, plus `src/device/locator.test.ts` with a scripted fake driver.
6. **Optional driver actions.** `longPress`, `hover`, `focus`,
   `scrollIntoView`, `swipe` on `Driver`, implemented on web and agent-device,
   `hold` added to the Windows host from Phase 1, the rest `skipped` on
   Windows. Files: `src/harness/lib/types.ts`, the three drivers,
   `src/harness/windows/host.ps1`.
7. **The polling scheduler.** `src/device/polling.ts` with `poll` and
   `SnapshotFeed`, `assertionTimeout` and `stable` on `deviceConfig` carried
   to the worker through `provide` and read with `inject`, falling back to
   the defaults when absent. Tests with fake timers. Files:
   `src/device/polling.ts`, `src/device/polling.test.ts`, `src/projects.ts`.
8. **The seventeen matchers.** Added to `src/device/matchers.ts` with their
   types on the `@vitest/expect` augmentation, and `findBy*`, `waitFor` and
   `queryBy*` wired to `poll`. Tests on a scripted feed. Files:
   `src/device/matchers.ts`, `src/device/matchers.test.ts`.
9. **The journal and the trace writer.** `src/device/evidence.ts`: `Step`,
   `TreeDigest`, `diffDigests`, `sanitiseTitle`, `renderTrace`,
   `writeEvidence`; the `Device` wrapper recording steps. Tests render a
   trace from a fixture journal and compare it to a checked-in `.md`. Files:
   `src/device/evidence.ts`, `src/device/evidence.test.ts`,
   `src/device/index.ts`.
10. **The hook.** `src/device/evidence-hook.ts` registering `beforeEach` and
    `afterEach`, imported by `src/device/matchers.ts`; `HARNESS_TRACE`;
    `annotate` attachments; the closed-driver fallback.
11. **Headed web.** `HARNESS_HEADED`, `HARNESS_SLOWMO`, the shell-aware
    executable search, the doctor line. File: `src/harness/platforms/web.ts`,
    `src/harness/index.ts`.
12. **The fixture's device suite.** `fixture/device/` with the static page,
    the tiny server in a `globalSetup`, `fixture/vitest.config.device.mts`,
    `playwright-core` in `fixture/package.json` and its lockfile, and
    `scripts/fixture.js` running it after the component projects with
    `HARNESS_PLATFORM=web`. CI installs Chromium. Files as named, `.github/workflows/ci.yml`.
13. **Docs.** `docs/locators.md`, `docs/matchers.md`, `docs/evidence.md`,
    `docs/device-tests.md` trimmed to point at them, README rows, the
    `configuration.md` entries for `assertionTimeout` and `stable`, the
    environment table for `HARNESS_TRACE`, `HARNESS_HEADED`, `HARNESS_SLOWMO`.

## Verification

Under the 100% gate, added to `coverage.include` in `vitest.config.mts`:
`src/harness/lib/roles.ts`, `src/device/queries.ts`, `src/device/locator.ts`,
`src/device/polling.ts`, `src/device/evidence.ts`. Each is logic with no
driver in it. `src/device/matchers.ts`, `src/device/evidence-hook.ts`,
`src/device/screen.ts` and `src/device/index.ts` register things with Vitest
or hold a driver and are proved by the fixture, per the repository's rule.

Unit tests, by file:

- `roles.test.ts`: every row of the four tables against the real snapshots
  from work item 2, the predicates (a toggle `Button` is a `switch`, a `Text`
  with a heading level is a `heading`, a `Button` under a `TabBar` is a
  `tab`), and that an unknown native type leaves `kind` absent.
- `queries.test.ts`: RNTL's `TextMatch` rules (whole string, whitespace
  collapsed, `exact: false`, RegExp, custom normaliser), `hidden`, each
  predicate's field, `getByRole` options including `level` and `checked:
  'mixed'`, scope by `parent` and scope by depth on a tree without `parent`,
  `filter({hasText})`, `filter({has})`, `first`, `last`, `nth`, and the
  candidate list in the `LOCATOR_AMBIGUOUS` message.
- `locator.test.ts`: with a scripted fake `Driver`, that `press` passes a ref
  on android and ios and a point on web and windows, that a `'one'` locator
  with two matches throws before any driver call, that `check` presses only
  when needed and fails when the state did not change, that `element(by.…)`
  gives the same node `findNode` gives on the five snapshot fixtures.
- `polling.test.ts`: with `vi.useFakeTimers()` and a scripted feed, the
  interval schedule (100, 150, 225, 338, 400, 400), the deadline, the shared
  in-flight snapshot (three concurrent polls, one snapshot per tick), the
  negation timeline above reproduced to the millisecond, and `signal`.
- `matchers.test.ts`: each of the seventeen against a scripted feed, positive
  and negated, with the message text checked for the locator name, the
  readings line and the evidence path.
- `evidence.test.ts`: `sanitiseTitle` on names with slashes, quotes, unicode
  and two titles that collide, `diffDigests` on appeared, gone and focus
  moved, and `renderTrace` of a fixture journal equal to a checked-in
  `trace.expected.md`.

The fixture's `device/` suite, in CI on every push. `fixture/device/page/
index.html` is a static page with a heading, a labelled text input, a
checkbox, a switch made of `role="switch"`, a list of three items, a disabled
button, a button whose label changes after a press, an element that appears
800 ms after a press and another that disappears 900 ms after one, a
password field, and one icon button with no accessible name. `fixture/device/
page.test.ts` asserts: `getByRole('heading', {level: 1})`, `getByLabelText`
plus `fill` plus `toHaveValue`, `check` plus `toBeChecked`, `getAllByRole
('listitem')` plus `toHaveCount(3)`, `toBeDisabled`, `findByText` on the late
element, `toBeHidden` on the leaving one with its two-second-plus duration
asserted, `queryByText` null, `within`, `LOCATOR_AMBIGUOUS` on
`getByRole('button')`, `toBeFullyLabelled` failing on the icon button with
its ref in the message, and one test that fails on purpose under
`HARNESS_TRACE=on` whose `trace.md`, `tree.txt` and `screenshot.png` the
suite then reads back and checks. The server is a `node:http` static server
started in the fixture's `globalSetup` on a free port, provided to the tests
with `provide`, and `HARNESS_URL` set from it. CI runs
`npx playwright install --with-deps chromium` before the fixture step.

The other three platforms: the same `page.test.ts` logic as a device suite in
a consumer (expo-windows's example app for Windows, an Expo app on an Android
device and an iOS simulator), run by hand before the phase closes, with the
role spellings confirmed and the `skipped` answers (`hover` on a device,
`swipe` on Windows) recorded in `docs/matchers.md`.

## Docs

- `docs/locators.md`: `screen`, the six predicates and six families as a
  table, `TextMatch`, `hidden`, `within`, refinements, the `Locator` actions
  per platform with `skipped` marked, `by.*` and `element` as the shorter
  spelling that remains, the `kind` vocabulary and what each platform maps
  to it.
- `docs/matchers.md`: the four audit matchers and the seventeen polling
  matchers, `assertionTimeout` and `stable`, the negation rule with the
  timeline, the message format.
- `docs/evidence.md`: the results layout, `trace.md` explained row by row,
  `HARNESS_TRACE`, the attachments reporters see, the `afterAll` advice.
- `docs/device-tests.md` becomes the short front page pointing at the three.
- `docs/configuration.md`: `assertionTimeout`, `stable`. `docs/harness.md`
  and `docs/device-tests.md`: `HARNESS_HEADED`, `HARNESS_SLOWMO`,
  `HARNESS_TRACE` in the environment table.
- README: the Device tests row names `screen` and the polling matchers; a
  new row for evidence.

Every page describes the package as it is after the phase, with no history.

## Risks and fallbacks

- **Role spellings on iOS and Android.** The map is only as good as what
  agent-device prints, and agent-device is at 0.21 and moving. Fallback: the
  fixtures from work item 2 are re-captured when the pinned agent-device
  changes, and a native type the map does not know leaves `kind` absent
  rather than guessing, so a test falls back to `role` or `testId`.
- **Polling load on Windows before Phase 1 lands.** Thirteen walks in five
  seconds through a process per walk is slow. Phase 1 is a dependency for
  that reason, and the feed's `minSpacing` caps the rate regardless.
- **`afterEach` order.** A test that closes the driver in its own `afterEach`
  gets a trace without a screenshot. The writer says so in the trace, the
  docs say `afterAll`, and `device.close()` records the step so the trace
  shows when it happened.
- **Evidence size.** A trace per failing test with a PNG is small; `on` for
  every test on a long suite is not. `on` is opt-in and Phase 3's
  `globalSetup` empties the folder per run.
- **Strictness surprising a test written for `element`.** It cannot:
  `element` keeps first-match, and only the new `getBy*` is strict. The
  `LOCATOR_AMBIGUOUS` message names the three ways out.
- **`screen` colliding with RNTL's.** Device files do not import RNTL. A file
  that did would write `import {screen as page}`. Decision 2 in README.md.
- **Vitest's `annotate` shape.** Introduced in 3.2, so under our `vitest
  >=4` peer it exists. The hook guards the call so a future signature change
  logs rather than fails the test.

## Exit criteria

- The RNTL-style examples in section 1 and the seventeen matchers pass on
  web in CI through the fixture, and by hand on Windows, Android and iOS,
  with `skipped` recorded where a platform has no counterpart.
- `getByRole('button')` on a page with two buttons fails at once with both
  candidates listed; `toBeHidden` on a leaving element passes only after a
  second of continuous absence, measured.
- A test made to fail leaves `trace.md`, `tree.txt`, `tree.json` and
  `screenshot.png` under `.harness/results/`, the trace shows the tree diff
  after each step, and a reader who did not run the test can name the cause
  from it.
- `by.role('button')` finds a UIA `Button`, and the Phase 0 contract test
  passes without a change.
- The five new logic files sit at 100% on four metrics, and the whole check
  loop plus the fixture is green.

## References

- RNTL queries: http://oss.callstack.com/react-native-testing-library/docs/api/queries
- Vitest extending matchers: https://vitest.dev/guide/extending-matchers
- Vitest hooks and test context: https://vitest.dev/api/hooks, https://vitest.dev/guide/test-context
- e2e `screen` and `expect`: https://e2e.tester.army/docs/reference/screen, https://e2e.tester.army/docs/reference/expect
- e2e debugging and traces: https://e2e.tester.army/docs/debugging
- e2e mobile role mapping: https://e2e.tester.army/docs/reference/mobile
- UI Automation control types: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controltype-ids
- XCUIElement.ElementType: https://developer.apple.com/documentation/xctest/xcuielement/elementtype
- WAI-ARIA 1.2 roles: https://www.w3.org/TR/wai-aria-1.2/#role_definitions
- Playwright browsers, headless shell and headed mode: https://playwright.dev/docs/browsers
- Playwright `launch` options: https://playwright.dev/docs/api/class-browsertype#browser-type-launch
- agent-device commands (`press`, `longpress`, `focus`, `scroll --until`, `swipe`): https://oss.callstack.com/agent-device/docs/commands

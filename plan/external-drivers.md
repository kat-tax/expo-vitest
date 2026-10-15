# Drivers to adopt, or to take from

Status: read on 2026-10-15, nothing installed or run · Decision: the owner's

The owner would rather not maintain our own Windows driver, and asked
whether maintained projects could replace our drivers or lend them
features: agent-desktop, Cua's driver and Terminator for the desktop,
agent-browser for web, argent for mobile. Each was read in its source, at
the commit named below, and the claims each verdict rests on were checked
there again.

Each was held to the same bar:

- **The `Driver` shape.** A snapshot with a ref and bounds on every node,
  then `press`, `fill`, `type`, `key` and `screenshot`. Every method
  answers rather than throws.
- **The rules.**
  - The tree is the assertion, and a field that is absent is the finding.
  - There are no runtime dependencies: a backend is a tool found at run
    time and called from Node.
  - Nothing is installed in the app.
  - Synthetic input is refused while someone is at the desk.
- **For a desktop driver, what react-native-windows 0.84 does with UI
  Automation patterns** (Phase 1, item 5).
  - Invoke is offered only on a view with `onAccessibilityTap`.
  - Toggle, Select and SetValue on an ordinary view do nothing, yet UI
    Automation reports success.
  - A react-navigation tab pressed through SelectionItem therefore says
    it was pressed while nothing happened.

## Verdicts

| Project | Read at | For | Verdict |
| --- | --- | --- | --- |
| [agent-desktop](https://github.com/lahfir/agent-desktop) | main `9d7ba42`; Windows on `feat/windows-adapter` `6d9ab84` | Windows | Not yet: Windows is unreleased, and its click cannot press a view with no Invoke. The design closest to our rules. |
| [Cua Driver](https://cua.ai/docs/cua-driver/quickstart) | trycua/cua `749636a`, cua-driver 0.35.4 | Windows | No: its background press is the no-op above, reported as done, and its foreground press is what our host does. |
| [Terminator](https://github.com/mediar-ai/terminator) | `73a381c`, npm 0.24.32 | Windows | No: the tree it hands Node has no testID, its click takes the foreground and the pointer, and its code has not changed since April. Its postconditions are the pattern to take. |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | `dac13bb`, 0.39.1 | Web | No: a process per call, a snapshot without most of our fields, and Windows its weakest platform. Several ideas to take. |
| [argent](https://github.com/software-mansion/argent) | `91542bd`, 0.29.0 | Mobile | Not instead of agent-device: no refs, no press by selector, closed binaries. Its Metro and CDP features are worth taking. |

## Windows

### agent-desktop

- **What it is.** A Rust workspace under Apache-2.0, with one maintainer.
  Release 0.9.4 (2026-09-23) is macOS only. On main, the Windows adapter
  is a stub whose own test expects `PlatformNotSupported`.
- **Where Windows is.** The real adapter is pull request #110:
  - open since 2026-07-26, at 278 commits and +217K lines;
  - to be merged "when Phase 2 completes", with no date.
- **The tree, on that branch.** The `uiautomation` crate over
  `CUIAutomation8`, with connection timeouts so a hung app cannot hang a
  call. The tree is walked an element at a time, with a cache request per
  node.
- **Refs.** A ref carries:
  - the pid and the process's creation time;
  - the window handle;
  - the path of child indexes, with the role, name, AutomationId and
    bounds as evidence.

  Each action resolves the ref again and answers `STALE_REF` or
  `AMBIGUOUS_TARGET` rather than guess. Refs are numbered before an
  interactive snapshot prunes, so `-i` and a full snapshot agree.
- **Click.** Invoke first, then `LegacyIAccessible.DoDefaultAction`, with
  no pointer step (`crates/windows/src/actions/chain.rs`).
  - A react-navigation tab offers no Invoke, so a click on it is refused.
    It never claims a press that did not happen, and it cannot press the
    tab either, except with `--headed mouse-click --xy` at bounds read
    some other way.
  - Not checked: whether UI Automation's legacy default action on such a
    view is the same no-op Select.
- **Reading the state back.** After set-value, toggle, check and expand,
  the state is polled every 50 ms for up to 400 to 600 ms, and a
  contradicting state fails the step with what was observed. `select` is
  still answered as delivered and unverified.
- **Screenshots** are Windows.Graphics.Capture of the one window, with
  `PrintWindow` as the fallback. The window is never raised.
- **How it is called.** On Windows it is a process per command: the
  persistent command host builds for macOS only, and there is no MCP
  server.
- **What it lacks against our Driver:**
  - `open` for a deep link;
  - a ref on every node, and parents;
  - position in set, heading, live region and status;
  - a ref for any node whose control type is Custom;
  - a default depth deeper than 10, which is shallow for a React Native
    screen;
  - an idle check.

### Cua Driver

- **What it is.** Rust under MIT, in trycua/cua at `libs/cua-driver`.
  - Release 0.35.4 came out on 2026-10-14, and every recent release is
    marked prerelease.
  - There have been 62 releases since July, ten of them with breaking
    changes.
  - Telemetry is on by default, and `DO_NOT_TRACK` turns it off.
  - The Windows installer edits the PATH and by default registers a
    logon task that runs the driver.
- **The tree** is one cached request over the subtree, control view only:
  the way our host reads it.
- **A press in the background** tries Invoke, then Toggle, then
  SelectionItem, then ExpandCollapse. It stops at the first call that
  returns success and reports the effect as `unverifiable`
  (`crates/platform-windows/src/tools/impl_.rs`).
  - Nothing is read back and nothing falls back. On react-native-windows
    this is the no-op above, reported as done.
  - A pixel click in the background posts mouse messages to the deepest
    child window. Its own comments say WinUI content islands, which
    react-native-windows draws into, ignore those.
- **A press in the foreground** activates the window, refuses unless that
  exact window came to the front, and then moves the cursor and sends
  input. That is our host's click plus the check.
- **The snapshot leaves out:**
  - disabled controls, from its elements;
  - testIDs on rows that cannot be acted on;
  - focus, focusable, offscreen, position in set, heading, live region,
    status and dialog.

  Its parent is the nearest ancestor that can be acted on.
- **Fill** goes through ValuePattern, without focus, and is read back.
- **Screenshots** are Windows.Graphics.Capture of one window with no
  border or cursor, and it refuses a minimized window.
- **How it is called.** `cua-driver mcp` speaks JSON-RPC lines over
  stdio, once per run: the same shape as our host. Its SDK carries native
  dependencies.
- **It changes the app while it acts.** It sets `WS_EX_NOACTIVATE` and
  `EnableWindow(FALSE)` on the target window, and draws an agent cursor
  unless told not to.
- **Testing and speed.** It has no React Native fixture; its Windows
  coverage is Electron, Tauri, WPF, WinUI 3 and WebView2. Issue #4906
  reports 89 to 272 ms for a window's state.
- **On macOS it is mature:** AXPress, per-process events, ScreenCaptureKit,
  with the grants held by its own app. This package has no macOS
  platform today.

### Terminator

- **What it is.** A Rust core over the `uiautomation` crate, for Windows
  only, with a napi-rs binding for Node, a Python binding and an MCP
  server.
  - Its license text is MIT, under a "GitHub Inc." copyright line.
  - Its code last changed on 2026-04-05. A shell-injection report (#479,
    June) and a request for a security contact (#482, October) are
    unanswered.
  - Its npm, crates.io and PyPI releases are at three different versions.
- **The tree** is one `FindFirstBuildCache` over the subtree through the
  COM client, falling back to a walk.
  - The nodes it hands Node carry no AutomationId: the tree builder
    leaves its property map empty, and a node's id is a six-character
    hash.
  - Enabled and focused are dropped on the way to Node too.
- **A click** activates the window, then moves the real pointer and
  clicks with `SendInput`, and the pointer is not put back.
  - A react-navigation tab does get pressed this way, but nothing checks
    that it did.
  - Its pattern methods report success the way UI Automation does.
    `setSelected(true)` on such a tab returns ok.
  - `setToggled` decides a switch's state by looking for a private-use
    glyph in its name, not by reading ToggleState.
- **Waiting.** A chained selector such as `process:app >> nativeid:x`
  waits about a second on each later step, whatever timeout it was
  given.
- **Screenshots** are a crop of the monitor, so a covered window comes
  out as whatever covers it.
- **How it is called.** The platform package's `main` is the `.node`
  file itself, with no postinstall, so it could be loaded by path from a
  global folder. Its calls are synchronous and set no UI Automation
  timeouts, so a hung app would hang the thread.
- **It is on by default:**
  - a full-screen overlay during every action;
  - screenshots written to `%LOCALAPPDATA%\mediar\executions` after each
    action;
  - PostHog and Sentry in its MCP agent.

### What it means for our Windows driver

None of the three can take over a react-native-windows app today:

- **agent-desktop** is the better design, but it is not released on
  Windows, and it cannot press a view that has no Invoke.
- **Cua's driver** is released, but it reports presses that did not
  happen unless it is driven in its foreground mode, which is ours.
- **Terminator** presses the way ours does, with the window raised and
  the pointer. It loses the testID, checks nothing, and has not been
  worked on since April.

Our driver is about 1,300 lines, of C#, PowerShell and TypeScript.

## Web: agent-browser

- **What it is.** A Rust CLI and a daemon per session that speaks CDP
  directly, without Playwright, under Apache-2.0.
  - About 44k stars, with one maintainer far ahead of the rest.
  - It needs Node 24.
  - The npm package is 119 MB, because it carries all seven platform
    binaries.
- **There is no programmatic API.** Every call is a process: the package
  exports only a `bin`, and the MCP server hands each tool call to the
  binary (`cli/src/mcp.rs`). The daemon's socket protocol would be faster,
  but its schema is undocumented.
- **The snapshot** comes from Chrome's accessibility tree.
  - Refs are numbered before any filter, so `-i` agrees with a full
    snapshot.
  - Within one document a ref survives changes, and the ones that went
    are listed as removed.
  - A replaced node can quietly resolve to a different element of the
    same role and name.
  - It has no bounds, testID, focus, offscreen, description, position in
    set or live region, and many nodes get no ref.
  - Taking it sets and removes data attributes in the page, which an
    app's MutationObserver sees.
- **Input.** Actions do not wait. `fill` clears a field in a way React
  may never see. `type` inserts text, so no key events fire.
- **On Windows:**
  - the daemon dies partway through a session (#1993);
  - `open` never returns on Windows 10 (#1821);
  - the unsigned binary gets quarantined;
  - the full end-to-end suite runs on Ubuntu only.
- **Security.** On Windows the daemon's port takes no token. Every daemon
  also opens a loopback WebSocket that takes input from any local page,
  an Expo dev server's included.

Ours is 294 lines over playwright-core, at 2 to 17 ms a step.

## Mobile: argent

- **What it is.** Software Mansion's toolkit, at 0.29.0, with releases
  every week. Its source is Apache-2.0, but the simulator server, the iOS
  accessibility service, the iOS libraries and the Android helper are
  closed.
- **How it drives each target:**
  - **iOS simulator:** no XCTest, and a full tree needs argent to boot
    the simulator itself.
  - **Physical iPhone:** an XCUITest runner.
  - **Android:** a helper APK it installs on the device, adb, and Android
    Studio's screen-sharing agent on a phone.
  - **Chromium:** over CDP.
  - It has no react-native-windows.
- **Calling it from Node:** a self-contained client bundle, or its tool
  server over HTTP.
- **What it lacks against agent-device:**
  - refs;
  - a press by selector (a tap takes a point as fractions of the screen);
  - Android's clickable and focusable, which its Android tree drops
    (`packages/tool-server/src/tools/ui-tree/android.ts`);
  - a JSON tree on a physical iPhone;
  - typing beyond ASCII on Android.
- **On Windows**, every adb call opens a console window (the fix, #1085,
  has been open since September). Nothing public shows a physical phone
  driven from Windows.
- **What it does that agent-device does not:** read the app through Metro
  and the Hermes debugger, with nothing in the app.
  - The React tree, with component names, testIDs, labels and measured
    rects.
  - The component chain, with source file and line, at a point.
  - Console logs and a fetch log.

  Connecting turns off LogBox and pausing on exceptions, so it does change
  the app under test.

## What to take, whichever way the decision goes

In order of value:

1. **Say whether an action was seen to work.** Read the state back after
   it, and report delivered and verified, delivered but unverified, or
   not delivered. These are agent-desktop's dispositions and Cua's
   `effect`. Terminator's agent says "executed without error" rather than
   "succeeded". It fits `StepResult` as an optional field, and it is what
   a pattern press on Windows needs before it can be trusted.
2. **Let a step name what it expects.** A `press(target, {expect})` that
   is ok only when its expectation holds within a short time, such as a
   selector that should appear or go. When nothing is named, use a
   before-and-after diff of the tree, without ids and bounds, as the
   check. These are Terminator's postconditions and its tree diff. On
   react-native-windows, a pattern's hollow success then becomes a
   fallback to the pointer, or a failure that says nothing changed.
3. **Refs that mean one element across a snapshot's kinds and survive
   unrelated changes.** All three readers that have refs do this.
   - On web: a `WeakMap` from element to a number that only goes up, and
     the refs that went, listed.
   - On Windows: number before narrowing, which fixes the bug recorded in
     Phase 1.
4. **The React tree over Metro's CDP**, as a second view beside the
   native one, on any platform running Hermes with a dev server. It finds
   testIDs the native tree collapses, and names the component and source
   line at a failed press. It needs only Node's own WebSocket. Not
   checked yet on react-native-windows.
5. **Window screenshots through Windows.Graphics.Capture, or
   `PrintWindow`.** The window is not raised, and windows in front of it
   do not spoil the picture.
6. **Make sure a pointer click lands where it is meant to, and leave the
   desk as it was.** Hit-test the point first, and check that the exact
   window is in front. Save the focus and the caret before the window is
   raised, and put them back after, as Terminator does.
7. **A wait that passes only after a number of matching reads** in a row
   (Cua's `stable_samples`), for Phase 1's settle.
8. **On web:** controls found by `tabindex` or a pointer cursor, named
   from their text, for react-native-web's role-less Pressables. Errors
   that name what covered a press and the names that were seen.
9. **On Android:** adb's server protocol over its socket instead of a
   process per call, and the status bar pinned before a screenshot.
10. **One experiment for our host:** read the cache through the COM client
    (`IUIAutomation`) instead of the managed one. Terminator and Cua's
    driver read a cached subtree that way, and it may not have the
    managed reader's exception that now forces a walk on every screen
    of Entz.

## Recommendation

- **Windows: freeze ours rather than grow it.**
  - Item 5 comes back only with points 1 and 2 under it.
  - Item 10 shrinks to point 10's experiment.
  - Keep fixing what is wrong, starting with the ref numbering.
  - Take points 1, 2, 3, 5 and 6 above.
  - Follow agent-desktop's pull request #110. When it ships, try it on the
    example app, and offer upstream the two things it lacks for React
    Native: a pointer step after Invoke, and a read back after a click.
    That is the route that ends with someone else maintaining the
    Windows driver.

  Adopting Cua's driver now would mean driving it in its foreground mode
  only, which is the same input as ours. It would cost the snapshot fields
  it does not read, weekly breaking changes, telemetry and a logon task by
  default, and changes to the app's window while it acts. Adopting
  Terminator would trade our driver for one that loses the testID and is
  no longer worked on.
- **Web: keep ours.** Take points 3 and 8 into item 7, and point 2 where
  it applies.
- **Mobile: keep agent-device.** Take point 4 as a feature of its own,
  and point 9. Try argent as a second backend once its Windows console
  windows are fixed.
- **Everywhere:** point 7 goes into item 9's settle.

## What a live trial would need

Each of these changes the machine, so each waits for the owner's go-ahead.

- **Cua's driver.** Its installer edits the PATH, registers a logon task,
  and sends telemetry unless `DO_NOT_TRACK` is set.
- **agent-desktop's Windows branch.** A Rust build of unreleased code.
- **Terminator.** A global install of its native addon, with its overlay
  and its screenshot log turned off by environment variables.
- **argent.** An 80 MB global install, and an APK installed on the phone.

The prediction to test, on a react-native-windows tab:
- Cua's background press reports success, and the screen stays where it
  was.
- agent-desktop refuses the click.
- Terminator's click switches the tab, with the window raised and the
  pointer moved.

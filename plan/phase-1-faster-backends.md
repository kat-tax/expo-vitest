# Phase 1. Faster backends

Status: not started · Size: M · Depends on: Phase 0 · Unblocks: Phase 2

The index is [`README.md`](README.md). Section 5 there is the one-table
summary of this phase; section 11 holds the agent-device, Playwright and
Vitest facts cited below. Nothing in this phase changes a public name: the
`Driver` interface gains optional members, `deviceConfig` gains options with
defaults that reproduce today's timing, and every step a test writes today
runs the same, faster.

## Purpose and the claims it proves

The user's first ask is that anything e2e does faster, we do. Three of our four
backends pay a process start per step, and the Windows one pays a C# compile
on top. e2e's mobile engine holds one agent-device client for the run, and its
web reader crosses the Playwright connection as one JSON string per
observation. This phase removes the per-step process on iOS, Android and
Windows, stops asking the page for a tree it has not changed, and adds the two
timing windows e2e has that we lack. On Windows three levers matter more than
the host language, and all three are here: one cached fetch of the subtree in
place of a call per element and property, UI Automation patterns in place of
synthetic input where a control exposes one, and, if the bench still says the
host is the cost, a compiled host over UIA3 that starts in a fraction of
PowerShell's time.

Claims, each measured with `expo-harness bench` from Phase 0 on the same app
before and after:

| Claim | Bar |
| --- | --- |
| iOS and Android steps cost one round trip to agent-device's daemon, not a Node process plus a round trip | p50 of `snapshot` and `press` under half of the Phase 0 baseline on the same device |
| A Windows snapshot costs one cached subtree fetch, not an assembly load, a compile and a cross-process call per element and property | p50 under 100 ms warm for a 400-node tree on the PowerShell host, under 50 ms on the compiled host; host start under 3 s once, under 300 ms compiled |
| A Windows press on a control that exposes a UI Automation pattern needs no foreground window and no quiet desk | the device suite's presses on the example app go through `invoke`, `toggle` or `select` with `raise` never sent and the idle guard never consulted |
| An unchanged web page costs one trivial evaluate per poll | fewer collects per test on the fixture's `device/` suite, no regression on `press` |
| A press after an action lands on a settled screen | fewer retried presses in the device suite; measured as the count of `transition` waits and settle timeouts in the step log |
| A Vitest timeout can interrupt any step | a test with a 1 s `testTimeout` fails in about 1 s with the host or daemon hung, not after the step's own 180 s |

## What e2e does

- `@e2e-dev/mobile` 0.12.0 depends on `agent-device` 0.21.25 and drives it
  through the Node client, one named session per worker slot
  (`<session>-<n>`, default `e2e-<target name>-<n>`). Its `settle` option is
  "UI stability window after a tap, fill, scroll, or back, in milliseconds.
  Default 150. `false` skips the wait." Its `transition` option is "wait before
  acting on a control that just appeared or moved, in milliseconds. Default
  500." Source: https://e2e.tester.army/docs/reference/mobile.
- `@e2e-dev/web` 0.14.0 pins `playwright-core` 1.63.0. Its reader sends
  "semantic metadata ... as one JSON string" per observation and opens a new
  page per attempt ("Initial viewport of every attempt's page; default 1280 by
  720"). Source: https://e2e.tester.army/docs/reference/web.
- Its runner polls `observe` and `locate` for locator matchers until
  `assertionTimeout` (5 s) and for actions until `actionTimeout` (30 s), so
  the cost of an unchanged observation is the cost that dominates a test.
  Source: https://e2e.tester.army/docs/reference/expect.
- agent-device itself settles after `open`: "When an `open` reports
  `timing.postOpenObservation` that isn't `"observable"`, the next
  screen-reading command waits briefly for two reads to agree. If the screen
  is still moving, the command continues and warns." Source:
  https://oss.callstack.com/agent-device/llms-full.txt.

## What this package has today

- `src/harness/platforms/agent-device.ts:86-163`. `agentDeviceDriver` runs
  the CLI through `run('agent-device', [...])` at line 91 with a 180 s
  timeout, once per step. `available()` at lines 114-120 spawns it twice
  (`--version`, then `capabilities`). `close()` at line 161 spawns it again.
  Every call goes through `spawnSync` in `src/harness/lib/run.ts:18-33`,
  which blocks the event loop, so a Vitest timeout cannot fire while a step
  waits. The driver passes `--platform` and `--device` on every call and
  never names a session, so each call lands on agent-device's implicit
  worktree session.
- `src/harness/platforms/windows.ts:68-186`. `snapshot` at line 80 runs
  `snapshot.ps1`; `click` at lines 102-109 runs `raise.ps1` and then
  `input.ps1`; `fill` at lines 146-157 runs `raise.ps1`, `input.ps1` for the
  click and `input.ps1` again for the keys; `screenshot` at line 172 runs
  `screen.ps1`; `idleSeconds` at line 178 runs `idle.ps1`. Each script begins
  with `Add-Type -AssemblyName` and an `Add-Type` C# block
  (`src/harness/windows/snapshot.ps1:13-26`, `input.ps1:15-31`,
  `screen.ps1:16-26`, `raise.ps1:8-20`, `idle.ps1:7-17`), which compiles on
  every start. A `fill` is three PowerShell processes and three compiles.
- `src/harness/platforms/web.ts:111-258`. `open()` at lines 139-157 keeps
  one browser and one page for the driver's life, which is already what a
  warm driver needs. `snapshot` at lines 163-190 evaluates `COLLECT`
  (lines 43-109) on every call, whether or not the page changed. `pointFor`
  at lines 192-206 takes a fresh snapshot before every press, so a press is
  two collects.
- `src/device/index.ts:111-122`. `waitFor` polls `snapshot({interactive:
  false})` every 400 ms. Phase 2's polling matchers will poll the same way
  and more often.
- `src/harness/lib/snapshot.ts:15-61`. `SnapshotNode` carries `depth` (line
  30) and no parent. Windows and web know the parent at collection time and
  drop it; agent-device reports depth only.
- `src/harness/lib/types.ts:53-83`. `Driver` has no notion of a change
  counter, a settled state or a previous snapshot.

## Design

### 1. The agent-device transport

A transport sits under the driver and is chosen once per driver:

```ts
// src/harness/platforms/agent-device-transport.ts
export interface AgentDeviceTransport {
  readonly kind: 'client' | 'cli';
  /** What is driving, for `doctor` and the step log. */
  describe(): string;
  open(to: string, signal: AbortSignal): Promise<void>;
  /** The raw payload agent-device answered with; `nodesFrom` reads it. */
  snapshot(interactive: boolean, signal: AbortSignal): Promise<unknown>;
  click(target: AgentTarget, signal: AbortSignal): Promise<void>;
  pressAt(point: Point, signal: AbortSignal): Promise<void>;
  fill(target: AgentTarget, text: string, signal: AbortSignal): Promise<void>;
  type(text: string, signal: AbortSignal): Promise<void>;
  screenshot(file: string, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

/** A ref (`@e7`) or a selector in agent-device's own spelling (`label="Save"`, `id="new-drop"`). */
export type AgentTarget = {ref: string} | {selector: string};
```

**Choosing.** `transportFor(platform, options)` tries the client, then the
CLI:

1. Find the package. `installedIn(root, 'agent-device')` from
   `src/projects.ts:84-96` walks up from the project. If that is null, the
   global folders in order: `HARNESS_AGENT_DEVICE` when set (a folder
   holding `node_modules/agent-device`), then `npm root -g` spawned once per
   process and cached (under Volta it answers the image's `node_modules`,
   checked on this machine), then `~/.bun/install/global/node_modules`.
2. Load it. agent-device is published with `import` conditions only, so
   `createRequire` cannot resolve it. Read its `package.json`, take
   `exports['.'].import`, and `await import(pathToFileURL(entry).href)`. A
   load error of any kind falls through to the CLI with the reason kept for
   `doctor`.
3. Make the client: `createAgentDeviceClient({session, lockPolicy:
   'reject', lockPlatform: platform})`, where the session is
   `expo-vitest-<platform>-<pid>`. Named sessions are "shared across
   worktrees" and locked in `reject` mode, so two runs on one machine never
   touch each other's device, and two platforms in one process never share a
   session. Source: https://oss.callstack.com/agent-device/docs/sessions.
4. Otherwise the CLI, through the asynchronous `runAsync` from Phase 0, with
   `--session expo-vitest-<platform>-<pid>` on every call so the fallback has
   the same isolation.

**Mapping.** The driver's steps become client calls:

| Driver | Client | CLI fallback |
| --- | --- | --- |
| `open(to)` | `apps.open({url: to, platform, device})` for a link; `apps.open({app: to, platform, device})` for a bundle id or name | `open <to> --platform <p> [--device <d>] --session <s>` |
| `snapshot({interactive})` | `capture.snapshot({interactiveOnly: interactive})` | `snapshot [-i] --json` |
| `press(ref or selector)` | `interactions.click({ref})` or `({selector})` | `click <target>` |
| `press(point)` | `interactions.press({x, y})` | `press <x> <y>` |
| `fill(target, text)` | `interactions.fill({ref or selector, text})` | `fill <target> <text>` |
| `type(text)` | `interactions.type({text})` | `type <text>` |
| `screenshot(file)` | `capture.screenshot({path: file})` | `screenshot <file>` |
| `close()` | `sessions.close()` | `close --session <s>` |

The commands page documents `click @ref` for refs and `press <x> <y>` for
points, while the README's quick start still shows `press @e2`. The first
work item confirms which forms the installed 0.21.x accepts and whether the
client's `click` takes a selector string, and fixes the table. `toAgentTarget`
in `src/harness/platforms/agent-device.ts:65-74` already produces the CLI
spelling; the client path reuses it and passes `identifier="<testID>"` for
`by.testID`, which is where React Native's `testID` lands on both platforms.

**Snapshot shape.** The snapshots page describes a nested tree with `kind`
(platform-neutral role), optional `type` (raw class), `role` on iOS only,
`label`, `value`, `identifier`, `rect`, and a `viewport`. `nodesFrom` in
`agent-device.ts:52-62` already unwraps several payload shapes; it gains a
flattening pass that walks `children` and assigns `depth`, and
`toSnapshotNode` reads `kind` as a fallback for `role` and keeps `rect` as
`bounds`, and copies agent-device's `kind` straight onto the node's `kind`,
so Phase 2's map has nothing to do for iOS and Android.

**Signals and timeouts.** Every client call takes `signal`. The driver passes
the signal it was given, or `AbortSignal.timeout(stepTimeout)` with
`stepTimeout` 30 s by default and 180 s for `open`, which matches
agent-device's own boot budget of "about 90 seconds" with headroom. A Vitest
timeout aborts the test's work through the same signal in Phase 2; here the
step simply stops blocking the loop, which is the property the first claim
measures.

**Cleanup.** `close()` calls `sessions.close()` and resolves within 10 s or
gives up. On `SIGINT` and `SIGTERM` the driver registers one handler per
process that closes every open transport with a 5 s budget, because an
unreleased session leaves a device claim that blocks the next `open` with
`DEVICE_IN_USE` until `agent-device device release --stale` clears it. The
handler is installed once, from `src/harness/lib/drivers.ts`, and removed in
`close()`.

### 2. The Windows host

One `powershell.exe` per driver, started on first use, alive until `close()`:

```
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <dist>/harness/windows/host.ps1
```

Windows PowerShell 5.1 is the first host because it ships with Windows and its
.NET Framework carries `UIAutomationClient`; PowerShell 3.0 and later start in
a single-threaded apartment by default, which UI Automation accepts. It is the
quick win, not the end state: section 2b describes the compiled host that
replaces it if the bench says PowerShell itself is the cost, and both hosts
speak the same protocol so the driver cannot tell them apart. The executable
`pwsh` is measured as an option in the bench and adopted only if it loads the
same assemblies and starts faster.

**Protocol.** JSON lines, UTF-8, one request in flight at a time. The driver
serialises calls through a promise chain; the host reads with
`[Console]::In.ReadLine()`, answers one line, and flushes.

```json
{"id": 12, "op": "snapshot", "process": "MyApp", "interactive": false, "max": 400}
{"id": 12, "ok": true, "ms": 41, "result": {"process": "MyApp", "window": {"x": 0, "y": 0, "width": 1280, "height": 800}, "generation": 7, "nodes": [...]}}
{"id": 13, "op": "click", "process": "MyApp", "points": [[640, 400]]}
{"id": 13, "ok": false, "error": "no window for MyApp"}
```

Operations, each a function in `host.ps1` and each the body of one of
today's scripts:

| `op` | Fields | Answers |
| --- | --- | --- |
| `hello` | | `{pid, apartment, powershell, uia: true}`; the driver's `available()` sends it first |
| `rect` | `process` | the main window's screen rectangle |
| `snapshot` | `process`, `interactive`, `max`, `fresh` | today's `snapshot.ps1` output plus `generation`, `parent` and `patterns` on each node, read as one cached subtree |
| `click` | `process`, `points` | `clicked x,y` per point, window-relative as today; synthetic, so the idle guard applies |
| `hold` | `process`, `x`, `y`, `ms` | `held x,y for <ms>`: mouse down, a wait of `ms`, mouse up, for Phase 2's `longPress`; synthetic |
| `invoke` | `ref` | `{pattern: 'Invoke'}` after `InvokePattern.Invoke()` on the element the newest snapshot gave that ref, or `{unsupported: true}` |
| `toggle` | `ref` | `TogglePattern.Toggle()` and the new toggle state, or unsupported |
| `select` | `ref` | `SelectionItemPattern.Select()`, or unsupported |
| `setValue` | `ref`, `text` | `ValuePattern.SetValue(text)` and the value read back, or unsupported |
| `scrollInto` | `ref` | `ScrollItemPattern.ScrollIntoView()`, or unsupported |
| `expand`, `collapse` | `ref` | `ExpandCollapsePattern.Expand()` or `Collapse()`, or unsupported |
| `keys` | `keys` | `sent <keys>` through `SendKeys.SendWait` |
| `screen` | `process`, `out`, `x`, `y`, `w`, `h` | `saved <out> (w x h at x,y)` |
| `idle` | | seconds since the last input |
| `raise` | `process` | `foreground True (set True)` |
| `watch` | `process` | subscribes the UIA events of item 2b, answers `{watching: true}` |
| `generation` | | the current change counter, or `-1` when not watching |
| `quit` | | exits 0 |

The host compiles one `Add-Type` block at start that holds every P/Invoke
today's five scripts declare (`GetWindowRect`, `SetCursorPos`, `mouse_event`,
`GetLastInputInfo`, `GetForegroundWindow`, `AttachThreadInput`,
`SetForegroundWindow`, `SetWindowPos`, `ShowWindow`, `BringWindowToTop`) and
loads `UIAutomationClient`, `UIAutomationTypes`, `System.Drawing` and
`System.Windows.Forms` once. Measured on this machine, that start is the one
cost the host pays and the per-step scripts pay every time.

```powershell
# src/harness/windows/host.ps1, the loop
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$out = [Console]::Out
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $request = $null
  try { $request = $line | ConvertFrom-Json } catch { $out.WriteLine('{"ok":false,"error":"not JSON"}'); $out.Flush(); continue }
  $started = [Environment]::TickCount
  try {
    $result = switch ($request.op) {
      'hello'      { Hello }
      'snapshot'   { Snapshot $request.process ([bool]$request.interactive) ([int]($request.max ?? 400)) ([bool]$request.fresh) }
      'click'      { Click $request.process $request.points }
      'hold'       { Hold $request.process $request.x $request.y $request.ms }
      'invoke'     { Pattern $request.ref 'Invoke' }
      'toggle'     { Pattern $request.ref 'Toggle' }
      'select'     { Pattern $request.ref 'SelectionItem' }
      'setValue'   { SetValue $request.ref $request.text }
      'scrollInto' { Pattern $request.ref 'ScrollItem' }
      'expand'     { Pattern $request.ref 'ExpandCollapse' 'Expand' }
      'collapse'   { Pattern $request.ref 'ExpandCollapse' 'Collapse' }
      'keys'       { Keys $request.keys }
      'screen'     { Screen $request.process $request.out $request.x $request.y $request.w $request.h }
      'idle'       { Idle }
      'raise'      { Raise $request.process }
      'rect'       { Rect $request.process }
      'watch'      { Watch $request.process }
      'generation' { Generation }
      'quit'       { exit 0 }
      default      { throw "unknown op $($request.op)" }
    }
    $out.WriteLine(([pscustomobject]@{id = $request.id; ok = $true; ms = [Environment]::TickCount - $started; result = $result} | ConvertTo-Json -Depth 8 -Compress))
  } catch {
    $out.WriteLine(([pscustomobject]@{id = $request.id; ok = $false; error = $_.Exception.Message} | ConvertTo-Json -Compress))
  }
  $out.Flush()
}
```

`??` is PowerShell 7 syntax; under 5.1 the script uses an `if` instead. The
snippet shows the shape, not the final text.

**The driver side.** `src/harness/platforms/windows-host.ts` owns the child
process: `spawn('powershell', [...], {stdio: ['pipe', 'pipe', 'pipe'],
windowsHide: true})`, a line reader on stdout, a queue of pending requests
keyed by `id`, and a per-request timeout (10 s by default, 60 s for `screen`
and `snapshot` with `max` above 400). Stderr is collected for the error
message. If the child exits or a request times out, every pending request
rejects with `HarnessError` code `ACTION_FAILED` and the message names the
host, the host is killed, and the next request starts a new one. A host that
cannot start twice in a row makes `available()` answer `ready: false` with
code `DRIVER_UNAVAILABLE` and the stderr. `available()` sends `hello` and
`rect`, which replaces today's `Get-Process` spawn at
`src/harness/platforms/windows.ts:74-78`.

`windowsDriver` keeps its shape and calls the host for each step. `fill`
becomes `raise`, `click`, `keys` as three requests on one process instead of
three processes. `raiseWindows` at line 188, used by the harness `raise`
step, goes through the same host. The five `.ps1` scripts stay in `dist`
until the host has run against expo-windows's example app on both the harness
and the device suite, then they are deleted in a separate commit, and
`scripts/build.js` keeps copying `.ps1` files, which now means one.

**The cached tree read.** Today's `Walk` in `snapshot.ps1` costs one
cross-process call per child step and one per property it reads, so a
400-node tree is several thousand round trips, and that, not PowerShell, is
most of a slow snapshot. UI Automation can hand over the whole subtree with
every requested property in one call: a `CacheRequest` with
`TreeScope.Subtree`, `TreeFilter` set to the control view condition,
`AutomationElementMode.Full`, and every property the walker reads added to it
(`ControlType`, `Name`, `AutomationId`, `BoundingRectangle`, `IsOffscreen`,
`IsEnabled`, `HasKeyboardFocus`, `IsKeyboardFocusable`, `HelpText`,
`PositionInSet`, `SizeOfSet`, `HeadingLevel`, `ItemStatus`, `IsDialog`,
`LiveSetting` by its id, and the six `Is…PatternAvailable` properties).
`root.GetUpdatedCache(request)` answers the window element with
`CachedChildren` filled recursively, and the walk then runs in process over
cached values, which is also where `depth` and `parent` come from for free.
`Max` still caps the nodes kept. The cached elements are held by ref until the
next snapshot, so a pattern op on `@e7` needs no second search. This lands in
the PowerShell host, where the same classes exist, and is measured as its own
bench row, because it is the change that moves the number.

**Pattern-first actions.** A control that implements a UI Automation pattern
can be driven through it without a pointer: `InvokePattern.Invoke()` presses a
button, `TogglePattern.Toggle()` flips a switch or a checkbox,
`SelectionItemPattern.Select()` picks a list item or a tab,
`ValuePattern.SetValue(text)` fills a field, `ScrollItemPattern.ScrollIntoView()`
brings a row on screen, `ExpandCollapsePattern` opens a combo box or a tree
node. A pattern call reaches the control through UI Automation's own channel,
so it needs no foreground window and does not care who is at the desk.
react-native-windows's automation peers carry an Invoke handler and
accessibility actions (`AccessibilityInvokeEventHandler` and
`AccessibilityActions` on `DynamicAutomationProperties` in its native API)
and derive Toggle, SelectionItem and Value from `accessibilityRole` and
`accessibilityState`. Which of its controls answer which pattern is exactly
what work item 5's spike records against expo-windows's example app before
the driver relies on any of it.

The snapshot carries `patterns` per node from the cached availability
properties, so the driver chooses without a round trip.
`windowsDriver.press(target)` tries, in order, `invoke`, `toggle`, `select`,
then today's synthetic click. `fill(target, text)` tries `setValue` and
accepts it only when the value read back equals `text` and the spike showed
`onChangeText` firing on the example app's `TextInput`; otherwise it clicks
and sends keys as today. `raise` and the idle guard are consulted only before
a synthetic op, never before a pattern op, so on an app whose controls all
expose patterns a device test runs while someone types in another window. A
test can force one path with `element(by.…).press({via: 'pointer'})` or
`fill(text, {via: 'keys'})`, which Phase 2's `Locator` passes through, for a
control whose pattern exists but does the wrong thing.

The refusal text that `guard()` in `src/harness/index.ts:153-161` prints today
moves, unchanged, into the driver's synthetic path, so the contract test that
pins it still passes, the harness command and a device test refuse the same
way, and `--force` and Phase 3's `HARNESS_FORCE` reach the driver as one
option. The rule in `.claude/rules/harness.md` that synthetic input keeps the
guard stays true to the letter; it gains one sentence saying a pattern call is
not synthetic input.

### 2b. The compiled host (stretch, behind measurement)

With the host alive and the tree read cached, what remains on Windows is
PowerShell's own cost: a start of one to three seconds once per driver,
`ConvertTo-Json` and `ConvertFrom-Json` on every line, and the managed
`System.Windows.Automation` wrapper, which is the older UI Automation client
and lacks properties the script already looks up by numeric id. A compiled
host removes all three and keeps the protocol, so the driver does not know
which host answered.

**What it is.** `src/harness/windows/host.cs`, one C# file shipped as source,
compiled on first use by the compiler that ships with Windows,
`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, into
`%LOCALAPPDATA%\expo-vitest\host\<sha256 of host.cs>\host.exe`, and reused
from there until the source changes. That is the trust model `Add-Type`
already uses, since Windows PowerShell drives the same compiler, with the
compile paid once instead of once per process. Nothing is downloaded and no
binary ships in the package. The in-box compiler speaks C# 5, so the file uses
no string interpolation, no `?.` and no expression-bodied members, and
`scripts/build.js` copies `.cs` files beside `.ps1`.

**What it uses.** UIA3, the COM client in `UIAutomationCore.dll`, through
interfaces declared by hand in `host.cs` with `[ComImport]` and the IIDs
copied from `UIAutomationClient.h`, for the subset the host needs:
`IUIAutomation`, `IUIAutomationElement`, `IUIAutomationElementArray`,
`IUIAutomationCacheRequest`, `IUIAutomationCondition`,
`IUIAutomationTreeWalker`, the six pattern interfaces of section 2, and the
structure-changed, property-changed and focus-changed handler interfaces. No
interop assembly is generated or shipped. The tree read is `BuildUpdatedCache`
on the window element with a request whose scope is the subtree, then an
in-process walk of `GetCachedChildren`. JSON goes through
`System.Web.Script.Serialization.JavaScriptSerializer`, which .NET Framework
has in the box. Input and screen capture are the same `user32` and GDI+ calls
as today. `hello` runs a self-test that reads the desktop element's name
through the hand-declared interfaces, so a vtable mistake fails at start with
a message and the PowerShell host takes over.

**The dirty flag** lives here, because the handlers are already compiled code
and UI Automation delivers events on a thread-pool thread where a PowerShell
script block cannot run. A class implementing the three handler interfaces
increments one `Interlocked` counter:

```csharp
sealed class Watch : IUIAutomationStructureChangedEventHandler,
                     IUIAutomationPropertyChangedEventHandler,
                     IUIAutomationFocusChangedEventHandler {
  public static long Generation;
  public void HandleStructureChangedEvent(IUIAutomationElement sender, StructureChangeType changeType, int[] runtimeId) { Interlocked.Increment(ref Generation); }
  public void HandlePropertyChangedEvent(IUIAutomationElement sender, int propertyId, object newValue) { Interlocked.Increment(ref Generation); }
  public void HandleFocusChangedEvent(IUIAutomationElement sender) { Interlocked.Increment(ref Generation); }
}
```

It subscribes with `TreeScope_Subtree` on the window for structure changes,
for the properties the snapshot reads (name, offscreen, enabled, bounds,
focus, help text, item status), and for focus. `snapshot` records the counter
before it fetches and keeps the result with that number. A later `snapshot`
with `fresh` false answers the kept result when the counter is unchanged and
the result is younger than `maxAge` (2 s), and fetches again otherwise. The
`generation` op lets the driver ask the number without a fetch, which is what
settle uses on Windows (section 4).

Failure modes, each with its answer:

- A provider that does not raise an event for a change. The `maxAge` cap
  bounds the staleness to 2 s, and `fresh: true` bypasses the cache for the
  comparison that must be exact (the step after a press in `settle`, a
  screenshot's companion tree). Measured on react-native-windows's example
  app: if a known interaction leaves the counter unchanged, the cache is
  turned off for that app and the bench says so.
- Event storms during an animation. The counter only moves; nothing is
  fetched until someone asks, so a storm costs nothing.
- The app window closing and reopening. The subscription is renewed when
  `rect` finds a new main window handle, after removing the old handlers.
- The 2 s cap is the only tunable: `HARNESS_WINDOWS_CACHE_MS`, 0 disables.

**Selection.** `windows-host.ts` starts the compiled host when `csc.exe`
exists and the compile succeeds or is already cached, and the PowerShell host
otherwise. `HARNESS_WINDOWS_HOST=powershell|csharp|0` overrides. `hello`
answers `{host, uia}` so `doctor` and the bench say which one ran.

**Ships only if** the bench after work item 4 shows the PowerShell host above
its targets: a start over 3 s, `snapshot` p50 over 100 ms warm with the cached
read, or `press` dominated by the host rather than the app. The compiled
host's own targets are a start under 300 ms and `snapshot` p50 under 50 ms.

### 3. Change-aware polling on web

An init script, installed with `page.addInitScript` before the first `goto`
in `open()` (`src/harness/platforms/web.ts:139-157`), runs in every document
before the page's own scripts:

```js
(() => {
  if (window.__harness) return;
  const state = {generation: 1};
  const bump = () => { state.generation += 1; };
  const observe = () => {
    new MutationObserver(bump).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
  };
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, {once: true});
  for (const type of ['focusin', 'focusout', 'resize', 'scroll', 'transitionend', 'animationend']) {
    window.addEventListener(type, bump, true);
  }
  window.__harness = state;
})();
```

`subtree`, `childList`, `attributes` and `characterData` together cover a
style change, a class toggle, a text update and a node added or removed, which
is everything `COLLECT` reads. Focus and scroll are not mutations and get
their own listeners. The counter lives on the document, so a navigation
replaces it: the driver reads `window.__harness ? window.__harness.generation
: -1` and treats `-1` or a number lower than the last one as changed.

`snapshot()` keeps the last collect with its generation. A call with the
generation unchanged and the collect younger than `maxAge` (2 s) answers the
kept snapshot with the same refs, which stay valid because the DOM has not
changed. Otherwise it evaluates `COLLECT` after two `requestAnimationFrame`
callbacks, so layout and paint from the last mutation have happened and the
boxes are final:

```js
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
```

`pointFor` reuses the same path, so a press after an unchanged poll costs no
second collect. A `fresh: true` option bypasses the cache for `settle`.

### 4. Settle and transition

Two options on `deviceConfig` and on each call:

```ts
deviceConfig({settle: 150, transition: 500});
await element(by.testID('save')).press({settle: 0});
```

Both live in a decorator so every driver gets them and the logic is a pure
function under the coverage gate:

```ts
// src/harness/lib/settle.ts
export interface Timing { settle: number; transition: number; settleTimeout: number }
export const DEFAULT_TIMING: Timing = {settle: 150, transition: 500, settleTimeout: 2_000};

/** What a node is, without its ref: refs renumber on every snapshot. */
export function identity(node: SnapshotNode): string;
/** Whether two snapshots describe the same screen, tolerating `jitter` px of bounds movement. */
export function agree(a: Snapshot, b: Snapshot, jitter = 1): boolean;
/** Whether `node` was absent from `previous`, or moved by more than `moved` px. */
export function appeared(previous: Snapshot | null, node: SnapshotNode, moved = 8): boolean;
/** The ref-independent identities of a snapshot, for `appeared`. */
export function identities(snapshot: Snapshot): Map<string, Bounds | null>;
```

`identity` is `role`, `name`, `testId`, `depth` and the parent chain of
identities, joined. `agree` compares the identity lists in order plus
`interactive`, `enabled`, `offscreen`, `focused` and `bounds` within `jitter`.
Focus is included because the next step is often typing, and typing into the
wrong field is the failure settle exists to prevent. Bounds are included
because a sheet sliding in is the case e2e's window was built for; a spinner
that never settles hits `settleTimeout` and the step continues with a note in
the step log, which is agent-device's own behaviour and e2e's.

`withTiming(driver, timing)` in `src/harness/lib/drivers.ts` wraps a driver:

- After `press`, `fill`, `type`, `key` and `open`, wait until the screen is
  settled or `settleTimeout` passes. With a driver that exposes
  `generation()` (Windows with the watch, web), settled means the counter has
  not moved for `settle` ms, polled every 25 ms: one trivial call per poll and
  no walk. Without one (agent-device, Windows without the watch), settled
  means two consecutive `snapshot({fresh: true})` calls `agree`, taken
  `settle` ms apart.
- Before `press` and `fill` on a selector, resolve the node, and if
  `appeared(previous, node)` is true, wait `transition` ms and resolve again
  before acting. `previous` is the last snapshot the wrapper saw. A press on
  a point skips the check, since there is no node to have appeared.
- `settle: 0` and `transition: 0` turn each off; `settle: false` is accepted
  as an alias of 0 to match e2e's spelling.

The harness CLI gets the same wrapper, so `expo-harness ... press ... tree`
shows the settled tree without a `wait` step.

### 5. `parent` on every node

`SnapshotNode` gains an optional `parent?: string`, the ref of the node's
nearest kept ancestor, or absent at the root. Additive, so the tree shape
rule holds.

- Windows: `Walk` in the host passes the parent's ref down and writes it.
- Web: `COLLECT` walks `element.parentElement` up to the nearest element
  carrying `data-harness-ref`. Ancestors are visited before descendants in
  `querySelectorAll` order, so the parent's ref is already set.
- agent-device: reconstructed from `depth` when the payload is flat, or taken
  from the nesting when it carries `children`:

```ts
// src/harness/lib/snapshot.ts
export function assignParents(nodes: SnapshotNode[]): SnapshotNode[] {
  const stack: string[] = [];
  return nodes.map(node => {
    stack.length = node.depth;
    const parent = node.depth > 0 ? stack[node.depth - 1] : undefined;
    stack[node.depth] = node.ref;
    return parent ? {...node, parent} : node;
  });
}
```

`renderSnapshot` is unchanged; `parent` is for Phase 2's `within` and for
the identity chain above.

### 6. Measurement

`expo-harness -p <platform> [options] bench [--runs 20]` from Phase 0 runs
each operation twenty times after one discarded warm-up and prints p50 and
p95 in milliseconds, plus the cold time of the first call in the session:

| Operation | What it does |
| --- | --- |
| `snapshot` | the full tree |
| `snapshot -i` | the interactive tree |
| `press` | a press by `testID` on a control that changes nothing (a disabled button or a label), so the screen stays comparable |
| `fill` | a fill into a text field, cleared between runs |
| `screenshot` | a PNG to `.harness/bench.png` |
| `settle` | the time from a press to settled, with `settle` on |

Apps, the same before and after: web is expo-interface's example started with
`npx expo start --web`; Windows is expo-windows's example app; Android is
expo-interface's example on a Pixel over USB; iOS is the same on an iPhone
simulator on a Mac. The machine, OS, agent-device version, PowerShell version
and node count of the tree are recorded with the numbers.

`docs/performance.md` carries one table per platform:

| Operation | Before p50 | Before p95 | After p50 | After p95 | Cold |
| --- | --- | --- | --- | --- | --- |

and a paragraph per platform saying what changed and what was verified. The
page describes the package as it is, so the "before" column is labelled as
the CLI and per-step script paths, which remain selectable with
`HARNESS_AGENT_DEVICE=cli` and `HARNESS_WINDOWS_HOST=0` for the comparison
and for a machine where the host cannot start.

## Compatibility

- `Driver` gains optional `generation?(): Promise<number>` and the
  `fresh` option on `snapshot`. Existing drivers and tests compile unchanged.
- `SnapshotNode.parent` is optional and absent where unknown.
- `deviceConfig()` with no options returns the same object as today; `settle`
  and `transition` are new keys that default to e2e's numbers only when the
  wrapper is applied, and the wrapper is applied by `device` and the harness,
  not by `deviceConfig`. Phase 0's contract test asserts the object.
- `device.waitFor` keeps its 400 ms interval and its message; it only gets
  cheaper.
- `HARNESS_AGENT_DEVICE=cli` and `HARNESS_WINDOWS_HOST=0` force today's
  paths, and `HARNESS_WINDOWS_HOST=powershell|csharp` picks a host. They are
  documented in `docs/device-tests.md` as the switches for a machine where the
  new path cannot run.
- `SnapshotNode.patterns` is optional and present on Windows only. A
  pattern-first press changes no test: `element(by.…).press()` still presses.
  What changes is that the desk need not be quiet for it, and the refusal a
  synthetic press prints when it is not keeps its words.
- The implicit agent-device session today becomes a named one. A user who
  drove the same device by hand through the CLI in another terminal during a
  test run shared a session before and does not after; the docs say so, and
  `doctor` prints the session name.

## Work items

Each is one commit with a message that says what was verified.

1. **Confirm agent-device's surface** against 0.21.27 installed locally: which
   of `click @ref` and `press @ref` the CLI accepts, whether
   `interactions.click` takes `{selector}`, the exact `capture.snapshot`
   result (nested `children` or flat with `depth`), and `apps.open`'s
   argument for a deep link. Record the answers at the top of
   `src/harness/platforms/agent-device-transport.ts`. Files: that file,
   `docs/device-tests.md` (session name). Verified by running each call
   against an Android device and printing the result.
2. **The transport and its loader.** `transportFor`, the package search
   through `installedIn` and the global folders, dynamic import of the
   `import` export, the client mapping, the CLI fallback over `runAsync`,
   `HARNESS_AGENT_DEVICE=cli`. `agentDeviceDriver` calls it. `available()`
   makes one call (`devices.capabilities`) instead of two spawns. Files:
   `src/harness/platforms/agent-device.ts`,
   `src/harness/platforms/agent-device-transport.ts`,
   `src/harness/lib/run.ts`. Verified: unit tests for the loader's folder
   order and the payload flattening; the device suite on Android; `doctor`
   naming the client.
3. **Session cleanup.** The named session, `close()` with a budget, the
   signal handlers in `src/harness/lib/drivers.ts`. Verified by interrupting
   a run with Ctrl+C and checking `agent-device device status` shows no
   claim.
4. **The host.** `src/harness/windows/host.ps1` with every op, the tree read
   as one `CacheRequest` over `TreeScope.Subtree` walked in process,
   `patterns` on each node, `src/harness/platforms/windows-host.ts` with the
   queue, timeouts and restart, `windowsDriver` on the host, `raiseWindows`
   on the host, `HARNESS_WINDOWS_HOST=0`. `scripts/build.js` unchanged.
   Verified: unit tests for the line framing, queueing and restart with a
   fake child; the harness and the device suite against expo-windows's
   example app; `bench` three times, before, with the host and the old walk,
   and with the cached read, so the table shows the gain from each.
5. **Pattern-first actions.** The spike first: each control of the example
   app pressed and filled through its pattern, with `onPress` and
   `onChangeText` observed in the app's log, recorded in a table at the top
   of `src/harness/lib/patterns.ts`. Then the `invoke`, `toggle`, `select`,
   `setValue`, `scrollInto`, `expand` and `collapse` ops; `choosePress` and
   `chooseFill` in `patterns.ts` as pure functions of a node's `patterns` and
   the `via` option; `windowsDriver.press` and `fill` on them with the
   synthetic fallback; the idle guard and `raise` moved into the synthetic
   path with the refusal text unchanged; `force` as a driver option. Files:
   `host.ps1`, `src/harness/lib/patterns.ts`, `src/harness/platforms/windows.ts`,
   `src/harness/index.ts`. Verified: unit tests for the decision table; the
   example app's buttons, switch and list items pressed with the desk in use
   and `raise` never sent; the contract test unchanged.
6. **Delete the per-step scripts** once items 4 and 5 have run on a second
   Windows machine. Files: the five `.ps1` scripts, `docs/harness.md`.
   Verified by the same runs.
7. **Web init script and cache.** The generation script, the cached
   snapshot, `fresh`, double `requestAnimationFrame`. Files:
   `src/harness/platforms/web.ts`. Verified: the fixture's `device/` suite
   on web with a counter of collects asserted lower than polls; `bench`.
8. **`parent` on every node.** `assignParents`, the host's cached walk,
   `COLLECT`. Files: `src/harness/lib/snapshot.ts`, `host.ps1`, `web.ts`,
   `agent-device.ts`. Verified: unit tests for `assignParents` on a flat
   list and on nested payloads; a tree from each platform printed and read.
9. **Settle and transition.** `src/harness/lib/settle.ts`, `withTiming` in
   `drivers.ts`, the options on `deviceConfig` and on `press`, `fill`,
   `type`, `key`, the step log lines. Files: those, `src/device/index.ts`,
   `src/projects.ts`, `src/harness/index.ts`. Verified: unit tests for
   `agree`, `appeared`, `identity` and the wrapper with a scripted fake
   driver and fake timers; the device suite on four platforms; the contract
   test unchanged.
10. **The compiled host**, only if item 4's bench shows the PowerShell host
    above its targets. `src/harness/windows/host.cs` with the hand-declared
    UIA3 interfaces and the `hello` self-test, the compile on first use and
    its cache folder in `windows-host.ts`, the dirty flag with the `watch`
    and `generation` ops and `HARNESS_WINDOWS_CACHE_MS`,
    `HARNESS_WINDOWS_HOST=csharp`, `scripts/build.js` copying `.cs`.
    Verified: unit tests for the host selection and the compile cache key
    with a fake filesystem; the harness script and the device suite on both
    hosts; a scripted sequence on the example app (open a flyout, type,
    toggle a switch) each moving the counter; `bench` on both hosts with the
    cache on and off.
11. **`docs/performance.md`** with the before and after tables and the
    paragraphs; the README feature row for settle and transition;
    `docs/device-tests.md` for the new options and switches;
    `docs/harness.md` for the pattern presses.

## Verification

Logic under the 100% gate, added to `include` in `vitest.config.mts`:

- `src/harness/lib/settle.ts`: `identity`, `agree` (same screen, one node
  renamed, bounds within and beyond jitter, focus moved), `appeared` (absent,
  present and still, moved 8 px, moved 9 px), the wrapper's behaviour with a
  fake driver under `vi.useFakeTimers()`: settles on agreement, gives up at
  `settleTimeout` with a note, waits `transition` for a new node and not for
  a known one, uses `generation()` when present.
- `src/harness/lib/snapshot.ts`: `assignParents` on depths that rise, fall
  and skip, and on an empty list.
- `src/harness/platforms/windows-host.ts`: framing of partial lines and two
  responses in one chunk, requests answered out of order by id, a timeout
  rejecting with `ACTION_FAILED` and killing the child, a restart on the next
  request, `available()` after two failed starts, all with a fake child
  process exposing stdin, stdout and `exit`.
- `src/harness/platforms/agent-device-transport.ts`: the folder search order
  with a fake filesystem and a fake `npm root -g`, the CLI fallback when the
  import throws, `HARNESS_AGENT_DEVICE=cli`, payload flattening of nested
  `children` into depths, `kind` as the role fallback.
- `src/harness/lib/patterns.ts`: `choosePress` and `chooseFill` over every
  combination of `patterns` and `via`, the synthetic fallback when a pattern
  op answers `unsupported`, and the read-back rule for `setValue`.
- `src/harness/platforms/windows-host.ts`, in addition: host selection from
  `HARNESS_WINDOWS_HOST` and the presence of `csc.exe`, the compile cache key
  from the source hash, and the fallback to PowerShell when `hello` fails on
  the compiled host.

The drivers themselves, as the repository's rule says, are proved by running
them:

- Windows: the harness script in `docs/harness.md` and expo-windows's device
  suite against its example app, with the PowerShell host and the old walk,
  with the cached read, with pattern presses while the desk is in use, and,
  if it ships, with the compiled host and its dirty flag.
- Android: expo-interface's device suite on a Pixel, with the client, then
  with `HARNESS_AGENT_DEVICE=cli`.
- iOS: the same on a simulator on a Mac.
- Web: the fixture's `device/` suite in CI, which gains an assertion that a
  ten-poll `waitFor` on an unchanged page collected once.

Bench targets, recorded before and after on the same app and machine:

| Platform | Operation | Target |
| --- | --- | --- |
| Windows | `snapshot`, 400 nodes, warm, PowerShell host with the cached read | p50 under 100 ms |
| Windows | `snapshot`, 400 nodes, warm, compiled host | p50 under 50 ms |
| Windows | host start, PowerShell | under 3 s, once per driver |
| Windows | host start, compiled, source already compiled | under 300 ms |
| Windows | `press` through `invoke` on a button | p50 under 50 ms, `raise` never sent |
| Android | `snapshot`, `press` | p50 under half of the baseline |
| iOS | `snapshot`, `press` | p50 under half of the baseline |
| Web | `snapshot` on an unchanged page | p50 under 5 ms |
| Web | `press` | no regression beyond 5% |
| All | a step under a 1 s `testTimeout` with the backend hung | the test fails in under 2 s |

## Docs

- `docs/performance.md`, new: the tables and paragraphs from section 6.
- `docs/device-tests.md`: `settle` and `transition`, the session name,
  `HARNESS_AGENT_DEVICE`, `HARNESS_WINDOWS_HOST`, `HARNESS_WINDOWS_CACHE_MS`,
  `parent` in the tree table.
- `docs/harness.md`: "Where each platform is driven from" names the host and
  the client; "What each platform can do" gains a row for pressing through a
  pattern without touching the desk; the `.ps1` list goes when item 6 lands;
  the two things worth knowing say that the quiet-desk rule applies to
  synthetic input only.
- `docs/configuration.md`: the two new `deviceConfig` options.
- README feature table: the settle row.

## Risks and fallbacks

- **agent-device's client API moves between 0.21.x releases.** The transport
  is one file, the mapping is one table, and the CLI fallback is always
  there. The first work item pins what 0.21.27 does; `doctor` prints the
  version it found.
- **The client is ESM-only and found outside the project.** Dynamic import by
  file URL works from a Vitest fork worker because `node_modules` is
  externalised. If a package manager's global layout is not one of the three
  searched, `HARNESS_AGENT_DEVICE` names the folder and the CLI covers the
  rest.
- **The host dies mid-run** (an app crash takes UIA down, a long `SendKeys`).
  Pending requests fail with a named error, the host restarts on the next
  request, and nothing is retried silently.
- **UIA events are not raised for some change.** The cache caps staleness at
  2 s and `fresh` bypasses it where exactness matters; the stretch item does
  not ship if the example app shows a silent change.
- **A page that mutates constantly** (a clock, a progress bar) never settles
  and never caches. `settleTimeout` bounds the wait and the step log says
  "continued with the screen still changing"; the cache simply misses.
- **Named sessions change who can drive the device by hand** during a run.
  Documented, and the implicit session is one environment variable away
  (`HARNESS_AGENT_DEVICE_SESSION=` to an empty value leaves `--session`
  off).
- **PowerShell 5.1 is absent** on a Windows Server image without it. The
  host can run under `pwsh` if the bench shows it loads the assemblies, and
  the compiled host needs only the .NET Framework runtime, which those images
  have; until one of them lands `available()` names the missing executable.
- **A pattern fires but the app does not react** (an `Invoke` the peer
  accepts without calling `onPress`, a `SetValue` that skips `onChangeText`).
  The spike in work item 5 checks each control of the example app against
  the app's own log before the driver prefers a pattern, `fill` accepts
  `setValue` only on a matching read-back, and `via: 'pointer'` or
  `via: 'keys'` forces the old path for one call.
- **The in-box compiler is missing or refuses the source.** `csc.exe` is part
  of the .NET Framework 4.x that Windows 10 and 11 install as a component,
  so its absence means a stripped image; the host then stays PowerShell and
  `doctor` says why. A compile error from a C# 5 restriction is caught in CI,
  which compiles `host.cs` on a Windows runner on every push.
- **Antivirus quarantines a freshly compiled executable** under
  `%LOCALAPPDATA%`. The compile is logged with its path, a quarantined exe
  fails `hello` and the PowerShell host takes over, and the docs name the
  folder to allow.
- **A hand-declared UIA3 interface has a wrong vtable slot.** `hello`'s
  self-test reads through the declared interfaces before any request is
  served, the declarations carry the header line they were copied from, and
  the PowerShell host is always there.

## Exit criteria

- `bench` tables for all four platforms are in `docs/performance.md`, and
  the Windows and Android targets above are met; web shows no regression.
  The Windows table has one row per step: the old walk, the host, the cached
  read, and the compiled host if it shipped.
- On the example app, `press` on its buttons, switch and list items goes
  through a pattern with `raise` never sent while a keyboard is in use in
  another window, and `fill` on its text input reports which path it took.
- A device test with a 1 s `testTimeout` and a hung backend fails in under
  2 s on every platform.
- `agent-device device status` shows no claim after a run and after an
  interrupted run.
- The fixture's `device/` suite asserts a single collect across an unchanged
  ten-poll wait.
- The settle and parent logic are under the 100% gate; the contract test is
  unchanged; `bun run lint`, `bun run typecheck`, `bun run test:coverage` and
  `bun run test:fixture` are green.
- The device suites of expo-windows and expo-interface pass with no change to
  their tests.

## References

- agent-device Node client: https://oss.callstack.com/agent-device/docs/client-api
- agent-device sessions and claims: https://oss.callstack.com/agent-device/docs/sessions
- agent-device snapshots: https://oss.callstack.com/agent-device/docs/snapshots
- agent-device commands: https://oss.callstack.com/agent-device/docs/commands
- agent-device configuration and environment: https://oss.callstack.com/agent-device/docs/configuration
- agent-device full text, settle after `open`: https://oss.callstack.com/agent-device/llms-full.txt
- e2e mobile engine `settle` and `transition`: https://e2e.tester.army/docs/reference/mobile
- e2e web engine, one page per attempt: https://e2e.tester.army/docs/reference/web
- UI Automation events: https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automation.addstructurechangedeventhandler and https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automation.addautomationpropertychangedeventhandler
- UI Automation caching, managed client: https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.cacherequest and https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.getupdatedcache
- UI Automation caching, UIA3 COM client: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-cachingforclients and https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationelement-buildupdatedcache
- UI Automation control patterns: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview
- react-native-windows native automation API, `DynamicAutomationProperties`: https://microsoft.github.io/react-native-windows/docs/native-api/DynamicAutomationProperties
- The in-box C# compiler, "usually located in the Microsoft.NET\Framework\<Version> folder under the Windows directory": https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/
- `JavaScriptSerializer`: https://learn.microsoft.com/en-us/dotnet/api/system.web.script.serialization.javascriptserializer
- `powershell.exe` switches and apartment default: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe
- `MutationObserver.observe` options: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe
- Playwright `page.addInitScript` and `page.evaluate`: https://playwright.dev/docs/api/class-page
- `npm root -g`: https://docs.npmjs.com/cli/v10/commands/npm-root

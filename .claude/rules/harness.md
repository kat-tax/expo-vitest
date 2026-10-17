---
paths:
  - "src/harness/**"
  - "src/device/**"
---

# The harness and the device layer

One set of drivers, two faces: `expo-harness` for looking at a screen by hand,
and `expo-vitest`'s `device` and `screen` for asserting on it from Vitest.
Web is a headless Chromium through `playwright-core`, or its Firefox or
WebKit, or a Chromium already running, over CDP. Windows is UI Automation
and synthetic input through PowerShell, iOS and Android are `agent-device`.
Nothing is installed in the app under test.

## Rules

- **A driver answers, it does not throw.** A step a backend cannot do reports
  `skipped`, so one script runs on all four platforms and says what it could not
  do rather than failing for the wrong reason. Keep the `Driver` shape the same
  across the backends: a test reads the same whichever answered.
- **The tree is the assertion**, not the pixels: it is stable across machines,
  diffs legibly, and is what a screen reader reads. A node's optional fields
  (`help`, `inSet`, `heading`, `live`, `status`, `dialog`) are absent unless the
  platform reported them, and that absence is the finding. Never fill one in
  with a guess.
- **Synthetic input goes to whatever is in front.** The Windows driver checks
  how long the machine has been quiet right before it sends any, and refuses
  while someone is using it, unless it was made with `force` (`--force`,
  `HARNESS_FORCE`). Its own input is not counted as someone's
  (`src/harness/lib/quiet.ts`). Do not add synthetic input to the driver
  without that check. The host also sends a click only where the window at
  its point is the app's and the point is on a screen, and keys only while
  the app's window is in front. Raising the window moves it inside
  the screen's work area when it reaches past it. A pattern call is not
  synthetic input: a press goes through a control's UI Automation pattern
  where it has one, and stands only where the control's state shows it
  (`src/harness/lib/patterns.ts`).
  A headless browser and a device are not the desktop, so their
  `idleSeconds` is `null`.
- **A screenshot does not raise the window**, because raising it hides the
  flyout or sheet that is usually the thing being looked at. On Windows the
  window draws its own picture (`PrintWindow`), so a window covering it is not
  in it. The picture comes from the screen while a menu or popup of the app's
  own is open over it, or when the window draws nothing.
- **A baseline belongs to the machine that drew it.** `toMatchScreenshot`
  records or replaces one only under `HARNESS_UPDATE_SCREENSHOTS` or
  `vitest -u`; without one it keeps the picture as evidence and passes on the
  tree assertions. Nothing records a baseline as a side effect of a run. A
  mask is painted at compare time, so the baseline is the region without it.
- **A control answers, as a step does.** The app's life and the device's
  settings go through one driver member, `control`, and what each platform
  lacks, and why, is the table in `src/harness/lib/controls.ts`, which
  `src/device/capabilities.ts` reads. A new control is a row there and a
  case in each driver, and a platform without it answers `skipped` with the
  table's reason. A control a platform has but this device lacks, as a fold
  on a phone that does not fold, throws with agent-device's reason.
- **A pool is claimed per test file** (`src/device/pool.ts`): a lock file
  in `.harness/locks/<run>/`, then a session of its own on the device, which
  agent-device holds the device for. Every driver in a pool run names its
  device; none is left to agent-device's choice, which could be any device
  plugged into the machine.
- The project root is the working directory, or `HARNESS_ROOT`. Never work it
  out from a file's own location: installed, that is the package.
- The PNG comparison is `src/harness/lib/png.ts`, on Node's own zlib. It reads
  the 8-bit non-interlaced PNGs that Playwright's browsers, GDI+ and `adb`
  write, and says so plainly for anything else. Do not add an image dependency.

## Windows

The backend is the host: `src/harness/windows/host.cs`, compiled once per
driver by `host.ps1` and kept running for the driver's life, answering JSON
lines. It reads the tree in one cached request over the window's subtree,
or an element at a time where the managed client's reader of that cache
throws, as it does on some react-native-windows screens.
Title bars are
left out with everything in them, since a cached read hands back ones a walk
never reached. The tree walks the descendants of the app's main window, then
the app's other windows on the screen, since a WinUI `MenuFlyout` opens in a
top-level window of its own; a window UI Automation already shows inside the
main one, as a WinForms menu, is not read twice. The main window is the
process's window with a caption where .NET's `MainWindowHandle` names a
popup, as it does while a WinForms menu is open.

## Web

A snapshot reads the page and writes nothing to it: the app may be watching
its own DOM. An init script counts every change a snapshot could show, and
while that count stands and nothing animates, a snapshot is the last one
read, for up to two seconds. A CSS transition moves boxes without a
mutation, so a page that is animating is read afresh every time. Anything
a snapshot wrote to the page would move the count and undo that. Refs live in the page, from element to number, so a node keeps its ref
for as long as it stays. A press first asks the page where it would land,
and refuses to press what is over the node.

The browser is Chromium unless `HARNESS_BROWSER` names Firefox or WebKit,
or `HARNESS_CDP` reaches a Chromium already running
(`src/harness/platforms/web-browsers.ts`). What each grants a page differs,
and `GRANTS` there is the table, measured with a page open, which is when a
browser checks a grant. A grant a browser lacks is passed over rather than
sent, since one it does not know fails the whole context. Over CDP the run
opens contexts of its own and closes only those, so the browser's own tabs
and profile stay as they were. A new step in the driver is run in all three
browsers and over CDP before it is done.

## Testing

None of this runs in the unit tests: they cover the logic (the snapshot shapes,
the PNG reader and the image geometry, the command line, the error codes, the
process helpers, the benchmark's arithmetic, the harness config and the
command's lifecycle, the controls' table and the capabilities, and what the
screenshot matcher decides). The drivers are proved by running them against a
real app, and the device matchers by the fixture's device suite and a device
suite in a consumer.

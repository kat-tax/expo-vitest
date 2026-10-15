---
paths:
  - "src/harness/**"
  - "src/device/**"
---

# The harness and the device layer

One set of drivers, two faces: `expo-harness` for looking at a screen by hand,
and `expo-vitest/device` for asserting on it from Vitest. Web is a headless
Chromium through `playwright-core`, Windows is UI Automation and synthetic input
through PowerShell, iOS and Android are `agent-device`. Nothing is installed in
the app under test.

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
  without that check. A headless browser and a device are not the desktop,
  so their `idleSeconds` is `null`.
- **A screenshot does not raise the window**, because raising it hides the
  flyout or sheet that is usually the thing being looked at. On Windows the
  window draws its own picture (`PrintWindow`), so a window covering it is not
  in it. The picture comes from the screen while a menu or popup of the app's
  own is open over it, or when the window draws nothing.
- **A baseline belongs to the machine that drew it.** `toMatchScreenshot`
  records one only under `HARNESS_UPDATE_SCREENSHOTS`; without one it keeps the
  picture as evidence and passes on the tree assertions. Nothing records a
  baseline as a side effect of a run.
- The project root is the working directory, or `HARNESS_ROOT`. Never work it
  out from a file's own location: installed, that is the package.
- The PNG comparison is `src/harness/lib/png.ts`, on Node's own zlib. It reads
  the 8-bit non-interlaced PNGs that Chromium, GDI+ and `adb` write and says so
  plainly for anything else. Do not add an image dependency.

## Windows

The backend is the host: `src/harness/windows/host.cs`, compiled once per
driver by `host.ps1` and kept running for the driver's life, answering JSON
lines. It reads the tree in one cached request over the window's subtree,
or an element at a time where the managed client's reader of that cache
throws, as it does on some react-native-windows screens.
The per-step scripts beside it are what `HARNESS_WINDOWS_HOST=0` runs, and
must read the same tree; a change to the walk goes in both. Title bars are
left out with everything in them, since a cached read hands back ones a walk
never reached. The tree walks the descendants of the app's main window, and
a WinUI `MenuFlyout` opens in a separate top-level window, so a menu plainly
open on screen leaves no trace in it. That is what screenshots are for.

## Testing

None of this runs in the unit tests: they cover the logic (the snapshot shapes,
the PNG reader, the command line, the error codes, the process helpers, the
benchmark's arithmetic). The drivers are proved by running them against a real
app, and the device matchers by a device suite in a consumer.

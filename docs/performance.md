# Performance

[Docs home](README.md)

What each driver costs on a real app, measured with
[`expo-harness bench`](harness.md#timing-a-platform). Times are in
milliseconds, and lower is better. They are a baseline to measure a change
to a driver against, not a promise about any machine but the one named.

## How they were taken

- `bench` at 20 iterations, run twice on each platform. Each row is from
  whichever run had the lower p50 for that operation.
- The first call of an operation is `cold`, and is kept out of the
  percentiles, which are by nearest rank.
- `press` presses something a press does nothing to, named with `--press`,
  and finds it afresh each time, as `element(…).press()` does in a test.
  `fill` was not timed, since none of the three screens has a field.
- One machine for all three: an Intel Core i9-14900K with 96 GB, Windows 11
  Pro 10.0.22631, Node 24.20.0. iOS needs a Mac, and is not on this page.

To time your own app on any platform:

```sh
expo-harness -p <platform> [options] open <route> bench --press '<something inert>'
```

Each run also writes every sample to `.harness/bench/`, so two runs can be
compared beyond what the table shows.

## Web

An Expo Router app on Expo SDK 56 (the example in
[expo-interface](https://github.com/kat-tax/expo-interface)), served by
`expo start` in development, at its home screen of 22 nodes. Chromium's
headless shell 1243, through `playwright-core` 1.63.0. `--press` named the
tab already selected.

```
  operation         cold      p50      p95      min      max
  snapshot           6.6      2.1      5.3      1.6      7.0
  snapshot -i        1.9      1.8      2.2      1.6      2.2
  press              7.0      3.0      3.4      2.6      3.4
  screenshot        19.0     16.8     17.5     15.6     33.3
```

One browser stays open for the run, and a snapshot is one evaluation in the
page, so web is cheap.

## Windows

A react-native-windows 0.84 Release build made with expo-windows 0.25, at
its first screen of 94 nodes. `--press` named the tab already selected.

```
  operation         cold      p50      p95      min      max
  snapshot         712.8    680.7    702.2    648.7    728.8
  snapshot -i      684.3    648.8    707.4    633.9    712.8
  press           2204.2   2227.1   2269.0   2186.0   2272.2
  screenshot       382.4    351.6    376.2    336.1    385.4
```

Every step starts a PowerShell 5.1 process, which loads UI Automation and
compiles the C# it needs, and the tree is walked with a call across to the
app for each element and each property. A press also raises the window,
since synthetic input goes to whatever is in front, and finds its target in
a fresh tree first.

## Android

A Pixel 7 Pro on Android 16 over USB, with agent-device 0.21.27, at the
Settings app's first screen of 62 nodes. `--press` named the clock in the
status bar, which a tap does nothing to.

Through agent-device's Node client, which the harness uses wherever the
package loads:

```
  operation         cold      p50      p95      min      max
  snapshot        1729.8   1308.0   1502.7   1103.4   1517.8
  snapshot -i     1324.1   1321.1   1495.3   1217.6   1501.3
  press           1998.9   1907.8   2053.8   1550.9   2069.0
  screenshot      2706.5   2686.4   2770.2   2620.5   2821.4
```

Through its command line, which `HARNESS_AGENT_DEVICE=cli` picks, measured
straight after on the same screen:

```
  operation         cold      p50      p95      min      max
  snapshot        1732.1   1477.0   1765.3   1378.6   1775.6
  snapshot -i     1591.5   1529.8   1805.5   1322.2   1862.5
  press           2015.3   2083.5   2271.2   1794.4   2370.9
  screenshot      2839.6   2841.9   3014.5   2764.4   3064.6
```

The client saves the command line's process start on every step, 5 to 14%
of a step here. The rest is the phone: agent-device's daemon asks its runner
on the device for the tree, the tap or the picture, and on either path that
is most of the time.

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
  `fill` was not timed.
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
its first screen of 94 nodes.

Through the host, one PowerShell process the harness keeps for the run:

```
  operation         cold      p50      p95      min      max
  snapshot         330.4    242.0    357.3    105.8    366.8
  snapshot -i      121.2    126.3    227.6    103.7    290.9
  screenshot        43.0     34.7     38.3     31.7     39.4
```

Through a PowerShell script per step, which `HARNESS_WINDOWS_HOST=0` picks,
measured straight after on the same screen:

```
  operation         cold      p50      p95      min      max
  snapshot        1422.0   1366.4   1746.8    946.8   1919.2
  snapshot -i      868.3   1067.6   1534.6    822.3   1672.5
  screenshot       353.8    354.4    398.2    341.3    427.2
```

Someone was using the machine for both, so the guard skipped the press and
every number carries that load. With the desk left alone and `--force`, a
press on the tab already selected took 2227 ms at p50 through the scripts.

A script per step starts a PowerShell process, which loads UI Automation and
compiles the C# it needs, and walks the tree with a call across to the app
for each element and each property. The host starts and compiles once, in
about half a second, and fetches the whole tree in one request. What is left
of a snapshot is that request: the app's own provider answering for every
element, which is most of the time here.

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

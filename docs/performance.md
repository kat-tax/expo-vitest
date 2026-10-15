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
its first screen of 94 nodes. `--press` named the tab already selected, but
the press is not in the table: someone was using the machine each time it
was about to run, and the quiet-desk guard skipped it.

```
  operation         cold      p50      p95      min      max
  snapshot         728.7    681.2    722.6    655.1    724.0
  snapshot -i      668.6    658.7    688.7    627.7    721.3
  screenshot       380.9    350.6    367.3    341.3    404.1
```

Every step starts a PowerShell 5.1 process, which loads UI Automation and
compiles the C# it needs, and the tree is walked with a call across to the
app for each element and each property. A press also raises the window,
since synthetic input goes to whatever is in front, and finds its target in
a fresh tree first.

## Android

A Pixel 7 Pro on Android 16 over USB, through the agent-device 0.21.27
command line, at the Settings app's first screen of 62 nodes. `--press`
named the clock in the status bar, which a tap does nothing to.

```
  operation         cold      p50      p95      min      max
  snapshot        2054.5   1613.0   1867.2   1373.1   1969.1
  snapshot -i     1819.4   1760.3   1917.7   1461.7   1995.6
  press           2313.6   2244.4   2484.0   2088.4   2506.8
  screenshot      3086.6   2997.7   3136.3   2806.0   3136.4
```

Every step starts the agent-device command line, which then talks to its
daemon and the runner on the phone.

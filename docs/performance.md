# Performance

[Docs home](README.md)

What each driver costs on a real app, measured with
[`expo-harness bench`](harness.md#timing-a-platform). Times are in
milliseconds, and lower is better. They are a baseline to measure a change
to a driver against, not a promise about any machine but the one named.

## How they were taken

- `bench` at 20 iterations, run twice on web, Windows and Android, where
  each row is from whichever run had the lower p50 for that operation, and
  once on iOS.
- The first call of an operation is `cold`, and is kept out of the
  percentiles, which are by nearest rank.
- `press` presses something a press does nothing to, named with `--press`,
  and finds it afresh each time, as `element(…).press()` does in a test.
  `fill` was not timed.
- One machine for web, Windows and Android: an Intel Core i9-14900K with
  96 GB, Windows 11 Pro 10.0.22631, Node 24.20.0. iOS on GitHub's `macos-26`
  runner, in this repository's CI, Node 24.20.0.

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
page, so web is cheap. Between changes it is cheaper still: a script in the
page counts every change a snapshot could show, and while the count stands and
nothing animates, a snapshot is the last one read, for up to two seconds. On a static page of 17
nodes a snapshot then takes 0.5 ms at p50. On a page of 3,012 nodes it takes
2 ms, against about 200 ms for a read after a change. A press asks the page
once more, where it would land, which costs about half a millisecond.

## Windows

A react-native-windows 0.84 Release build made with expo-windows 0.25, at
its first screen of 94 nodes, through the host: one PowerShell process the
harness keeps for the run.

```
  operation         cold      p50      p95      min      max
  snapshot         330.4    242.0    357.3    105.8    366.8
  snapshot -i      121.2    126.3    227.6    103.7    290.9
  screenshot        43.0     34.7     38.3     31.7     39.4
```

Someone was using the machine, so the driver refused the press, and every
number carries that load.

A process started for each step would load UI Automation, compile the C# it
needs, and walk the tree with a call across to the app for each element and
each property. The host starts and compiles once, in about half a second,
and fetches the whole tree in one request. Where the managed UI Automation
client cannot read that cached tree back, as on some react-native-windows
screens, the host walks the same tree an element at a time instead, which
took 359 ms for the 94 nodes in one reading. What is left of a snapshot is
that request: the app's own provider answering for every element, which is
most of the time here.

A screenshot is the window drawing itself, so a window over it is not in the
picture: 35 ms at p50 in a run of ten.

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

## iOS

An iPhone 11 simulator on iOS 26.5, on GitHub's `macos-26` runner, with
agent-device 0.21.28 through its Node client, at the Settings app's first
screen. `--press` named the screen's title, which a tap does nothing to.

```
  operation         cold      p50      p95      min      max
  snapshot        1950.3    205.8    816.3    122.4   2313.8
  snapshot -i      167.5    172.5    230.9    124.5    256.8
  press           3025.1   1020.8   1199.9    839.0   1334.0
  screenshot      3543.1   2101.0   2821.0   1368.5   3234.1
```

The first of each is the slowest by far, as agent-device's runner reaches
the app. After it a read takes about 200 ms, a press about a second and a
picture about two.

## Video

What a [recording](evidence.md#video) adds to a test: each test's time with
`HARNESS_VIDEO=on` against `off`, each run twice, on the same machine. A
recording is made of every test under `retain-on-failure` too, so the cost is
the same there.

| Where | A test that | Off | On | More |
| --- | --- | --- | --- | --- |
| Web, a page of a heading, two lines and a button | opens the page and finds the button | 2183, 2202 | 2275, 2269 | 70 to 90 |
| | opens it, presses the button and waits for what never comes | 5294, 5335 | 5548, 5463 | 130 to 250 |
| | finds a line on the page the last test left | 1, 2 | 169, 176 | about 170 |
| An Android 16 emulator, a Pixel 9 Pro XL, agent-device 0.21.27 | restarts Settings and asks which app is in front | 11276, 11386 | 15763, 16190 | 4400 to 4900 |
| | does that, and fails | 12994, 13127 | 18639, 18437 | 5300 to 5600 |

On web the cost is the screencast's start and the file written at its end.
On Android most of it is the end: through agent-device's command line, a
start took 2.0 to 2.3 s and a stop 6.9 to 7.6 s, and hiding the touches made
no difference. The emulator ran without a window, and drew nothing on its
screen, so its recordings were about 13 KB each. A device whose screen
changes makes bigger files, so expect a stop to take longer there.

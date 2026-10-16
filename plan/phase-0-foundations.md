# Phase 0. Foundations

Status: built · Size: S · Depends on: nothing · Unblocks: every later phase

Nothing in this phase is visible to a user of the package. It puts in place the
four things every later phase leans on: a test that pins today's public
surface, a benchmark that makes "faster" a number, a process helper that a
Vitest timeout can interrupt, and an error type with a code. The compatibility
contract, the dependency policy and the feature map are in
[README.md](README.md); this document does not restate them.

## As built

Work items 1 to 5 are on the `e2e` branch, a commit each,
with smaller commits beside them: the web driver answers a page that will
not load with `APP_UNREACHABLE` instead of throwing Playwright's error,
which the docs needed before they could say a failed call rejects with a
`HarnessError`; `docs/device-tests.md` gained its section on the codes; and
the baselines turned up the fixes below. Where the build differs from the
design below, the build is what holds, for these reasons:

- **Seven codes, not ten.** `HarnessCode` has the seven that something
  produces today. `LOCATOR_AMBIGUOUS` and `ASSERTION_FAILED` join it in
  Phase 2, with strict locators and polling matchers, and
  `SCREENSHOT_MISMATCH` in Phase 3, with the screenshot result, so the type
  never names a failure nothing can have. `errors.test.ts` pins the seven,
  and the phase that adds a code edits that pin in the same commit.
- **No driver factory on `Device`.** The contract test stubs the driver by
  mocking `src/harness/lib/drivers.ts`, which pins the exported `device` and
  `element` themselves and adds no API to do it. A phase that needs a second
  device (pools, MCP sessions) adds the parameter then.
- **`toMatchObjectType` is given `Plain<T>`.** Handed an interface it demands
  equality, so the contract wraps interfaces in a mapped type: added fields
  pass, renamed, removed and retyped ones fail. Each kind of pin was broken
  once to see it fail.
- **Each logic file joined the gate in the commit that tested it**, not all
  in work item 3, which would have gated `run.ts` before its test existed.
  The testing rule and the verify skill point at `coverage.include` rather
  than repeating the list.
- **`bench` presses only what it is told to.** The design pressed the
  centre of a node that does not act; the first version found one as the
  first static node not inside an interactive one, and on the expo-interface
  example on web that point was the icon of a card react-native-web draws as
  a pressable `div` with no role, so one press opened the drop. Nothing in
  a tree says what is safe to press, so `press` times only what `--press`
  names, as `fill` times only what `--field` names, and both find their
  target afresh on every call, which is what a test's `element().press()`
  pays.
- **`bench` asks the quiet-desk guard before every input, and skips rather
  than refuses.** On Windows, `press` and `fill` stop with the guard's
  reason the moment someone uses the machine, and the rest is still timed.
  Every operation keeps a `cold` first call. `BenchResult` has `source`, a
  `Sample` that failed says so in `failed`, and the table's columns are nine
  wide.
- **Two driver fixes the baselines turned up.** The agent-device driver
  sent `identifier="<testID>"`, which agent-device 0.21.27 refuses; it sends
  `id=` now. And npm's global install cannot be started by the harness on
  Windows (a `.cmd` launcher), so the doctor and the setup say
  `bun add --global agent-device` there.
- **`runAsync` keeps its own timer** rather than `spawn`'s `timeout` option,
  so a timeout is known rather than inferred from the signal, and `0` means
  no limit, as it does for `spawnSync`.

Work item 6's baselines are in `docs/performance.md` for web (the
expo-interface example under `expo start`), Windows (a react-native-windows
0.84 Release build made with expo-windows 0.25, standing in for
expo-windows's example app, which this machine does not have) and Android
(a Pixel 7 Pro over agent-device 0.21.27, installed with bun), and iOS: an
iPhone 11 simulator on iOS 26.5, timed once by the test app's iOS job on
GitHub's `macos-26` runner (run 38871546118), since this machine is not a
Mac. The Windows press was taken with `--force`, with
the owner's leave, after the guard had skipped it on every run because the
desk was in use. The guard is asked outside the timing, so `--force`
changes nothing that is timed. It pressed the tab already selected, and the
app was on the same 94-node screen after forty-two presses.

## Purpose and the claims it proves

| Claim | How this phase makes it provable |
| --- | --- |
| Nothing in later phases breaks a Vitest or RNTL user ([README.md, section 3](README.md#3-the-compatibility-contract)) | A contract test fails CI the moment a name, a type, a default or a message changes. |
| Anything e2e does faster, we do faster ([README.md, section 5](README.md#5-where-e2e-is-faster)) | `expo-harness bench` prints p50 and p95 per operation, and the four baselines are recorded before Phase 1 touches a driver. |
| A Vitest timeout can interrupt a stuck step | An asynchronous twin of `run()` that Phase 1 moves the drivers onto. Today `spawnSync` blocks the event loop and no timer fires until the child exits. |
| A failure says what kind of failure it is, in a word a migration guide can tabulate | `HarnessError` with a `code`, mapped to e2e's codes where the meaning is the same. |

## What e2e does

- **Error codes and classes.** Every failure carries a class (`test`,
  `configuration`, `infrastructure`, `internal`, `interrupted`) and a code.
  The class sets the exit code (1, 2, 3, 4, 130), the code names the cause.
  Locator and action failures are codes under the `test` class:
  `LOCATOR_NOT_FOUND`, `LOCATOR_AMBIGUOUS`, `ACTION_FAILED`,
  `ASSERTION_FAILED`, `INVALID_ARGUMENT`. Engine and driver faults are
  `ENGINE_FAILURE` (infrastructure), an unreachable app is `APP_UNREACHABLE`
  (infrastructure), a missing capability is `UNSUPPORTED_CAPABILITY`
  (configuration). Agent errors are checked with `isAgentError(error)` and a
  branch on `code`, because `instanceof` fails across package copies.
  Source: https://e2e.tester.army/docs/reference/errors.
- **Benchmarks.** None shipped. e2e reports per-step durations in `--debug`
  output and trace pages, which is how a user sees its speed, and it has no
  command that measures an engine on its own.
- **Contract tests.** The engine SPI has `engine-contract.test.ts` in the e2e
  repository, which checks lifecycle order, observations, actions and errors
  of an engine. That is a contract on engines, not on the public test API.
- **Process handling.** `app.command` is spawned without a shell, resolved
  with `PATH`, with `startupTimeout` and `shutdownTimeout`. Everything else
  runs in-process over Playwright or agent-device's Node client.

## What this package has today

- `src/harness/lib/run.ts:18` is `run()`: `spawnSync` with `encoding: 'utf8'`,
  `timeout` (120 s by default), `input`, `windowsHide`, no shell. `missing` is
  set from `ENOENT`. `runBinary()` at `:43` is the same for bytes, and
  `powershell()` at `:62` wraps `powershell -NoProfile -NonInteractive
  -ExecutionPolicy Bypass -File`. Thirteen call sites across the three drivers
  and the doctor use them, all synchronous.
- `src/harness/lib/types.ts:18` is `StepResult`: `ok`, `skipped?`, `message`,
  `output?`, with `ok()`, `failed()` and `elsewhere()` as constructors. No
  code field. `Driver` at `:48` answers with a `StepResult` from every step
  and throws only from `snapshot()`.
- `src/device/index.ts` throws a plain `Error` in eight places: `:64` when
  the driver is not ready, `:71`, `:86`, `:92`, `:106`, `:138`, `:142` when a
  step result is not ok (the driver's message, passed through), and `:121`
  when `waitFor` times out. The drivers throw from their own helpers:
  `src/harness/platforms/web.ts:142`, `:153`, `:197`, `:198`;
  `src/harness/platforms/windows.ts:82`, `:96`, `:98`;
  `src/harness/platforms/agent-device.ts:129`.
- `src/harness/index.ts` holds the argument parser (`parse` at `:84`,
  `unmangleRoute` at `:132`, `STEP_ARGUMENTS` at `:68`) and calls `main()` at
  import, so none of it can be imported by a test today. The CLI exits 2 on a
  usage error and 1 when the driver is not ready or a step fails.
- `src/projects.ts:307` is `deviceConfig()`: one project named `device`,
  `globals`, `environment: 'node'`, `include: ['device/**/*.test.ts']`,
  `setupFiles: [file('device/matchers.ts')]`, `testTimeout` and
  `hookTimeout` 120 s, `fileParallelism: false`, `pool: 'forks'`,
  `maxWorkers: 1`, and `resolve.alias` from `selfAliases()`.
- Tests: `src/harness/lib/snapshot.test.ts` already pins `parseTarget`,
  `by.*`, `describeTarget`, `findNode`, `centreOf` and `renderSnapshot`.
  `src/projects.test.ts` pins `SUBPATHS` against `package.json`'s `exports`.
  Nothing pins the `device` object, `element`, the matchers' presence, the
  environment variables, `deviceConfig()`'s output, or the CLI's steps.
- Messages asserted anywhere today: only the PNG reader's, in
  `src/harness/lib/png.test.ts:92` to `:96` (`/not a PNG/`, `/8-bit/`,
  `/non-interlaced/`, `/colour type/`, `/palette/`). The docs quote no device
  message verbatim; `docs/device-tests.md` says the `waitFor` error "says how
  many nodes the tree had", which the message at `src/device/index.ts:121`
  does with `the tree has N nodes`.
- `tsconfig.json` includes `src/**/*.ts`, so `bun run typecheck` type-checks
  the test files. A type-level assertion in a test fails `tsc --noEmit` even
  though it does nothing at run time.
- The coverage gate in `vitest.config.mts` is `src/projects.ts`,
  `src/forbid-modules.ts`, `src/windows-resolution.ts`, `src/timeout.ts`.
  `src/harness/lib/snapshot.ts` and `png.ts` have tests but are not in the
  gate.

## Design

### 1. The contract test

`src/device/contract.test.ts`, one file, run by the Node project like every
other unit test. It asserts in two layers, because they fail at different
times.

**At run time**, with the module imported as a consumer would import it:

```ts
import {by, configFromEnvironment, device, element} from './index.ts';
import {baselineFor} from './matchers.ts';
import {deviceConfig, file} from '../projects.ts';
import {parse, unmangleRoute} from '../harness/lib/cli.ts';
```

- `by.testID('x')`, `by.label('x')`, `by.text('x')`, `by.role('x')`,
  `by.ref('@e1')` produce exactly `{testId}`, `{label}`, `{contains}`,
  `{role}`, `{ref}`.
- `parseTarget` for `@e3`, `label="New drop"`, `role=button`,
  `testID=new-drop`, `testId="new-drop"`, `testid=new-drop`, `contains="x"`,
  and a bare word. Duplicating `snapshot.test.ts` here is deliberate: that
  file may be reorganised, the contract may not.
- `configFromEnvironment({})` is `{platform: 'web', url: undefined, scheme:
  undefined, target: undefined}`, and the five `HARNESS_*` names map to the
  four fields plus the platform.
- `baselineFor('web', 'home')` is
  `path.join(process.cwd(), 'device', '__screenshots__', 'web', 'home.png')`
  with `HARNESS_ROOT` unset. That is how `HARNESS_ROOT` and the baseline
  folder are pinned without a driver.
- The `device` object has `platform`, `ready`, `open`, `snapshot`,
  `fullSnapshot`, `screenshot`, `type`, `key`, `waitFor`, `close`, each a
  function (or a getter for `platform`), with today's arity. `element({})`
  has `selector`, `press`, `fill`, `node`, `waitFor`. Presence and arity, not
  an exact key list: later phases add methods and the contract allows that.
- Importing `./matchers.ts` leaves `toHaveElement`, `toBeFullyLabelled`,
  `toSupportArrowNavigation` and `toMatchScreenshot` on `expect`, and
  `toHaveElement` passes and fails on a two-node fixture tree with the
  messages it writes today (`expected an element matching label="X"; the
  tree has 2 nodes:`).
- `deviceConfig()` with no options deep-equals this object, computed with
  `file()` so the path is right from source and from `dist`:

```ts
{
  resolve: {alias: selfAliases()},
  test: {
    name: 'device',
    globals: true,
    environment: 'node',
    include: ['device/**/*.test.ts'],
    setupFiles: [file('device/matchers.ts')],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
}
```

  Exact, not a subset. Phase 3 adds options; with none given the object must
  stay byte for byte what a consumer gets today, and the test is where that
  is enforced. `deviceConfig({include: ['x/**'], timeout: 5})` is pinned too.
- The CLI parser: the step table (`open 1`, `snapshot 0 or 1`, `tree 0`,
  `press 1`, `tap 2`, `fill 2`, `type 1`, `screenshot 1`, `raise 0`,
  `wait 1`, `idle 0`), the options (`-p`, `--platform`, `--url`, `--scheme`,
  `--target`, `--out`, `--force`, `-i`, `--interactive`, `-h`, `--help`,
  `doctor`), the two usage messages, and `unmangleRoute` under a fake
  `MSYSTEM` and `EXEPATH`.
- The two device messages a person reads most: `no web device to drive:
  <reason>` and `label="X" never appeared within 10 ms; the tree has 0
  nodes`, asserted with a stubbed driver so no backend is needed.

**At type-check time**, with `expectTypeOf` from `vitest`. It does nothing at
run time; it fails `bun run typecheck` because `tsconfig.json` includes the
test files. Both facts are stated in a comment at the top of the test.

```ts
expectTypeOf(device.open).parameters.toEqualTypeOf<[string]>();
expectTypeOf(device.open).returns.toEqualTypeOf<Promise<void>>();
expectTypeOf(device.key).returns.toEqualTypeOf<Promise<'pressed' | 'skipped'>>();
expectTypeOf(device.waitFor).returns.toEqualTypeOf<Promise<SnapshotNode>>();
expectTypeOf<SnapshotNode>().toMatchObjectType<{ref: string; role: string; name: string; depth: number; interactive: boolean}>();
expectTypeOf<SnapshotNode>().toHaveProperty('testId');
expectTypeOf<Selector>().toEqualTypeOf<{ref?: string; testId?: string; label?: string; role?: string; contains?: string}>();
expectTypeOf(deviceConfig).parameters.toExtend<[options?: {include?: string[]; timeout?: number}]>();
```

`toMatchObjectType` and `toExtend` where additions are allowed (the node
shape, the options), `toEqualTypeOf` where nothing may change (a method's
parameters and return, the `Selector` keys). `Selector` is held exact on
purpose: a new way to select something is a new `by.*` function and a new
optional key, and adding the key is a deliberate edit to this test in the
same commit.

Two refactors make the test possible, neither changing behaviour:

- `parse`, `unmangleRoute`, `USAGE`, `STEP_ARGUMENTS`, `OPTIONAL_ARGUMENT`
  and `screenshotPath` move from `src/harness/index.ts` to
  `src/harness/lib/cli.ts`. The entry keeps `main`, `step`, `guard` and
  `doctor`, imports the rest, and still calls `main()` at the bottom. The
  parser is logic and joins the gate.
- `Device` takes an optional driver factory in its constructor
  (`new Device(config, driverFor)`), defaulting to `driverFor`, so the
  contract test can hand it a stub. The exported `device` is unchanged.

### 2. `expo-harness bench`

A step, so it composes with `open` the way every other step does:

```sh
expo-harness -p web --url http://localhost:8081 open / bench
expo-harness -p windows --target MyApp bench 50
expo-harness -p android --scheme myapp open /settings bench --field 'testID=search' --json
```

```ts
// src/harness/lib/bench.ts
export interface Sample {operation: string; ms: number[]; cold: number | null; skipped?: string}
export interface BenchResult {platform: string; iterations: number; node: string; at: string; samples: Sample[]}
export function percentile(sorted: number[], p: number): number;        // nearest rank
export function summarise(sample: Sample): {p50: number; p95: number; min: number; max: number; n: number};
export function renderBench(result: BenchResult): string;              // the table
export async function bench(driver: Driver, options: {iterations: number; field?: Target}): Promise<BenchResult>;
```

What it measures, in order, each `iterations` times (20 by default):

| Operation | What runs | Side effects |
| --- | --- | --- |
| `snapshot` | `driver.snapshot()` | none |
| `snapshot --interactive` | `driver.snapshot({interactive: true})` | none |
| `press` | `driver.press(point)` at the centre of the first node that is not interactive and has bounds, taken from one snapshot before the loop | a press on static text; on a platform where every node is interactive the sample is `skipped` with that reason |
| `fill` | `driver.fill(field, 'bench')` | only with `--field`; the field keeps the text, and the output says so |
| `screenshot` | `driver.screenshot('.harness/bench/<n>.png')` | files under `.harness/bench/`, removed at the end |

The first call of each operation is kept apart as `cold`, because the first
snapshot pays the browser launch, the host start or the device claim, and
that number is a different fact from the steady state. The remaining
`iterations` samples give the percentiles. Nearest rank: on `n` sorted
samples the `p`th percentile is the sample at index `ceil(p / 100 × n) - 1`.
For twenty samples p50 is the tenth and p95 the nineteenth. Timing is
`performance.now()` around the awaited call, rounded to one decimal.

The table, which is what a person reads:

```
bench on windows (MyApp), 20 iterations, node 24.4.0, 2026-10-13T06:24:00Z

  operation               cold      p50      p95      min      max
  snapshot             1842.0   1611.3   1702.9   1588.1   1740.2
  snapshot -i          1620.4   1498.7   1589.0   1470.3   1601.8
  press                   -     1210.5   1288.1   1190.0   1302.4
  fill                 skipped: pass --field <target> to measure it
  screenshot            698.2    412.6    455.0    401.9    470.3
```

`--json` prints `BenchResult` instead, and every run also writes it to
`.harness/bench/<platform>-<timestamp>.json`, so a before-and-after pair can
be diffed without retyping. `--iterations <n>` or the step's positional
argument sets `n`; below 5 the step refuses, since a p95 of three samples is
the maximum.

The idle guard applies to `press` and `fill` on Windows exactly as it does to
the steps, so `bench` on a desk someone is using refuses without `--force`.

### 3. The asynchronous process helper

```ts
// src/harness/lib/run.ts, beside the existing run()
export interface RunOptions {
  cwd?: string;
  /** Milliseconds before the child is sent `killSignal`. 120 000 unless given. */
  timeout?: number;
  input?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface RanAsync extends Ran {
  /** The child outlived `timeout` and was killed. */
  timedOut: boolean;
  /** `signal` aborted before the child exited. */
  aborted: boolean;
}

export function runAsync(command: string, args: string[], options?: RunOptions): Promise<RanAsync>;
```

- `spawn(command, args, {cwd, env, windowsHide: true, stdio: 'pipe', signal,
  timeout, killSignal: 'SIGTERM'})`. No shell, ever: a path under
  `Program Files` must survive, and nothing a model or a test hands over may
  be interpreted.
- `stdout` and `stderr` are collected as UTF-8 strings. Binary output stays
  with `runBinary()`; nothing asynchronous needs bytes yet.
- `input` is written to stdin and stdin is ended; without `input`, stdin is
  ended at once, so a child that reads it does not hang.
- Resolution on `close`, never on `exit`, so the streams are drained.
  `status` is the exit code or `null` when a signal ended the child.
- `error` with `code === 'ENOENT'` resolves `{ok: false, missing: true}`,
  matching `run()`. An `AbortError` resolves `{aborted: true}`. A timeout is
  detected from the `timeout` option having fired: `child.killed` is true and
  `signalCode` is `SIGTERM`; it resolves `{timedOut: true}`. Nothing rejects:
  callers already branch on `ok`, and a rejection would be the one shape they
  do not handle.
- On Windows a signal to the child is `TerminateProcess` on that process
  alone, not its tree. That is enough for every child the drivers spawn
  today: the `agent-device` CLI is a client of a daemon and the PowerShell
  scripts spawn nothing. The Phase 1 host owns its own lifetime (it exits
  when its stdin closes). If a future child needs its tree killed, the
  helper gains `taskkill /pid <pid> /T /F` behind `process.platform ===
  'win32'`; it is not added speculatively.

No driver moves to `runAsync` in this phase. Phase 1 moves the agent-device
driver when it adds the Node client fallback, and the Windows driver when it
replaces the scripts with the host.

### 4. `HarnessError`

```ts
// src/harness/lib/errors.ts
export type HarnessCode =
  | 'DRIVER_UNAVAILABLE'      // no backend for the platform here: not installed, not running, not a Windows machine
  | 'APP_UNREACHABLE'         // the app did not open: a URL that does not answer, a deep link with no exe to launch
  | 'LOCATOR_NOT_FOUND'       // nothing in the tree matched, within the time allowed
  | 'LOCATOR_AMBIGUOUS'       // more than one node matched a strict query (Phase 2)
  | 'ACTION_FAILED'           // the backend refused or failed the step
  | 'NOT_ACTIONABLE'          // the node exists but cannot be acted on: no bounds, off screen, disabled
  | 'UNSUPPORTED_CAPABILITY'  // asked of a platform that has no counterpart and cannot answer `skipped`
  | 'ASSERTION_FAILED'        // a polling matcher ran out of time (Phase 2)
  | 'SCREENSHOT_MISMATCH'     // a baseline differs beyond the allowance (Phase 3's matcher result carries it)
  | 'INVALID_ARGUMENT';       // a call or a command line that cannot be acted on

export class HarnessError extends Error {
  override readonly name = 'HarnessError';
  readonly code: HarnessCode;
  readonly platform?: Platform;
  /** A file under `.harness/` that shows the failure, when one was written. */
  readonly evidence?: string;
  constructor(code: HarnessCode, message: string, options?: {platform?: Platform; evidence?: string; cause?: unknown});
}

/** Duck-typed on `name` and `code`: two copies of the package can be loaded, and `instanceof` fails across them. */
export function isHarnessError(error: unknown): error is HarnessError;
```

The message is the whole of what changes hands today, so it stays byte for
byte and the code is added beside it. `StepResult` gains an optional `code`
and `failed()` a second argument, both additive:

```ts
export interface StepResult {ok: boolean; skipped?: boolean; message: string; output?: string; code?: HarnessCode}
export function failed(message: string, code: HarnessCode = 'ACTION_FAILED'): StepResult;
```

`Device` then throws `new HarnessError(result.code ?? 'ACTION_FAILED',
result.message, {platform})` where it threw `new Error(result.message)`.
Every existing throw and its code:

| Site | Message, unchanged | Code |
| --- | --- | --- |
| `src/device/index.ts:64` | `no <platform> device to drive: <reason>` | `DRIVER_UNAVAILABLE` |
| `src/device/index.ts:71` (`open`) | the driver's | `APP_UNREACHABLE` |
| `src/device/index.ts:86`, `:92`, `:106` (`screenshot`, `type`, `key`) | the driver's | `ACTION_FAILED` |
| `src/device/index.ts:121` (`waitFor`) | `<target> never appeared within <n> ms; the tree has <k> nodes` | `LOCATOR_NOT_FOUND` |
| `src/device/index.ts:138`, `:142` (`element.press`, `element.fill`) | the driver's | the result's code, else `ACTION_FAILED` |
| `src/harness/platforms/web.ts:142`, `:153` | `playwright-core is not installed in this project`, `no Chromium to drive (...)` | `DRIVER_UNAVAILABLE` |
| `src/harness/platforms/web.ts:197`, `windows.ts:96` | `nothing matches <target> on the page (<k> nodes)`, `... in the window (...)` | `LOCATOR_NOT_FOUND` |
| `src/harness/platforms/web.ts:198`, `windows.ts:98` | `<ref> <role> "<name>" is not on screen to press`, `... has no bounds to press` | `NOT_ACTIONABLE` |
| `src/harness/platforms/windows.ts:82`, `agent-device.ts:129` (snapshot) | `could not read the tree of <process>: ...`, `agent-device could not take a snapshot` | `ACTION_FAILED` |
| `src/harness/platforms/windows.ts:128` (`open` with no exe) | `cannot open <url>: no exe to launch (pass --target <exe>)` | `APP_UNREACHABLE` |
| `src/harness/platforms/windows.ts:165` (unknown key) | `<name> is not a key the Windows harness knows how to send` | `UNSUPPORTED_CAPABILITY` |
| `src/harness/lib/cli.ts` (`parse`) | `<name> is not a step; try --help`, `<name> takes <n> argument(s)` | `INVALID_ARGUMENT` |

The drivers' `press` and `fill` catch their helper's throw and return
`failed(message)`; they now pass the thrown error's code through, so a
`LOCATOR_NOT_FOUND` from `pointFor` reaches the test as `LOCATOR_NOT_FOUND`
and not as `ACTION_FAILED`. The PNG reader's five errors stay plain `Error`:
they describe a file, not a step, and `png.test.ts` asserts them as they are.

Mapping to e2e, for the migration guide in Phase 4:

| Ours | e2e | Same meaning? |
| --- | --- | --- |
| `LOCATOR_NOT_FOUND`, `LOCATOR_AMBIGUOUS`, `ACTION_FAILED`, `ASSERTION_FAILED`, `INVALID_ARGUMENT`, `UNSUPPORTED_CAPABILITY`, `APP_UNREACHABLE` | the same names | yes |
| `NOT_ACTIONABLE` | `NOT_ACTIONABLE` is an engine error e2e maps to `ACTION_FAILED` | kept apart here, because "the thing is there but cannot be pressed" is a different fix from "the press failed" |
| `DRIVER_UNAVAILABLE` | `ENGINE_FAILURE` or `BROWSER_INSTALL_FAILED` | ours is one code with the reason in the message |
| `SCREENSHOT_MISMATCH` | none; a failed `toHaveScreenshot` is `ASSERTION_FAILED` | kept apart, because the evidence is a diff image rather than a tree |

The CLI's exit codes do not change: 2 for a usage error, 1 for a driver that
is not ready or a step that failed. Scripts branch on them today, and e2e's
richer exit codes are a runner feature Vitest already provides differently.

## Compatibility

The contract test is the compatibility contract in code. What each group of
assertions guards, and why:

- **Exact `deviceConfig()` output.** Phase 3 rewrites this function around
  `platforms` and `harness.config.ts`. With no options it must return what it
  returns today, or a consumer's `vitest.config.device.mts` changes meaning
  under their feet.
- **Exact `Selector` keys and exact method parameters.** A new optional key or
  parameter would type-check in a consumer, but the assertion makes the
  addition a deliberate edit to the contract in the same commit, with the
  reason in the message.
- **Presence and arity of `device` and `element` members, not an exact list.**
  Additions are the plan; renames and removals are not.
- **The two user-facing messages and the CLI's usage messages.** Phase 0
  itself touches every throw, and these are what a person reads in a failing
  run. Pinning them is what lets the code be added without the message
  drifting.
- **`baselineFor` and `configFromEnvironment`.** The `HARNESS_*` variables and
  the baseline folder are read in two places; the test fixes both.
- **The CLI step and option tables.** `expo-harness` scripts live in other
  repositories' CI. A step that takes a different number of arguments breaks
  them silently.

Additive changes in this phase, each one invisible to existing code:
`StepResult.code`, `failed(message, code)`, the `Device` constructor's second
argument, `runAsync`, `HarnessError`, the `bench` step, the new module
`src/harness/lib/cli.ts` (the entry re-exports nothing; it is internal).

## Work items

Each item is one commit. The message says why and what was verified.

1. **Move the CLI parser out of the entry.** `src/harness/lib/cli.ts` gains
   `parse`, `unmangleRoute`, `USAGE`, `STEP_ARGUMENTS`, `OPTIONAL_ARGUMENT`,
   `screenshotPath`, and `src/harness/index.ts` imports them. Add
   `src/harness/lib/cli.test.ts`. Verified by the fixture and by running
   `expo-harness --help` and `expo-harness -p web open / tree` by hand.
2. **Add `HarnessError`.** `src/harness/lib/errors.ts` and
   `errors.test.ts`; `code?` on `StepResult` and the second argument of
   `failed()` in `src/harness/lib/types.ts`; the codes threaded through
   `src/device/index.ts`, `src/harness/platforms/web.ts`, `windows.ts`,
   `agent-device.ts`, and the parser's two throws. Messages unchanged, which
   the next item proves.
3. **Add the contract test.** `src/device/contract.test.ts`, with the
   optional driver factory on `Device`. Add `src/harness/lib/cli.ts`,
   `errors.ts` and `run.ts` to the coverage `include` in
   `vitest.config.mts`, and the same list in `.claude/rules/testing.md` and
   `.claude/skills/verify/SKILL.md`.
4. **Add `runAsync`.** In `src/harness/lib/run.ts`, with `run.test.ts`
   driving `process.execPath` through exit codes, stdin, `cwd`, `ENOENT`,
   a timeout and an abort. No caller yet.
5. **Add `bench`.** `src/harness/lib/bench.ts` and `bench.test.ts`; the step
   in `src/harness/index.ts` and its row in `STEP_ARGUMENTS`; `--iterations`,
   `--field` and `--json` in the parser; the section in `docs/harness.md`.
   `bench.ts` joins the gate.
6. **Record the baselines.** Run `bench` on web, Windows, Android and iOS
   against the apps named under Verification, and commit
   `docs/performance.md` with the four tables, the method, and the machine,
   app and tool versions each was taken on.

## Verification

**Under the gate**, at 100% on four metrics, so `vitest.config.mts`'s
`include` gains `src/harness/lib/cli.ts`, `src/harness/lib/errors.ts`,
`src/harness/lib/run.ts` and `src/harness/lib/bench.ts`:

- `cli.test.ts`: every step's argument count, the optional `snapshot` file,
  each option and its short form, `doctor` and `--help` as commands, the two
  parse errors with their codes, `unmangleRoute` with and without `MSYSTEM`,
  `screenshotPath` for a bare name, a relative path and an absolute path.
- `errors.test.ts`: construction with and without options, `cause` preserved,
  `isHarnessError` true for an instance and for a plain object with `name:
  'HarnessError'` and a string `code` (the two-copies case), false for an
  `Error` and for `null`; the `HarnessCode` union has exactly the ten
  members, checked with `expectTypeOf`.
- `run.test.ts`, every case through `process.execPath` so it runs on every
  CI platform: `-e "process.stdout.write('x')"` gives `ok` and `stdout`; `-e
  "process.exit(3)"` gives `status: 3` and not `ok`; a command that does not
  exist gives `missing`; `-e "setTimeout(()=>{},10000)"` with `timeout: 200`
  gives `timedOut` within a second; an `AbortController` aborted after 50 ms
  gives `aborted`; `input` arrives on the child's stdin; `cwd` is where the
  child runs. The synchronous `run()`, `runBinary()`, `installed()` and
  `powershell()` are covered by the same file; on Linux `powershell` is
  `missing`, which is a branch worth having.
- `bench.test.ts`: `percentile` on `[1..20]` gives p50 10 and p95 19, on one
  sample gives that sample, on `[5, 1, 3]` after sorting gives p50 3;
  `summarise` with a `cold` kept apart; `renderBench` on a fixed result
  matches the table above; `bench()` against a stub driver whose calls
  resolve after a set delay produces the expected sample counts, skips
  `fill` without a field, and skips `press` when no node qualifies.
- `contract.test.ts`, as designed above. Its type-level half is proved by
  `bun run typecheck`.

**By running it**, because the drivers changed shape even though no step
changed behaviour:

- `bun run test:fixture`, as every phase.
- `expo-harness -p web --url <an Expo web app> open / tree press 'label="X"'`
  with a label that does not exist, to see the `LOCATOR_NOT_FOUND` message
  unchanged; the same on Windows against expo-windows's example app.
- `bench` on all four platforms: web against an Expo web app on
  `npx expo start --web`, Windows against expo-windows's example app, Android
  against a device over `agent-device`, iOS against a simulator on a Mac. The
  numbers go in `docs/performance.md` as the Phase 0 baseline, with the
  machine, the app, the agent-device version and the Node version on each
  row. They are the "before" that Phase 1's exit criteria are measured
  against.

## Docs

- `docs/harness.md`: a `bench` row in the steps table, the `--iterations`,
  `--field` and `--json` options, a sample table, and one paragraph on what it
  measures and what `cold` means.
- `docs/device-tests.md`: a section "Errors" with `isHarnessError`, the ten
  codes and one line each, and the note that the message is unchanged from
  before the code existed is not written down, per the no-history rule; the
  page says what the codes are, not when they arrived.
- `docs/performance.md`: new. The method (twenty iterations, nearest-rank
  percentiles, cold kept apart), the four baseline tables, and how to
  reproduce them. This page grows a column per phase that touches a driver.
- `docs/contributing.md`: the coverage gate list.
- `README.md`'s feature table: the harness row mentions `bench`; no new row.

## Risks and fallbacks

- **`expectTypeOf` is silent at run time.** If someone adds `--typecheck` to
  the test script or removes test files from `tsconfig.json`, the type half
  of the contract would still be checked one way or the other, but the
  comment in the test names the dependency so it is not broken by accident.
- **Absolute paths in the exact `deviceConfig()` assertion.** They are
  computed with `file()` and `path.join`, so they are right on Windows and
  Linux and from `dist`. The fixture runs the real config either way.
- **Timeouts on Windows kill one process, not a tree.** True today and
  harmless for today's children. The fallback, `taskkill /T`, is named above
  and added only when a child needs it.
- **Bench noise.** A device with an animation on screen or a laptop on
  battery moves the numbers. The table carries min and max, the JSON carries
  every sample, and a baseline is taken twice with the lower p50 kept; both
  runs are committed in `.harness/bench/` form in the performance page's
  source notes, not in the repository.
- **`isHarnessError` across two package copies.** Duck typing is the design,
  not a fallback; the test for a plain object with the right `name` and
  `code` is what keeps it honest.
- **A driver test suite in a consumer that matches error messages.** None is
  known, and the messages do not change. If one appears, it keeps working.

## Exit criteria

- `src/device/contract.test.ts` exists, passes, and its type assertions fail
  `bun run typecheck` when a pinned signature is changed (proved once by
  changing one and reverting, noted in the commit message).
- `vitest.config.mts`'s coverage `include` lists `src/harness/lib/cli.ts`,
  `errors.ts`, `run.ts` and `bench.ts`, and `bun run test:coverage` reports
  100% on all four metrics.
- Every `throw` under `src/device/` and `src/harness/platforms/` constructs
  a `HarnessError`; `grep -rn "throw new Error" src/device src/harness/platforms`
  prints nothing. The PNG reader is the one documented exception.
- `expo-harness -p web --url <url> open / bench` prints the table and writes
  `.harness/bench/web-<timestamp>.json`.
- `docs/performance.md` holds a baseline table for web, Windows, Android and
  iOS, each with its machine, app and tool versions.
- `runAsync` passes its seven cases on Linux and Windows CI runners; no
  driver calls it yet.
- `bun run lint`, `bun run typecheck`, `bun run test:coverage` and
  `bun run test:fixture` are green.

## References

- e2e error reference, codes and classes: https://e2e.tester.army/docs/reference/errors (e2e 0.20.0)
- e2e engine contract test, named in the writing-an-engine page: https://e2e.tester.army/docs/writing-an-engine
- Node `child_process`: `spawn` options `timeout`, `killSignal`, `signal`, `windowsHide`, `stdio`, the `ENOENT` and `spawn` events, `kill()` on Windows: https://nodejs.org/api/child_process.html (Node 24)
- Vitest `expectTypeOf`, which does nothing at run time and needs a type check to fail: https://vitest.dev/api/expect-typeof (Vitest 4.1)
- Nearest-rank percentile: https://en.wikipedia.org/wiki/Percentile#The_nearest-rank_method
- This repository: `src/harness/lib/run.ts`, `src/harness/lib/types.ts`, `src/device/index.ts`, `src/device/matchers.ts`, `src/harness/index.ts`, `src/projects.ts`, `vitest.config.mts`, `tsconfig.json`, `.claude/rules/testing.md`

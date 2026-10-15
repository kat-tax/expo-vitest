# Plan: everything e2e has, better, without surprising anyone

This folder is the working plan for taking the device layer of `expo-vitest`
past [tester-army/e2e](https://github.com/tester-army/e2e) on every count that
matters to a person testing an Expo app: speed, developer experience, platform
reach, and trust. It is a plan, not documentation. `docs/` describes the package
as it is; this folder describes where it is going and why. It is not shipped
(`package.json`'s `files` does not include it).

| File | What it holds |
| --- | --- |
| `README.md` | The goal, the bar, the compatibility contract, the dependency policy, the feature map, verification as a whole, what is left out, the decisions taken. Read this first. |
| [`phase-0-foundations.md`](phase-0-foundations.md) | The contract test, the benchmark, the async process helper, error codes. Size S. |
| [`phase-1-faster-backends.md`](phase-1-faster-backends.md) | The agent-device Node client, the persistent Windows host, change-aware polling on web, settle and transition. Size M. |
| [`phase-2-locators-matchers-evidence.md`](phase-2-locators-matchers-evidence.md) | `screen` with RNTL's names, strict lazy locators, polling matchers, `kind`, failure evidence and traces. Size M. |
| [`phase-3-app-and-device-control.md`](phase-3-app-and-device-control.md) | A Vitest project per platform, `harness.config.ts`, app command and ready URL, the device fixture, masks and element screenshots, gating. Size M. |
| [`phase-4-developer-experience.md`](phase-4-developer-experience.md) | `expo-vitest init`, the skill and `guide`, the reporter and pull request comments, video, CDP connect, hosted devices, device pools, web extras, the docs pages. Size M. |
| [`phase-5-agent.md`](phase-5-agent.md) | `expo-vitest/agent`: act, assert, waitFor, extract, the model interface and the Claude adapter, the replay cache, secrets and policy, tools, executors, personas, debug and cost. Size L. |
| [`phase-6-agent-surfaces.md`](phase-6-agent-surfaces.md) | `expo-harness mcp`, explore, bug bash, the skill's agent topics. Size M. |
| [`external-drivers.md`](external-drivers.md) | Maintained drivers read as replacements for ours or as sources of features: the verdicts, what to take, the recommendation. |

Each phase document follows one shape: purpose and the claims it proves, what
e2e does, what this package has today, the design, the ordered work items,
verification, docs changes, risks, exit criteria, references. Sizes are
relative: S is days, M is one to two weeks, L is several weeks.

Reference points, checked 2026-10-13: `e2e` 0.20.0, `@e2e-dev/web` 0.14.0,
`@e2e-dev/mobile` 0.12.0 (pins `agent-device` 0.21.25), `agent-device` 0.21.27,
`@anthropic-ai/sdk` 0.133.0, `playwright-core` 1.63.0 (what `@e2e-dev/web`
pins), this package 0.1.0 on Vitest 4.1 and Expo SDK 57.

## 1. The goal

Every feature e2e has, available to an `expo-vitest` user, with four
differences held throughout:

1. **Four platforms, not three.** Everything works on web, Windows, Android and
   iOS, and a step a platform cannot do says `skipped` rather than failing.
2. **One runner.** Device tests, agent steps and component tests all run under
   Vitest, with Vitest's `expect`, watch mode, reporters, sharding and projects.
   Nothing here is a second test runner.
3. **The tree is the evidence.** Assertions, failure evidence, replay and the
   model's view are all the accessibility tree first, pixels second.
4. **Nothing phones home and nothing is required.** No telemetry, no runtime
   dependencies, no model unless a test asks for one.

## 2. What "better" means, concretely

A feature is not done because it exists. Each phase names which of these it
must beat e2e on, and the verification that shows it did.

| Criterion | The bar |
| --- | --- |
| Faster | Measured with `expo-harness bench` on the same app, lower p50 and p95 per operation than e2e's engine for the same platform, or than our own baseline where e2e has no backend. |
| Friendlier | Fewer steps from install to a green run, names an RNTL user already knows, and a failure message that says what to do next. |
| Wider | Runs on Windows as well as the other three, or says `skipped` with a reason. |
| Lighter | No new runtime dependency. Optional peers only, resolved at runtime, with `doctor` saying what is missing. |
| Safer | Secrets never reach a model, a log or a screenshot. Nothing leaves the machine except to the app under test and a model the user configured. |

## 3. The compatibility contract

Vitest and React Native Testing Library users must not notice this work until
they reach for it. These do not change in any phase:

- `expoProjects`, `nodeProject` and `deviceConfig` keep their signatures, and
  every existing option keeps its default. New options default to today's
  behaviour.
- The file-name rule, the four projects, and the setup files.
- `expo-vitest/native`, `expo-vitest/windows` and `expo-vitest/router`.
- `expo-vitest/device`: `device.platform`, `open`, `snapshot`, `fullSnapshot`,
  `screenshot`, `type`, `key`, `waitFor`, `close`; `element(by.…)` with `press`,
  `fill`, `node`, `waitFor`; `by.testID`, `label`, `text`, `role`, `ref`; the
  four matchers `toHaveElement`, `toBeFullyLabelled`,
  `toSupportArrowNavigation`, `toMatchScreenshot`; the `HARNESS_*` variables.
- The tree shape. Fields are added, never renamed or removed. `role` stays the
  platform's own word.
- `expo-harness`: every step, target spelling and option it has today.
- `vi`, never `jest`. RNTL 13 and 14 as they are.

Rules for everything new:

- Additive only. A new capability is a new method, selector, matcher, option,
  subpath or command. An old name that gets a better one stays as an alias.
- A driver answers, it does not throw. New device methods return `'done'` or
  `'skipped'`, the way `device.key` does.
- A contract test pins the public surface (Phase 0). A change that breaks it
  fails CI, and the plan has to be amended before the code is.
- Nothing breaking ships before a major version, and this plan contains no
  breaking change.

One widening to flag: `by.role('button')` will also match a node whose new
`kind` is `button`, so it finds a UIA `Button` on Windows. Everything that
matched before still matches.

## 4. Dependency and runtime policy

| | Today | After this plan |
| --- | --- | --- |
| Runtime dependencies | none | none |
| Optional peers | `playwright-core` | `playwright-core`, `@anthropic-ai/sdk` |
| Tools found at runtime | `agent-device` (global or project) | the same, with its Node client preferred over its CLI |
| Schema validation | none | Standard Schema v1 or plain JSON Schema accepted; no Zod dependency, though a Zod schema works |
| MCP | none | a hand-written stdio JSON-RPC server; no MCP SDK |
| Images | own PNG reader and diff writer | the same, with masking and cropping added |
| Telemetry | none | none |

e2e's `e2e` package carries peers on `ai` and five `@ai-sdk/*` packages, plus
`zod` and `pngjs`, and turns telemetry on by default. Staying at zero is a
feature and the plan treats it as one.

Node floor: `engines.node` becomes `>=22.18` in Phase 3 (decision 3 in
section 10). `agent-device` already needs 22.12, and 22.18 is where Node
strips types without a flag, so a consumer's `harness.config.ts` can be
loaded by Node's own `import()` wherever Vitest's module runner does not
reach. Phase 3 still checks which loader it needs; the floor no longer
depends on the answer.

## 5. Where e2e is faster

Phase 1 is the answer in full. In one table:

| Area | Today | The change | Target |
| --- | --- | --- | --- |
| iOS and Android | the `agent-device` CLI spawned per step with `spawnSync` | agent-device's Node client, async CLI fallback | p50 of snapshot and press lower than the command line's; on a Pixel 7 Pro the device's own work is most of a step |
| Windows | a PowerShell process per step, each loading UI Automation and compiling C#, and a tree walk that pays a cross-process call per element and property | one persistent host serving JSON lines, the subtree fetched in one cached request, UI Automation patterns in place of synthetic input where a control exposes one, then a compiled C# host over UIA3 with an event-driven cache if the bench still says the host is the cost | snapshot p50 under 100 ms warm for 400 nodes on the PowerShell host and under 50 ms compiled; a press through a pattern with no foreground window |
| Web | one in-page evaluate per snapshot | a mutation counter so an unchanged screen costs one trivial evaluate | fewer collects per test, no per-step regression |
| Settle and transition | press immediately | 150 ms stability after an action, 500 ms before touching a control that just appeared, both configurable | fewer retried presses |
| Warm-up | the first test pays the launch | `globalSetup` makes the driver and opens the base route first | the first test starts warm |
| Parallelism | one file, one worker | a project per platform (Phase 3), then device pools (Phase 4). Vitest documents `fileParallelism: false` as forcing one worker, and does not say whether that is per project; Phase 3's spike decides, and the fallback is `sequence.groupOrder` serialisation | platforms in parallel, then devices |
| Replay | none | a verified agent step replays through the same locators as a scripted test (Phase 5) | a replayed step costs no model call |

## 6. Feature map

Every e2e feature, what we have, what we will have, and the phase. "Better
because" is the claim the phase has to prove.

| e2e feature | Ours today | Planned | Better because | Phase |
| --- | --- | --- | --- | --- |
| Runner, workers, retries, shards, watch | Vitest | Vitest, plus a project per platform | One runner for components and devices, and watch mode on a device test | 3 |
| Web engine, Chromium, Firefox, WebKit | Chromium | `HARNESS_BROWSER`, headed mode, CDP connect | Same reach, no extra package | 2, 4 |
| Mobile engine over agent-device | agent-device CLI per step | agent-device Node client, one session per run | Faster per step, timeouts can fire | 1 |
| Windows | UIA and synthetic input, process per step | one persistent host with cached tree reads and pattern-first presses, then a compiled host if measured faster | e2e has no Windows at all, and a pattern press needs no quiet desk | 1 |
| Playwright-style locators, normalised roles, strict single match | `by.*`, first match, native role word | `screen.getBy*` and `within` with RNTL names, strict, `kind` beside `role` | Names an RNTL user already knows; the native word kept for the audit | 2 |
| Polling locator matchers | snapshot matchers plus `waitFor` | `toBeVisible`, `toHaveText`, `toBeChecked`, `toHaveCount`, and the rest, polling to `assertionTimeout` | Same matchers, and the four audit matchers e2e cannot host | 2 |
| Trace pages, failure screenshots, app log | nothing automatic | screenshot, tree, step log and `trace.md` per failing test | The tree is in the trace and diffs between steps | 2 |
| Error codes and classes | messages | `HarnessError` with `code`, `isHarnessError` | Same codes where the meaning is the same, so a migration guide is a table | 0 |
| Settle and transition windows | none | `settle`, `transition` | Change-aware, so cheaper | 1 |
| `app.command` and `readyUrl` | start the app yourself | `app.command`, `readyUrl`, `reuseExisting` on by default locally | One command to a green run | 3 |
| App lifecycle: open, restart, clearState, back | `open` | `restart`, `clearState`, `back`, `home` | On four platforms, `skipped` where impossible | 3 |
| Device fixture: permissions, network, location, appearance, orientation, fold, biometrics, clipboard, install, open link, alert, keyboard | nothing | the same names, over agent-device, Playwright emulation and PowerShell | Web gets them too through Playwright | 3 |
| Launch arguments, permissions pre-grant, dev client recipe | none | `app.launchArguments`, `app.permissions`, a documented Expo dev client launch | Documented for all four, including the Windows deep link | 3 |
| `requires` and `platforms` gating | `it.skipIf` | `device.can`, `onlyOn`, `skipOn`, and skip reasons in the report | Same gating, Vitest's own skip | 3 |
| Visual comparison: screen or element, masks, thresholds, per-target baselines | whole screen, ratio, per-platform baselines, explicit recording | element crops, masks from the tree, `threshold`, `maxDiffPixels`, the `-expected` `-actual` `-diff` triple, stabilised screens | Masks come from the tree, not from a locator paint, and recording stays deliberate | 3 |
| Reporters: list, junit, markdown, json | Vitest's | Vitest's, plus a summary reporter that writes the step summary and `GITHUB_STEP_SUMMARY` | Nothing to install | 4 |
| Pull request comment | none | `expo-vitest/reporter` with `github()` | Evidence links point at the tree and the screenshot | 4 |
| Video | none | `HARNESS_VIDEO` on devices through agent-device and on web through Playwright | `skipped` on Windows, said plainly | 4 |
| Hosted browsers and devices | none | CDP connect for browsers; Limrun, BrowserStack and AWS Device Farm through agent-device's own `connect` | Zero code of ours for devices | 4 |
| `init` wizard | none | `expo-vitest init`, shows every change before writing, `--yes` | Sets up components and devices on four platforms in one go | 4 |
| Coding agent skill and `guide` | none | `.claude/skills/expo-vitest/`, `expo-vitest guide` | Covers the component projects too | 4 |
| MCP server | none | `expo-harness mcp`, same tool names | Windows and web sessions, which e2e's server cannot open | 6 |
| Migration guides | none | from Detox, Maestro, Playwright, and from e2e | A table per guide | 4 |
| CI pages: GitHub Actions, EAS Workflows, Bitrise, Codemagic | one paragraph | a page each, with a Windows runner job | Four platforms covered | 4 |
| Agent: act, assert, waitFor, extract, vision | none | `expo-vitest/agent` | Model optional, provider neutral, Claude first class, no telemetry | 5 |
| Replay cache, `unique()`, strict mode, hand-off | none | the same semantics in `.harness/cache/` | Replays through the same locators as a scripted test | 5 |
| Secrets, credentials, redaction, pixel withholding | none | the same rules | The same rules on Windows too | 5 |
| Project tools, custom executors, personas, decision models | none | `defineTool`, `StepExecutor`, `agents`, an executor slot a decision model can fill | No vendor lock in the executor | 5 |
| Debug: `--debug`, `--ai-trace`, cost per step | none | `HARNESS_DEBUG`, `HARNESS_AI_TRACE`, cost in the trace | Prices known for Claude, reported per step | 5 |
| Explore, bug bash | none | `expo-harness explore`, `expo-harness bug-bash` | Four platforms | 6 |
| Subscriptions sign-in | none | Claude through the SDK's own credential chain | No OAuth code of ours | 5 |
| Telemetry | none | none | | |
| Component tests, RNTL helpers, router helper | yes | unchanged | e2e has none | |

## 7. Verification, as a whole

The repository's rule stands: unit tests cover what is logic and nothing else,
and the coverage `include` list in `vitest.config.mts` grows with each new
logic file. Drivers, hosts and the agent's live behaviour are proved by running
them. Every phase ends with `bun run lint`, `bun run typecheck`,
`bun run test:coverage` and `bun run test:fixture` green, plus its own device
run.

| What | Proved by | Where it runs |
| --- | --- | --- |
| Queries, roles, polling, evidence, config, masks, cache, redaction, policy, loop, cost, MCP framing | unit tests, 100% on four metrics | CI, every push |
| The web driver, matchers, evidence, `command`, screenshots | the fixture's `device/` suite on a static page | CI, every push |
| Windows host and driver | the harness and the device suite against expo-windows's example app | a Windows machine, before each phase closes |
| iOS and Android | the device suite in a consumer, and `bench` | a Mac and a device, before each phase closes |
| Performance | `expo-harness bench`, numbers kept in `docs/performance.md` | before and after Phase 1, and each later phase that touches a driver |
| The agent, live | a smoke behind an environment variable | by hand, before Phases 5 and 6 close |
| Compatibility | the contract test | CI, every push, every phase |

## 8. Documentation

The README's feature table gains a row per shipped feature, and `docs/` gains
or grows a page per topic as each phase lands: `device-tests.md` split into
`locators.md`, `matchers.md`, `controls.md` and `evidence.md`; new
`performance.md`, `ci.md`, `migrating.md`, `agent.md`, `coding-agents.md`;
`configuration.md` for `harness.config.ts` and the new `deviceConfig` options;
`harness.md` for the new commands. Every page describes the package as it is,
with no history, per `AGENTS.md`. This folder is where the history lives until
a phase ships, and the commit messages after.

## 9. Not in this plan, and why

- **Other vendors' subscription sign-in** (ChatGPT, Copilot, SuperGrok,
  OpenCode). That is OAuth plumbing for each vendor, outside what a test
  package should own, and the `Model` interface already lets a user bring any
  token. Claude's subscription path comes free through the SDK's credential
  chain.
- **A decision model package.** It depends on one vendor's probability API.
  The executor slot accepts one; shipping one is not our job.
- **Hosted provider packages** for Kernel, smol, Limrun, EAS. Browsers are
  reached through CDP connect; devices through agent-device's own `connect`
  to BrowserStack, AWS Device Farm and Limrun. Documented, not wrapped.
- **An e2e engine for Windows.** Decided against (decision 6 in section 10).
  Windows stays a platform only this package drives. The reach it would have
  bought is not worth handing e2e the one platform it lacks.
- **Any breaking change.** Including renaming `role`, making `element` strict,
  or changing a default timeout. If one looks worth it, it goes in a separate
  major-version plan.

## 10. Decisions

Taken on 2026-10-13. A phase that wants to reopen one amends this list first.

1. **The normalised role field is `kind`.** It is the field agent-device
   already puts on every snapshot node, so iOS and Android need no
   translation, and it is short. The step journal in Phase 2 names its own
   discriminant `event`, so the two never share a word. `role` stays the
   platform's own word.
2. **The query object is `screen`.** It matches React Native Testing Library,
   which is the point. Device test files do not import RNTL; one that did
   would alias one of the two.
3. **`engines.node` becomes `>=22.18` in Phase 3.** agent-device already needs
   22.12, and 22.18 is where Node strips types without a flag, so a `.ts`
   harness config loads under any loader. The floor is declared once and
   does not depend on the loader spike.
4. **The default model is `claude-opus-5-5`.** Thinking is always on and
   `effort` is the lever. `claude-fable-5-1` is one option away for the
   hardest flows, with its retention requirement documented beside it.
5. **The pull request reporter ships in this package** as
   `expo-vitest/reporter`. One install, versioned with the evidence format it
   reads, built on `fetch` so the dependency count stays at zero.
6. **No Windows engine for e2e.** Windows stays a platform only this package
   drives.
7. **Our drivers stay, and borrow (2026-10-15).** Five maintained drivers
   were read as replacements: agent-desktop, Cua's driver, Terminator,
   agent-browser and argent. None could take over a react-native-windows
   app, and none did better on web or mobile. The web and Windows drivers
   stay ours and agent-device stays, with the features listed in
   [`external-drivers.md`](external-drivers.md) borrowed into Phase 1.
   agent-desktop's Windows adapter is the one to try again once it ships.

## 11. Shared facts the phases build on

Established while researching, so the phase documents cite one source.

- **agent-device's Node client** is `createAgentDeviceClient` from
  `agent-device`, with a named `session`, `lockPolicy` and `lockPlatform`, and
  namespaces `devices`, `sessions`, `apps`, `capture` (`snapshot`,
  `screenshot`, `diff`), `interactions` (`click`, `press`, `longPress`,
  `swipe`, `scroll`, `type`, `fill`, `focus`, `find`, `get`, `is`), `command`
  (`wait`, `alert`, `back`, `home`, `orientation`, `fold`, `keyboard`,
  `clipboard`), `recording` (`record`, `trace`), `settings` (`update`),
  `observability`, `replay`, `batch`, `leases`, `metro`. Every dispatching
  call takes `signal?: AbortSignal`. Errors go through `isAgentDeviceError`
  and `normalizeAgentDeviceError`. Source: https://oss.callstack.com/agent-device/docs/client-api.
- **agent-device's CLI** has `settings appearance|permission|wifi|airplane|location|animations|text-size|faceid|touchid|fingerprint|clear-app-state|reset-keychain`,
  `orientation`, `fold`, `clipboard`, `record start|stop`, `screenshot
  --normalize-status-bar --crop-on --scale`, `open --launch-url --relaunch`,
  `install`, `reinstall`, `back --in-app|--system`, `home`, `alert`,
  `keyboard dismiss`, `connect browserstack|...`, `daemon stop`, `device
  status|release`, and selectors `role="button" label="Continue"`,
  `id="primary-cta"`, `text="..."`, `label~="regex"`, refs `@e1`. Source:
  https://oss.callstack.com/agent-device/docs/commands.
- **Node type stripping** is on by default from 23.6.0 and 22.18.0, refuses
  files under `node_modules`, and rejects enums, namespaces with runtime code,
  parameter properties and import aliases. Source: https://nodejs.org/api/typescript.html.
- **Vitest** exposes `globalSetup` with `project.provide` and `inject`,
  per-project `name`, `include`, `environment`, `setupFiles` and
  `globalSetup`; root-only `coverage`, `reporters` and `attachmentsDir`; the
  reporter hooks `onInit`, `onTestRunStart`, `onTestModuleCollected`,
  `onTestCaseReady`, `onTestCaseResult`, `onTestCaseAnnotate`,
  `onTestCaseArtifactRecord` (4.0.11), `onTestRunEnd`; and in a test
  `onTestFailed`, `onTestFinished`, `annotate(message, type?, attachment)`
  and `signal`. Sources: https://vitest.dev/config/globalsetup,
  https://vitest.dev/advanced/api/reporters, https://vitest.dev/guide/test-context,
  https://vitest.dev/guide/projects.
- **MCP** over stdio is newline-delimited JSON-RPC on stdin and stdout, UTF-8,
  no embedded newlines, logging on stderr only; the lifecycle is `initialize`
  (protocol version `2025-06-18`, `capabilities.tools`, `serverInfo`,
  `instructions`), `notifications/initialized`, then `tools/list` and
  `tools/call` with `content` blocks (`text`, `image` with base64 `data` and
  `mimeType`) and `isError`. Sources: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports,
  .../basic/lifecycle, .../server/tools.
- **UI Automation** fetches a whole subtree with every requested property in
  one cross-process call: in the managed client a `CacheRequest` with
  `TreeScope.Subtree` passed to `AutomationElement.GetUpdatedCache`, then
  `CachedChildren`; in the UIA3 COM client `IUIAutomation::CreateCacheRequest`
  and `IUIAutomationElement::BuildUpdatedCache`, then `GetCachedChildren`.
  Control patterns (`Invoke`, `Toggle`, `SelectionItem`, `Value`,
  `ScrollItem`, `ExpandCollapse`) drive a control without a pointer or a
  foreground window. The C# compiler that ships with .NET Framework 4.x,
  `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, speaks C# 5 and
  is the compiler `Add-Type` uses under Windows PowerShell. Sources:
  https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.cacherequest,
  https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-cachingforclients,
  https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview,
  https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/.
- **Standard Schema v1** is an object with `~standard: {version: 1, vendor,
  validate(value) => {value} | {issues: [{message, path?}]}}`, synchronous or
  a promise. Source: https://standardschema.dev/.
- **Playwright** gives `browserType.connectOverCDP(endpointURL)`,
  `browser.newContext({recordVideo: {dir, size}, viewport, colorScheme,
  reducedMotion, locale, timezoneId, geolocation, permissions, offline})`,
  `context.addInitScript`, `context.route`, `context.grantPermissions`,
  `context.setGeolocation`, `context.setOffline`, `context.on('dialog')`,
  `page.emulateMedia({colorScheme})`. Sources: https://playwright.dev/docs/api/class-browsercontext,
  https://playwright.dev/docs/api/class-browsertype.
- **The Anthropic SDK** path for the agent is `client.messages.create` with
  `tools` carrying `strict: true` and `additionalProperties: false`,
  `tool_choice: {type: 'auto'}`, base64 image blocks, `cache_control` on the
  system prompt and the last tool, `output_config.effort`, `max_tokens` around
  16000 for a non-streaming call, and `fallbacks: 'default'` with the
  `server-side-fallback-2026-07-01` beta. Default model `claude-opus-5-5`,
  `claude-fable-5-1` on request. Prices for cost reporting, per million tokens:
  Opus 5.5 $4 in and $20 out, Fable 5.1 $10 and $50, Sonnet 5.5 $2 and $10,
  Haiku 5.5 $0.10 and $0.50.
- **e2e's own numbers** to match or beat: `assertionTimeout` 5 s,
  `actionTimeout` 30 s, test `timeout` 120 s, `settle` 150 ms, `transition`
  500 ms, agent budgets 25 steps and 25 model calls, screenshots at most 768
  px on the long side with the newest two kept, negated matchers after 1 s of
  continuous truth, cache `read-write` locally and `read-only` in CI.
- **Corrections found while writing the phases.** agent-device's commands
  page spells a press on a ref `click @ref` and a press at a point `press <x>
  <y>`, while its README still shows `press @e2`; Phase 1's first work item
  confirms which the installed version accepts. agent-device snapshots carry a
  platform-neutral `kind` on every node and `role` on iOS only, so Phase 2
  takes that field as the node's `kind` and maps only UIA control types and
  DOM roles itself. MCP revision 2025-06-18 removed
  JSON-RPC batching, so Phase 6's server answers a batch with `-32600`. The
  Claude adapter uses `client.beta.messages.create`, because `fallbacks` is a
  beta parameter, so its load check looks for that path. The cache read and
  write prices in Phase 5's cost table are to be re-checked against the
  pricing page before that phase starts.

## 12. Hooks between phases

The interfaces one phase provides and a later one relies on, agreed here so a
phase cannot drift from them without amending this list.

| Provided by | Hook | Used by |
| --- | --- | --- |
| Phase 0 | `runAsync` with `timeout` and `signal`; `HarnessError`, `isHarnessError` and `StepResult.code`, with the seven codes something produces now (Phase 2 adds `LOCATOR_AMBIGUOUS` and `ASSERTION_FAILED`, Phase 3 `SCREENSHOT_MISMATCH`); the CLI parser in `src/harness/lib/cli.ts`; the contract test, which stubs drivers by mocking `drivers.ts`; `expo-harness bench` | every later phase |
| Phase 1 | `Driver.generation?()` and the `fresh` snapshot option; `SnapshotNode.parent` and, on Windows, `SnapshotNode.patterns`; the Windows host ops including `hold` and the pattern ops `invoke`, `toggle`, `select`, `setValue`, `scrollInto`, `expand`, `collapse`; the idle guard inside the driver's synthetic path with a `force` option and its environment form, `HARNESS_FORCE`; agent-device's implicit session, shared by every file in a workspace (a named session per process was measured to block the next file when one forgets `close()`) | Phase 2's `within`, polling, `longPress` and the `via` option on `press` and `fill`; Phase 4's pools take a session per claimed device through agent-device's leases, which expire on their own |
| Phase 2 | the evidence journal with `verified` events and `onStep`; `evidence` annotations carrying the screenshot, tree and trace paths; `assertionTimeout` and `stable` reaching the worker through `provide`; the setup file staying `src/device/matchers.ts` | Phase 4's reporter reads the annotations; Phase 5's cache records an `act` only after a `verified` event names it |
| Phase 3 | `harness.config.ts` with `actionTimeout` and the reserved `agents`, `tools`, `secrets`, `cache` keys; `device.can` over one capability table that includes the step verbs; `app.<platform>.device` as a name, a list or a hosted provider object; `globalSetup` providing the run id | Phase 4's pools, hosted devices and video; Phase 5's tool list; Phase 6's catalog |
| Phase 4 | `src/cli/init.ts`, `src/cli/guide.ts`, `src/cli/detect.ts`, `src/cli/templates.ts`; the skill under `skills/expo-vitest/` in the package and `.claude/skills/expo-vitest/` in a project; `device.web` | Phase 6's `.mcp.json` entry and skill topics |
| Phase 5 | the replay resolver that finds a recorded control by `kind`, name, test id and parent; the agent loop with a step kind; `resizePng` | Phase 6's MCP node ids, `explore` and `bug-bash` |

## Appendix: e2e references used

Checked 2026-10-13, for re-checking when a phase starts.

| Topic | Page |
| --- | --- |
| Engine SPI | https://e2e.tester.army/docs/reference/engine |
| Config | https://e2e.tester.army/docs/reference/config |
| test, screen, expect, app, agent | https://e2e.tester.army/docs/reference/test, .../reference/screen, .../reference/expect, .../reference/app, .../reference/agent |
| Mobile and web engines | https://e2e.tester.army/docs/reference/mobile, https://e2e.tester.army/docs/reference/web, https://e2e.tester.army/docs/mobile, https://e2e.tester.army/docs/browser |
| Cache, security rules, errors, environment | https://e2e.tester.army/docs/cache, https://e2e.tester.army/docs/reference/security, https://e2e.tester.army/docs/reference/errors, https://e2e.tester.army/docs/reference/environment |
| Agent steps, executors, tools, decision models, agents | https://e2e.tester.army/docs/agent-steps, .../executors, .../tools, .../decision-models, .../agents |
| MCP, coding agents, debugging, authentication | https://e2e.tester.army/docs/reference/mcp, https://e2e.tester.army/docs/coding-agents, https://e2e.tester.army/docs/debugging, https://e2e.tester.army/docs/authentication |
| Visual, reporters, GitHub, CI, EAS Workflows | https://e2e.tester.army/docs/visual-testing, .../reference/reporters, .../github, .../ci, .../ci/eas-workflows |
| Quickstart, CLI, runner | https://e2e.tester.army/docs/quickstart, https://e2e.tester.army/docs/reference/cli, https://e2e.tester.army/docs/reference/runner |
| Expo example | https://github.com/tester-army/e2e/tree/main/examples/with-expo |
| agent-device | https://github.com/callstackincubator/agent-device, https://oss.callstack.com/agent-device/ |

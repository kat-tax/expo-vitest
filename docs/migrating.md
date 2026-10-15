# Migrating

[Docs home](README.md) · [Device tests](device-tests.md) · [Locators](locators.md) · [Matchers](matchers.md) · [Controls](controls.md)

What a test from Detox, Maestro, Playwright or e2e becomes here. Each row's
status is one of four: **same**, the call by the same name; **renamed**, the
same thing by another name; **by design**, not here, for the reason given;
and **not yet**. A test here is a Vitest test: `describe`, `it`, the hooks,
retries and timeouts are Vitest's own, and so is `expect`.

## From Detox

| Detox | Here | Status |
| --- | --- | --- |
| `apps.<name>.binaryPath` | `app.<platform>.appPath` in the [harness config](configuration.md#harnessconfigts) | renamed |
| `apps.<name>.bundleId` | `app.<platform>.bundleId` | same |
| `devices.<name>.device.type` | `app.<platform>.device`, or `HARNESS_TARGET` | renamed |
| `configurations` | `deviceConfig({platforms})`, a project per platform | renamed |
| Jest's config, `maxWorkers` | Vitest's config, and a [pool](device-tests.md#pools) of `devices` to run files side by side | renamed |
| `detox build` | the platform's own build, as [CI](ci.md) shows | by design: the package drives a build, and makes none |
| `element(by.id('save'))` | `screen.getByTestId('save')` | renamed |
| `by.label('Save')` | `screen.getByLabelText('Save')` | renamed |
| `by.text('Save')` | `screen.getByText('Save')` | renamed |
| `by.traits(['button'])` | `screen.getByRole('button', {name})` | renamed |
| `by.type('RCTImageView')` | a role, a label or a test id | by design: a native class name differs on every platform |
| `by.id('x').withAncestor(by.id('row'))` | `within(screen.getByTestId('row')).getByTestId('x')` | renamed |
| `.atIndex(2)` | `.nth(2)` | renamed |
| `.tap()` | `.press()` | renamed |
| `.tap({x, y})` | | by design: a test names what it presses, so it reads the same on every screen size |
| `.multiTap(2)` | | not yet |
| `.longPress()` | `.longPress()` | same |
| `.typeText('Ada')` | `.type('Ada')` | same |
| `.replaceText('Ada')` | `.fill('Ada')` | renamed |
| `.clearText()` | `.clear()` | renamed |
| `.tapReturnKey()` | `.key('Enter')` | renamed |
| `.swipe('up', 'fast')`, `.scroll(200, 'down')` | `.swipe('up', {distance})` | renamed |
| `.scrollTo('bottom')`, `waitFor(el).toBeVisible().whileElement(list).scroll()` | `.scrollIntoView()` on what is wanted | renamed |
| `.pinch()`, `.setColumnToValue()` | | not yet |
| `.getAttributes()` | `.node()` | renamed |
| `expect(el).toBeVisible()` | `await expect(locator).toBeVisible()` | same |
| `expect(el).not.toBeVisible()` | `toBeHidden()` | renamed |
| `expect(el).toExist()`, `.not.toExist()` | `toBeAttached()`, `toBeDetached()` | renamed |
| `toHaveText`, `toHaveValue` | `toHaveText`, `toHaveValue` | same |
| `toHaveLabel` | `toHaveAccessibleName` | renamed |
| `toHaveToggleValue(true)` | `toBeChecked()` | renamed |
| `waitFor(el).toBeVisible().withTimeout(ms)` | `await expect(locator).toBeVisible({timeout: ms})` | renamed |
| `device.launchApp({newInstance: true})` | `device.restart()` | renamed |
| `launchApp({launchArgs, permissions})` | `launchArguments` and `permissions` in the harness config, applied to each restart | renamed |
| `launchApp({delete: true})` | `device.clearState()` | renamed |
| `device.reloadReactNative()` | `device.restart()`, the nearest | renamed |
| `device.terminateApp()` | | not yet |
| `device.installApp()` | `device.installApp()` | same |
| `device.sendToHome()` | `device.home()` | renamed |
| `device.pressBack()` | `device.back()` | renamed |
| `device.openURL({url})` | `device.openLink(url)` | renamed |
| `device.setOrientation('landscape')` | `device.setOrientation('landscape')` | same |
| `device.setLocation(lat, lon)` | `device.setLocation({latitude, longitude})` | renamed |
| `device.setBiometricEnrollment(true)` | `device.enrollBiometrics('faceid', true)` | renamed |
| `device.matchFace()`, `unmatchFace()` | `device.setBiometrics('faceid', 'match')`, `'nonmatch'` | renamed |
| `device.takeScreenshot('home')` | `device.screenshot('home')`, or `toMatchScreenshot('home')` | renamed |
| `device.getPlatform()` | `device.platform` | renamed |
| `:ios:` or `:android:` in a test's name | `onlyOn(['ios'])` around the tests | renamed |
| `device.setStatusBar(...)` | `statusBar: 'fixed'` in the harness config, the default | by design: one status bar for every screenshot, set for the run |
| `device.disableSynchronization()`, `device.setURLBlacklist()` | | by design: each step waits for the screen to [hold still](device-tests.md#waiting-for-the-screen), with no app-side sync to tune |
| `device.shake()` | | not yet |

## From Maestro

A flow is a test file, and each command a line of it.

| Maestro | Here | Status |
| --- | --- | --- |
| `appId` | `app.<platform>.bundleId` in the [harness config](configuration.md#harnessconfigts) | renamed |
| `--platform` | `--project device:<platform>` | renamed |
| `--device` | `HARNESS_TARGET`, or `app.<platform>.device` | renamed |
| `flows` in `.maestro/config.yaml`, and `'!helper.yaml'` | Vitest's `include` and `exclude` | renamed |
| `tags`, `--include-tags`, `--exclude-tags` | Vitest's `-t`, a pattern over the tests' names | renamed |
| `env`, `${VAR}` | `process.env` | by design |
| `MAESTRO_*` variables | `HARNESS_*` | renamed |
| `--format junit`, `--output` | Vitest's `junit` reporter and `--outputFile` | renamed |
| `--format html` | Vitest's `html` reporter | renamed |
| `properties` on a JUnit test | | not yet |
| `--shards`, `--shard-split` | Vitest's `--shard` | renamed |
| `maestro record` | [`video`](evidence.md#video) | renamed |
| `maestro test -c`, Maestro Studio | Vitest's watch mode, and [`expo-harness`](harness.md) by hand | renamed |
| `maestro hierarchy` | `expo-harness tree` | renamed |
| Maestro Cloud | a [hosted device](device-tests.md#hosted-devices) | renamed |
| `launchApp` | `device.open('/')`, or `device.restart()` for a fresh launch | renamed |
| `launchApp: {clearState: true}`, `clearState` | `device.clearState()` | renamed |
| `launchApp: {stopApp: true}` | `device.restart()` | renamed |
| `launchApp: {arguments}`, `launchApp: {permissions}` | `launchArguments` and `permissions` in the harness config | renamed |
| `stopApp`, `killApp` | | not yet |
| a second `appId` in a flow | | not yet: one app to a platform |
| `tapOn: Save` | `screen.getByText('Save').press()` | renamed |
| `tapOn: {id: save}` | `screen.getByTestId('save').press()` | renamed |
| `tapOn: {index: 2}` | `.nth(2).press()` | renamed |
| `tapOn: {point: 50%,50%}` | | by design: a test names what it presses, so it reads the same on every screen size |
| `tapOn` with `containsDescendants` | `.filter({has: locator})` | renamed |
| `tapOn` with `below`, `above`, `leftOf`, `rightOf` | `within(...)` on the container | by design: a container holds, where a position on screen moves |
| `retryTapIfNoChange` | | by design: a press waits for its node, and the next step for the screen to hold still |
| `waitToSettleTimeoutMs` | `settle` in the harness config | renamed |
| `longPressOn` | `.longPress()` | renamed |
| `doubleTapOn` | | not yet |
| `inputText: Ada` | `.fill('Ada')` on the field, or `device.type('Ada')` where the focus is | renamed |
| `inputRandomEmail`, `inputRandomText`, `faker` | a value the test makes | by design |
| `eraseText` | `.clear()` | renamed |
| `hideKeyboard` | `device.dismissKeyboard()` | renamed |
| `pressKey: Enter` | `locator.key('Enter')`, or `device.key('Enter')` | renamed |
| `pressKey: Home`, `pressKey: back` | `device.home()`, `device.back()` | renamed |
| `pressKey` for lock, power, the volume or a TV remote | | not yet |
| `back` | `device.back()` | renamed |
| `copyTextFrom`, `pasteText`, `setClipboard` | `device.clipboard()`, `device.setClipboard(text)` | renamed |
| `label` | the test's name, and the step's line in the [trace](evidence.md#the-trace) | by design |
| `scroll`, `swipe` | `.swipe('up', {distance})` | renamed |
| `swipe` from a point to a point | | by design: a swipe starts on a node |
| `scrollUntilVisible` | `.scrollIntoView()` | renamed |
| `waitForAnimationToEnd` | each step's wait for the screen to [hold still](device-tests.md#waiting-for-the-screen) | by design: every step does it |
| `assertVisible`, `assertNotVisible` | `toBeVisible()`, `toBeHidden()` | renamed |
| `assertVisible` with `enabled` | `toBeEnabled()` | renamed |
| `assertVisible` with `checked`, `selected` | `toBeChecked()`, or `getByRole(role, {selected: true})` | renamed |
| `assertVisible` with `focused` | the node's `focused`, from `.node()` | renamed |
| `assertTrue` | `expect(...)` | renamed |
| `extendedWaitUntil` | `toBeVisible({timeout})` | renamed |
| `assertScreenshot` | `toMatchScreenshot` | renamed |
| `assertDarkMode`, `assertLightMode` | assert on a themed control | by design |
| `setDarkMode`, `toggleDarkMode` | `device.setAppearance('dark')` | renamed |
| `setPermissions` | `device.setPermission(name, state)` | renamed |
| `setLocation`, `setOrientation`, `setAirplaneMode` | `device.setLocation({latitude, longitude})`, `device.setOrientation`, `device.setAirplaneMode` | same |
| `toggleAirplaneMode` | `device.setAirplaneMode` | renamed |
| `openLink` | `device.openLink(url)` | same |
| `takeScreenshot` | `device.screenshot(name)` | renamed |
| `startRecording`, `stopRecording` | `device.recordVideo()`, `device.saveVideo(file)`, or [`video`](evidence.md#video) for every test | renamed |
| `runFlow` | a function | by design |
| `runFlow: {when: {visible}}` | `if (await locator.isVisible())` | renamed |
| `optional` | a `queryBy*` query, which answers null | by design |
| `repeat`, `retry` | a loop, and Vitest's `retry` | by design |
| `runScript`, `evalScript`, `${output.x}` | the test's own code and variables | by design |
| `http.get`, `http.post`, `json()` | `fetch` | by design |
| `onFlowStart`, `onFlowComplete` | `beforeEach`, `afterEach` | renamed |
| platform-specific selectors | `onlyOn`, and the [file-name rule](projects.md) | renamed |
| `clearKeychain`, `addMedia`, `travel` | | not yet |
| `assertWithAI`, `assertNoDefectsWithAI`, `extractTextWithAI` | `agent.assert`, `agent.extract` | not yet: [the agent](https://github.com/kat-tax/expo-vitest/blob/master/plan/phase-5-agent.md) |

## From Playwright

The queries keep their shape and take React Native Testing Library's names,
since a test here runs on a phone as well as a page.

| Playwright | Here | Status |
| --- | --- | --- |
| `page.goto('/settings')` | `device.open('/settings')` | renamed |
| `page.getByRole(role, {name})` | `screen.getByRole(role, {name})` | same |
| `getByText`, `getByTestId` | `getByText`, `getByTestId` | same |
| `getByLabel`, `getByPlaceholder` | `getByLabelText`, `getByPlaceholderText` | renamed |
| `getByAltText`, `getByTitle` | | not yet: the web tree names a node by its ARIA label, its labels and its text, not by `alt` or `title` |
| `locator.click()` | `.press()` | renamed |
| `.fill`, `.check`, `.uncheck`, `.hover`, `.focus` | the same | same |
| `.press('Enter')` | `.key('Enter')` | renamed |
| `.scrollIntoViewIfNeeded()` | `.scrollIntoView()` | renamed |
| `.click({button: 'right'})` | `device.web.secondaryTap(locator)` | renamed |
| `.selectOption`, `.setInputFiles` | `device.web.selectOption(locator, …)`, `device.web.setInputFiles(locator, …)` | renamed |
| `.dblclick()`, `.dragTo()` | | not yet |
| `.first()`, `.last()`, `.nth()`, `.filter()` | the same | same |
| `toBeVisible`, `toBeHidden`, `toHaveText`, `toContainText`, `toHaveValue`, `toBeChecked`, `toBeEnabled`, `toBeDisabled`, `toHaveCount`, `toHaveAttribute`, `toHaveAccessibleName`, `toHaveRole`, `toBeAttached` | the same | same |
| `toHaveScreenshot` | `toMatchScreenshot` | renamed |
| `page.route` | `device.web.route` | renamed |
| `page.on('dialog')` | `device.web.onDialog` | renamed |
| `page.waitForEvent('download')` | `device.web.waitForDownload(trigger)` | renamed |
| `page.evaluate` | `device.web.evaluate` | renamed |
| `page.setViewportSize` | `device.web.setViewport` | renamed |
| `context.cookies`, `addCookies`, `clearCookies` | `device.web.cookies`, `setCookies`, `clearCookies` | renamed |
| `page.frameLocator('#card')` | `device.web.frame('#card')` | renamed |
| browser projects | [`HARNESS_BROWSER`](harness.md#the-browser), `chromium`, `firefox` or `webkit` | renamed |
| `connectOverCDP` | [`HARNESS_CDP`](harness.md#the-browser) | renamed |
| `video` | [`video`](evidence.md#video) in the harness config | same |
| the trace viewer | `trace.md`, the tree and the screenshot in each failing test's [folder](evidence.md) | by design: a trace a person or an agent reads as text |
| `storageState`, `test.step` | | not yet |
| `expect.poll` | Vitest's `expect.poll` | same |

## From e2e

| e2e | Here | Status |
| --- | --- | --- |
| `test`, `expect` from `e2e` | Vitest's | renamed |
| `screen.getByRole(role, name)` | `screen.getByRole(role, {name})` | renamed |
| `.tap()` | `.press()` | renamed |
| `app.open` | `device.open` | renamed |
| `app.restart`, `app.clearState` | `device.restart`, `device.clearState` | renamed |
| the `device` fixture | `device` from `expo-vitest/device` | renamed |
| `requires` | `device.can`, `requires`, `onlyOn` and `skipOn` | same |
| `targets` | `deviceConfig({platforms})` | renamed |
| `e2e.config.ts` | `harness.config.ts` | renamed |
| `--target ios` | `--project device:ios` | renamed |
| `.e2e/` | `.harness/` | renamed |
| reporters | Vitest's, and [`expo-vitest/reporter`](ci.md#the-summary-and-the-pull-request-comment) | renamed |
| `video` | [`video`](evidence.md#video) | same |
| `agent.*`, `cache` | `expo-vitest/agent`, `HARNESS_CACHE` | not yet: [the agent](https://github.com/kat-tax/expo-vitest/blob/master/plan/phase-5-agent.md) |

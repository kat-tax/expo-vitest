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
| `element(by.id('save'))` | `screen.getByTestId('save')` | renamed |
| `by.label('Save')` | `screen.getByLabelText('Save')` | renamed |
| `by.text('Save')` | `screen.getByText('Save')` | renamed |
| `by.traits(['button'])` | `screen.getByRole('button', {name})` | renamed |
| `by.type('RCTTextView')` | a role, a label or a test id | by design: a native class name differs on every platform |
| `.atIndex(2)` | `.nth(2)` | renamed |
| `.tap()` | `.press()` | renamed |
| `.longPress()` | `.longPress()` | same |
| `.multiTap(2)` | | not yet |
| `.typeText('Ada')` | `.type('Ada')` | same |
| `.replaceText('Ada')` | `.fill('Ada')` | renamed |
| `.clearText()` | `.clear()` | renamed |
| `.scroll(200, 'down')`, `.swipe('up')` | `.swipe('up')` | renamed |
| `.scrollTo('bottom')` | `.scrollIntoView()` on what is at the bottom | renamed |
| `.pinch()`, `.setColumnToValue()` | | not yet |
| `.getAttributes()` | `.node()` | renamed |
| `expect(el).toBeVisible()` | `await expect(locator).toBeVisible()` | same |
| `expect(el).toExist()`, `.not.toExist()` | `toBeAttached()`, `toBeDetached()` | renamed |
| `toHaveText`, `toHaveValue` | `toHaveText`, `toHaveValue` | same |
| `toHaveLabel` | `toHaveAccessibleName` | renamed |
| `toHaveToggleValue(true)` | `toBeChecked()` | renamed |
| `waitFor(el).toBeVisible().withTimeout(ms)` | `await expect(locator).toBeVisible({timeout: ms})` | renamed |
| `device.launchApp({newInstance: true})` | `device.restart()` | renamed |
| `launchApp({launchArgs, permissions})` | `launchArguments` and `permissions` in the [harness config](configuration.md#harnessconfigts), applied to each restart | renamed |
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
| `device.setStatusBar(...)` | `statusBar: 'fixed'` in the harness config, the default | by design: one status bar for every screenshot, set for the run |
| `device.disableSynchronization()` | | by design: each step waits for the screen to [hold still](device-tests.md#waiting-for-the-screen), which needs no app-side sync to turn off |
| `device.shake()` | | not yet |

## From Maestro

A flow is a test file, and each command a line of it.

| Maestro | Here | Status |
| --- | --- | --- |
| `launchApp` | `device.open('/')`, or `device.restart()` for a fresh launch | renamed |
| `launchApp: {clearState: true}` | `device.clearState()` | renamed |
| `tapOn: Save` | `screen.getByText('Save').press()` | renamed |
| `tapOn: {id: save}` | `screen.getByTestId('save').press()` | renamed |
| `tapOn: {point: 50%,50%}` | | by design: a test names what it presses, so it reads the same on every screen size |
| `longPressOn` | `.longPress()` | renamed |
| `doubleTapOn` | | not yet |
| `inputText: Ada` | `.fill('Ada')` on the field, or `device.type('Ada')` where the focus is | renamed |
| `eraseText` | `.clear()` | renamed |
| `hideKeyboard` | `device.dismissKeyboard()` | renamed |
| `pressKey: Enter` | `locator.key('Enter')`, or `device.key('Enter')` | renamed |
| `back` | `device.back()` | renamed |
| `scroll`, `swipe` | `.swipe('up')` | renamed |
| `scrollUntilVisible` | `.scrollIntoView()` | renamed |
| `assertVisible`, `assertNotVisible` | `toBeVisible()`, `toBeHidden()` | renamed |
| `assertTrue` | `expect(...)` | renamed |
| `extendedWaitUntil` | `toBeVisible({timeout})` | renamed |
| `waitForAnimationToEnd` | each step's wait for the screen to [hold still](device-tests.md#waiting-for-the-screen) | by design: every step does it |
| `openLink` | `device.openLink(url)` | same |
| `runFlow` | a function | by design |
| `repeat`, `retry` | a loop, and Vitest's `retry` | by design |
| `takeScreenshot` | `device.screenshot(name)` | renamed |
| `startRecording`, `stopRecording` | `device.recordVideo()`, `device.saveVideo(file)`, or [`video`](evidence.md#video) for every test | renamed |
| `setLocation`, `setOrientation`, `setAirplaneMode` | `device.setLocation({latitude, longitude})`, `device.setOrientation`, `device.setAirplaneMode` | same |
| `copyTextFrom`, `pasteText` | `device.clipboard()`, `device.setClipboard(text)` | renamed |
| `clearKeychain`, `addMedia`, `travel`, `killApp` | | not yet |
| `assertWithAI`, `extractTextWithAI` | `agent.assert`, `agent.extract` | not yet: [the agent](https://github.com/kat-tax/expo-vitest/blob/master/plan/phase-5-agent.md) |
| `assertDarkMode` | `device.setAppearance('dark')`, then assert on a themed control | by design |

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

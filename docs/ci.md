# CI

[Docs home](README.md) · [Device tests](device-tests.md) · [Evidence](evidence.md)

Component tests need Node and nothing else, so any job runs them. Device
tests need what each platform's tests drive: a browser on web, an emulator or
a simulator and agent-device for a phone, a built app on Windows. Give each
platform a job of its own: the runners differ, and each job's evidence is its
own.

## What each platform needs

| Platform | Runner | Before the tests |
| --- | --- | --- |
| web | Linux | `npx playwright-core install --with-deps chromium`, or `firefox` or `webkit` for [`HARNESS_BROWSER`](harness.md#the-browser). The harness config's [command](configuration.md#the-command) serves the app. |
| android | Linux with KVM | `agent-device`, an emulator booted, and the app built and installed. |
| ios | macOS | `agent-device`, a simulator booted on a runtime the image has, and a simulator build installed. |
| windows | Windows | The app built, at the path the harness config's `target` names, and `HARNESS_FORCE=1`, since no one is at the desk. |

`--project device:<platform>` runs one platform's tests. In CI a platform the
job cannot drive fails its tests with `DRIVER_UNAVAILABLE` rather than
skipping them, and the command does not reuse a server already running, which
may be serving some other build.

Every job keeps `.harness/` whatever the tests did, so a failure's
[evidence](evidence.md) is there to download: the screenshot, the tree, the
trace, a recording where [video](evidence.md#video) is on, and the summary.

## GitHub Actions

One workflow, a job per platform:

```yaml
# .github/workflows/device-tests.yml
name: device tests
on: [pull_request]
permissions:
  contents: read
  pull-requests: write

jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24, cache: npm}
      - run: npm ci
      - run: npx playwright-core install --with-deps chromium
      - run: npx vitest run --config vitest.config.device.mts --project device:web
        env: {GITHUB_TOKEN: '${{ github.token }}'}
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with: {name: harness-web, path: .harness, include-hidden-files: true}

  ios:
    runs-on: macos-26
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24, cache: npm}
      - run: npm ci && npm install --global agent-device
      - uses: actions/cache@v6
        with:
          path: ~/.agent-device
          key: agent-device-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - run: npx expo prebuild --platform ios
      - name: Build for the simulator
        run: |
          xcodebuild -workspace ios/MyApp.xcworkspace -scheme MyApp \
            -configuration Release -sdk iphonesimulator \
            -destination 'generic/platform=iOS Simulator' -derivedDataPath build
      - name: Boot a simulator on a pinned runtime, and install the app
        run: |
          UDID=$(xcrun simctl create ci "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-26-5)
          xcrun simctl bootstatus "$UDID" -b
          xcrun simctl install "$UDID" build/Build/Products/Release-iphonesimulator/MyApp.app
      - run: npx vitest run --config vitest.config.device.mts --project device:ios
        env: {HARNESS_TARGET: ci, GITHUB_TOKEN: '${{ github.token }}'}
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with: {name: harness-ios, path: .harness, include-hidden-files: true}

  android:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24, cache: npm}
      - uses: actions/setup-java@v6
        with: {distribution: temurin, java-version: 17}
      - run: npm ci && npm install --global agent-device
      - name: Enable KVM
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm
      - run: npx expo prebuild --platform android && cd android && ./gradlew :app:assembleRelease
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 36
          arch: x86_64
          target: google_apis
          profile: pixel_7
          avd-name: ci
          emulator-options: -no-window -gpu swiftshader_indirect -no-snapshot -noaudio -no-boot-anim
          disable-animations: true
          script: |
            adb install -r android/app/build/outputs/apk/release/app-release.apk
            npx vitest run --config vitest.config.device.mts --project device:android
        env: {HARNESS_TARGET: ci, GITHUB_TOKEN: '${{ github.token }}'}
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with: {name: harness-android, path: .harness, include-hidden-files: true}

  windows-build:
    runs-on: windows-2022
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24, cache: npm}
      - run: npm ci
      - run: npx react-native run-windows --release --no-launch --no-deploy
      - uses: actions/upload-artifact@v7
        with: {name: windows-release, path: windows/x64/Release}

  windows:
    needs: windows-build
    runs-on: windows-2022
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: {node-version: 24, cache: npm}
      - run: npm ci
      - uses: actions/download-artifact@v8
        with: {name: windows-release, path: windows/x64/Release}
      - run: Set-DisplayResolution -Width 1920 -Height 1080 -Force
        shell: pwsh
      - run: npx vitest run --config vitest.config.device.mts --project device:windows
        env: {HARNESS_FORCE: '1', GITHUB_TOKEN: '${{ github.token }}'}
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with: {name: harness-windows, path: .harness, include-hidden-files: true}
```

What each job keeps in mind:

- **`include-hidden-files: true`** on each upload. The action leaves out
  every file whose path has a folder starting with a dot, and everything in
  `.harness/` does.
- **iOS** pins the simulator's runtime by name and creates its own simulator,
  `ci`, since the image's default runtime and devices change from one image
  to the next. Pick a runtime the image lists, and keep the name the tests
  run on in `HARNESS_TARGET`, or `app.ios.device`. A project that keeps its
  `ios/` folder skips `expo prebuild`.
- **Android** installs and tests in one `script`, since the action stops
  the emulator when its step ends, and each line of the script runs in a
  shell of its own. Expo's templates sign a release build with the debug
  key, so the APK installs as it is.
- **Windows** takes the app from a build job's artifact: a
  react-native-windows build needs Visual Studio 2022's C++ desktop and UWP
  workloads and the Windows SDK, which `windows-2022` has, and takes long
  enough to be a job of its own. `HARNESS_FORCE` lets the harness send
  input on a desk [no one is using](device-tests.md#running),
  which on a runner is always so. The harness config's `app.windows.target`
  names the exe under `windows/x64/Release`. A runner's screen is 1024x768,
  smaller than most app windows, and the harness will not press a part of a
  window off the screen, so the job sets a larger one first.
- **Web** needs nothing else: the harness config's command starts the dev
  server on the run's port, and stops it after.

## The summary and the pull request comment

Two reporters, from `expo-vitest/reporter`, write a run's summary: its counts,
each failing test with its error and links to its evidence, the flaky tests,
and every test folded away.

```ts
// vitest.config.device.mts
import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest';
import {github, summary} from 'expo-vitest/reporter';

export default defineConfig(deviceConfig({platforms: ['web', 'android'], reporters: ['default', summary(), github()]}));
```

- **`summary()`** writes `.harness/summary.md` after every run, its links
  relative to the file so they open in an editor. `summary({file})` writes it
  elsewhere.
- **`github()`** does nothing outside GitHub Actions. In a job it adds the
  summary to the job's page, its links pointing at the run's artifacts, and
  on a pull request it posts it as a comment, one to each job, which a rerun
  updates rather than adding to. `github({key})` tells apart the comments of
  a matrix's jobs, as `key: matrix.platform` would.
- The comment needs the job's token with `pull-requests: write`: the
  workflow's `permissions`, and `GITHUB_TOKEN` in the step's `env`. A pull
  request from a fork gets a token that can only read, so its comment is not
  posted, the log says why, and the job's page still has the summary.
- A comment holds at most 65,536 characters and a job's page 1 MiB. A
  summary longer than that folds away first every test, then the flaky ones,
  then the failures past what fits, and says what it left out.
- A reporter named on the command line replaces the config's, so keep these
  in `reporters`, with any others the run wants.

Neither reporter fails a run: what goes wrong in one is a line in the log.

## Caching

Two caches save a job's minutes: Playwright's browsers, and agent-device's
runner, which it builds for a device the first time it drives one.

```yaml
- uses: actions/cache@v6
  id: browsers
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
- run: npx playwright-core install --with-deps chromium
  if: steps.browsers.outputs.cache-hit != 'true'
# A cache keeps the browser, not the system packages it needs.
- run: npx playwright-core install-deps chromium
  if: steps.browsers.outputs.cache-hit == 'true'

- uses: actions/cache@v6
  with:
    path: ~/.agent-device
    key: agent-device-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
```

Playwright keeps its browsers in `~/.cache/ms-playwright` on Linux,
`~/Library/Caches/ms-playwright` on macOS and `%LOCALAPPDATA%\ms-playwright`
on Windows. A key on the lockfile changes when `playwright-core` does, which
is when it wants another build of each browser, and agent-device's cache
with it; where a job pins agent-device's version, key that cache on the
version instead.

## EAS Workflows

EAS builds the app once for a fingerprint, and repacks that build for a pull
request that changes no native code. The test jobs then run on EAS's own
machines, the Android one on a runner with nested virtualization for the
emulator:

```yaml
# .eas/workflows/device-tests.yml
name: device tests
defaults:
  tools:
    node: '24'
on:
  pull_request:
    branches: ['*']

jobs:
  fingerprint:
    type: fingerprint
    environment: preview

  android_get_build:
    needs: [fingerprint]
    type: get-build
    params:
      platform: android
      profile: preview
      fingerprint_hash: ${{ needs.fingerprint.outputs.android_fingerprint_hash }}
      wait_for_in_progress: true
  android_repack:
    needs: [android_get_build]
    if: ${{ needs.android_get_build.outputs.build_id }}
    type: repack
    params:
      build_id: ${{ needs.android_get_build.outputs.build_id }}
      profile: preview
  android_build:
    needs: [android_get_build]
    if: ${{ !needs.android_get_build.outputs.build_id }}
    type: build
    params:
      platform: android
      profile: preview

  android_tests:
    after: [android_repack, android_build]
    if: ${{ after.android_repack.status == 'success' || after.android_build.status == 'success' }}
    runs_on: linux-medium-nested-virtualization
    env:
      BUILD_ID: ${{ after.android_repack.outputs.build_id || after.android_build.outputs.build_id }}
      HARNESS_TARGET: ci
    steps:
      - uses: eas/checkout
      - uses: eas/install_node_modules
      - run: npm install --global agent-device
      - uses: eas/download_build
        id: download_build
        with:
          build_id: ${{ env.BUILD_ID }}
          extensions: [apk]
      - name: Boot an emulator
        run: |
          SDK="${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}"
          TOOLS="$SDK/cmdline-tools/latest/bin"
          IMAGE='system-images;android-35;google_apis;x86_64'
          yes | "$TOOLS/sdkmanager" --licenses
          yes | "$TOOLS/sdkmanager" --install platform-tools emulator "$IMAGE"
          echo no | "$TOOLS/avdmanager" create avd --force --name ci --package "$IMAGE" --device pixel_6
          agent-device boot --platform android --device ci --headless
      - run: adb install -r "${{ steps.download_build.outputs.artifact_path }}"
      - run: npx vitest run --config vitest.config.device.mts --project device:android
      - uses: eas/upload_artifact
        if: ${{ always() }}
        with:
          type: other
          name: harness-android
          path: .harness/**/*

  ios_get_build:
    needs: [fingerprint]
    type: get-build
    params:
      platform: ios
      profile: preview-simulator
      simulator: true
      fingerprint_hash: ${{ needs.fingerprint.outputs.ios_fingerprint_hash }}
      wait_for_in_progress: true
  ios_repack:
    needs: [ios_get_build]
    if: ${{ needs.ios_get_build.outputs.build_id }}
    type: repack
    params:
      build_id: ${{ needs.ios_get_build.outputs.build_id }}
      profile: preview-simulator
  ios_build:
    needs: [ios_get_build]
    if: ${{ !needs.ios_get_build.outputs.build_id }}
    type: build
    params:
      platform: ios
      profile: preview-simulator

  ios_tests:
    after: [ios_repack, ios_build]
    if: ${{ after.ios_repack.status == 'success' || after.ios_build.status == 'success' }}
    runs_on: macos-medium
    env:
      BUILD_ID: ${{ after.ios_repack.outputs.build_id || after.ios_build.outputs.build_id }}
      HARNESS_TARGET: iPhone 17
    steps:
      - uses: eas/checkout
      - uses: eas/install_node_modules
      - run: npm install --global agent-device
      - uses: eas/download_build
        id: download_build
        with:
          build_id: ${{ env.BUILD_ID }}
          extensions: [app]
      - name: Boot a simulator, and install the app
        run: |
          agent-device boot --platform ios --device "iPhone 17"
          xcrun simctl install booted "${{ steps.download_build.outputs.artifact_path }}"
      - run: npx vitest run --config vitest.config.device.mts --project device:ios
      - uses: eas/upload_artifact
        if: ${{ always() }}
        with:
          type: other
          name: harness-ios
          path: .harness/**/*
```

`preview` and `preview-simulator` are build profiles in `eas.json`, the
second with `"ios": {"simulator": true}`. The shape is agent-device's own EAS
template's, with this package's tests in place of its agent.

## Bitrise

```yaml
# bitrise.yml
format_version: '25'
default_step_lib_source: https://github.com/bitrise-io/bitrise-steplib.git

tools:
  nodejs: 24:installed

pipelines:
  device-tests:
    triggers:
      pull_request:
        - target_branch: main
    workflows:
      device-ios: {}
      device-android: {}

workflows:
  device-ios:
    meta:
      bitrise.io:
        stack: osx-xcode-26.6.x
    steps:
      - git-clone@8: {}
      - script@1:
          title: Install
          inputs:
            - content: |-
                set -euo pipefail
                npm ci
                npm install --global agent-device
                npx expo prebuild --platform ios
      - xcode-build-for-simulator@3:
          inputs:
            - project_path: ios/MyApp.xcworkspace
            - scheme: MyApp
            - configuration: Release
      - xcode-start-simulator@0:
          inputs:
            - destination: platform=iOS Simulator,name=iPhone 17,OS=26.5
      - script@1:
          title: Device tests
          inputs:
            - content: |-
                set -euo pipefail
                xcrun simctl install booted "$BITRISE_APP_DIR_PATH"
                HARNESS_TARGET='iPhone 17' npx vitest run --config vitest.config.device.mts --project device:ios \
                  --reporter=default --reporter=junit --outputFile.junit=.harness/junit.xml
      - script@1:
          title: Keep the evidence
          is_always_run: true
          inputs:
            - content: if [ -d .harness ]; then (cd .harness && zip -qr "$BITRISE_DEPLOY_DIR/harness-ios.zip" .); fi
      - custom-test-results-export@1:
          inputs:
            - test_name: device-ios
            - base_path: $BITRISE_SOURCE_DIR/.harness/junit.xml
            - search_pattern: '*'
      - deploy-to-bitrise-io@2: {}

  device-android:
    meta:
      bitrise.io:
        stack: ubuntu-noble-24.04-bitrise-2025-android
    steps:
      - git-clone@8: {}
      - script@1:
          title: Install
          inputs:
            - content: |-
                set -euo pipefail
                npm ci
                npm install --global agent-device
                npx expo prebuild --platform android
      - avd-manager@2:
          inputs:
            - api_level: 35
            - tag: google_apis
            - abi: x86_64
      - android-build@1:
          inputs:
            - project_location: $BITRISE_SOURCE_DIR/android
            - module: app
            - variant: release
            - build_type: apk
      - wait-for-android-emulator@1: {}
      - script@1:
          title: Device tests
          inputs:
            - content: |-
                set -euo pipefail
                adb install -r "$BITRISE_APK_PATH"
                npx vitest run --config vitest.config.device.mts --project device:android \
                  --reporter=default --reporter=junit --outputFile.junit=.harness/junit.xml
      - script@1:
          title: Keep the evidence
          is_always_run: true
          inputs:
            - content: if [ -d .harness ]; then (cd .harness && zip -qr "$BITRISE_DEPLOY_DIR/harness-android.zip" .); fi
      - custom-test-results-export@1:
          inputs:
            - test_name: device-android
            - base_path: $BITRISE_SOURCE_DIR/.harness/junit.xml
            - search_pattern: '*'
      - deploy-to-bitrise-io@2: {}
```

The emulator starts before the Gradle build, so it boots while the APK
compiles. Vitest's JUnit report puts the tests in Bitrise's test reports;
naming reporters on the command line replaces the config's, so the
[summary](#the-summary-and-the-pull-request-comment) goes from there too
unless it is named as well.

## Codemagic

```yaml
# codemagic.yaml
workflows:
  device-ios:
    name: device tests, iOS
    instance_type: mac_mini_m2
    max_build_duration: 60
    environment:
      node: 24
      xcode: latest
    triggering:
      events: [pull_request]
    scripts:
      - name: Install
        script: npm ci && npm install --global agent-device && npx expo prebuild --platform ios
      - name: Build for the simulator
        script: |
          xcodebuild -workspace ios/MyApp.xcworkspace -scheme MyApp \
            -configuration Release -sdk iphonesimulator \
            -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build
      - name: Boot a simulator on a pinned runtime, and install the app
        script: |
          UDID=$(xcrun simctl create ci "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-26-5)
          xcrun simctl bootstatus "$UDID" -b
          xcrun simctl install "$UDID" ios/build/Build/Products/Release-iphonesimulator/MyApp.app
      - name: Device tests
        script: |
          HARNESS_TARGET=ci npx vitest run --config vitest.config.device.mts --project device:ios \
            --reporter=default --reporter=junit --outputFile.junit=.harness/junit.xml
        test_report: .harness/junit.xml
    artifacts:
      - .harness/**

  device-android:
    name: device tests, Android
    instance_type: linux_x2
    max_build_duration: 60
    environment:
      node: 24
    triggering:
      events: [pull_request]
    scripts:
      - name: Install
        script: npm ci && npm install --global agent-device && npx expo prebuild --platform android
      - name: Build the APK
        script: cd android && ./gradlew :app:assembleRelease
      - name: Boot the emulator, and install the app
        script: |
          emulator -avd emulator-35 -no-window -no-audio -no-boot-anim > /dev/null 2>&1 &
          adb wait-for-device
          until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done
          adb install -r android/app/build/outputs/apk/release/app-release.apk
      - name: Device tests
        script: |
          HARNESS_TARGET=emulator-35 npx vitest run --config vitest.config.device.mts --project device:android \
            --reporter=default --reporter=junit --outputFile.junit=.harness/junit.xml
        test_report: .harness/junit.xml
    artifacts:
      - .harness/**
```

Codemagic's Linux image has three emulators made already, `emulator`,
`emulator-35` and `emulator-36`, and a Linux instance needs billing on. A
`test_report` puts the JUnit results in the build's Tests tab.

## What has been run

This package's own CI runs the web job's steps, against its fixture: the
packed package installed in an app, its device tests on a Chromium the job
installs. The other jobs follow each service's documented setup, and
agent-device's own EAS template, and have not been run from this page. Pin
each image, stack and simulator runtime to one your account lists.

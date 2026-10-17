/**
 * What a Vitest config and a harness config call, as `expo-vitest/config`.
 * The tests import from `expo-vitest`, as Vitest keeps `vitest` and
 * `vitest/config` apart.
 *
 * - `expoProjects()` makes one Vitest project for iOS, Android, web and
 *   Windows, and a test file's name decides which of them run it.
 * - `deviceConfig()` makes the config of the device tests, which drive a
 *   running app, and `defineHarness()` types `harness.config.ts`, which
 *   says where each platform's app is.
 * - `nodeProject()` is a plain Node project beside them.
 */
export type {DeviceConfigOptions, ExpoProjectsOptions, Platform} from './projects.ts';
export {deviceConfig, expoProjects, nodeProject} from './projects.ts';
export type {AppConfig, CommandConfig, HarnessConfig, Permission} from './device/config.ts';
export type {HostedDevice} from './harness/lib/types.ts';
export {defineHarness} from './device/config.ts';
export {forbidModules} from './forbid-modules.ts';
export {EXPO_WEB_PACKAGES, metroCompat} from './metro-compat.ts';
export {TEST_TIMEOUT} from './timeout.ts';
export {windowsResolution} from './windows-resolution.ts';

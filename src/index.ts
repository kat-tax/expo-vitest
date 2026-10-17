/**
 * The tests' API, as `expo-vitest`: a device test drives a running app on
 * iOS, Android, web or Windows, and reads its accessibility tree.
 *
 *   import {device, screen} from 'expo-vitest';
 *
 *   await device.open('/settings');
 *   await screen.getByRole('button', {name: 'Save'}).press();
 *   await expect(screen.getByText('Saved')).toBeVisible();
 *
 * A Vitest config and a harness config import from `expo-vitest/config`,
 * as Vitest keeps `vitest` and `vitest/config` apart.
 */
export {by, configFromEnvironment, device, element, HarnessError, isHarnessError, Journal, Locator, onlyOn, reactNodeOf, render, requires, screen, skipOn, step, within, withComponents} from './device/index.ts';
export type {Attribute, Capability, DeviceConfig, DialogAnswer, ExpectOptions, FindOptions, HarnessCode, Kind, LocatorState, OptionChoice, Orientation, Queries, QueryOptions, ReactNode, ReactTree, Rendered, RenderOptions, RoleQueryOptions, Selector, Snapshot, SnapshotNode, Step, StepEvent, TextMatch, TextMatchOptions, TextQueryOptions, TreeDigest, WaitOptions, WebCookie, WebRequest, WebRoute} from './device/index.ts';

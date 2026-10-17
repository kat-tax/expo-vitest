/**
 * What a test can ask of the device it runs on, as data: each platform's
 * steps and controls, less what its driver lacks, and less what this device
 * lacks, as a phone that does not fold. A later agent's tools and an MCP
 * catalog can be read off the same table.
 */
import {CHANGES_SCREEN, LACKS} from '../harness/lib/controls.ts';
import type {AppOptions, ControlName, DeviceFacts, Platform} from '../harness/lib/types.ts';
import type {BrowserName} from '../harness/platforms/web-browsers.ts';
import {noClipboard, noPinch} from '../harness/platforms/web-browsers.ts';

export type Capability = 'open' | 'press' | 'fill' | 'type' | 'screenshot' | 'key' | 'longPress' | 'hover' | 'focus' | 'scrollIntoView' | 'swipe' | 'drag' | 'pinch' | 'video' | 'web' | 'screenshot:element' | 'statusBar' | ControlName;

/**
 * The steps each platform's driver has, whatever the device, then what its
 * pictures can do: one of an element alone, and a status bar made the same
 * in every one, which a device's has.
 */
export const ACTIONS: Record<Platform, Capability[]> = {
  web: ['open', 'press', 'fill', 'type', 'screenshot', 'key', 'longPress', 'hover', 'focus', 'scrollIntoView', 'swipe', 'drag', 'pinch', 'video', 'web', 'screenshot:element'],
  // Windows has no screen recorder without a dependency.
  windows: ['open', 'press', 'fill', 'type', 'screenshot', 'key', 'longPress', 'hover', 'focus', 'scrollIntoView', 'swipe', 'drag', 'screenshot:element'],
  android: ['open', 'press', 'fill', 'type', 'screenshot', 'longPress', 'focus', 'scrollIntoView', 'swipe', 'drag', 'pinch', 'video', 'screenshot:element', 'statusBar'],
  ios: ['open', 'press', 'fill', 'type', 'screenshot', 'longPress', 'focus', 'scrollIntoView', 'swipe', 'drag', 'pinch', 'video', 'screenshot:element', 'statusBar'],
};

const CONTROLS = Object.keys(CHANGES_SCREEN) as ControlName[];

/** Every capability, steps first, then the controls, each once. */
export const CAPABILITIES: Capability[] = [...new Set([...ACTIONS.web, ...ACTIONS.windows, ...ACTIONS.android, ...ACTIONS.ios, ...CONTROLS])];

/** What decides a capability beyond the platform: the device the driver found, the app, and the browser. */
export interface Circumstances {
  device?: DeviceFacts;
  app?: AppOptions;
  /** Web: the browser the run drives. */
  browser?: BrowserName;
  /** A unit test, whose device is the tree the test rendered. */
  unit?: boolean;
}

/** The steps a unit test's render has: what a person does to a component, with no screen drawn and no device to control. */
export const UNIT_ACTIONS: Capability[] = ['open', 'press', 'fill', 'type', 'key', 'longPress', 'hover', 'focus', 'scrollIntoView'];

const major = (version?: string): number => Number.parseInt(version ?? '', 10);

/** Why a capability is not there for this platform and device, or null where it is. */
export function absentBecause(capability: Capability, platform: Platform, circumstances: Circumstances = {}): string | null {
  if (circumstances.unit) {
    if (!UNIT_ACTIONS.includes(capability)) return `a unit test has no ${capability}, which a device test has on the running app`;
    return capability === 'hover' && platform !== 'web' ? `a unit test on ${platform} has no pointer to move` : null;
  }
  const control = (CONTROLS as Capability[]).includes(capability);
  if (!control && !ACTIONS[platform].includes(capability)) return `the ${platform} harness has no ${capability}`;
  const lacks = control ? LACKS[platform][capability as ControlName] : undefined;
  if (lacks) return lacks;
  const {device = {}, app = {}, browser = 'chromium'} = circumstances;
  if (capability === 'fold' && !/fold|flip|duo/i.test(device.name ?? '')) return `${device.name ?? 'the device'} does not fold`;
  if (capability === 'setAirplaneMode' && platform === 'android' && major(device.osVersion) < 11) return `airplane mode needs Android 11 or later, and this is Android ${device.osVersion}`;
  if ((capability === 'setBiometrics' || capability === 'enrollBiometrics') && device.kind === 'device') return `a physical ${platform} device answers its own biometric prompts`;
  if (capability === 'statusBar' && platform === 'ios' && device.kind === 'device') return "agent-device makes a simulator's status bar the same in every picture, not a physical iPhone's";
  if (capability === 'installApp' && platform === 'windows' && !/\.msix(bundle)?$/i.test(app.appPath ?? '')) return 'only an .msix is installed on Windows, and app.windows.appPath names none';
  if (capability === 'clearState' && platform === 'windows' && !app.stateDir) return 'app.windows.stateDir names no folder to delete';
  if ((capability === 'clipboard' || capability === 'setClipboard') && platform === 'web') return noClipboard(browser);
  if (capability === 'pinch' && platform === 'web') return noPinch(browser);
  return null;
}

/** Every capability there for this platform and device. */
export function capabilitiesOf(platform: Platform, circumstances: Circumstances = {}): ReadonlySet<Capability> {
  return new Set(CAPABILITIES.filter(capability => absentBecause(capability, platform, circumstances) === null));
}

/** The sentence a test skipped for what the device lacks says, or null where it lacks none of them. */
export function cannotSentence(needed: Capability[], platform: Platform, circumstances: Circumstances = {}): string | null {
  const missing = needed.flatMap(capability => {
    const why = absentBecause(capability, platform, circumstances);
    return why ? [`${capability}, since ${why}`] : [];
  });
  return missing.length ? `${platform} cannot ${missing.join('; nor ')}` : null;
}

const FACTS = Symbol.for('expo-vitest.device-facts');

/** Keeps what the warm-up found of the device, for the worker's device to read before its driver is open. */
export function rememberFacts(facts: DeviceFacts, store: object = globalThis): void {
  (store as {[FACTS]?: DeviceFacts})[FACTS] = facts;
}

/** What the warm-up found of the device, if it found anything. */
export function knownFacts(store: object = globalThis): DeviceFacts | undefined {
  return (store as {[FACTS]?: DeviceFacts})[FACTS];
}

/**
 * The app's life as data: which controls change the screen, how the journal
 * names each, and the sentence a platform answers with where it has no
 * counterpart. The drivers do the controls; what they say about them is
 * here, so it reads the same on every platform.
 */
import type {ControlName, ControlRequest, ControlResult, Platform} from './types.ts';
import {elsewhere} from './types.ts';

/** Whether a control changes what is on screen, so the step waits for the screen to hold still after it. */
export const CHANGES_SCREEN: Record<ControlName, boolean> = {
  restart: true,
  clearState: true,
  back: true,
  home: true,
  installApp: false,
  openLink: true,
  foregroundApp: false,
};

/** Why a platform has no counterpart for a control at all. */
export const LACKS: Record<Platform, Partial<Record<ControlName, string>>> = {
  web: {
    home: 'a browser has no home screen',
    installApp: 'nothing is installed in a browser',
  },
  windows: {
    back: "react-native-windows has no system back; press the app's own back control",
    home: 'Windows has no home screen to send an app to',
  },
  android: {},
  ios: {},
};

/** Why a platform cannot do a control it has, for this request or this app. */
export const CANNOT = {
  webLink: 'a browser here opens only http and https links',
  windowsState: 'it deletes the folder app.windows.stateDir names, and the harness config names none',
  windowsInstall: 'only an .msix is installed on Windows',
} as const;

/** A control as the journal names it. */
export function describeControl(request: ControlRequest): string {
  if (request.name === 'installApp') return `installApp${request.reinstall ? ', again,' : ''}${request.path ? ` from ${request.path}` : ''}`;
  if (request.name === 'openLink') return `openLink ${request.url}`;
  return request.name;
}

/** The answer of a platform with no counterpart for a control, or null where it has one. */
export function lacking(request: ControlRequest, platform: Platform): ControlResult | null {
  const why = LACKS[platform][request.name];
  return why ? elsewhere(request.name, platform, why) : null;
}

/** The answer of a platform that has a control but cannot do it here, and why. */
export function cannot(request: ControlRequest, platform: Platform, why: string): ControlResult {
  return elsewhere(request.name, platform, why);
}

/** The failure of a control that needs to know which app it is for. */
export function needsApp(name: ControlName, platform: Platform, key: 'bundleId' | 'appPath' | 'target'): string {
  const what = key === 'target' ? `app.${platform}.target, the app's exe,` : `app.${platform}.${key}`;
  return `${name} on ${platform} needs ${what} in the harness config`;
}

/** The permissions a harness config names, which are agent-device's, as Chromium calls the ones it has. */
const WEB_PERMISSIONS: Record<string, string> = {
  camera: 'camera',
  microphone: 'microphone',
  notifications: 'notifications',
  location: 'geolocation',
  'location-always': 'geolocation',
  motion: 'accelerometer',
};

/** What a browser context is granted: each permission set to `grant` that Chromium has, once. */
export function webGrants(permissions: Record<string, 'grant' | 'deny' | 'reset'> = {}): string[] {
  const granted = Object.entries(permissions).flatMap(([name, state]) => (state === 'grant' && WEB_PERMISSIONS[name] ? [WEB_PERMISSIONS[name]] : []));
  return [...new Set(granted)];
}

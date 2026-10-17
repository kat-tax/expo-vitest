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
  stopApp: true,
  resumeApp: true,
  activateApp: true,
  back: true,
  home: true,
  installApp: false,
  openLink: true,
  foregroundApp: false,
  setAppearance: true,
  setOrientation: true,
  setNetwork: false,
  setAirplaneMode: false,
  setPermission: false,
  setLocation: false,
  clearLocation: false,
  setBiometrics: false,
  enrollBiometrics: false,
  fold: true,
  clipboard: false,
  setClipboard: false,
  dismissKeyboard: true,
  alert: true,
};

/** The controls after which a platform shows nothing of the app's to wait for: a Windows app stopped has no window. */
export const NO_SCREEN_AFTER: Partial<Record<Platform, readonly ControlName[]>> = {windows: ['stopApp']};

/** Whether a step waits for the screen to hold still after a control on a platform. */
export function waitsAfter(name: ControlName, platform: Platform): boolean {
  return CHANGES_SCREEN[name] && !(NO_SCREEN_AFTER[platform] ?? []).includes(name);
}

/** Why a platform has no counterpart for a control at all. */
export const LACKS: Record<Platform, Partial<Record<ControlName, string>>> = {
  web: {
    home: 'a browser has no home screen',
    activateApp: 'a browser has no other app to bring up',
    installApp: 'nothing is installed in a browser',
    setAirplaneMode: 'a browser has no airplane mode; setNetwork takes the page offline',
    setBiometrics: 'a browser has no biometric sensor to answer',
    enrollBiometrics: 'a browser has no biometric sensor to enroll',
    fold: 'a browser window does not fold',
  },
  windows: {
    back: "react-native-windows has no system back; press the app's own back control",
    home: 'Windows has no home screen to send an app to',
    activateApp: "the Windows harness reads the windows of the app it drives, and no other's",
    setAppearance: "the app follows the Windows theme, which is the whole machine's",
    setOrientation: 'a desktop window has no orientation',
    setNetwork: "the network is the whole machine's",
    setAirplaneMode: "airplane mode is the whole machine's",
    setPermission: 'a desktop app asks Windows for what it needs, which a test does not answer',
    setLocation: "the location is the whole machine's",
    clearLocation: "the location is the whole machine's",
    setBiometrics: 'Windows Hello is not something a test answers',
    enrollBiometrics: 'Windows Hello is not something a test answers',
    fold: 'a desktop window does not fold',
    dismissKeyboard: 'a desktop has no keyboard on the screen to dismiss',
    alert: 'a WinUI dialog is in the tree: press its button by its label',
  },
  android: {
    enrollBiometrics: "an emulator's fingerprint is enrolled in its own settings",
  },
  ios: {
    setNetwork: "the simulator shares the Mac's network",
    setAirplaneMode: 'the simulator has no airplane mode',
  },
};

/** Why a platform cannot do a control it has, for this request or this app. */
export const CANNOT = {
  webLink: 'a browser here opens only http and https links',
  windowsState: 'it deletes the folder app.windows.stateDir names, and the harness config names none',
  windowsInstall: 'only an .msix is installed on Windows',
  webDeny: 'Chromium has no deny through Playwright; reset clears what was granted',
  webPermission: 'Chromium has no permission of that name',
} as const;

/** The biometric sensors a platform's simulator or emulator has. */
export const SENSORS: Partial<Record<Platform, string[]>> = {ios: ['faceid', 'touchid'], android: ['fingerprint']};

/** Why a platform cannot answer for a sensor, where it has another. */
export function otherSensor(platform: Platform, sensor: string): string | null {
  const sensors = SENSORS[platform];
  return sensors && !sensors.includes(sensor) ? `the ${platform} sensor is ${sensors.join(' or ')}, not ${sensor}` : null;
}

/** A control as the journal names it. What goes on the clipboard is left out, since a trace is kept and shared. */
export function describeControl(request: ControlRequest): string {
  switch (request.name) {
    case 'installApp':
      return `installApp${request.reinstall ? ', again,' : ''}${request.path ? ` from ${request.path}` : ''}`;
    case 'openLink':
      return `openLink ${request.url}`;
    case 'activateApp':
      return `activateApp ${request.id}`;
    case 'setAppearance':
      return `setAppearance ${request.mode}`;
    case 'setOrientation':
      return `setOrientation ${request.orientation}`;
    case 'setNetwork':
      return `setNetwork ${request.online ? 'online' : 'offline'}`;
    case 'setAirplaneMode':
      return `setAirplaneMode ${request.on ? 'on' : 'off'}`;
    case 'setPermission':
      return `setPermission ${request.permission} ${request.state}`;
    case 'setLocation':
      return `setLocation ${request.latitude},${request.longitude}`;
    case 'setBiometrics':
      return `setBiometrics ${request.sensor} ${request.result}`;
    case 'enrollBiometrics':
      return `enrollBiometrics ${request.sensor} ${request.enrolled ? 'enrolled' : 'not enrolled'}`;
    case 'fold':
      return `fold ${request.pose}`;
    case 'setClipboard':
      return `setClipboard, ${request.text.length} characters`;
    case 'alert':
      return `alert ${request.action}`;
    default:
      return request.name;
  }
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

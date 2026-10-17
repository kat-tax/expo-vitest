import {describe, expect, it} from 'vitest';
import {absentBecause, ACTIONS, CAPABILITIES, cannotSentence, capabilitiesOf, knownFacts, rememberFacts} from './capabilities.ts';

const pixel = {name: 'Pixel 9 Pro XL', kind: 'emulator', osVersion: '16'};

describe('the capabilities', () => {
  it('are the steps first, then every control, each once', () => {
    expect(CAPABILITIES.slice(0, ACTIONS.web.length)).toEqual(ACTIONS.web);
    expect(CAPABILITIES).toContain('restart');
    expect(CAPABILITIES).toContain('alert');
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("are a platform's steps, less what its driver has no counterpart for", () => {
    expect(absentBecause('key', 'android')).toBe('the android harness has no key');
    expect(absentBecause('hover', 'ios')).toBe('the ios harness has no hover');
    expect(absentBecause('swipe', 'windows')).toBeNull();
    expect([absentBecause('screenshot:element', 'web'), absentBecause('screenshot:element', 'windows'), absentBecause('screenshot:element', 'ios')]).toEqual([null, null, null]);
    expect(absentBecause('statusBar', 'web')).toBe('the web harness has no statusBar');
    expect(absentBecause('statusBar', 'android')).toBeNull();
    expect(absentBecause('statusBar', 'ios', {device: {kind: 'simulator'}})).toBeNull();
    expect(absentBecause('statusBar', 'ios', {device: {kind: 'device'}})).toBe("agent-device makes a simulator's status bar the same in every picture, not a physical iPhone's");
    expect(absentBecause('screenshot:element', 'android', {unit: true})).toBe('a unit test has no screenshot:element, which a device test has on the running app');
    expect(absentBecause('swipe', 'web')).toBeNull();
    expect(absentBecause('video', 'windows')).toBe('the windows harness has no video');
    expect(absentBecause('web', 'web')).toBeNull();
    expect(absentBecause('web', 'ios')).toBe('the ios harness has no web');
    expect([absentBecause('video', 'web'), absentBecause('video', 'android'), absentBecause('video', 'ios')]).toEqual([null, null, null]);
  });

  it("are a platform's controls, less what it lacks, with the controls' own reason", () => {
    expect(absentBecause('home', 'web')).toBe('a browser has no home screen');
    expect(absentBecause('setNetwork', 'ios')).toBe("the simulator shares the Mac's network");
    expect(absentBecause('setNetwork', 'android')).toBeNull();
  });

  it('on Windows, are every step and control the host takes', () => {
    for (const each of ['longPress', 'hover', 'focus', 'scrollIntoView', 'foregroundApp', 'clipboard', 'setClipboard'] as const) expect(absentBecause(each, 'windows')).toBeNull();
  });

  it('fold only on a device whose name says it folds', () => {
    expect(absentBecause('fold', 'android', {device: pixel})).toBe('Pixel 9 Pro XL does not fold');
    expect(absentBecause('fold', 'android')).toBe('the device does not fold');
    expect(absentBecause('fold', 'android', {device: {name: 'Pixel 9 Pro Fold'}})).toBeNull();
    expect(absentBecause('fold', 'android', {device: {name: 'Galaxy Z Flip6'}})).toBeNull();
    expect(absentBecause('fold', 'ios', {device: {name: 'iPhone Duo'}})).toBeNull();
  });

  it('put Android in airplane mode from 11, and where the version is not known', () => {
    expect(absentBecause('setAirplaneMode', 'android', {device: {osVersion: '10'}})).toBe('airplane mode needs Android 11 or later, and this is Android 10');
    expect(absentBecause('setAirplaneMode', 'android', {device: pixel})).toBeNull();
    expect(absentBecause('setAirplaneMode', 'android')).toBeNull();
  });

  it('answer biometric prompts on a simulator or an emulator only', () => {
    expect(absentBecause('setBiometrics', 'ios', {device: {kind: 'device'}})).toBe('a physical ios device answers its own biometric prompts');
    expect(absentBecause('enrollBiometrics', 'ios', {device: {kind: 'device'}})).toBe('a physical ios device answers its own biometric prompts');
    expect(absentBecause('setBiometrics', 'ios', {device: {kind: 'simulator'}})).toBeNull();
  });

  it('keep the clipboard on web to Chromium', () => {
    expect(absentBecause('clipboard', 'web', {browser: 'webkit'})).toBe('the clipboard is driven in Chromium alone, and this is WebKit');
    expect(absentBecause('setClipboard', 'web', {browser: 'firefox'})).toBe('the clipboard is driven in Chromium alone, and this is Firefox');
    expect(absentBecause('clipboard', 'web', {browser: 'chromium'})).toBeNull();
    expect(absentBecause('clipboard', 'android', {browser: 'webkit'})).toBeNull();
    expect(capabilitiesOf('web', {browser: 'webkit'}).has('open')).toBe(true);
  });

  it('pinch on iOS and Android, and on web in Chromium alone, which takes two fingers at once', () => {
    expect([absentBecause('pinch', 'android'), absentBecause('pinch', 'ios'), absentBecause('pinch', 'web'), absentBecause('pinch', 'web', {browser: 'chromium'})]).toEqual([null, null, null, null]);
    expect(absentBecause('pinch', 'web', {browser: 'firefox'})).toBe('Firefox takes no touch of two fingers from Playwright; Chromium does');
    expect(absentBecause('pinch', 'web', {browser: 'webkit'})).toBe('WebKit takes no touch of two fingers from Playwright; Chromium does');
    expect(absentBecause('pinch', 'windows')).toBe('the windows harness has no pinch');
    expect(absentBecause('pinch', 'ios', {unit: true})).toBe('a unit test has no pinch, which a device test has on the running app');
  });

  it('install and clear an app on Windows only where the harness config says how', () => {
    expect(absentBecause('installApp', 'windows')).toBe('only an .msix is installed on Windows, and app.windows.appPath names none');
    expect(absentBecause('installApp', 'windows', {app: {appPath: 'C:/builds/App.msix'}})).toBeNull();
    expect(absentBecause('installApp', 'windows', {app: {appPath: 'C:/builds/App.MSIXBUNDLE'}})).toBeNull();
    expect(absentBecause('clearState', 'windows')).toBe('app.windows.stateDir names no folder to delete');
    expect(absentBecause('clearState', 'windows', {app: {stateDir: 'C:/state'}})).toBeNull();
    expect(absentBecause('installApp', 'android')).toBeNull();
  });

  it("are gathered for a platform and its device", () => {
    const android = capabilitiesOf('android', {device: pixel});
    expect(android.has('setAirplaneMode')).toBe(true);
    expect(android.has('fold')).toBe(false);
    expect(android.has('key')).toBe(false);
    expect(capabilitiesOf('web').has('clipboard')).toBe(true);
    expect(capabilitiesOf('web').has('home')).toBe(false);
  });

  it('say what a device cannot do in one sentence, or nothing where it can do it all', () => {
    expect(cannotSentence(['fold', 'restart'], 'android', {device: pixel})).toBe('android cannot fold, since Pixel 9 Pro XL does not fold');
    expect(cannotSentence(['home', 'fold'], 'web')).toBe('web cannot home, since a browser has no home screen; nor fold, since a browser window does not fold');
    expect(cannotSentence(['restart', 'back'], 'web')).toBeNull();
    expect(cannotSentence([], 'ios')).toBeNull();
  });
});

describe("what the warm-up found of the device", () => {
  it('is kept on the global object for the worker', () => {
    const store = {};
    expect(knownFacts(store)).toBeUndefined();
    rememberFacts(pixel, store);
    expect(knownFacts(store)).toBe(pixel);
    const before = knownFacts();
    rememberFacts(pixel);
    expect(knownFacts(globalThis)).toBe(pixel);
    rememberFacts(before as typeof pixel);
  });
});

describe('a unit test', () => {
  it('has the steps a render takes, a pointer on web alone, and none of the controls a device has', () => {
    expect([...capabilitiesOf('ios', {unit: true})]).toEqual(['open', 'press', 'fill', 'type', 'key', 'longPress', 'focus', 'scrollIntoView']);
    expect(capabilitiesOf('web', {unit: true}).has('hover')).toBe(true);
    expect(absentBecause('screenshot', 'web', {unit: true})).toBe('a unit test has no screenshot, which a device test has on the running app');
    expect(absentBecause('restart', 'windows', {unit: true})).toBe('a unit test has no restart, which a device test has on the running app');
    expect(absentBecause('hover', 'android', {unit: true})).toBe('a unit test on android has no pointer to move');
  });
});

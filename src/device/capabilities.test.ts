import {describe, expect, it} from 'vitest';
import {absentBecause, ACTIONS, CAPABILITIES, cannotSentence, capabilitiesOf, knownFacts, rememberFacts} from './capabilities.ts';

const pixel = {name: 'Pixel 9 Pro XL', kind: 'emulator', osVersion: '16'};

describe('the capabilities', () => {
  it('are the steps first, then every control, each once', () => {
    expect(CAPABILITIES.slice(0, 12)).toEqual(ACTIONS.web);
    expect(CAPABILITIES).toContain('restart');
    expect(CAPABILITIES).toContain('alert');
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("are a platform's steps, less what its driver has no counterpart for", () => {
    expect(absentBecause('key', 'android')).toBe('the android harness has no key');
    expect(absentBecause('hover', 'ios')).toBe('the ios harness has no hover');
    expect(absentBecause('swipe', 'windows')).toBe('the windows harness has no swipe');
    expect(absentBecause('swipe', 'web')).toBeNull();
    expect(absentBecause('video', 'windows')).toBe('the windows harness has no video');
    expect([absentBecause('video', 'web'), absentBecause('video', 'android'), absentBecause('video', 'ios')]).toEqual([null, null, null]);
  });

  it("are a platform's controls, less what it lacks, with the controls' own reason", () => {
    expect(absentBecause('home', 'web')).toBe('a browser has no home screen');
    expect(absentBecause('setNetwork', 'ios')).toBe("the simulator shares the Mac's network");
    expect(absentBecause('setNetwork', 'android')).toBeNull();
  });

  it('need the Windows host for the steps a script per step cannot take', () => {
    expect(absentBecause('hover', 'windows', {host: false})).toBe('it needs the Windows host, which HARNESS_WINDOWS_HOST=0 turns off');
    expect(absentBecause('clipboard', 'windows', {host: false})).toBe('it needs the Windows host, which HARNESS_WINDOWS_HOST=0 turns off');
    expect(absentBecause('hover', 'windows')).toBeNull();
    expect(absentBecause('press', 'windows', {host: false})).toBeNull();
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

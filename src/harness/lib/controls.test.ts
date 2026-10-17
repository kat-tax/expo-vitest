import {describe, expect, it} from 'vitest';
import {CANNOT, CHANGES_SCREEN, cannot, describeControl, LACKS, lacking, needsApp, NO_SCREEN_AFTER, otherSensor, waitsAfter, webGrants} from './controls.ts';
import {PLATFORMS} from './types.ts';

describe('the controls', () => {
  it('wait for the screen after the ones that change it', () => {
    expect(Object.entries(CHANGES_SCREEN).filter(([, changes]) => changes).map(([name]) => name)).toEqual(['restart', 'clearState', 'stopApp', 'resumeApp', 'activateApp', 'back', 'home', 'openLink', 'setAppearance', 'setOrientation', 'fold', 'dismissKeyboard', 'alert']);
  });

  it('wait for nothing where the platform leaves nothing of the app on screen', () => {
    expect(NO_SCREEN_AFTER).toEqual({windows: ['stopApp']});
    expect([waitsAfter('stopApp', 'windows'), waitsAfter('stopApp', 'android'), waitsAfter('restart', 'windows'), waitsAfter('foregroundApp', 'web')]).toEqual([false, true, true, false]);
  });

  it('are named in the journal by what they did', () => {
    expect(describeControl({name: 'restart'})).toBe('restart');
    expect(describeControl({name: 'openLink', url: 'myapp://settings'})).toBe('openLink myapp://settings');
    expect(describeControl({name: 'activateApp', id: 'com.android.settings'})).toBe('activateApp com.android.settings');
    expect(describeControl({name: 'installApp'})).toBe('installApp');
    expect(describeControl({name: 'installApp', path: 'app.apk', reinstall: true})).toBe('installApp, again, from app.apk');
    expect(describeControl({name: 'setAppearance', mode: 'dark'})).toBe('setAppearance dark');
    expect(describeControl({name: 'setOrientation', orientation: 'landscape-left'})).toBe('setOrientation landscape-left');
    expect(describeControl({name: 'setNetwork', online: false})).toBe('setNetwork offline');
    expect(describeControl({name: 'setNetwork', online: true})).toBe('setNetwork online');
    expect(describeControl({name: 'setAirplaneMode', on: true})).toBe('setAirplaneMode on');
    expect(describeControl({name: 'setAirplaneMode', on: false})).toBe('setAirplaneMode off');
    expect(describeControl({name: 'setPermission', permission: 'camera', state: 'deny'})).toBe('setPermission camera deny');
    expect(describeControl({name: 'setLocation', latitude: 51.5, longitude: -0.12})).toBe('setLocation 51.5,-0.12');
    expect(describeControl({name: 'clearLocation'})).toBe('clearLocation');
    expect(describeControl({name: 'setBiometrics', sensor: 'faceid', result: 'nonmatch'})).toBe('setBiometrics faceid nonmatch');
    expect(describeControl({name: 'enrollBiometrics', sensor: 'touchid', enrolled: true})).toBe('enrollBiometrics touchid enrolled');
    expect(describeControl({name: 'enrollBiometrics', sensor: 'touchid', enrolled: false})).toBe('enrollBiometrics touchid not enrolled');
    expect(describeControl({name: 'fold', pose: 'half-open'})).toBe('fold half-open');
    expect(describeControl({name: 'alert', action: 'accept'})).toBe('alert accept');
  });

  it('leave what goes on the clipboard out of the journal, which is kept and shared', () => {
    expect(describeControl({name: 'setClipboard', text: 'a one-time code'})).toBe('setClipboard, 15 characters');
    expect(describeControl({name: 'clipboard'})).toBe('clipboard');
  });

  it('are skipped, with the reason, where a platform has no counterpart', () => {
    expect(lacking({name: 'home'}, 'web')).toEqual({ok: true, skipped: true, message: 'home is not something the web harness can do: a browser has no home screen'});
    expect(lacking({name: 'back'}, 'windows')?.message).toBe("back is not something the windows harness can do: react-native-windows has no system back; press the app's own back control");
    expect(lacking({name: 'home'}, 'windows')?.skipped).toBe(true);
    expect(lacking({name: 'installApp'}, 'web')?.skipped).toBe(true);
    expect(lacking({name: 'back'}, 'web')).toBeNull();
    expect(lacking({name: 'restart'}, 'android')).toBeNull();
    expect(PLATFORMS.every(platform => platform in LACKS)).toBe(true);
    expect(lacking({name: 'setAppearance', mode: 'dark'}, 'windows')?.message).toBe("setAppearance is not something the windows harness can do: the app follows the Windows theme, which is the whole machine's");
    expect(lacking({name: 'alert', action: 'accept'}, 'windows')?.message).toBe('alert is not something the windows harness can do: a WinUI dialog is in the tree: press its button by its label');
    expect(lacking({name: 'setNetwork', online: false}, 'ios')?.message).toBe("setNetwork is not something the ios harness can do: the simulator shares the Mac's network");
    expect(lacking({name: 'fold', pose: 'open'}, 'web')?.skipped).toBe(true);
    expect(lacking({name: 'setNetwork', online: false}, 'web')).toBeNull();
    expect(lacking({name: 'clipboard'}, 'windows')).toBeNull();
    expect(lacking({name: 'activateApp', id: 'com.example.other'}, 'web')?.message).toBe('activateApp is not something the web harness can do: a browser has no other app to bring up');
    expect(lacking({name: 'activateApp', id: 'Other.exe'}, 'windows')?.message).toBe("activateApp is not something the windows harness can do: the Windows harness reads the windows of the app it drives, and no other's");
    expect(lacking({name: 'activateApp', id: 'com.example.other'}, 'android')).toBeNull();
  });

  it("answer for a sensor only where it is the platform's", () => {
    expect(otherSensor('ios', 'faceid')).toBeNull();
    expect(otherSensor('ios', 'fingerprint')).toBe('the ios sensor is faceid or touchid, not fingerprint');
    expect(otherSensor('android', 'faceid')).toBe('the android sensor is fingerprint, not faceid');
    expect(otherSensor('android', 'fingerprint')).toBeNull();
    expect(otherSensor('web', 'faceid')).toBeNull();
  });

  it('are skipped, with the reason, where a platform has one but not for this', () => {
    expect(cannot({name: 'openLink', url: 'mailto:a@b.c'}, 'web', CANNOT.webLink).message).toBe('openLink is not something the web harness can do: a browser here opens only http and https links');
    expect(cannot({name: 'clearState'}, 'windows', CANNOT.windowsState).message).toBe(
      'clearState is not something the windows harness can do: it deletes the folder app.windows.stateDir names, and the harness config names none',
    );
  });

  it('name what they need to know of the app', () => {
    expect(needsApp('restart', 'android', 'bundleId')).toBe('restart on android needs app.android.bundleId in the harness config');
    expect(needsApp('installApp', 'ios', 'appPath')).toBe('installApp on ios needs app.ios.appPath in the harness config');
    expect(needsApp('restart', 'windows', 'target')).toBe("restart on windows needs app.windows.target, the app's exe, in the harness config");
  });
});

describe('permissions on web', () => {
  it("are the granted ones Chromium has, by Chromium's names, once each", () => {
    expect(webGrants({camera: 'grant', location: 'grant', 'location-always': 'grant', microphone: 'deny', photos: 'grant', notifications: 'reset'})).toEqual(['camera', 'geolocation']);
    expect(webGrants({motion: 'grant', notifications: 'grant'})).toEqual(['accelerometer', 'notifications']);
    expect(webGrants()).toEqual([]);
  });
});

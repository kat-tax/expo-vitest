import {describe, expect, it} from 'vitest';
import {CANNOT, CHANGES_SCREEN, cannot, describeControl, LACKS, lacking, needsApp, webGrants} from './controls.ts';
import {PLATFORMS} from './types.ts';

describe('the controls', () => {
  it('wait for the screen after the ones that change it', () => {
    expect(Object.entries(CHANGES_SCREEN).filter(([, changes]) => changes).map(([name]) => name)).toEqual(['restart', 'clearState', 'back', 'home', 'openLink']);
  });

  it('are named in the journal by what they did', () => {
    expect(describeControl({name: 'restart'})).toBe('restart');
    expect(describeControl({name: 'openLink', url: 'myapp://settings'})).toBe('openLink myapp://settings');
    expect(describeControl({name: 'installApp'})).toBe('installApp');
    expect(describeControl({name: 'installApp', path: 'app.apk', reinstall: true})).toBe('installApp, again, from app.apk');
  });

  it('are skipped, with the reason, where a platform has no counterpart', () => {
    expect(lacking({name: 'home'}, 'web')).toEqual({ok: true, skipped: true, message: 'home is not something the web harness can do: a browser has no home screen'});
    expect(lacking({name: 'back'}, 'windows')?.message).toBe("back is not something the windows harness can do: react-native-windows has no system back; press the app's own back control");
    expect(lacking({name: 'home'}, 'windows')?.skipped).toBe(true);
    expect(lacking({name: 'installApp'}, 'web')?.skipped).toBe(true);
    expect(lacking({name: 'back'}, 'web')).toBeNull();
    expect(lacking({name: 'restart'}, 'android')).toBeNull();
    expect(PLATFORMS.every(platform => platform in LACKS)).toBe(true);
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

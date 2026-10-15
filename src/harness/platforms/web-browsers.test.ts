import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {HEADED_NEEDS_FULL, browserRoots, candidates, isShell, launchOptions, modeFrom} from './web-browsers.ts';

describe('modeFrom', () => {
  it('opens a window for HARNESS_HEADED set to anything but 0 or false, and slows each operation by HARNESS_SLOWMO', () => {
    expect(modeFrom({} as NodeJS.ProcessEnv)).toEqual({headed: false});
    expect(modeFrom({HARNESS_HEADED: '1', HARNESS_SLOWMO: '250'} as unknown as NodeJS.ProcessEnv)).toEqual({headed: true, slowMo: 250});
    expect(modeFrom({HARNESS_HEADED: 'true'} as unknown as NodeJS.ProcessEnv).headed).toBe(true);
    expect(modeFrom({HARNESS_HEADED: '0'} as unknown as NodeJS.ProcessEnv).headed).toBe(false);
    expect(modeFrom({HARNESS_HEADED: 'false', HARNESS_SLOWMO: 'slow'} as unknown as NodeJS.ProcessEnv)).toEqual({headed: false});
    expect(modeFrom({HARNESS_SLOWMO: '-5'} as unknown as NodeJS.ProcessEnv)).toEqual({headed: false});
  });
});

describe('browserRoots', () => {
  it("looks where PLAYWRIGHT_BROWSERS_PATH says first, then in each platform's cache under the home", () => {
    expect(browserRoots({LOCALAPPDATA: 'C:/Users/me/AppData/Local', PLAYWRIGHT_BROWSERS_PATH: '/opt/pw'} as unknown as NodeJS.ProcessEnv)[0]).toBe('/opt/pw');
    expect(browserRoots({HOME: '/home/me'} as unknown as NodeJS.ProcessEnv)).toEqual([
      path.join('/home/me', 'ms-playwright'),
      path.join('/home/me', 'Library', 'Caches', 'ms-playwright'),
      path.join('/home/me', '.cache', 'ms-playwright'),
    ]);
    expect(browserRoots({PLAYWRIGHT_BROWSERS_PATH: '0'} as unknown as NodeJS.ProcessEnv)[0]).toBe('ms-playwright');
  });
});

describe('candidates', () => {
  const entries = ['chromium-1208', 'chromium_headless_shell-1243', 'chromium-1243', 'ffmpeg-1011', 'chromium_headless_shell-1208'];

  it('tries the newest revision first, its shell before its full browser, when headless', () => {
    const found = candidates('/pw', entries, false);
    expect(found[0]).toBe(path.join('/pw', 'chromium_headless_shell-1243', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
    expect(found.findIndex(file => file.includes('chromium-1243'))).toBeGreaterThan(found.findLastIndex(file => file.includes('chromium_headless_shell-1243')));
    expect(found.findIndex(file => file.includes('1208'))).toBeGreaterThan(found.findLastIndex(file => file.includes('1243')));
    expect(found.some(file => file.includes('ffmpeg'))).toBe(false);
  });

  it('takes only full browsers when headed, and tells a shell from one', () => {
    const found = candidates('/pw', entries, true);
    expect(found[0]).toBe(path.join('/pw', 'chromium-1243', 'chrome-win64', 'chrome.exe'));
    expect(found.some(isShell)).toBe(false);
    expect(candidates('/pw', entries, false).filter(isShell).length).toBeGreaterThan(0);
    expect(isShell(path.join('/pw', 'chromium-1243', 'chrome-linux', 'headless_shell'))).toBe(true);
  });
});

describe('launchOptions', () => {
  it('runs headless unless headed, slowed where asked, from a given executable where there is one', () => {
    expect(launchOptions({headed: false})).toEqual({headless: true});
    expect(launchOptions({headed: true, slowMo: 100}, '/pw/chrome.exe')).toEqual({headless: false, slowMo: 100, executablePath: '/pw/chrome.exe'});
  });

  it('says what to install where only the shell is there', () => {
    expect(HEADED_NEEDS_FULL).toBe('headed mode needs the full Chromium; run `npx playwright install chromium` without --only-shell');
  });
});

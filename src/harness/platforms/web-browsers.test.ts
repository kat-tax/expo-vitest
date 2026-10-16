import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {BROWSERS, GRANTS, HEADED_NEEDS_FULL, TITLES, browserLines, browserRoots, buildOf, candidates, grantsIn, installArguments, installHint, isShell, launchOptions, modeFrom, noClipboard, playwrightBases} from './web-browsers.ts';

const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;

describe('modeFrom', () => {
  it('opens a window for HARNESS_HEADED set to anything but 0 or false, and slows each operation by HARNESS_SLOWMO', () => {
    expect(modeFrom({} as NodeJS.ProcessEnv)).toEqual({headed: false, browser: 'chromium'});
    expect(modeFrom({HARNESS_HEADED: '1', HARNESS_SLOWMO: '250'} as unknown as NodeJS.ProcessEnv)).toEqual({headed: true, slowMo: 250, browser: 'chromium'});
    expect(modeFrom({HARNESS_HEADED: 'true'} as unknown as NodeJS.ProcessEnv).headed).toBe(true);
    expect(modeFrom({HARNESS_HEADED: '0'} as unknown as NodeJS.ProcessEnv).headed).toBe(false);
    expect(modeFrom({HARNESS_HEADED: 'false', HARNESS_SLOWMO: 'slow'} as unknown as NodeJS.ProcessEnv)).toEqual({headed: false, browser: 'chromium'});
    expect(modeFrom({HARNESS_SLOWMO: '-5'} as unknown as NodeJS.ProcessEnv)).toEqual({headed: false, browser: 'chromium'});
  });

  it('takes the browser the command line names over the one the environment names, and no other word', () => {
    expect(modeFrom(env({HARNESS_BROWSER: 'webkit'})).browser).toBe('webkit');
    expect(modeFrom(env({HARNESS_BROWSER: 'webkit'}), {browser: 'firefox'}).browser).toBe('firefox');
    expect(modeFrom(env({HARNESS_BROWSER: ''})).browser).toBe('chromium');
    expect(modeFrom(env({HARNESS_BROWSER: 'edge'}))).toEqual({headed: false, browser: 'chromium', invalid: 'HARNESS_BROWSER is "edge"; it takes chromium, firefox or webkit'});
    expect(modeFrom(env(), {browser: 'Safari'}).invalid).toBe('--browser is "Safari"; it takes chromium, firefox or webkit');
  });

  it('reaches a Chromium at an endpoint, passing over the browser named and a window, and says so', () => {
    expect(modeFrom(env({HARNESS_CDP: 'http://127.0.0.1:9222'}))).toEqual({headed: false, browser: 'chromium', cdp: 'http://127.0.0.1:9222'});
    expect(modeFrom(env({HARNESS_CDP: 'ws://a/devtools/browser/1', HARNESS_HEADED: '1', HARNESS_BROWSER: 'webkit', HARNESS_SLOWMO: '50'}))).toEqual({
      headed: false,
      slowMo: 50,
      browser: 'chromium',
      cdp: 'ws://a/devtools/browser/1',
      passedOver: ['HARNESS_BROWSER=webkit, since a browser over CDP is a Chromium', 'HARNESS_HEADED, since the browser at the endpoint has a window or not already'],
    });
    expect(modeFrom(env({HARNESS_CDP: 'http://a:1'}), {browser: 'firefox'}).passedOver).toEqual(['--browser firefox, since a browser over CDP is a Chromium']);
    expect(modeFrom(env({HARNESS_CDP: 'http://a:1'}), {cdp: 'wss://b'}).cdp).toBe('wss://b');
    expect(modeFrom(env({HARNESS_CDP: '127.0.0.1:9222'})).invalid).toBe(
      'HARNESS_CDP is "127.0.0.1:9222"; it takes the endpoint of a Chromium\'s remote debugging, such as http://127.0.0.1:9222 or a ws:// URL',
    );
    expect(modeFrom(env(), {cdp: 'nowhere'}).invalid).toMatch(/^--cdp is "nowhere"; /);
  });
});

describe('the browsers', () => {
  it('are the three playwright-core drives, each with a name a sentence uses', () => {
    expect(BROWSERS).toEqual(['chromium', 'firefox', 'webkit']);
    expect(BROWSERS.map(name => TITLES[name])).toEqual(['Chromium', 'Firefox', 'WebKit']);
  });

  it('are fetched by the project\'s own playwright-core, which takes no build but its own', () => {
    expect(installHint('webkit')).toBe('run `npx expo-harness install webkit`');
    expect(installHint('ffmpeg')).toBe('run `npx expo-harness install ffmpeg`');
  });

  it('grant a page what each grants, and pass over the rest', () => {
    expect(grantsIn('chromium', ['camera', 'accelerometer'])).toEqual({granted: ['camera', 'accelerometer'], refused: []});
    expect(grantsIn('firefox', ['camera', 'geolocation'])).toEqual({granted: ['geolocation'], refused: ['camera']});
    expect(grantsIn('webkit', ['clipboard-write', 'camera'])).toEqual({granted: ['camera'], refused: ['clipboard-write']});
    expect(GRANTS.firefox).toEqual(['notifications', 'geolocation']);
  });

  it('have a clipboard to drive in Chromium alone', () => {
    expect(noClipboard('chromium')).toBeNull();
    expect(noClipboard('webkit')).toBe('the clipboard is driven in Chromium alone, and this is WebKit');
    expect(noClipboard('firefox')).toBe('the clipboard is driven in Chromium alone, and this is Firefox');
  });

  it('are known by the folder each build is kept in', () => {
    expect(buildOf(path.join('/pw', 'chromium_headless_shell-1243', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'))).toBe('chromium_headless_shell-1243');
    expect(buildOf('C:\\pw\\webkit-2359\\Playwright.exe')).toBe('webkit-2359');
    expect(buildOf(path.join('/opt', 'chrome', 'chrome'))).toBe('chrome');
  });

  it('are listed for the doctor, installed or with what fetches each, and which a run uses', () => {
    expect(browserLines({chromium: 'chromium-1243', webkit: 'webkit-2359'}, 'webkit')).toEqual([
      'chromium installed, chromium-1243',
      'firefox  not installed: run `npx expo-harness install firefox`',
      'webkit   installed, webkit-2359, the one a run uses',
    ]);
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
    expect(HEADED_NEEDS_FULL).toBe('headed mode needs the full Chromium; run `npx expo-harness install chromium`');
  });

  it('install the headless shell bare, a named browser as named, and Chromium beside flags alone', () => {
    expect(installArguments([])).toEqual(['install', 'chromium', '--only-shell']);
    expect(installArguments(['webkit'])).toEqual(['install', 'webkit']);
    expect(installArguments(['--with-deps', 'firefox'])).toEqual(['install', '--with-deps', 'firefox']);
    expect(installArguments(['--with-deps'])).toEqual(['install', '--with-deps', 'chromium']);
  });

  it("load playwright-core from the project's own install first, then this package's", () => {
    expect(playwrightBases(path.resolve('/work/app'), '/pkg/dist/harness/platforms/web.js')).toEqual([path.join(path.resolve('/work/app'), 'package.json'), '/pkg/dist/harness/platforms/web.js']);
  });
});

/**
 * Which browser the web driver drives, and how. It is one of playwright-core's
 * three, launched, or a Chromium already running, reached over CDP.
 *
 * Playwright ships two builds of Chromium: a headless shell, which a headless
 * run prefers, and the full browser, which a headed one needs. Playwright
 * finds its own; these are the places a `playwright-core install` leaves them,
 * for when it does not, as when the installed browsers are a revision it does
 * not expect. Firefox and WebKit are patched builds that work only with the
 * version that installed them, so for those there is nothing else to look for.
 */
import path from 'node:path';

/** The browsers playwright-core drives, by the name of each one's browser type. */
export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export type BrowserName = (typeof BROWSERS)[number];

/** Each browser as a sentence names it. */
export const TITLES: Record<BrowserName, string> = {chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit'};

/** How the browser runs: which one, in a window to watch, slowed by `slowMo` ms an operation, or reached over CDP. */
export interface BrowserMode {
  headed: boolean;
  slowMo?: number;
  /** The browser launched, `chromium` unless another is named. */
  browser: BrowserName;
  /** A Chromium already running, reached at this endpoint over CDP rather than launched. */
  cdp?: string;
  /** What an endpoint makes the run pass over, a clause each. */
  passedOver?: string[];
  /** Why no browser can be had from what was named, in a sentence. */
  invalid?: string;
}

/**
 * How the browser runs, from the command line's `--browser` and `--cdp` over
 * the environment's `HARNESS_BROWSER` and `HARNESS_CDP`. `HARNESS_HEADED` set
 * to anything but `0` or `false` opens a window, and `HARNESS_SLOWMO` slows
 * each operation, in ms. A browser at an endpoint is a Chromium whose window
 * is its own business, so with one the browser named and `HARNESS_HEADED` are
 * passed over, and said to be.
 */
export function modeFrom(environment: NodeJS.ProcessEnv, given: {browser?: string; cdp?: string} = {}): BrowserMode {
  const headed = environment.HARNESS_HEADED;
  const slowMo = Number(environment.HARNESS_SLOWMO);
  const mode: BrowserMode = {
    headed: Boolean(headed) && headed !== '0' && headed !== 'false',
    ...(environment.HARNESS_SLOWMO && Number.isFinite(slowMo) && slowMo > 0 ? {slowMo} : {}),
    browser: 'chromium',
  };
  const named = given.browser || environment.HARNESS_BROWSER;
  const naming = given.browser ? `--browser ${named}` : `HARNESS_BROWSER=${named}`;
  if (named) {
    const browser = BROWSERS.find(each => each === named);
    if (!browser) return {...mode, invalid: `${given.browser ? '--browser' : 'HARNESS_BROWSER'} is "${named}"; it takes chromium, firefox or webkit`};
    mode.browser = browser;
  }
  const endpoint = given.cdp || environment.HARNESS_CDP;
  if (!endpoint) return mode;
  if (!/^(wss?|https?):\/\/./i.test(endpoint)) {
    return {...mode, invalid: `${given.cdp ? '--cdp' : 'HARNESS_CDP'} is "${endpoint}"; it takes the endpoint of a Chromium's remote debugging, such as http://127.0.0.1:9222 or a ws:// URL`};
  }
  const passedOver = [
    ...(mode.browser === 'chromium' ? [] : [`${naming}, since a browser over CDP is a Chromium`]),
    ...(mode.headed ? ['HARNESS_HEADED, since the browser at the endpoint has a window or not already'] : []),
  ];
  return {...mode, browser: 'chromium', headed: false, cdp: endpoint, ...(passedOver.length ? {passedOver} : {})};
}

/**
 * The permissions each browser grants a page, as Playwright names them. A
 * browser checks a grant once a page is open, and refuses the rest; these were
 * measured that way, on playwright-core 1.63 and 1.64.
 */
export const GRANTS: Record<BrowserName, readonly string[]> = {
  chromium: ['camera', 'microphone', 'notifications', 'geolocation', 'accelerometer', 'clipboard-read', 'clipboard-write'],
  firefox: ['notifications', 'geolocation'],
  webkit: ['camera', 'microphone', 'notifications', 'geolocation', 'clipboard-read'],
};

/** Of the permissions asked for, those a browser grants a page, and those it would refuse, which are passed over. */
export function grantsIn(browser: BrowserName, wanted: string[]): {granted: string[]; refused: string[]} {
  return {granted: wanted.filter(each => GRANTS[browser].includes(each)), refused: wanted.filter(each => !GRANTS[browser].includes(each))};
}

/**
 * Why a browser has no clipboard to drive, or null where it has. Only
 * Chromium's: Firefox grants a page no clipboard permission, and WebKit none
 * to write with.
 */
export function noClipboard(browser: BrowserName): string | null {
  return browser === 'chromium' ? null : `the clipboard is driven in Chromium alone, and this is ${TITLES[browser]}`;
}

/** The command that fetches a browser, or ffmpeg, for the playwright-core the harness loads, which takes no build but its own. */
export function installHint(what: BrowserName | 'ffmpeg'): string {
  return `run \`npx expo-harness install ${what}\``;
}

/**
 * What `expo-harness install` gives playwright-core's own installer. Bare,
 * the headless shell of Chromium, which is what a run launches. With
 * flags and no browser, Chromium beside the flags, since playwright-core
 * installs every browser where none is named.
 */
export function installArguments(args: readonly string[]): string[] {
  if (args.length === 0) return ['install', 'chromium', '--only-shell'];
  return args.some(each => !each.startsWith('-')) ? ['install', ...args] : ['install', ...args, 'chromium'];
}

/**
 * The files a `require` of playwright-core is made from, in turn: the
 * project's own, so a project can pin its version, then this package's,
 * which depends on it.
 */
export function playwrightBases(root: string, self: string): string[] {
  return [path.join(root, 'package.json'), self];
}

/** The folder a build is kept in, such as `chromium_headless_shell-1243`, from its executable's path. */
export function buildOf(file: string): string {
  const parts = file.split(/[\\/]/);
  return [...parts].reverse().find(part => /^[a-z_]+-\d+$/i.test(part)) ?? path.basename(path.dirname(file));
}

/** What the doctor says of each browser: installed, in which build, or what fetches it; and which a run would use. */
export function browserLines(installed: Partial<Record<BrowserName, string>>, chosen: BrowserName): string[] {
  return BROWSERS.map(name => {
    const build = installed[name];
    return `${name.padEnd(9)}${build ? `installed, ${build}` : `not installed: ${installHint(name)}`}${name === chosen ? ', the one a run uses' : ''}`;
  });
}

/** Where each platform's headless shell is, inside a revision's folder. */
const SHELLS = [
  'chrome-headless-shell-win64/chrome-headless-shell.exe',
  'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
  'chrome-headless-shell-mac/chrome-headless-shell',
  'chrome-headless-shell-linux64/chrome-headless-shell',
  'chrome-win/headless_shell.exe',
  'chrome-linux/headless_shell',
];

/** Where each platform's full browser is. */
const FULL = [
  'chrome-win64/chrome.exe',
  'chrome-win/chrome.exe',
  'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
];

/** Where Playwright keeps its browsers on each platform, under the user's home. */
export function browserRoots(environment: NodeJS.ProcessEnv): string[] {
  const home = environment.LOCALAPPDATA ?? environment.HOME ?? '';
  const named = environment.PLAYWRIGHT_BROWSERS_PATH;
  return [...(named && named !== '0' ? [named] : []), path.join(home, 'ms-playwright'), path.join(home, 'Library', 'Caches', 'ms-playwright'), path.join(home, '.cache', 'ms-playwright')];
}

/**
 * The executables to try under a root, given its folder's entries: the
 * newest revision first, and in a headless run each revision's shell before
 * its full browser. A headed run takes the full browser only.
 */
export function candidates(root: string, entries: string[], headed: boolean): string[] {
  const revision = (entry: string) => Number(entry.split('-').at(-1));
  const shells = entries.filter(entry => entry.startsWith('chromium_headless_shell-'));
  const full = entries.filter(entry => /^chromium-\d+$/.test(entry));
  const found: string[] = [];
  const revisions = [...new Set([...(headed ? [] : shells), ...full].map(revision))].sort((a, b) => b - a);
  for (const each of revisions) {
    if (!headed) for (const entry of shells.filter(name => revision(name) === each)) found.push(...SHELLS.map(file => path.join(root, entry, ...file.split('/'))));
    for (const entry of full.filter(name => revision(name) === each)) found.push(...FULL.map(file => path.join(root, entry, ...file.split('/'))));
  }
  return found;
}

/** Whether an executable is a headless shell, which cannot open a window. */
export function isShell(file: string): boolean {
  return /headless[_-]shell/.test(file);
}

/** What a browser's `launch` is given. */
export function launchOptions(mode: Pick<BrowserMode, 'headed' | 'slowMo'>, executablePath?: string): {headless: boolean; slowMo?: number; executablePath?: string} {
  return {headless: !mode.headed, ...(mode.slowMo ? {slowMo: mode.slowMo} : {}), ...(executablePath ? {executablePath} : {})};
}

/** What a headed run says where only the shell is installed. */
export const HEADED_NEEDS_FULL = 'headed mode needs the full Chromium; run `npx expo-harness install chromium`';

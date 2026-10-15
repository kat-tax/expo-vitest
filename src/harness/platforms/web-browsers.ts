/**
 * Which Chromium the web driver launches, and how. Playwright ships two
 * builds: a headless shell, which a headless run prefers, and the full
 * browser, which a headed one needs. Playwright finds its own; these are the
 * places a `playwright install` leaves them, for when it does not, as when
 * the installed browsers are a revision it does not expect.
 */
import path from 'node:path';

/** How the browser runs: in a window to watch, and slowed by `slowMo` ms an operation. */
export interface BrowserMode {
  headed: boolean;
  slowMo?: number;
}

/** `HARNESS_HEADED` set to anything but `0` or `false` opens a window; `HARNESS_SLOWMO` slows each operation, in ms. */
export function modeFrom(environment: NodeJS.ProcessEnv): BrowserMode {
  const headed = environment.HARNESS_HEADED;
  const slowMo = Number(environment.HARNESS_SLOWMO);
  return {
    headed: Boolean(headed) && headed !== '0' && headed !== 'false',
    ...(environment.HARNESS_SLOWMO && Number.isFinite(slowMo) && slowMo > 0 ? {slowMo} : {}),
  };
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

/** What \`chromium.launch\` is given. */
export function launchOptions(mode: BrowserMode, executablePath?: string): {headless: boolean; slowMo?: number; executablePath?: string} {
  return {headless: !mode.headed, ...(mode.slowMo ? {slowMo: mode.slowMo} : {}), ...(executablePath ? {executablePath} : {})};
}

/** What a headed run says where only the shell is installed. */
export const HEADED_NEEDS_FULL = 'headed mode needs the full Chromium; run `npx playwright install chromium` without --only-shell';

/**
 * What the Windows driver hands SendKeys. SendKeys reads `+`, `^`, `%` and
 * `~` as Shift, Ctrl, Alt and Enter, and parentheses, brackets and braces as
 * its own syntax, so text has to be written out for it before it is typed as
 * itself.
 */

/**
 * DOM key names, which is what a test writes, in the spelling SendKeys takes.
 * Only the keys a composite role's pattern uses: anything else is refused by
 * name rather than passed through, because SendKeys reads a bare letter as
 * text and `{` as the start of a token of its own.
 */
export const SEND_KEYS: Record<string, string> = {
  ArrowDown: '{DOWN}',
  ArrowUp: '{UP}',
  ArrowLeft: '{LEFT}',
  ArrowRight: '{RIGHT}',
  Home: '{HOME}',
  End: '{END}',
  Tab: '{TAB}',
  Enter: '{ENTER}',
  Escape: '{ESC}',
};

/** Text as SendKeys types it: each character it reads as syntax inside braces, a line break as Enter and a tab as Tab. */
export function literal(text: string): string {
  return text.replace(/\r?\n|\t|[+^%~(){}[\]]/g, found => (found === '\t' ? '{TAB}' : found.endsWith('\n') ? '{ENTER}' : `{${found}}`));
}

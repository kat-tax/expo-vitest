/**
 * What `device.web` works out before it reaches the browser: the files a
 * file input is given, the expression a function becomes, where a download
 * is kept, and how a step's line names an option.
 */
import path from 'node:path';
import {HarnessError} from '../harness/lib/errors.ts';
import type {OptionChoice} from '../harness/lib/types.ts';

/**
 * The files a file input is given, from the project root. Each must be in
 * the project, and not hidden nor in a hidden folder, so a test hands a page
 * nothing from outside what it tests, such as a key in the home folder.
 */
export function inputFiles(root: string, files: string[]): string[] {
  return files.map(file => {
    const full = path.resolve(root, file);
    const relative = path.relative(root, full);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new HarnessError('INVALID_ARGUMENT', `${file} is outside the project, and a file input is given files from inside it`, {platform: 'web'});
    }
    if (relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
      throw new HarnessError('INVALID_ARGUMENT', `${file} is hidden, or in a hidden folder, and a file input is given neither`, {platform: 'web'});
    }
    return full;
  });
}

/**
 * What the page evaluates: an expression as it is, or a function by its
 * source, called with `arg` as JSON. Only the source goes, so a function
 * cannot use anything of the test's but `arg`.
 */
export function expressionOf(source: string | ((arg: never) => unknown), arg?: unknown): string {
  if (typeof source === 'string') {
    if (arg !== undefined) throw new HarnessError('INVALID_ARGUMENT', 'an argument goes with a function, which is called with it; an expression takes none', {platform: 'web'});
    return source;
  }
  return `(${source.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`;
}

/** Where a download is kept: at the file a test names, from the root, or in `.harness/downloads/` by the name the page suggested. */
export function downloadFile(root: string, suggested: string, file?: string): string {
  if (file) return path.resolve(root, file);
  const name = path.basename(suggested).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'download';
  return path.join(root, '.harness', 'downloads', name);
}

/** An option as a step's line names it. */
export function describeOption(option: OptionChoice): string {
  if (typeof option === 'string') return JSON.stringify(option);
  return 'value' in option ? `the value ${JSON.stringify(option.value)}` : `option ${option.index}`;
}

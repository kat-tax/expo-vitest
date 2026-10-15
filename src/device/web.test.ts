import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {isHarnessError} from '../harness/lib/errors.ts';
import {describeOption, downloadFile, expressionOf, inputFiles} from './web.ts';

const root = path.resolve('/app');
const failure = (work: () => unknown): string[] | null => {
  try {
    work();
    return null;
  } catch (error) {
    if (isHarnessError(error)) return [error.code, error.message];
    throw error;
  }
};

describe('the files a file input is given', () => {
  it('are from the project root', () => {
    expect(inputFiles(root, ['fixtures/a.png', path.join(root, 'b.pdf')])).toEqual([path.join(root, 'fixtures', 'a.png'), path.join(root, 'b.pdf')]);
  });

  it('stay inside the project', () => {
    expect(failure(() => inputFiles(root, ['../secret.txt']))).toEqual(['INVALID_ARGUMENT', '../secret.txt is outside the project, and a file input is given files from inside it']);
    expect(failure(() => inputFiles(root, [path.resolve('/elsewhere/a.png')]))?.[0]).toBe('INVALID_ARGUMENT');
    expect(failure(() => inputFiles(root, ['.']))?.[0]).toBe('INVALID_ARGUMENT');
  });

  it('are neither hidden nor in a hidden folder', () => {
    expect(failure(() => inputFiles(root, ['.env']))).toEqual(['INVALID_ARGUMENT', '.env is hidden, or in a hidden folder, and a file input is given neither']);
    expect(failure(() => inputFiles(root, ['.ssh/id_rsa']))?.[0]).toBe('INVALID_ARGUMENT');
    expect(failure(() => inputFiles(root, ['a/.git/config']))?.[0]).toBe('INVALID_ARGUMENT');
  });
});

describe('what the page evaluates', () => {
  it('is an expression as it is', () => {
    expect(expressionOf('document.title')).toBe('document.title');
    expect(failure(() => expressionOf('document.title', 1))).toEqual(['INVALID_ARGUMENT', 'an argument goes with a function, which is called with it; an expression takes none']);
  });

  it('is a function by its source, called with the argument as JSON', () => {
    const count = (selector: string) => document.querySelectorAll(selector).length;
    expect(expressionOf(count, 'li')).toBe(`(${count.toString()})("li")`);
    expect(expressionOf(() => location.href)).toMatch(/^\(.*\)\(\)$/s);
  });
});

describe('a download', () => {
  it('is kept where the test says, from the root', () => {
    expect(downloadFile(root, 'report.csv', 'out/report.csv')).toBe(path.join(root, 'out', 'report.csv'));
  });

  it('is kept by the name the page suggested, made safe, in the downloads folder', () => {
    expect(downloadFile(root, 'my report (1).csv')).toBe(path.join(root, '.harness', 'downloads', 'my_report_1_.csv'));
    expect(downloadFile(root, '../../evil.sh')).toBe(path.join(root, '.harness', 'downloads', 'evil.sh'));
    expect(downloadFile(root, '..')).toBe(path.join(root, '.harness', 'downloads', 'download'));
  });
});

describe('an option', () => {
  it('is named by its label, its value or its place', () => {
    expect(describeOption('Blue')).toBe('"Blue"');
    expect(describeOption({value: 'b'})).toBe('the value "b"');
    expect(describeOption({index: 2})).toBe('option 2');
  });
});

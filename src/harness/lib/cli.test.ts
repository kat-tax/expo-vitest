import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {OPTIONAL_ARGUMENT, STEP_ARGUMENTS, USAGE, parse, screenshotPath, unmangleRoute} from './cli.ts';

describe('parse', () => {
  it('reads every step with the arguments it takes, in order', () => {
    const argv = ['open', '/settings', 'tree', 'press', '@e3', 'tap', '10', '20', 'fill', 'label="Name"', 'Ada', 'type', 'hello', 'screenshot', 'after.png', 'raise', 'wait', '500', 'idle'];
    expect(parse(argv).steps).toEqual([
      ['open', '/settings'],
      ['tree'],
      ['press', '@e3'],
      ['tap', '10', '20'],
      ['fill', 'label="Name"', 'Ada'],
      ['type', 'hello'],
      ['screenshot', 'after.png'],
      ['raise'],
      ['wait', '500'],
      ['idle'],
    ]);
  });

  it('takes the snapshot file only when the next word is not a step', () => {
    expect(parse(['snapshot']).steps).toEqual([['snapshot']]);
    expect(parse(['snapshot', 'tree.json']).steps).toEqual([['snapshot', 'tree.json']]);
    expect(parse(['snapshot', 'tree']).steps).toEqual([['snapshot'], ['tree']]);
    expect([...OPTIONAL_ARGUMENT]).toEqual(['snapshot']);
  });

  it('starts from the defaults', () => {
    expect(parse([])).toEqual({out: '.harness', force: false, interactive: false, steps: [], command: 'run'});
  });

  it('reads every option in either spelling, before or between the steps', () => {
    expect(parse(['-p', 'web', '--url', 'http://localhost:8085', '--scheme', 'myapp', '--target', 'MyApp', '--out', 'shots', '--force', '-i', 'tree'])).toEqual({
      platform: 'web',
      url: 'http://localhost:8085',
      scheme: 'myapp',
      target: 'MyApp',
      out: 'shots',
      force: true,
      interactive: true,
      steps: [['tree']],
      command: 'run',
    });
    expect(parse(['tree', '--platform', 'windows', '--interactive', 'idle'])).toMatchObject({platform: 'windows', interactive: true, steps: [['tree'], ['idle']]});
  });

  it('reads an option with nothing after it as empty', () => {
    expect(parse(['--url']).url).toBe('');
  });

  it('knows the two commands that are not steps', () => {
    expect(parse(['doctor']).command).toBe('doctor');
    expect(parse(['--help']).command).toBe('help');
    expect(parse(['-p', 'web', '-h', 'open', '/']).command).toBe('help');
  });

  it('refuses a word that is not a step, and a step short of its arguments', () => {
    const invalid = (message: string) => expect.objectContaining({name: 'HarnessError', code: 'INVALID_ARGUMENT', message});
    expect(() => parse(['jump'])).toThrow(invalid('jump is not a step; try --help'));
    expect(() => parse(['press'])).toThrow(invalid('press takes 1 argument'));
    expect(() => parse(['fill', '@e1'])).toThrow(invalid('fill takes 2 arguments'));
  });

  it('has every step in the usage', () => {
    for (const step of Object.keys(STEP_ARGUMENTS)) expect(USAGE).toMatch(new RegExp(`^(steps)?\\s+${step}\\b`, 'm'));
  });
});

describe('unmangleRoute', () => {
  /** This process's environment with the two variables that decide set, or cleared, so whichever shell runs the test does not. */
  function environment(values: {MSYSTEM?: string; EXEPATH?: string}): NodeJS.ProcessEnv {
    return {...process.env, MSYSTEM: undefined, EXEPATH: undefined, ...values};
  }
  // Git for Windows' launcher sets both; the root is the folder above its `bin`.
  const gitBash = environment({MSYSTEM: 'MINGW64', EXEPATH: 'C:/Program Files/Git/bin'});

  it('undoes what Git Bash did to an absolute route', () => {
    expect(unmangleRoute('C:/Program Files/Git/detail', gitBash)).toBe('/detail');
    expect(unmangleRoute('C:\\Program Files\\Git\\detail\\7', gitBash)).toBe('/detail/7');
    expect(unmangleRoute('c:/program files/git/detail', gitBash)).toBe('/detail');
  });

  it('leaves alone what Git Bash did not touch', () => {
    expect(unmangleRoute('/detail', gitBash)).toBe('/detail');
    expect(unmangleRoute('https://example.com/detail', gitBash)).toBe('https://example.com/detail');
    expect(unmangleRoute('C:/Program Files/Other/detail', gitBash)).toBe('C:/Program Files/Other/detail');
  });

  it('changes nothing outside Git Bash', () => {
    expect(unmangleRoute('C:/Program Files/Git/detail', environment({EXEPATH: 'C:/Program Files/Git/bin'}))).toBe('C:/Program Files/Git/detail');
    expect(unmangleRoute('C:/Program Files/Git/detail', environment({MSYSTEM: 'MINGW64'}))).toBe('C:/Program Files/Git/detail');
    // From the real environment, a plain route is a plain route whichever shell ran this.
    expect(unmangleRoute('/detail')).toBe('/detail');
  });
});

describe('screenshotPath', () => {
  it('puts a bare name under the out directory', () => {
    expect(screenshotPath('home.png', '.harness')).toBe(path.join('.harness', 'home.png'));
  });

  it('keeps a path that says where it goes', () => {
    const absolute = path.resolve('home.png');
    expect(screenshotPath(absolute, '.harness')).toBe(absolute);
    expect(screenshotPath('shots/home.png', '.harness')).toBe('shots/home.png');
    expect(screenshotPath('shots\\home.png', '.harness')).toBe('shots\\home.png');
  });
});

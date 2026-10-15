import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {OPTIONAL_ARGUMENT, STEP_ARGUMENTS, USAGE, parse, screenshotPath, unmangleRoute} from './cli.ts';

describe('parse', () => {
  it('reads every step with the arguments it takes, in order', () => {
    const argv = ['open', '/settings', 'tree', 'press', '@e3', 'tap', '10', '20', 'fill', 'label="Name"', 'Ada', 'type', 'hello', 'screenshot', 'after.png', 'raise', 'wait', '500', 'idle', 'bench', '30'];
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
      ['bench', '30'],
    ]);
  });

  it('takes an optional argument only when the next word is not a step', () => {
    expect(parse(['snapshot']).steps).toEqual([['snapshot']]);
    expect(parse(['snapshot', 'tree.json']).steps).toEqual([['snapshot', 'tree.json']]);
    expect(parse(['snapshot', 'tree']).steps).toEqual([['snapshot'], ['tree']]);
    expect(parse(['open', '/', 'bench']).steps).toEqual([['open', '/'], ['bench']]);
    expect(parse(['bench', '50']).steps).toEqual([['bench', '50']]);
    expect(parse(['bench', 'tree']).steps).toEqual([['bench'], ['tree']]);
    expect([...OPTIONAL_ARGUMENT]).toEqual(['snapshot', 'bench']);
  });

  it('starts from the defaults', () => {
    expect(parse([])).toEqual({out: '.harness', force: false, interactive: false, json: false, steps: [], command: 'run', args: []});
  });

  it('reads every option in either spelling, before or between the steps', () => {
    const argv = ['-p', 'web', '--url', 'http://localhost:8085', '--browser', 'webkit', '--cdp', 'http://127.0.0.1:9333', '--scheme', 'myapp', '--target', 'MyApp', '--out', 'shots', '--force', '-i', 'bench'];
    expect(parse([...argv, '--iterations', '50', '--press', 'label="Settings"', '--field', 'testID=search', '--json'])).toEqual({
      platform: 'web',
      url: 'http://localhost:8085',
      browser: 'webkit',
      cdp: 'http://127.0.0.1:9333',
      scheme: 'myapp',
      target: 'MyApp',
      out: 'shots',
      force: true,
      interactive: true,
      iterations: '50',
      press: 'label="Settings"',
      field: 'testID=search',
      json: true,
      steps: [['bench']],
      command: 'run',
      args: [],
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

  it('hands init and guide the rest of the line, in the first place only', () => {
    expect(parse(['init', '--yes'])).toMatchObject({command: 'init', args: ['--yes'], steps: []});
    expect(parse(['guide', 'device'])).toMatchObject({command: 'guide', args: ['device']});
    expect(parse(['guide'])).toMatchObject({command: 'guide', args: []});
    expect(parse(['cache', 'clear'])).toMatchObject({command: 'cache', args: ['clear']});
    expect(() => parse(['-p', 'web', 'init'])).toThrow('init is not a step; try --help');
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

describe('the waits after a step', () => {
  it('takes how long the screen must hold still, and how long a control that just came in is given', () => {
    expect(parse(['--settle', '0', '--transition', '250'])).toMatchObject({settle: 0, transition: 250});
    expect(parse([])).not.toHaveProperty('settle');
  });

  it('refuses what is not a whole number of milliseconds', () => {
    for (const value of ['soon', '-1', '1.5', '']) {
      expect(() => parse(['--settle', value])).toThrow('--settle takes a whole number of milliseconds, such as 150, or 0 for no wait');
    }
    expect(() => parse(['--transition'])).toThrow('--transition takes a whole number of milliseconds');
  });
});

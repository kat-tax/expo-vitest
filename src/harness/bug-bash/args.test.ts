import {describe, expect, it} from 'vitest';
import {BUG_BASH_USAGE, parallelOn, parseBugBashArgs} from './args.ts';

const failure = (args: string[]) => {
  try {
    parseBugBashArgs(args);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};

describe("bug-bash's command line", () => {
  it('reads device/features.json with the default agent, four charters at a time, each 8 actions in 10 minutes, and checks each issue', () => {
    expect(parseBugBashArgs([])).toEqual({featureMap: 'device/features.json', agent: 'default', parallel: 4, maxSteps: 8, timeout: 600_000, headed: false, force: false, confirm: true});
  });

  it('takes every flag', () => {
    const args = ['--feature-map', 'e2e/features.json', '-p', 'web', '--config', 'e2e/harness.config.ts', '--agent', 'buyer', '--parallel', '16', '--max-steps', '12', '--timeout', '900000'];
    expect(parseBugBashArgs([...args, '--headed', '--force', '--out', 'out/bash', '--vitest-config', 'e2e/vitest.config.mts', '--no-confirm', '-h'])).toEqual({
      featureMap: 'e2e/features.json',
      platform: 'web',
      config: 'e2e/harness.config.ts',
      agent: 'buyer',
      parallel: 16,
      maxSteps: 12,
      timeout: 900_000,
      headed: true,
      force: true,
      out: 'out/bash',
      vitestConfig: 'e2e/vitest.config.mts',
      confirm: false,
      help: true,
    });
    expect(parseBugBashArgs(['--platform', 'ios', '--help'])).toMatchObject({platform: 'ios', help: true});
  });

  it('refuses a platform it does not drive, a number outside its limits, a flag with no value, and one it does not take', () => {
    expect(failure(['--platform', 'macos'])).toBe('--platform takes one of web, windows, android, ios, not macos');
    expect(failure(['--parallel', '17'])).toBe('--parallel takes a whole number from 1 to 16');
    expect(failure(['--parallel', '0'])).toBe('--parallel takes a whole number from 1 to 16');
    expect(failure(['--max-steps', '13'])).toBe('--max-steps takes a whole number from 1 to 12');
    expect(failure(['--timeout', '1.5'])).toBe('--timeout takes a whole number of ms, at most 900000');
    expect(failure(['--out'])).toBe('--out takes a value');
    expect(failure(['checkout'])).toBe(`checkout is not something bug-bash takes\n\n${BUG_BASH_USAGE}`);
  });
});

describe('charters at once', () => {
  it('are as many as asked on web, no more than there are, and one on a desktop or a device, with why', () => {
    expect(parallelOn('web', 4, 10)).toEqual({parallel: 4});
    expect(parallelOn('web', 4, 2)).toEqual({parallel: 2});
    expect(parallelOn('windows', 4, 1)).toEqual({parallel: 1});
    expect(parallelOn('windows', 4, 3)).toEqual({parallel: 1, why: 'Windows is one window, which one charter drives at a time'});
    expect(parallelOn('android', 2, 3)).toEqual({parallel: 1, why: 'the bug bash takes one android device, so its charters explore one at a time'});
  });
});

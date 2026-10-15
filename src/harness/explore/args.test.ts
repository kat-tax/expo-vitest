import {describe, expect, it} from 'vitest';
import {DEFAULT_GOAL, EXPLORE_USAGE, parseExploreArgs} from './args.ts';

const failure = (args: string[]) => {
  try {
    parseExploreArgs(args);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};

describe("explore's command line", () => {
  it('explores the app for bugs with the default agent, 8 actions in 10 minutes, where nothing else is said', () => {
    expect(parseExploreArgs([])).toEqual({goal: DEFAULT_GOAL, agent: 'default', maxSteps: 8, timeout: 600_000, headed: false, force: false});
  });

  it('takes a goal in words, quoted or not, and every flag', () => {
    expect(
      parseExploreArgs(['Explore', 'the checkout like a first-time buyer', '-p', 'web', '--config', 'e2e/harness.config.ts', '--agent', 'buyer', '--max-steps', '12', '--timeout', '900000', '--headed', '--force', '--out', 'out/run', '-h']),
    ).toEqual({
      goal: 'Explore the checkout like a first-time buyer',
      platform: 'web',
      config: 'e2e/harness.config.ts',
      agent: 'buyer',
      maxSteps: 12,
      timeout: 900_000,
      headed: true,
      force: true,
      out: 'out/run',
      help: true,
    });
    expect(parseExploreArgs(['--platform', 'android', '--help'])).toMatchObject({platform: 'android', help: true});
  });

  it('refuses a platform it does not drive, a budget outside its limits, a flag with no value, and a flag it does not take', () => {
    expect(failure(['--platform', 'macos'])).toBe('--platform takes one of web, windows, android, ios, not macos');
    expect(failure(['--max-steps', '13'])).toBe('--max-steps takes a whole number from 1 to 12');
    expect(failure(['--max-steps', '0'])).toBe('--max-steps takes a whole number from 1 to 12');
    expect(failure(['--max-steps', '2.5'])).toBe('--max-steps takes a whole number from 1 to 12');
    expect(failure(['--timeout', '900001'])).toBe('--timeout takes a whole number of ms, at most 900000');
    expect(failure(['--agent'])).toBe('--agent takes a value');
    expect(failure(['--steps', '3'])).toBe(`--steps is not something explore takes\n\n${EXPLORE_USAGE}`);
  });
});

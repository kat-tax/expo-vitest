import {describe, expect, it} from 'vitest';
import {MCP_USAGE, parseMcpArgs} from './args.ts';

describe("mcp's command line", () => {
  it('takes no flags, and then opens what the first session names, four at most', () => {
    expect(parseMcpArgs([])).toEqual({headed: false, force: false, maxSessions: 4});
  });

  it('takes a platform, a config, a window to watch, force, how many sessions, and help', () => {
    expect(parseMcpArgs(['--platform', 'windows', '--config', 'e2e/harness.config.ts', '--headed', '--force', '--max-sessions', '16', '-h'])).toEqual({
      platform: 'windows',
      config: 'e2e/harness.config.ts',
      headed: true,
      force: true,
      maxSessions: 16,
      help: true,
    });
    expect(parseMcpArgs(['--help']).help).toBe(true);
  });

  it('refuses a platform it does not drive, a count outside 1 to 16, a flag with no value, and a flag it does not take', () => {
    const failure = (args: string[]) => {
      try {
        parseMcpArgs(args);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(failure(['--platform', 'macos'])).toBe('--platform takes one of web, windows, android, ios, not macos');
    expect(failure(['--max-sessions', '0'])).toBe('--max-sessions takes a whole number from 1 to 16');
    expect(failure(['--max-sessions', '2.5'])).toBe('--max-sessions takes a whole number from 1 to 16');
    expect(failure(['--config'])).toBe('--config takes a value');
    expect(failure(['--port', '3000'])).toBe(`--port is not something mcp takes\n\n${MCP_USAGE}`);
  });
});

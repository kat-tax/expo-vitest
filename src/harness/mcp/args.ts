/** What `expo-harness mcp` takes on its command line. */
import {HarnessError} from '../lib/errors.ts';
import type {Platform} from '../lib/types.ts';
import {PLATFORMS} from '../lib/types.ts';

export interface McpOptions {
  platform?: Platform;
  config?: string;
  headed: boolean;
  force: boolean;
  maxSessions: number;
  /** Print the usage, and serve nothing. */
  help?: true;
}

export const MCP_USAGE = `expo-harness mcp [--platform <name>] [--config <path>] [--headed] [--force] [--max-sessions <n>]

  --platform <name>     what open_session opens where it names no target: ${PLATFORMS.join(', ')}
  --config <path>       a harness config other than the project root's
  --headed              on web, a browser window to watch
  --force               on Windows, act even while someone is using the machine
  --max-sessions <n>    how many sessions may be open at once, 1 to 16 (default 4)`;

/** The command's own flags. */
export function parseMcpArgs(args: readonly string[]): McpOptions {
  const options: McpOptions = {headed: false, force: false, maxSessions: 4};
  for (let at = 0; at < args.length; at++) {
    const flag = args[at];
    const value = () => {
      const given = args[++at];
      if (given === undefined) throw new HarnessError('INVALID_ARGUMENT', `${flag} takes a value`);
      return given;
    };
    if (flag === '--platform') {
      const platform = value();
      if (!PLATFORMS.includes(platform as Platform)) throw new HarnessError('INVALID_ARGUMENT', `--platform takes one of ${PLATFORMS.join(', ')}, not ${platform}`);
      options.platform = platform as Platform;
    } else if (flag === '--config') options.config = value();
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--force') options.force = true;
    else if (flag === '--max-sessions') {
      const count = Number(value());
      if (!Number.isInteger(count) || count < 1 || count > 16) throw new HarnessError('INVALID_ARGUMENT', '--max-sessions takes a whole number from 1 to 16');
      options.maxSessions = count;
    } else throw new HarnessError('INVALID_ARGUMENT', `${flag} is not something mcp takes\n\n${MCP_USAGE}`);
  }
  return options;
}

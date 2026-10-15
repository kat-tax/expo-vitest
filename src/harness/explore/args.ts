/** What `expo-harness explore` takes on its command line. */
import {HarnessError} from '../lib/errors.ts';
import type {Platform} from '../lib/types.ts';
import {PLATFORMS} from '../lib/types.ts';

export interface ExploreArgs {
  goal: string;
  platform?: Platform;
  config?: string;
  agent: string;
  /** Actions, 1 to 12. */
  maxSteps: number;
  /** In ms, at most 15 minutes. */
  timeout: number;
  headed: boolean;
  force: boolean;
  /** The report's folder, in place of `.harness/explore/<time>`. */
  out?: string;
  /** Print the usage, and explore nothing. */
  help?: true;
}

export const DEFAULT_GOAL = 'Explore the app and find bugs';
export const MOST_STEPS = 12;
export const LONGEST = 900_000;

export const EXPLORE_USAGE = `expo-harness explore [goal] [--platform <name>] [--agent <name>] [--max-steps <n>] [--timeout <ms>] [--headed] [--force] [--out <dir>]

  goal                  what to explore, with a posture, in quotes (default "${DEFAULT_GOAL}")
  --platform <name>     where to explore: ${PLATFORMS.join(', ')} (default: the first this machine can drive)
  --config <path>       a harness config other than the project root's
  --agent <name>        the agent from the harness config's agents that explores (default "default")
  --max-steps <n>       the actions it may take, 1 to ${MOST_STEPS} (default 8)
  --timeout <ms>        how long it may take, at most ${LONGEST} (default 600000)
  --headed              on web, a browser window to watch
  --force               on Windows, act even while someone is using the machine
  --out <dir>           the report's folder (default .harness/explore/<yyyy-mm-dd-hhmmss>)

It exits 1 when it reported an issue, 2 when it could not explore, else 0.`;

/** The command's own flags, and the goal: what is left, in words. */
export function parseExploreArgs(args: readonly string[]): ExploreArgs {
  const options: ExploreArgs = {goal: DEFAULT_GOAL, agent: 'default', maxSteps: 8, timeout: 600_000, headed: false, force: false};
  const words: string[] = [];
  const whole = (flag: string, given: string, least: number, most: number, what: string) => {
    const count = Number(given);
    if (!/^\d+$/.test(given) || count < least || count > most) throw new HarnessError('INVALID_ARGUMENT', `${flag} takes ${what}`);
    return count;
  };
  for (let at = 0; at < args.length; at++) {
    const flag = args[at] as string;
    const value = () => {
      const given = args[++at];
      if (given === undefined) throw new HarnessError('INVALID_ARGUMENT', `${flag} takes a value`);
      return given;
    };
    if (flag === '--platform' || flag === '-p') {
      const platform = value();
      if (!PLATFORMS.includes(platform as Platform)) throw new HarnessError('INVALID_ARGUMENT', `${flag} takes one of ${PLATFORMS.join(', ')}, not ${platform}`);
      options.platform = platform as Platform;
    } else if (flag === '--config') options.config = value();
    else if (flag === '--agent') options.agent = value();
    else if (flag === '--max-steps') options.maxSteps = whole(flag, value(), 1, MOST_STEPS, `a whole number from 1 to ${MOST_STEPS}`);
    else if (flag === '--timeout') options.timeout = whole(flag, value(), 1, LONGEST, `a whole number of ms, at most ${LONGEST}`);
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--force') options.force = true;
    else if (flag === '--out') options.out = value();
    else if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag.startsWith('-')) throw new HarnessError('INVALID_ARGUMENT', `${flag} is not something explore takes\n\n${EXPLORE_USAGE}`);
    else words.push(flag);
  }
  const goal = words.join(' ').trim();
  if (goal) options.goal = goal;
  return options;
}

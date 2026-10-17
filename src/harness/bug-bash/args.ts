/** What `expo-harness bug-bash` takes on its command line. */
import {LONGEST, MOST_STEPS} from '../explore/args.ts';
import {HarnessError} from '../lib/errors.ts';
import type {Platform} from '../lib/types.ts';
import {PLATFORMS} from '../lib/types.ts';

export interface BugBashArgs {
  featureMap: string;
  platform?: Platform;
  config?: string;
  /** The agent of a charter whose area names none. */
  agent: string;
  /** How many charters explore at once, 1 to 16, as the platform allows. */
  parallel: number;
  /** Each charter's actions, 1 to 12. */
  maxSteps: number;
  /** Each charter's time, in ms. */
  timeout: number;
  headed: boolean;
  force: boolean;
  /** The run's folder, in place of `.harness/bug-bash/<time>`. */
  out?: string;
  /** The device config the skeletons are run with, in place of the root's `vitest.config.device.*`. */
  vitestConfig?: string;
  /** Run the skeletons, so that a finding counts as a bug only when its check fails. */
  confirm: boolean;
  help?: true;
}

export const BUG_BASH_USAGE = `expo-harness bug-bash [--feature-map <file>] [--platform <name>] [--parallel <n>] [options]

  --feature-map <file>  the areas to explore and their goals, as JSON (default device/features.json)
  --platform <name>     where to explore: ${PLATFORMS.join(', ')} (default: the first this machine can drive)
  --config <path>       a harness config other than the project root's
  --agent <name>        the agent of an area that names none (default "default")
  --parallel <n>        charters at once, 1 to 16 (default 4); one on Windows, Android and iOS
  --max-steps <n>       each charter's actions, 1 to ${MOST_STEPS} (default 8)
  --timeout <ms>        each charter's time, at most ${LONGEST} (default 600000)
  --headed              on web, a browser window to watch each charter
  --force               on Windows, act even while someone is using the machine
  --out <dir>           the run's folder (default .harness/bug-bash/<yyyy-mm-dd-hhmmss>)
  --vitest-config <path> the device config the skeletons run with (default vitest.config.device.*)
  --no-confirm          write the skeletons, and run none of them

Each issue becomes a skeleton in device/bug-bash/, skipped unless HARNESS_BUGBASH is set, and is a bug
only when its skeleton fails its check. It exits 1 on a bug, or on an issue it did not check, 2 when no
charter could explore, else 0.`;

/** The command's own flags. */
export function parseBugBashArgs(args: readonly string[]): BugBashArgs {
  const options: BugBashArgs = {featureMap: 'device/features.json', agent: 'default', parallel: 4, maxSteps: 8, timeout: 600_000, headed: false, force: false, confirm: true};
  const whole = (flag: string, given: string, most: number, what: string) => {
    if (!/^\d+$/.test(given) || Number(given) < 1 || Number(given) > most) throw new HarnessError('INVALID_ARGUMENT', `${flag} takes ${what}`);
    return Number(given);
  };
  for (let at = 0; at < args.length; at++) {
    const flag = args[at] as string;
    const value = () => {
      const given = args[++at];
      if (given === undefined) throw new HarnessError('INVALID_ARGUMENT', `${flag} takes a value`);
      return given;
    };
    if (flag === '--feature-map') options.featureMap = value();
    else if (flag === '--platform' || flag === '-p') {
      const platform = value();
      if (!PLATFORMS.includes(platform as Platform)) throw new HarnessError('INVALID_ARGUMENT', `${flag} takes one of ${PLATFORMS.join(', ')}, not ${platform}`);
      options.platform = platform as Platform;
    } else if (flag === '--config') options.config = value();
    else if (flag === '--agent') options.agent = value();
    else if (flag === '--parallel') options.parallel = whole(flag, value(), 16, 'a whole number from 1 to 16');
    else if (flag === '--max-steps') options.maxSteps = whole(flag, value(), MOST_STEPS, `a whole number from 1 to ${MOST_STEPS}`);
    else if (flag === '--timeout') options.timeout = whole(flag, value(), LONGEST, `a whole number of ms, at most ${LONGEST}`);
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--force') options.force = true;
    else if (flag === '--out') options.out = value();
    else if (flag === '--vitest-config') options.vitestConfig = value();
    else if (flag === '--no-confirm') options.confirm = false;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new HarnessError('INVALID_ARGUMENT', `${flag} is not something bug-bash takes\n\n${BUG_BASH_USAGE}`);
  }
  return options;
}

/** How many charters a platform can explore at once, and why where it is fewer than asked. */
export function parallelOn(platform: Platform, asked: number, charters: number): {parallel: number; why?: string} {
  const most = Math.max(1, Math.min(asked, charters));
  if (platform === 'web' || most === 1) return {parallel: most};
  const why = platform === 'windows' ? 'Windows is one window, which one charter drives at a time' : `the bug bash takes one ${platform} device, so its charters explore one at a time`;
  return {parallel: 1, why};
}

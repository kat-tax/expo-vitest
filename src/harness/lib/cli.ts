/**
 * The command line, read: which steps to run, and how. Apart from the entry,
 * which runs the moment it is imported, so that reading it can be tested.
 */
import path from 'node:path';
import {HarnessError} from './errors.ts';
import type {Platform} from './types.ts';
import {PLATFORMS} from './types.ts';

const OUT = '.harness';

export const USAGE = `the harness: run an app on a platform and look at what it drew

  expo-harness doctor                    what this machine can drive
  expo-harness init [--yes]              set a project up to test with expo-vitest
  expo-harness guide [topic | --list]    how to write and run the tests, for a person or an agent
  expo-harness -p <platform> [options] <step>...

expo-vitest is the same command.

platforms   ${PLATFORMS.join(', ')}

steps       open <path|url>       a route, as a deep link or a URL
            snapshot [file]       the accessibility tree as JSON (stdout, or a file)
            tree                  the same, as indented text
            press <target>        a press on what a ref or selector names
            tap <x> <y>           a press at a point, when nothing names it
            fill <target> <text>  focus a field and put text in it
            type <text>           into whatever has focus
            screenshot <file>     a PNG, under ${OUT}/ unless the path says otherwise
            raise                 bring the app to the front (desktop)
            wait <ms>             let something settle
            idle                  how long the machine has been quiet
            bench [n]             time each operation n times (default 20), into ${OUT}/bench/

targets     @e7                   a ref from the last snapshot
            label="New drop"      by accessible name
            role=button           by role
            New drop              a bare word is a label

options     --url <url>           where the app is served (web; default http://localhost:8081)
            --scheme <scheme>     the app's URI scheme for deep links
            --target <what>       the device, simulator, exe or process to drive
            --out <dir>           where screenshots go (default ${OUT})
            --interactive         snapshot only what can be acted on
            --force               press even when someone is using the machine
            --settle <ms>         how long the screen must hold still after a step (default 150; 0 for no wait)
            --transition <ms>     how long a control that just came in is given before a press (default 500)
            --iterations <n>      how many times bench runs each operation
            --press <target>      something a press does nothing to, for bench to time press on
            --field <target>      a field for bench to time fill on
            --json                bench prints its result as JSON instead of a table
`;

export interface Options {
  platform?: Platform;
  url?: string;
  scheme?: string;
  target?: string;
  out: string;
  force: boolean;
  interactive: boolean;
  /** How long the screen must hold still after a step, in ms, where the command line said. */
  settle?: number;
  /** How long a control the last step brought in is given before it is pressed, in ms, where the command line said. */
  transition?: number;
  /** How many times `bench` runs each operation, as it was typed. */
  iterations?: string;
  /** What `bench` times `press` on: something a press does nothing to. */
  press?: string;
  /** The field `bench` times `fill` on. */
  field?: string;
  /** `bench` prints JSON rather than a table. */
  json: boolean;
  steps: string[][];
  command: 'doctor' | 'run' | 'help' | 'init' | 'guide';
  /** What follows `init` or `guide`, which each reads for itself. */
  args: string[];
}

export const STEP_ARGUMENTS: Record<string, number> = {
  open: 1,
  snapshot: 0,
  tree: 0,
  press: 1,
  tap: 2,
  fill: 2,
  type: 1,
  screenshot: 1,
  raise: 0,
  wait: 1,
  idle: 0,
  bench: 0,
};

/** Steps whose argument is optional, so a bare `snapshot` is also a step. */
export const OPTIONAL_ARGUMENT = new Set(['snapshot', 'bench']);

/** A whole number of milliseconds a flag was given, or a refusal that says what it takes. */
function milliseconds(flag: string, value: string): number {
  const number = Number(value);
  if (value === '' || !Number.isInteger(number) || number < 0) throw new HarnessError('INVALID_ARGUMENT', `${flag} takes a whole number of milliseconds, such as 150, or 0 for no wait`);
  return number;
}

export function parse(argv: string[]): Options {
  const options: Options = {out: OUT, force: false, interactive: false, json: false, steps: [], command: 'run', args: []};
  // init and guide take arguments of their own, and are known in the first place only, where no step is.
  const [first, ...after] = argv;
  if (first === 'init' || first === 'guide') return {...options, command: first, args: after};
  const rest: string[] = [];
  for (let at = 0; at < argv.length; at++) {
    const argument = argv[at];
    const value = () => argv[++at] ?? '';
    if (argument === '--platform' || argument === '-p') options.platform = value() as Platform;
    else if (argument === '--url') options.url = value();
    else if (argument === '--scheme') options.scheme = value();
    else if (argument === '--target') options.target = value();
    else if (argument === '--out') options.out = value();
    else if (argument === '--force') options.force = true;
    else if (argument === '--settle') options.settle = milliseconds('--settle', value());
    else if (argument === '--transition') options.transition = milliseconds('--transition', value());
    else if (argument === '--interactive' || argument === '-i') options.interactive = true;
    else if (argument === '--iterations') options.iterations = value();
    else if (argument === '--press') options.press = value();
    else if (argument === '--field') options.field = value();
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.command = 'help';
    else if (argument === 'doctor') options.command = 'doctor';
    else rest.push(argument);
  }
  for (let at = 0; at < rest.length; at++) {
    const name = rest[at];
    const takes = STEP_ARGUMENTS[name];
    if (takes === undefined) throw new HarnessError('INVALID_ARGUMENT', `${name} is not a step; try --help`);
    // An optional argument is taken only when the next word is not itself a step.
    const next = rest[at + 1];
    const optional = OPTIONAL_ARGUMENT.has(name) && next !== undefined && STEP_ARGUMENTS[next] === undefined;
    const wanted = optional ? 1 : takes;
    const args = rest.slice(at + 1, at + 1 + wanted);
    if (args.length < wanted) throw new HarnessError('INVALID_ARGUMENT', `${name} takes ${wanted} argument${wanted === 1 ? '' : 's'}`);
    options.steps.push([name, ...args]);
    at += wanted;
  }
  return options;
}

/**
 * Git Bash rewrites an argument that looks like an absolute POSIX path into one
 * under its own installation before the harness ever sees it, so `open /detail`
 * arrives as `C:/Program Files/Git/detail`. The shell says where it lives, so
 * this undoes it exactly rather than guessing.
 */
export function unmangleRoute(value: string, environment: NodeJS.ProcessEnv = process.env): string {
  const exe = environment.EXEPATH;
  if (!environment.MSYSTEM || !exe) return value;
  const root = path.dirname(exe).replace(/\\/g, '/');
  const normalized = value.replace(/\\/g, '/');
  if (!normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return value;
  return `/${normalized.slice(root.length + 1)}`;
}

/** Where a screenshot lands: under the out directory unless the step named a path of its own. */
export function screenshotPath(file: string, out: string): string {
  if (path.isAbsolute(file) || file.includes('/') || file.includes('\\')) return file;
  return path.join(out, file);
}

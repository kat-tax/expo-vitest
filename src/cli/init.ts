/**
 * `expo-vitest init`: sets a project up to test with this package. It finds
 * what the project has, asks four questions, shows every file before it
 * writes it, never overwrites one, and installs only when told to. What it
 * decides is in `plan.ts` and `templates.ts`; this asks and writes.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {launchOf} from '../device/app-process.ts';
import type {Platform} from '../harness/lib/types.ts';
import {PLATFORMS} from '../harness/lib/types.ts';
import type {AppJson, Detection, Manifest} from './detect.ts';
import {detect} from './detect.ts';
import type {Step} from './plan.ts';
import {planInit} from './plan.ts';
import {skillFiles} from './skill.ts';
import type {Choices, Command} from './templates.ts';
import {AGENT_LINE, installCommands, MCP_ADD, MCP_FILES, shown} from './templates.ts';

/** The folders a project keeps its tests in, walked to see whether it has any. */
const WALKED = ['src', 'app', 'components', 'lib', 'device', 'test', 'tests', '__tests__'];

/** The files at a project's root, and those in the folders tests live in, as relative paths with forward slashes. */
function filesOf(root: string): string[] {
  const found: string[] = [];
  const walk = (folder: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, folder), {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = folder ? `${folder}/${entry.name}` : entry.name;
      found.push(relative);
      if (entry.isDirectory() && depth > 0 && entry.name !== 'node_modules' && !entry.name.startsWith('.') && (folder !== '' || WALKED.includes(entry.name))) walk(relative, depth - 1);
    }
  };
  walk('', 6);
  return found;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** The command a person types for a script, through the project's manager. */
function script(detection: Detection, name: string): string {
  if (detection.manager === 'npm') return name === 'test' ? 'npm test' : `npm run ${name}`;
  return detection.manager === 'bun' ? `bun run ${name}` : `${detection.manager} ${name}`;
}

/** A step as it is shown before it is written. */
function show(step: Step): string {
  const indented = (text: string) => text.replace(/\n$/, '').replace(/^/gm, '    ');
  switch (step.kind) {
    case 'create':
      return `\n+ ${step.path}, new:\n${indented(step.content)}`;
    case 'edit':
      return `\n~ ${step.path}:\n${indented(step.diff)}`;
    case 'keep':
      return `\n= ${step.why}${step.content ? `. It would have written:\n${indented(step.content)}` : '.'}`;
    case 'print':
      return `\n! ${step.why}:\n${indented(step.content)}`;
  }
}

/** Asks one question, and answers its default to an empty line. */
async function ask(rl: readline.Interface, question: string, fallback: string): Promise<string> {
  const answer = (await rl.question(question)).trim();
  return answer || fallback;
}

async function yesNo(rl: readline.Interface, question: string): Promise<boolean> {
  return /^y/i.test(await ask(rl, `${question} [Y/n] `, 'y'));
}

/** The platforms named in an answer, or the ones offered where it names none of them. */
function platformsIn(answer: string, offered: Platform[]): Platform[] {
  const named = answer
    .split(/[\s,]+/)
    .map(word => word.toLowerCase())
    .filter((word): word is Platform => (PLATFORMS as string[]).includes(word));
  return named.length ? PLATFORMS.filter(platform => named.includes(platform)) : offered;
}

function run(command: Command, root: string): boolean {
  console.log(`\n$ ${shown(command)}`);
  const launch = launchOf({executable: command.command, args: command.args, cwd: root}, process.platform, process.env, fs.existsSync);
  const ran = spawnSync(launch.file, launch.args, {cwd: root, stdio: 'inherit', windowsVerbatimArguments: launch.verbatim});
  return ran.status === 0;
}

export async function init(argv: string[], root: string = process.cwd()): Promise<number> {
  const yes = argv.includes('--yes') || argv.includes('-y');
  // The MCP server's files are offered to a person, and written under --yes only where --mcp asks for them.
  const mcp = argv.includes('--mcp');
  if (argv.includes('--agent')) {
    console.error('init --agent sets up the agent, which this version does not have yet');
    return 2;
  }
  const unknown = argv.filter(argument => argument !== '--yes' && argument !== '-y' && argument !== '--mcp');
  if (unknown.length) {
    console.error(`init takes --yes and --mcp, and not ${unknown.join(' ')}`);
    return 2;
  }
  const manifestFile = path.join(root, 'package.json');
  const manifest = readJson<Manifest>(manifestFile);
  if (!manifest) {
    console.error(`run init in a project's folder: there is no package.json in ${root}`);
    return 1;
  }
  const app = readJson<AppJson>(path.join(root, 'app.json')) ?? readJson<AppJson>(path.join(root, 'app.config.json'));
  const detection = detect({manifest, files: filesOf(root), environment: process.env, ...(app ? {app} : {})});
  for (const warning of detection.warnings) console.log(`note: ${warning}`);

  const rl = yes ? null : readline.createInterface({input: process.stdin, output: process.stdout});
  try {
    const choices: Choices = rl
      ? {
          platforms: platformsIn(await ask(rl, `Platforms [${detection.platforms.join(' ')}]: Enter keeps them, or type the ones you want: `, ''), detection.platforms),
          device: await yesNo(rl, 'Set up device tests?'),
          agent: await yesNo(rl, 'Add the skill for coding agents?'),
          mcp: mcp || (await yesNo(rl, `Register the MCP server for Claude Code and Cursor, in ${MCP_FILES.join(' and ')}?`)),
        }
      : {platforms: detection.platforms, device: true, agent: true, mcp};
    const install = rl ? await yesNo(rl, 'Install the packages now?') : false;

    const read = (file: string) => {
      try {
        return fs.readFileSync(path.join(root, file), 'utf8');
      } catch {
        return undefined;
      }
    };
    let all = yes;
    for (const step of planInit(detection, choices, read, choices.agent ? skillFiles() : [])) {
      console.log(show(step));
      if (step.kind === 'keep' || step.kind === 'print') continue;
      if (!all && rl) {
        const answer = (await ask(rl, `  write ${step.path}? [y]es, [n]o, [a]ll: `, 'y')).toLowerCase();
        if (answer.startsWith('a')) all = true;
        else if (!answer.startsWith('y')) {
          console.log(`  left ${step.path} as it is`);
          continue;
        }
      }
      const target = path.join(root, step.path);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, step.content);
      console.log(`  wrote ${step.path}`);
    }

    const commands = installCommands(detection, choices, manifest);
    if (commands.length && install) {
      for (const command of commands) {
        if (!run(command, root)) {
          console.error(`\n${shown(command)} failed; run it yourself, then the commands below`);
          return 1;
        }
      }
    } else if (commands.length) {
      console.log('\nInstall what the tests need:');
      for (const command of commands) console.log(`  ${shown(command)}`);
    }
    console.log('\nNext:');
    console.log(`  ${script(detection, 'test').padEnd(26)}the component tests`);
    if (choices.device) console.log(`  ${script(detection, 'test:device').padEnd(26)}the device tests, which start the app through harness.config.ts`);
    if (choices.agent) console.log(`\nFor a coding agent, add this line to AGENTS.md or CLAUDE.md, which init leaves to you:\n  ${AGENT_LINE}`);
    if (choices.mcp) console.log(`\nClaude Code asks before it first starts a server a project names. For Claude Code alone, this writes the same entry:\n  ${MCP_ADD}`);
    return 0;
  } finally {
    rl?.close();
  }
}

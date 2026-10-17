/**
 * Every file `init` writes, and every command it runs, as functions of what
 * it found and what it was told, so each is tested by its text.
 */
import {DEFAULT_MODEL} from '../agent/anthropic.ts';
import type {Platform} from '../harness/lib/types.ts';
import type {Detection, Manifest, PackageManager} from './detect.ts';

/** What the person answered: the platforms, whether to set up device tests, and whether to add the coding-agent files. */
export interface Choices {
  platforms: Platform[];
  device: boolean;
  agent: boolean;
  /** The MCP server, registered where Claude Code and Cursor read a project's servers. */
  mcp?: boolean;
  /** The agent's model, where `init --agent` sets the agent up. */
  model?: AgentChoice;
}

/**
 * The agent `init --agent` sets up: Claude through the adapter here, named
 * where it is not the adapter's own model, with a sentence of what the app
 * is for its context; or a model of the project's own, which is code init
 * cannot write.
 */
export interface AgentChoice {
  provider: 'claude' | 'other';
  model?: string;
  context?: string;
}

/** The model init offers: the Claude adapter's own. */
export const AGENT_MODEL = DEFAULT_MODEL;

/** The line that brings the Claude adapter into `harness.config.ts`. */
export const ANTHROPIC_IMPORT = "import {anthropic} from 'expo-vitest/agent/anthropic';";

/** A string as the configs init writes spell one: in single quotes. */
function literal(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** The agent's entry in `harness.config.ts`, each line at `indent` deeper than the one around it: Claude, and what the app is where it was said. */
export function agentEntry(choice: AgentChoice, indent = '  '): string {
  const model = choice.model && choice.model !== AGENT_MODEL ? `anthropic({model: ${literal(choice.model)}})` : 'anthropic()';
  const context = choice.context ? `, context: ${literal(choice.context)}` : '';
  return `${indent}agents: {\n${indent}${indent}default: {model: ${model}${context}},\n${indent}},\n`;
}

/** What init prints for a model of the project's own, to add to `harness.config.ts` by hand. */
export const OWN_MODEL = `agents: {
  // A Model is {id, complete(request)}: npx expo-vitest guide agent shows one.
  default: {model: myModel},
},`;

/** The order a config names platforms in. */
const ORDER: Platform[] = ['ios', 'android', 'web', 'windows'];

const ordered = (platforms: Platform[]) => ORDER.filter(platform => platforms.includes(platform));
const quoted = (values: string[]) => `[${values.map(value => `'${value}'`).join(', ')}]`;

/** The platforms device tests start on: web where there is web, since it needs no build, and otherwise the ones chosen. */
export function devicePlatforms(choices: Choices): Platform[] {
  return choices.platforms.includes('web') ? ['web'] : ordered(choices.platforms);
}

/** `vitest.config.mts`: a project per platform. */
export function vitestConfig(choices: Choices): string {
  return `import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest/config';

export default defineConfig({
  test: {projects: expoProjects({platforms: ${quoted(ordered(choices.platforms))}})},
});
`;
}

/** `vitest.config.device.mts`: the device tests, a project per platform. */
export function deviceVitestConfig(choices: Choices): string {
  return `import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest/config';

export default defineConfig(deviceConfig({platforms: ${quoted(devicePlatforms(choices))}}));
`;
}

/** How the package manager runs a package's command: `npx expo`, `bunx expo`, `pnpm exec expo`, `yarn expo`. */
export function runner(manager: PackageManager): string[] {
  return {npm: ['npx'], bun: ['bunx'], pnpm: ['pnpm', 'exec'], yarn: ['yarn']}[manager];
}

/** `harness.config.ts`: each chosen platform's app, with the app's own ids where `app.json` has them. */
export function harnessConfig(detection: Detection, choices: Choices): string {
  const {identity} = detection;
  const scheme = identity.scheme ? `, scheme: '${identity.scheme}'` : '';
  const [executable, ...through] = runner(detection.manager);
  const entries: string[] = [];
  if (choices.platforms.includes('web')) {
    const args = quoted([...through, 'expo', 'start', '--web', '--port', '{port}']);
    entries.push(`    web: {url: 'http://localhost:8081', command: {executable: '${executable}', args: ${args}}},`);
  }
  const placeholder = '    // The app id is a placeholder: put your own here.\n';
  if (choices.platforms.includes('android')) entries.push(`${identity.package ? '' : placeholder}    android: {bundleId: '${identity.package ?? 'com.example.app'}'${scheme}},`);
  if (choices.platforms.includes('ios')) entries.push(`${identity.bundleId ? '' : placeholder}    ios: {bundleId: '${identity.bundleId ?? 'com.example.app'}'${scheme}},`);
  // A Windows app is found as the exe under windows/x64, so only a scheme is worth saying.
  if (choices.platforms.includes('windows') && identity.scheme) entries.push(`    windows: {scheme: '${identity.scheme}'},`);
  const claude = choices.model?.provider === 'claude' ? choices.model : null;
  return `import {defineHarness} from 'expo-vitest/config';
${claude ? `${ANTHROPIC_IMPORT}\n` : ''}
export default defineHarness({
  app: {
${entries.join('\n')}
  },
${claude ? agentEntry(claude) : ''}});
`;
}

/** `src/platform.test.ts`, which runs on every project the config makes. */
export function platformTest(): string {
  return `import {Platform} from 'react-native';

it('knows its platform', () => {
  expect(['ios', 'android', 'web', 'windows']).toContain(Platform.OS);
});
`;
}

/** `device/example.test.ts`: a device test that opens the app and reads what it drew. */
export function deviceExampleTest(): string {
  return `import {device} from 'expo-vitest';

it('opens the app and reads what it drew', async () => {
  await device.open('/');
  const tree = await device.fullSnapshot();
  expect(tree.nodes.length).toBeGreaterThan(0);
  // Kept as evidence until a baseline is recorded: HARNESS_UPDATE_SCREENSHOTS=1, or vitest -u.
  await expect(device).toMatchScreenshot('home');
});
`;
}

/** The scripts `init` adds, where the manifest does not have them. */
export function scripts(choices: Choices): Record<string, string> {
  return {test: 'vitest run', 'test:watch': 'vitest', ...(choices.device ? {'test:device': 'vitest run --config vitest.config.device.mts'} : {})};
}

/** The types `tsconfig.json` needs, for the globals and the matchers on `expect`, which bring the engine's with them. */
export const TYPES = ['expo-vitest/types'];

/** What `.gitignore` needs: the folder the harness writes its evidence to. */
export const IGNORED = ['.harness/'];

/**
 * The packages a project needs, less the ones it has: this one and the
 * runner. Everything else, the engines, the testing libraries, jsdom and
 * the drivers, comes with this one, whatever the project's platforms.
 */
export function packagesFor(manifest: Manifest): string[] {
  return ['expo-vitest', 'vitest'].filter(name => !hasPackage(manifest, name));
}

/** Whether the manifest names a package, as a dependency of either kind. */
function hasPackage(manifest: Manifest, name: string): boolean {
  return manifest.dependencies?.[name] !== undefined || manifest.devDependencies?.[name] !== undefined;
}

/** A command `init` runs, as it is shown before it runs. */
export interface Command {
  command: string;
  args: string[];
  why: string;
}

/** The commands that install what is missing: through `expo install` in an Expo app, which picks versions that fit the SDK, and the manager's own add elsewhere. */
export function installCommands(detection: Detection, choices: Choices, manifest: Manifest): Command[] {
  const packages = packagesFor(manifest);
  const [command, ...through] = runner(detection.manager);
  const add = {npm: ['npm', 'install', '--save-dev'], bun: ['bun', 'add', '--dev'], pnpm: ['pnpm', 'add', '--save-dev'], yarn: ['yarn', 'add', '--dev']}[detection.manager];
  const commands: Command[] = [];
  if (packages.length) {
    commands.push(
      detection.expoSdk === null
        ? {command: add[0] as string, args: [...add.slice(1), ...packages], why: 'the test packages'}
        : {command, args: [...through, 'expo', 'install', '--dev', ...packages], why: 'the test packages, at versions that fit the Expo SDK'},
    );
  }
  if (choices.device && devicePlatforms(choices).includes('web')) {
    commands.push({command, args: [...through, 'expo-harness', 'install'], why: 'the Chromium the web device tests drive'});
  }
  // The SDK is a Node package with no native code, so it comes through the manager's own add, not expo install.
  if (choices.model?.provider === 'claude' && !hasPackage(manifest, '@anthropic-ai/sdk')) {
    commands.push({command: add[0] as string, args: [...add.slice(1), '@anthropic-ai/sdk'], why: "the SDK the agent's Claude adapter calls"});
  }
  return commands;
}

/** A command as a person would type it. */
export function shown(command: Command): string {
  return [command.command, ...command.args].map(word => (/\s/.test(word) ? JSON.stringify(word) : word)).join(' ');
}

/** The MCP server's entry, the same where Claude Code reads a project's servers and where Cursor does. */
export const MCP_SERVER = {type: 'stdio', command: 'npx', args: ['expo-harness', 'mcp']};

/** Where Claude Code and Cursor read a project's MCP servers. */
export const MCP_FILES = ['.mcp.json', '.cursor/mcp.json'];

/** The command that writes the same entry for Claude Code alone. */
export const MCP_ADD = 'claude mcp add --transport stdio --scope project expo-harness -- npx expo-harness mcp';

/** The line `init` asks a person to add to their agent instructions, which it does not write itself. */
export const AGENT_LINE = 'Tests use expo-vitest. Run `npx expo-vitest guide` for how to write them, run them and read a failure.';

/** A step in words, as init shows one once it has set the agent up. */
export const AGENT_EXAMPLE = "await agent.act('open the settings and turn on dark mode'); // import {agent} from 'expo-vitest/agent'";

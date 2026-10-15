/**
 * Every file `init` writes, and every command it runs, as functions of what
 * it found and what it was told, so each is tested by its text.
 */
import type {Platform} from '../harness/lib/types.ts';
import type {Detection, Manifest, PackageManager} from './detect.ts';

/** What the person answered: the platforms, whether to set up device tests, and whether to add the coding-agent files. */
export interface Choices {
  platforms: Platform[];
  device: boolean;
  agent: boolean;
}

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
import {expoProjects} from 'expo-vitest';

export default defineConfig({
  test: {projects: expoProjects({platforms: ${quoted(ordered(choices.platforms))}})},
});
`;
}

/** `vitest.config.device.mts`: the device tests, a project per platform. */
export function deviceVitestConfig(choices: Choices): string {
  return `import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest';

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
  return `import {defineHarness} from 'expo-vitest/device';

export default defineHarness({
  app: {
${entries.join('\n')}
  },
});
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
  return `import {device} from 'expo-vitest/device';

afterAll(() => device.close());

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

/** The types `tsconfig.json` needs, for the globals and the matchers on `expect`. */
export const TYPES = ['vitest-expo/types', 'expo-vitest/types'];

/** What `.gitignore` needs: the folder the harness writes its evidence to. */
export const IGNORED = ['.harness/'];

/** The packages a project with these choices needs, less the ones it has. */
export function packagesFor(detection: Detection, choices: Choices, manifest: Manifest): string[] {
  const native = choices.platforms.some(platform => platform !== 'web');
  const wanted = [
    'expo-vitest',
    'vitest',
    'vitest-expo',
    'vitest-native',
    ...(native ? ['@testing-library/react-native'] : []),
    // RNTL 14 renders through test-renderer, which 13 has built in.
    ...(native && (detection.rntl === null || detection.rntl >= 14) ? ['test-renderer'] : []),
    ...(choices.platforms.includes('web') ? ['@testing-library/react', '@testing-library/jest-dom', 'jsdom'] : []),
    ...(choices.device && devicePlatforms(choices).includes('web') ? ['playwright-core'] : []),
  ];
  const has = (name: string) => manifest.dependencies?.[name] !== undefined || manifest.devDependencies?.[name] !== undefined;
  return wanted.filter(name => !has(name));
}

/** A command `init` runs, as it is shown before it runs. */
export interface Command {
  command: string;
  args: string[];
  why: string;
}

/** The commands that install what is missing: through `expo install` in an Expo app, which picks versions that fit the SDK, and the manager's own add elsewhere. */
export function installCommands(detection: Detection, choices: Choices, manifest: Manifest): Command[] {
  const packages = packagesFor(detection, choices, manifest);
  const [command, ...through] = runner(detection.manager);
  const commands: Command[] = [];
  if (packages.length) {
    const add = {npm: ['npm', 'install', '--save-dev'], bun: ['bun', 'add', '--dev'], pnpm: ['pnpm', 'add', '--save-dev'], yarn: ['yarn', 'add', '--dev']}[detection.manager];
    commands.push(
      detection.expoSdk === null
        ? {command: add[0] as string, args: [...add.slice(1), ...packages], why: 'the test packages'}
        : {command, args: [...through, 'expo', 'install', '--dev', ...packages], why: 'the test packages, at versions that fit the Expo SDK'},
    );
  }
  if (choices.device && devicePlatforms(choices).includes('web')) {
    commands.push({command, args: [...through, 'playwright-core', 'install', 'chromium', '--only-shell'], why: 'the Chromium the web device tests drive'});
  }
  return commands;
}

/** A command as a person would type it. */
export function shown(command: Command): string {
  return [command.command, ...command.args].map(word => (/\s/.test(word) ? JSON.stringify(word) : word)).join(' ');
}

/** The line `init` asks a person to add to their agent instructions, which it does not write itself. */
export const AGENT_LINE = 'Tests use expo-vitest. Run `npx expo-vitest guide` for how to write them, run them and read a failure.';

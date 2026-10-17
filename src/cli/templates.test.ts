import {describe, expect, it} from 'vitest';
import type {Detection} from './detect.ts';
import type {Choices} from './templates.ts';
import {
  AGENT_LINE,
  AGENT_MODEL,
  agentEntry,
  ANTHROPIC_IMPORT,
  deviceExampleTest,
  devicePlatforms,
  deviceVitestConfig,
  harnessConfig,
  IGNORED,
  installCommands,
  packagesFor,
  platformTest,
  runner,
  scripts,
  shown,
  TYPES,
  vitestConfig,
} from './templates.ts';

const found = (extra: Partial<Detection> = {}): Detection => ({
  manager: 'npm',
  expoSdk: 57,
  rntl: null,
  platforms: ['web', 'android', 'ios'],
  typescript: true,
  identity: {},
  hasTests: false,
  warnings: [],
  ...extra,
});
const chose = (extra: Partial<Choices> = {}): Choices => ({platforms: ['web', 'android', 'ios'], device: true, agent: true, ...extra});

describe('the configs', () => {
  it('name the platforms chosen, in the order a config names them', () => {
    expect(vitestConfig(chose({platforms: ['web', 'ios', 'android']}))).toBe(`import {defineConfig} from 'vitest/config';
import {expoProjects} from 'expo-vitest/config';

export default defineConfig({
  test: {projects: expoProjects({platforms: ['ios', 'android', 'web']})},
});
`);
  });

  it('start device tests on web where there is web, and on the platforms chosen where there is not', () => {
    expect(devicePlatforms(chose())).toEqual(['web']);
    expect(devicePlatforms(chose({platforms: ['windows', 'android']}))).toEqual(['android', 'windows']);
    expect(deviceVitestConfig(chose())).toBe(`import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest/config';

export default defineConfig(deviceConfig({platforms: ['web']}));
`);
  });
});

describe('the harness config', () => {
  it("serves web through the project's own manager, and names each app by app.json's ids", () => {
    const text = harnessConfig(found({manager: 'bun', identity: {scheme: 'shop', bundleId: 'com.example.shop.ios', package: 'com.example.shop'}}), chose({platforms: ['web', 'android', 'ios', 'windows']}));
    expect(text).toBe(`import {defineHarness} from 'expo-vitest/config';

export default defineHarness({
  app: {
    web: {url: 'http://localhost:8081', command: {executable: 'bunx', args: ['expo', 'start', '--web', '--port', '{port}']}},
    android: {bundleId: 'com.example.shop', scheme: 'shop'},
    ios: {bundleId: 'com.example.shop.ios', scheme: 'shop'},
    windows: {scheme: 'shop'},
  },
});
`);
  });

  it('marks a placeholder id, and says nothing of Windows without a scheme', () => {
    const text = harnessConfig(found({manager: 'pnpm'}), chose({platforms: ['web', 'android', 'windows']}));
    expect(text).toContain(`command: {executable: 'pnpm', args: ['exec', 'expo', 'start', '--web', '--port', '{port}']}`);
    expect(text).toContain(`    // The app id is a placeholder: put your own here.\n    android: {bundleId: 'com.example.app'},`);
    expect(text).not.toContain('windows');
    expect(harnessConfig(found(), chose({platforms: ['ios']}))).toContain(`    // The app id is a placeholder: put your own here.\n    ios: {bundleId: 'com.example.app'},`);
  });
});

describe("the agent's entry", () => {
  it("is Claude through the adapter, named only where it is not the adapter's own model, with what the app is", () => {
    expect(AGENT_MODEL).toBe('claude-opus-5-5');
    expect(agentEntry({provider: 'claude'})).toBe('  agents: {\n    default: {model: anthropic()},\n  },\n');
    expect(agentEntry({provider: 'claude', model: AGENT_MODEL, context: "Ada's shop"}, '\t')).toBe("\tagents: {\n\t\tdefault: {model: anthropic(), context: 'Ada\\'s shop'},\n\t},\n");
    expect(agentEntry({provider: 'claude', model: 'claude-sonnet-5-5', context: 'a\\b\nc'})).toContain("default: {model: anthropic({model: 'claude-sonnet-5-5'}), context: 'a\\\\b\\nc'}");
  });

  it('comes into a new harness config with the adapter imported, and not for a model of its own', () => {
    expect(harnessConfig(found(), chose({platforms: ['android'], model: {provider: 'claude', context: 'A shop'}}))).toBe(`import {defineHarness} from 'expo-vitest/config';
${ANTHROPIC_IMPORT}

export default defineHarness({
  app: {
    // The app id is a placeholder: put your own here.
    android: {bundleId: 'com.example.app'},
  },
  agents: {
    default: {model: anthropic(), context: 'A shop'},
  },
});
`);
    expect(harnessConfig(found(), chose({platforms: ['android'], model: {provider: 'other'}}))).not.toContain('agents');
  });
});

describe('the example tests', () => {
  it('check the platform on every project, and open the app on a device', () => {
    expect(platformTest()).toContain("expect(['ios', 'android', 'web', 'windows']).toContain(Platform.OS);");
    expect(deviceExampleTest()).toContain("await device.open('/');");
    expect(deviceExampleTest()).toContain("await expect(device).toMatchScreenshot('home');");
  });
});

describe('the edits', () => {
  it('add the scripts, the device one with device tests', () => {
    expect(scripts(chose())).toEqual({test: 'vitest run', 'test:watch': 'vitest', 'test:device': 'vitest run --config vitest.config.device.mts'});
    expect(scripts(chose({device: false}))).toEqual({test: 'vitest run', 'test:watch': 'vitest'});
  });

  it("add the types and the harness's folder", () => {
    expect(TYPES).toEqual(['expo-vitest/types']);
    expect(IGNORED).toEqual(['.harness/']);
    expect(AGENT_LINE).toContain('npx expo-vitest guide');
  });
});

describe('what is installed', () => {
  it('is this package and the runner, whatever the platforms, since the rest comes with this package', () => {
    expect(packagesFor({})).toEqual(['expo-vitest', 'vitest']);
  });

  it('leaves out what the project has', () => {
    expect(packagesFor({devDependencies: {vitest: '4.1.0'}})).toEqual(['expo-vitest']);
    expect(packagesFor({dependencies: {'expo-vitest': '0.2.0'}, devDependencies: {vitest: '4.1.0'}})).toEqual([]);
  });

  it("goes through expo install in an Expo app, and the manager's add elsewhere", () => {
    expect(installCommands(found(), chose({platforms: ['web']}), {}).map(shown)).toEqual([
      'npx expo install --dev expo-vitest vitest',
      'npx expo-harness install',
    ]);
    expect(installCommands(found({manager: 'yarn', expoSdk: null}), chose({platforms: ['windows'], device: false}), {}).map(shown)).toEqual([
      'yarn add --dev expo-vitest vitest',
    ]);
    expect(installCommands(found({manager: 'bun', expoSdk: null}), chose({platforms: ['android'], device: false}), {})[0]?.command).toBe('bun');
    expect(installCommands(found({manager: 'pnpm', expoSdk: null}), chose({platforms: ['android'], device: false}), {})[0]?.args.slice(0, 2)).toEqual(['add', '--save-dev']);
    expect(installCommands(found({manager: 'npm', expoSdk: null}), chose({platforms: ['android'], device: false}), {})[0]?.args.slice(0, 2)).toEqual(['install', '--save-dev']);
  });

  it('runs nothing where everything is there', () => {
    const all = Object.fromEntries(packagesFor({}).map(name => [name, '1']));
    expect(installCommands(found(), chose({platforms: ['ios'], device: false}), {devDependencies: all})).toEqual([]);
  });

  it("adds the Claude SDK through the manager's own add, where the agent is Claude and the project lacks it", () => {
    const all = Object.fromEntries(packagesFor({}).map(name => [name, '1']));
    const claude = chose({platforms: ['ios'], device: false, model: {provider: 'claude'}});
    expect(installCommands(found(), claude, {devDependencies: all}).map(shown)).toEqual(['npm install --save-dev @anthropic-ai/sdk']);
    expect(installCommands(found({manager: 'bun'}), claude, {devDependencies: all}).map(shown)).toEqual(['bun add --dev @anthropic-ai/sdk']);
    expect(installCommands(found(), claude, {devDependencies: {...all, '@anthropic-ai/sdk': '1'}})).toEqual([]);
    expect(installCommands(found(), chose({platforms: ['ios'], device: false, model: {provider: 'other'}}), {devDependencies: all})).toEqual([]);
  });

  it("is run through the manager's runner, and shown as typed", () => {
    expect([runner('npm'), runner('bun'), runner('pnpm'), runner('yarn')]).toEqual([['npx'], ['bunx'], ['pnpm', 'exec'], ['yarn']]);
    expect(shown({command: 'npx', args: ['expo', 'a b'], why: ''})).toBe('npx expo "a b"');
  });
});

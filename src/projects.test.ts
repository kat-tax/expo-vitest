import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {deviceConfig, expoProjects, file, installedIn, installFolders, isInstalled, nodeProject, SELF, selfAliases, SUBPATHS} from './projects.ts';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'));

/** A project's `test` block, which the type leaves optional. */
function testOf(project: {test?: Record<string, any>}): Record<string, any> {
  return project.test as Record<string, any>;
}

describe('the subpaths', () => {
  it('are the ones the package exports, each a source file that exists', () => {
    const exported = Object.keys(manifest.exports)
      .filter(key => !['.', './types', './package.json'].includes(key))
      .map(key => key.slice(2));
    expect(Object.keys(SUBPATHS).sort()).toEqual(exported.sort());
    for (const [subpath, source] of Object.entries(SUBPATHS)) {
      expect(fs.existsSync(path.join(PACKAGE, 'src', source)), subpath).toBe(true);
      // The compiled file the export names is the source's, under `dist`.
      expect(manifest.exports[`./${subpath}`].default).toBe(`./dist/${source.replace(/\.tsx?$/, '.js')}`);
    }
  });

  it('alias each to its file here, source while this is source', () => {
    expect(file('windows.ts')).toBe(path.join(PACKAGE, 'src', 'windows.ts'));
    // Compiled, the file beside this one is JavaScript, whatever it was.
    expect(file('router.tsx', true)).toBe(path.join(PACKAGE, 'src', 'router.js'));
    const aliases = selfAliases();
    expect(aliases).toHaveLength(Object.keys(SUBPATHS).length);
    const router = aliases.find(alias => (alias.find as RegExp).test('expo-vitest/router'));
    expect(router?.replacement).toBe(path.join(PACKAGE, 'src', 'router.tsx'));
    // A subpath is matched whole: `device` is not `device/matchers`.
    expect(aliases.filter(alias => (alias.find as RegExp).test('expo-vitest/device/matchers'))).toHaveLength(1);
    expect(aliases.filter(alias => (alias.find as RegExp).test('expo-vitest/windows/more'))).toHaveLength(0);
  });
});

describe('the module graph', () => {
  it('keeps this package in it where it is installed, and not what a checkout of the same name installs', () => {
    expect(SELF.test('C:/work/app/node_modules/expo-vitest/dist/native.js')).toBe(true);
    expect(SELF.test('/work/app/node_modules/.pnpm/expo-vitest@1.0.0/node_modules/expo-vitest/dist/native.js')).toBe(true);
    expect(SELF.test('C:\\work\\app\\node_modules\\expo-vitest\\dist\\native.js')).toBe(true);
    expect(SELF.test('C:\\dev\\expo-vitest\\node_modules\\react-native\\index.js')).toBe(false);
    expect(SELF.test('/dev/expo-vitest/src/native.ts')).toBe(false);
  });
});

describe('isInstalled', () => {
  it('finds a package up through the folders, and not one that is nowhere', () => {
    expect(isInstalled(path.join(PACKAGE, 'src'), 'vitest')).toBe(true);
    expect(isInstalled(PACKAGE, 'expo-vitest-no-such-package')).toBe(false);
    const holder = installedIn(path.join(PACKAGE, 'src'), 'vitest') as string;
    expect(fs.existsSync(path.join(holder, 'node_modules', 'vitest', 'package.json'))).toBe(true);
    expect(installedIn(PACKAGE, 'expo-vitest-no-such-package')).toBeNull();
  });

  it('names where a package is served from: where it is found, and where a link to it really leads', () => {
    const holder = installedIn(PACKAGE, 'vitest') as string;
    expect(installFolders(PACKAGE, 'vitest')).toEqual([holder]);
    expect(installFolders(PACKAGE, 'expo-vitest-no-such-package')).toEqual([PACKAGE]);

    // An app whose package manager links packages in from a store elsewhere.
    const temporary = fs.realpathSync(os.tmpdir());
    const store = fs.mkdtempSync(path.join(temporary, 'expo-vitest-store-'));
    const app = fs.mkdtempSync(path.join(temporary, 'expo-vitest-app-'));
    try {
      const stored = path.join(store, 'node_modules', '.store', 'linked@1.0.0', 'node_modules', 'linked');
      fs.mkdirSync(stored, {recursive: true});
      fs.writeFileSync(path.join(stored, 'package.json'), '{}');
      fs.mkdirSync(path.join(app, 'node_modules'));
      fs.symlinkSync(stored, path.join(app, 'node_modules', 'linked'), 'junction');
      expect(installFolders(app, 'linked')).toEqual([app, store]);
    } finally {
      fs.rmSync(app, {recursive: true, force: true});
      fs.rmSync(store, {recursive: true, force: true});
    }
  });
});

describe('expoProjects', () => {
  it('makes a project per platform, each taking the files its name is in', () => {
    const projects = expoProjects({root: PACKAGE});
    expect(projects.map(project => testOf(project).name)).toEqual(['ios', 'android', 'windows', 'web']);
    const [ios, android, windows, web] = projects.map(testOf);
    expect(ios.include).toEqual(['src/**/*.test.{ts,tsx}']);
    expect(ios.exclude).toEqual(expect.arrayContaining(['**/*.web.test.*', '**/*.android.test.*', '**/*.windows.test.*']));
    expect(android.exclude).toEqual(expect.arrayContaining(['**/*.ios.test.*']));
    expect(android.exclude).not.toContain('**/*.android.test.*');
    expect(windows.include).toEqual(['src/**/*.windows.test.{ts,tsx}', 'src/**/*.test.ts']);
    expect(windows.exclude).toEqual(expect.arrayContaining(['**/*.native.test.*', '**/*.web.test.*']));
    expect(web.exclude).toEqual(expect.arrayContaining(['**/*.native.test.*', '**/*.windows.test.*']));
    // Vite's root as well as Vitest's: the engine's plugins read the first.
    expect(projects.map(project => project.root)).toEqual([PACKAGE, PACKAGE, PACKAGE, PACKAGE]);
    for (const project of [ios, android, windows, web]) {
      expect(project).toMatchObject({globals: true, clearMocks: true, testTimeout: 15_000, root: PACKAGE});
      expect(project.setupFiles).toHaveLength(1);
      expect(fs.existsSync(project.setupFiles[0]), project.setupFiles[0]).toBe(true);
    }
  });

  it('takes the folders, the platforms, the timeout and a Windows project of another name and other files', () => {
    const projects = expoProjects({
      root: PACKAGE,
      platforms: ['windows'],
      include: ['src', 'app'],
      timeout: 1000,
      windows: {name: 'runtime', include: ['src/**/*.test.{ts,tsx}'], forbid: ['a'], resolveIn: ['node_modules/kit/src']},
    });
    expect(projects).toHaveLength(1);
    expect(testOf(projects[0])).toMatchObject({name: 'runtime', include: ['src/**/*.test.{ts,tsx}'], testTimeout: 1000});
    const names = (projects[0].plugins as {name?: string}[]).map(plugin => plugin.name);
    expect(names.slice(0, 2)).toEqual(['expo-vitest:forbid-modules', 'expo-vitest:windows-resolution']);

    const [ios] = expoProjects({root: PACKAGE, platforms: ['ios'], include: ['src', 'app']});
    expect(testOf(ios).include).toEqual(['src/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}']);
  });

  it('is rooted where Vitest runs unless told otherwise', () => {
    const [ios] = expoProjects({platforms: ['ios']});
    expect(ios.root).toBe(process.cwd());
  });

  it('lets web read the project itself where the engine is nowhere to be found', () => {
    const nowhere = path.parse(PACKAGE).root;
    const [web] = expoProjects({root: nowhere, platforms: ['web']});
    expect((web.server as {fs: {allow: string[]}}).fs.allow).toContain(nowhere);
  });

  it('pre-bundles for web only what is installed, with what it was given besides', () => {
    const [web] = expoProjects({root: PACKAGE, platforms: ['web'], web: {optimize: ['vitest', 'expo-vitest-no-such-package'], alias: [{find: 'a', replacement: 'b'}]}});
    const include: string[] = testOf(web).deps.optimizer.client.include;
    expect(include).toContain('vitest');
    expect(include).not.toContain('expo-vitest-no-such-package');
    expect(include).toContain('@expo/ui');
    expect((web.resolve as unknown as {alias: {find: unknown}[]}).alias.map(alias => alias.find)).toContain('a');
    // The folder the engine is installed in can be read, wherever a hoisted install put it.
    const allow = (web.server as {fs: {allow: string[]}}).fs.allow;
    expect(allow).toEqual(expect.arrayContaining(installFolders(PACKAGE, 'vitest-expo')));
  });
});

describe('nodeProject and deviceConfig', () => {
  it('is a Node project of the name and files given', () => {
    expect(testOf(nodeProject({name: 'cli', include: ['cli/**/*.test.js'], root: PACKAGE, timeout: 5}))).toEqual({
      name: 'cli',
      root: PACKAGE,
      testTimeout: 5,
      environment: 'node',
      globals: true,
      clearMocks: true,
      include: ['cli/**/*.test.js'],
    });
    expect(testOf(nodeProject({name: 'cli', include: []}))).toMatchObject({root: process.cwd(), testTimeout: 15_000});
  });

  it('runs device tests one at a time, with the matchers registered', () => {
    const device = testOf(deviceConfig());
    expect(device).toMatchObject({name: 'device', include: ['device/**/*.test.ts'], fileParallelism: false, maxWorkers: 1, testTimeout: 120_000, hookTimeout: 120_000});
    expect(device.setupFiles).toEqual([path.join(PACKAGE, 'src', 'device', 'matchers.ts')]);
    expect(testOf(deviceConfig({include: ['e2e/**/*.test.ts'], timeout: 10}))).toMatchObject({include: ['e2e/**/*.test.ts'], testTimeout: 10});
  });

  it('hands the waits after a step to the tests through their environment, and nothing when none was given', () => {
    expect(testOf(deviceConfig({settle: 0, transition: 300})).env).toEqual({HARNESS_SETTLE: '0', HARNESS_TRANSITION: '300'});
    expect(testOf(deviceConfig({settle: false})).env).toEqual({HARNESS_SETTLE: '0'});
    expect(testOf(deviceConfig({transition: false})).env).toEqual({HARNESS_TRANSITION: '0'});
    expect(testOf(deviceConfig())).not.toHaveProperty('env');
  });

  it('hands how long a wait looks, and how long an absence must hold, to the tests the same way', () => {
    expect(testOf(deviceConfig({assertionTimeout: 8000, stable: 500})).env).toEqual({HARNESS_ASSERTION_TIMEOUT: '8000', HARNESS_STABLE: '500'});
  });
});

describe('deviceConfig with platforms', () => {
  const projectsOf = (config: {test?: {projects?: unknown}}) => (config.test?.projects ?? []) as {root: string; test: Record<string, any>}[];
  const folder = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'expo-vitest-harness-'));

  afterEach(() => vi.unstubAllEnvs());

  it('is a project per platform, in the order given, each once', () => {
    const names = projectsOf(deviceConfig({platforms: ['android', 'web', 'android']})).map(project => project.test.name);
    expect(names).toEqual(['device:android', 'device:web']);
  });

  it("takes each project's platform over the shell's, and the waits as the single form does", () => {
    vi.stubEnv('HARNESS_PLATFORM', 'ios');
    const [web] = projectsOf(deviceConfig({platforms: ['web'], settle: false, assertionTimeout: 8000, include: ['e2e/**/*.test.ts'], timeout: 10}));
    expect(web!.test).toMatchObject({
      env: {HARNESS_PLATFORM: 'web', HARNESS_SETTLE: '0', HARNESS_ASSERTION_TIMEOUT: '8000'},
      include: ['e2e/**/*.test.ts'],
      testTimeout: 10,
      hookTimeout: 10,
      provide: {'harness.platform': 'web'},
    });
  });

  it('finds the harness config at the root, or takes the one named, or the environment\'s', () => {
    const root = folder();
    expect(projectsOf(deviceConfig({platforms: ['web'], root}))[0]!.test.provide['harness.file']).toBeNull();
    fs.writeFileSync(path.join(root, 'harness.config.mts'), 'export default {};');
    expect(projectsOf(deviceConfig({platforms: ['web'], root}))[0]!.test.provide['harness.file']).toBe(path.join(root, 'harness.config.mts'));
    fs.mkdirSync(path.join(root, 'e2e'));
    fs.writeFileSync(path.join(root, 'e2e', 'harness.ts'), 'export default {};');
    expect(projectsOf(deviceConfig({platforms: ['web'], root, harness: 'e2e/harness.ts'}))[0]!.test.provide['harness.file']).toBe(path.join(root, 'e2e', 'harness.ts'));
    vi.stubEnv('HARNESS_CONFIG', 'e2e/harness.ts');
    expect(projectsOf(deviceConfig({platforms: ['web'], root}))[0]!.test.provide['harness.file']).toBe(path.join(root, 'e2e', 'harness.ts'));
    expect(() => deviceConfig({platforms: ['web'], root, harness: 'gone.ts'})).toThrow(expect.objectContaining({code: 'INVALID_CONFIG'}));
  });

  it("runs a pool's files side by side, each pooled platform in a group of its own", () => {
    const root = folder();
    fs.writeFileSync(path.join(root, 'harness.config.mjs'), "export default {app: {android: {devices: ['Pixel_8', 'Pixel_9']}, web: {workers: 3}}};");
    const [web, android, ios] = projectsOf(deviceConfig({platforms: ['web', 'android', 'ios'], root}));
    expect([web, android, ios].map(project => [project!.test.maxWorkers, project!.test.fileParallelism, project!.test.sequence])).toEqual([
      [3, true, {setupFiles: 'list', groupOrder: 1}],
      [2, true, {setupFiles: 'list', groupOrder: 2}],
      [1, false, {setupFiles: 'list'}],
    ]);
    vi.stubEnv('HARNESS_TARGET', 'emulator-5554');
    expect(projectsOf(deviceConfig({platforms: ['android'], root}))[0]!.test.maxWorkers).toBe(1);
  });

  it("takes the root from HARNESS_ROOT, else the working directory, for Vite and for Vitest", () => {
    const root = folder();
    vi.stubEnv('HARNESS_ROOT', root);
    const [fromEnvironment] = projectsOf(deviceConfig({platforms: ['web']}));
    expect([fromEnvironment!.root, fromEnvironment!.test.root, fromEnvironment!.test.provide['harness.root']]).toEqual([root, root, root]);
    vi.unstubAllEnvs();
    expect(projectsOf(deviceConfig({platforms: ['web']}))[0]!.root).toBe(process.cwd());
  });

  it("keeps the reporters at the config's root, in either form, and adds none unless given", () => {
    const reporters = ['default', {onTestRunEnd: () => {}}];
    expect(deviceConfig({reporters}).test?.reporters).toBe(reporters);
    expect(deviceConfig({platforms: ['web'], reporters}).test?.reporters).toBe(reporters);
    expect(deviceConfig({platforms: ['web']}).test).not.toHaveProperty('reporters');
  });

  it('refuses a platform it does not know, none at all, and harness or root without platforms', () => {
    expect(() => deviceConfig({platforms: ['macos' as 'web']})).toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT', message: 'deviceConfig takes platforms from web, windows, android, ios, not "macos"'}));
    expect(() => deviceConfig({platforms: []})).toThrow('deviceConfig takes platforms from web, windows, android, ios, at least one');
    expect(() => deviceConfig({harness: 'harness.config.ts'})).toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT', message: 'deviceConfig takes harness and root with platforms, which say what they are for'}));
    expect(() => deviceConfig({root: '.'})).toThrow('deviceConfig takes harness and root with platforms');
  });
});

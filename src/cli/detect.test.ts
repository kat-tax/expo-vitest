import {describe, expect, it} from 'vitest';
import {detect, identityOf, isTestFile, majorOf, packageManagerOf, platformsOf, VERIFIED_SDK} from './detect.ts';

const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;
const files = (...names: string[]) => new Set(names);

describe('the package manager', () => {
  it("is the manifest's packageManager first", () => {
    expect(packageManagerOf({packageManager: 'pnpm@9.1.0'}, files('bun.lock'), env())).toBe('pnpm');
    expect(packageManagerOf({packageManager: 'bun@1.3.0'}, files(), env())).toBe('bun');
    expect(packageManagerOf({packageManager: 'yarn@4.0.0'}, files(), env())).toBe('yarn');
    expect(packageManagerOf({packageManager: 'npm@11.0.0'}, files('bun.lock'), env())).toBe('npm');
  });

  it('is the lockfile next, then the one that ran init, then npm', () => {
    expect(packageManagerOf({packageManager: 'deno@2'}, files('bun.lockb'), env())).toBe('bun');
    expect(packageManagerOf({}, files('bun.lock'), env())).toBe('bun');
    expect(packageManagerOf({}, files('pnpm-lock.yaml'), env())).toBe('pnpm');
    expect(packageManagerOf({}, files('yarn.lock'), env())).toBe('yarn');
    expect(packageManagerOf({}, files('package-lock.json'), env({npm_config_user_agent: 'bun/1.3'}))).toBe('npm');
    expect(packageManagerOf({}, files(), env({npm_config_user_agent: 'pnpm/9.1.0 npm/? node/v24'}))).toBe('pnpm');
    expect(packageManagerOf({}, files(), env({npm_config_user_agent: 'npm/11 node/v24'}))).toBe('npm');
    expect(packageManagerOf({}, files(), env())).toBe('npm');
  });
});

describe('a major version', () => {
  it('is the first number of a range, or none', () => {
    expect([majorOf('^57.0.0'), majorOf('~14.1'), majorOf('57'), majorOf('>=13 <15')]).toEqual([57, 14, 57, 13]);
    expect([majorOf('latest'), majorOf('workspace:*'), majorOf(undefined)]).toEqual([null, null, null]);
  });
});

describe('the platforms', () => {
  it('are the native pair with Expo or their folders, web with a DOM, Windows with react-native-windows', () => {
    expect(platformsOf({dependencies: {expo: '^57.0.0', 'react-native-web': '0.21'}}, files())).toEqual(['web', 'android', 'ios']);
    expect(platformsOf({dependencies: {'react-native': '0.83'}}, files('android/build.gradle'))).toEqual(['android']);
    expect(platformsOf({dependencies: {'react-native': '0.83'}}, files('ios'))).toEqual(['ios']);
    expect(platformsOf({devDependencies: {'react-dom': '19', 'react-native-windows': '0.84'}}, files())).toEqual(['web', 'windows']);
  });

  it('are all four where nothing says, as in a library', () => {
    expect(platformsOf({dependencies: {react: '19'}}, files('src/index.ts'))).toEqual(['web', 'windows', 'android', 'ios']);
  });
});

describe("the app's identity", () => {
  it("is app.json's slug, first scheme, bundle id and package", () => {
    expect(identityOf({expo: {slug: 'shop', scheme: ['shop', 'shop-dev'], ios: {bundleIdentifier: 'com.example.shop'}, android: {package: 'com.example.shop'}}})).toEqual({
      slug: 'shop',
      scheme: 'shop',
      bundleId: 'com.example.shop',
      package: 'com.example.shop',
    });
    expect(identityOf({expo: {scheme: 'shop'}})).toEqual({scheme: 'shop'});
    expect(identityOf({})).toEqual({});
    expect(identityOf(undefined)).toEqual({});
  });
});

describe('a test file', () => {
  it('is one the file-name rule picks up, outside node_modules', () => {
    expect(['src/button.test.tsx', 'src/a.windows.test.tsx', 'device/home.test.ts', 'lib/x.test.mjs'].every(isTestFile)).toBe(true);
    expect(['src/button.tsx', 'src/test.ts', 'node_modules/x/a.test.ts', 'src/a.test.json'].some(isTestFile)).toBe(false);
  });
});

describe('what init finds', () => {
  it('gathers the findings of a project', () => {
    const found = detect({
      manifest: {dependencies: {expo: '^57.0.0', 'react-native-web': '0.21'}, devDependencies: {'@testing-library/react-native': '^14.0.0'}},
      files: ['bun.lock', 'tsconfig.json', 'app/index.tsx', 'src/button.test.tsx'],
      environment: env(),
      app: {expo: {scheme: 'shop', android: {package: 'com.example.shop'}}},
    });
    expect(found).toEqual({
      manager: 'bun',
      expoSdk: 57,
      rntl: 14,
      platforms: ['web', 'android', 'ios'],
      typescript: true,
      identity: {scheme: 'shop', package: 'com.example.shop'},
      hasTests: true,
      warnings: [],
    });
  });

  it('warns of an SDK it is not verified on, and an RNTL it does not support, and goes on', () => {
    const found = detect({manifest: {dependencies: {expo: '~55.0.0'}, devDependencies: {'@testing-library/react-native': '12.4.0'}}, files: [], environment: env()});
    expect(found.warnings).toEqual([
      `expo-vitest is verified on Expo SDK ${VERIFIED_SDK}, and this project is on 55; it may work, and init goes on`,
      'React Native Testing Library 12 is older than the 13 this package needs; upgrade it',
    ]);
    expect([found.typescript, found.hasTests, found.rntl]).toEqual([false, false, 12]);
  });

  it('knows a project with no Expo and no RNTL', () => {
    expect(detect({manifest: {}, files: [], environment: env()})).toMatchObject({expoSdk: null, rntl: null, warnings: []});
  });
});

/**
 * What `init` finds in a project before it writes anything: the package
 * manager, the Expo SDK, which React Native Testing Library, the platforms,
 * TypeScript, the app's identity, and whether there are tests already.
 * Pure, over the manifest, the files that exist, `app.json` and the
 * environment, so each finding is tested without a project on disk.
 */
import type {Platform} from '../harness/lib/types.ts';
import {PLATFORMS} from '../harness/lib/types.ts';

/** As much of `package.json` as `init` reads. */
export interface Manifest {
  name?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/** As much of `app.json` as `init` reads. */
export interface AppJson {
  expo?: {
    slug?: string;
    scheme?: string | string[];
    ios?: {bundleIdentifier?: string};
    android?: {package?: string};
  };
}

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm';

/** The app's own names, where `app.json` gives them. */
export interface Identity {
  slug?: string;
  scheme?: string;
  bundleId?: string;
  package?: string;
}

export interface Detection {
  manager: PackageManager;
  /** The Expo SDK's major version, or null where the project has no `expo`. */
  expoSdk: number | null;
  /** React Native Testing Library's major version, or null where it is not installed. */
  rntl: number | null;
  /** The platforms the project has, or all four where nothing says, as in a library. */
  platforms: Platform[];
  typescript: boolean;
  identity: Identity;
  /** Whether a test file is there already, by the file-name rule. */
  hasTests: boolean;
  /** What the run should say before it goes on. */
  warnings: string[];
}

/** The SDK this package is verified on. */
export const VERIFIED_SDK = 57;

/** A dependency's version range, from either list. */
function versionOf(manifest: Manifest, name: string): string | undefined {
  return manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
}

/** The major version a range names, or null where it names none, as `latest` or `workspace:*` do. */
export function majorOf(range: string | undefined): number | null {
  const match = range?.match(/(\d+)(?:\.\d+)*/);
  return match ? Number(match[1]) : null;
}

/** The package manager: the manifest's `packageManager`, else a lockfile, else the one that ran this, else npm. */
export function packageManagerOf(manifest: Manifest, files: ReadonlySet<string>, environment: NodeJS.ProcessEnv): PackageManager {
  const named = manifest.packageManager?.split('@')[0];
  if (named === 'bun' || named === 'pnpm' || named === 'yarn' || named === 'npm') return named;
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun';
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('package-lock.json')) return 'npm';
  const agent = environment.npm_config_user_agent?.split('/')[0];
  return agent === 'bun' || agent === 'pnpm' || agent === 'yarn' ? agent : 'npm';
}

/** The platforms a project has: iOS and Android with Expo or their folders, web with react-native-web or react-dom, Windows with react-native-windows. */
export function platformsOf(manifest: Manifest, files: ReadonlySet<string>): Platform[] {
  const has = (name: string) => versionOf(manifest, name) !== undefined;
  const folder = (name: string) => [...files].some(file => file === name || file.startsWith(`${name}/`));
  const found = new Set<Platform>();
  if (has('expo') || folder('ios')) found.add('ios');
  if (has('expo') || folder('android')) found.add('android');
  if (has('react-native-web') || has('react-dom')) found.add('web');
  if (has('react-native-windows')) found.add('windows');
  return found.size ? PLATFORMS.filter(platform => found.has(platform)) : [...PLATFORMS];
}

/** The app's names from `app.json`: its slug, its first scheme, its bundle id and its package. */
export function identityOf(app: AppJson | undefined): Identity {
  const expo = app?.expo;
  const scheme = Array.isArray(expo?.scheme) ? expo.scheme[0] : expo?.scheme;
  return {
    ...(expo?.slug ? {slug: expo.slug} : {}),
    ...(scheme ? {scheme} : {}),
    ...(expo?.ios?.bundleIdentifier ? {bundleId: expo.ios.bundleIdentifier} : {}),
    ...(expo?.android?.package ? {package: expo.android.package} : {}),
  };
}

/** A test file by the file-name rule: `.test.` and a script's extension, outside `node_modules`. */
export function isTestFile(file: string): boolean {
  return /\.test\.(ts|tsx|js|jsx|mts|mjs)$/.test(file) && !file.split('/').includes('node_modules');
}

/** Everything `init` needs to know of a project, and what it should warn of. */
export function detect(input: {manifest: Manifest; files: string[]; environment: NodeJS.ProcessEnv; app?: AppJson}): Detection {
  const files = new Set(input.files);
  const {manifest} = input;
  const expoSdk = majorOf(versionOf(manifest, 'expo'));
  const rntl = majorOf(versionOf(manifest, '@testing-library/react-native'));
  const warnings: string[] = [];
  if (expoSdk !== null && expoSdk !== VERIFIED_SDK) warnings.push(`expo-vitest is verified on Expo SDK ${VERIFIED_SDK}, and this project is on ${expoSdk}; it may work, and init goes on`);
  if (rntl !== null && rntl < 13) warnings.push(`React Native Testing Library ${rntl} is older than the 13 this package needs; upgrade it`);
  return {
    manager: packageManagerOf(manifest, files, input.environment),
    expoSdk,
    rntl,
    platforms: platformsOf(manifest, files),
    typescript: files.has('tsconfig.json'),
    identity: identityOf(input.app),
    hasTests: input.files.some(isTestFile),
    warnings,
  };
}

// Runs the fixture's tests against the package as an app would have it: the
// component projects, then the device tests, on web and on a platform this
// machine cannot drive. Web needs a Chromium, which
// `playwright-core install chromium-headless-shell` puts in place.
//
//   node scripts/fixture.js
//   node scripts/fixture.js --update-lockfile
//
// The fixture is copied to a folder outside this one and installed there, from
// its own lockfile. `npm pack` builds the package (`prepack`) and makes the
// tarball a publish would upload; that is unpacked into the copy's
// `node_modules` and named in its manifest, and the fixture's tests run there.
//
// Outside, and really installed, because both are what an app has and each
// hides something otherwise:
//
// - The engine under the iOS and Android projects leaves alone any package
//   whose folder contains the run, taking it to be the project itself. A
//   fixture inside this folder is never treated the way an app's dependency
//   is, so what only happens to a dependency cannot show. The engine compiling
//   this package with React Native's Babel preset, which broke its setup file,
//   was one such thing.
// - Packages linked in from this folder's `node_modules` rather than installed
//   make a layout the engine keeps two copies of a module in, which fails for
//   reasons that are neither the package's nor an app's.
//
// `--update-lockfile` installs without the lockfile and copies the new one
// back, for when the fixture's manifest changes.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'fixture');
const update = process.argv.includes('--update-lockfile');
const shell = process.platform === 'win32';
// The real path, since a temporary folder is often reached through a link and the engine compares paths.
const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'expo-vitest-fixture-'));
const modules = path.join(scratch, 'node_modules');
const installed = path.join(modules, 'expo-vitest');

/** Runs a command in the scratch folder, its output with this one's. */
function run(command, args, options = {}) {
  execFileSync(command, args, {cwd: scratch, stdio: 'inherit', ...options});
}

try {
  fs.cpSync(fixture, scratch, {recursive: true, filter: source => path.basename(source) !== 'node_modules'});

  console.log(`==== What an app has installed, in ${scratch}`);
  run('bun', ['install', ...(update ? [] : ['--frozen-lockfile'])], {shell});
  if (update) {
    fs.copyFileSync(path.join(scratch, 'bun.lock'), path.join(fixture, 'bun.lock'));
    console.log('fixture/bun.lock updated');
  }

  console.log('==== The package, as published');
  fs.mkdirSync(installed, {recursive: true});
  execFileSync('npm', ['pack', '--pack-destination', modules, '--loglevel', 'error'], {cwd: root, stdio: ['ignore', 'ignore', 'inherit'], shell});
  const [tarball] = fs.readdirSync(modules).filter(name => name.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack left no tarball');
  // Names only, from the folder they are in: a Windows tar reads `C:` as a host name, and GNU tar a backslash as a character.
  run('tar', ['-xzf', tarball, '-C', 'expo-vitest', '--strip-components=1'], {cwd: modules});
  fs.rmSync(path.join(modules, tarball));

  const packed = fs.readdirSync(installed, {recursive: true}).filter(name => fs.statSync(path.join(installed, name)).isFile());
  const sources = packed.filter(name => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'));
  if (sources.length) throw new Error(`the package ships TypeScript Node cannot load: ${sources.join(', ')}`);

  // Named in the manifest as an app names it, which is what the engine reads to decide how to treat it.
  const manifestFile = path.join(scratch, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const {version} = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  manifest.devDependencies = {...manifest.devDependencies, 'expo-vitest': version};
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${tarball}: ${packed.length} files`);

  // The skill ships, and the command an app has prints it.
  console.log('==== The guide, from the package');
  const listed = execFileSync(process.execPath, [path.join(installed, 'dist', 'harness', 'index.js'), 'guide', '--list'], {cwd: scratch, encoding: 'utf8'});
  process.stdout.write(listed);
  if (!listed.includes('device ')) throw new Error('the packed package does not ship the skill guide prints');

  console.log('==== The fixture, on it');
  run(process.execPath, [path.join(modules, 'vitest', 'vitest.mjs'), 'run']);

  // A real Chromium over a page the harness config's command serves, with a
  // trace kept for every test, so the last test can read the ones before it.
  // Beside it, a platform this machine cannot drive: its tests are skipped
  // with the driver's reason, and fail where the run requires the platform.
  const absent = process.platform === 'darwin' ? 'windows' : 'ios';
  const device = [path.join(modules, 'vitest', 'vitest.mjs'), 'run', '--config', 'vitest.config.device.mts'];
  // Playwright records video with the build of ffmpeg its own version names,
  // and looks for no other, and Firefox and WebKit are builds that work with
  // the version that installed them alone. So the copy's playwright-core
  // fetches its own: ffmpeg, and the browser HARNESS_BROWSER names, once, and
  // nothing where they are already there.
  const own = ['ffmpeg', ...(['firefox', 'webkit'].includes(process.env.HARNESS_BROWSER) ? [process.env.HARNESS_BROWSER] : [])];
  console.log(`==== The fixture's playwright-core, with its ${own.join(' and ')}`);
  run(process.execPath, [path.join(modules, 'playwright-core', 'cli.js'), 'install', ...own]);
  const environment = {...process.env, FIXTURE_ABSENT: absent, HARNESS_TRACE: 'on'};
  console.log(`==== The device tests, on web and on ${absent}, which this machine cannot drive`);
  const skipped = execFileSync(process.execPath, device, {cwd: scratch, env: {...environment, HARNESS_REQUIRE: '0'}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
  process.stdout.write(skipped);
  if (!skipped.includes(`no ${absent} device to drive here`)) throw new Error(`the ${absent} tests were not skipped with the driver's reason`);
  if (!skipped.includes('web cannot home, since a browser has no home screen')) throw new Error('the test that needs a home screen was not skipped on web with the reason');
  const summarised = fs.readFileSync(path.join(scratch, '.harness', 'summary.md'), 'utf8');
  if (!/^## expo-vitest · \d+ passed · \d+ skipped/.test(summarised)) throw new Error(`the summary reporter wrote no summary of the run: ${summarised.slice(0, 200)}`);
  // The reporter named on the command line replaces the config's, so a run
  // that fails on purpose writes no summary and posts no comment.
  console.log('==== Video kept for the test that fails, and for no other');
  let videoRun = '';
  try {
    execFileSync(process.execPath, [...device, '--project', 'device:web', '--reporter', 'verbose', 'device/video'], {cwd: scratch, env: {...environment, FIXTURE_VIDEO: '1', HARNESS_VIDEO: 'retain-on-failure'}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    throw new Error('the test that fails on purpose passed');
  } catch (error) {
    videoRun = `${error.stdout}${error.stderr}`;
    if (!`${error.stdout}`.includes('fails on purpose, and keeps its recording')) throw error;
  }
  const recorded = path.join(scratch, '.harness', 'results', 'web', 'device', 'video');
  const kept = fs.readdirSync(recorded).filter(test => fs.existsSync(path.join(recorded, test, 'video.webm')));
  if (kept.length !== 1 || !kept[0].startsWith('fails-on-purpose')) throw new Error(`video.webm was kept for ${kept.join(', ') || 'no test'}, not for the one test that failed:\n${videoRun}`);
  if (fs.readFileSync(path.join(recorded, kept[0], 'video.webm')).readUInt32BE(0) !== 0x1a45dfa3) throw new Error('the video.webm kept is not a WebM file');
  console.log(`video.webm is in ${kept[0]} alone`);
  console.log(`==== ${absent} required, so its tests fail`);
  try {
    execFileSync(process.execPath, [...device, '--project', `device:${absent}`, '--reporter', 'verbose'], {cwd: scratch, env: {...environment, HARNESS_REQUIRE: '1'}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    throw new Error(`the ${absent} tests passed under HARNESS_REQUIRE`);
  } catch (error) {
    if (!`${error.stdout}${error.stderr}`.includes('DRIVER_UNAVAILABLE')) throw error;
    console.log('they failed with DRIVER_UNAVAILABLE');
  }

  // Last, since it takes the app's own tests and configs away: init on what
  // a project starting out has, from the packed package's command, and then
  // the component tests on the config it wrote. The device config it writes
  // is not run: its command serves the app on the port of an app's own.
  console.log('==== init --yes, on the app with its tests and configs taken away');
  for (const name of ['vitest.config.mts', 'vitest.config.device.mts', 'harness.config.ts', 'src', 'device', '.harness']) {
    fs.rmSync(path.join(scratch, name), {recursive: true, force: true});
  }
  run(process.execPath, [path.join(installed, 'dist', 'harness', 'index.js'), 'init', '--yes']);
  for (const file of ['vitest.config.mts', 'vitest.config.device.mts', 'harness.config.ts', 'src/platform.test.ts', 'device/example.test.ts', '.claude/skills/expo-vitest/SKILL.md', '.gitignore']) {
    if (!fs.existsSync(path.join(scratch, file))) throw new Error(`init --yes did not write ${file}`);
  }
  console.log('==== The component tests init wrote, on the config it wrote');
  run(process.execPath, [path.join(modules, 'vitest', 'vitest.mjs'), 'run']);
} finally {
  try {
    fs.rmSync(scratch, {recursive: true, force: true, maxRetries: 4, retryDelay: 500});
  } catch (error) {
    // A process the run started may hold the copy as its own folder for a
    // while: agent-device's daemon, started there to say what it can drive,
    // keeps it until it has been idle some minutes. The tests have answered.
    console.warn(`left ${scratch} behind: ${error.message}`);
  }
}

// Runs the test app's device tests against the package as an app would have
// it: on web, or on the platforms TESTAPP_PLATFORMS names, as android,web.
// Web needs a Chromium, which `playwright-core install chromium-headless-shell`
// puts in place. Android needs the app's development build on the device
// HARNESS_TARGET names (docs/contributing.md, The test app).
//
//   node scripts/testapp.js
//   node scripts/testapp.js --update-lockfile
//
// `TESTAPP_RESULTS` names a folder the copy's `.harness/` is kept in, as CI
// uploads it; it goes with the copy otherwise.
//
// The app is copied to a folder outside this one and installed there from its
// own lockfile, and the tarball `npm pack` makes is unpacked into the copy's
// `node_modules` and named in its manifest, for the reasons
// scripts/fixture.js gives. `--update-lockfile` installs without the lockfile
// and copies the new one back, for when the app's manifest changes.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'testapp');
const update = process.argv.includes('--update-lockfile');
const shell = process.platform === 'win32';
// The real path, since a temporary folder is often reached through a link and the engine compares paths.
const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'expo-vitest-testapp-'));
const modules = path.join(scratch, 'node_modules');
const installed = path.join(modules, 'expo-vitest');
// What installing, serving, building and testing the app leave in its folder, none of which a copy starts with.
const made = new Set(['node_modules', '.expo', '.harness', 'android', 'ios', 'dist']);

/** Runs a command in the scratch folder, its output with this one's. */
function run(command, args, options = {}) {
  execFileSync(command, args, {cwd: scratch, stdio: 'inherit', ...options});
}

try {
  fs.cpSync(app, scratch, {recursive: true, filter: source => source === app || !made.has(path.basename(source))});

  console.log(`==== The app, installed in ${scratch}`);
  run('bun', ['install', ...(update ? [] : ['--frozen-lockfile'])], {shell});
  if (update) {
    fs.copyFileSync(path.join(scratch, 'bun.lock'), path.join(app, 'bun.lock'));
    console.log('testapp/bun.lock updated');
  }

  console.log('==== The package, as published');
  fs.mkdirSync(installed, {recursive: true});
  execFileSync('npm', ['pack', '--pack-destination', modules, '--loglevel', 'error'], {cwd: root, stdio: ['ignore', 'ignore', 'inherit'], shell});
  const [tarball] = fs.readdirSync(modules).filter(name => name.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack left no tarball');
  // Names only, from the folder they are in: a Windows tar reads `C:` as a host name, and GNU tar a backslash as a character.
  run('tar', ['-xzf', tarball, '-C', 'expo-vitest', '--strip-components=1'], {cwd: modules});
  fs.rmSync(path.join(modules, tarball));
  const manifestFile = path.join(scratch, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const {version} = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  manifest.devDependencies = {...manifest.devDependencies, 'expo-vitest': version};
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  // The tests as an app has them, against the types the package ships.
  console.log('==== The app and its tests, type-checked');
  run(process.execPath, [path.join(modules, 'typescript', 'bin', 'tsc'), '--noEmit']);

  console.log(`==== The device tests, on ${process.env.TESTAPP_PLATFORMS ?? 'web'}`);
  run(process.execPath, [path.join(modules, 'vitest', 'vitest.mjs'), 'run', '--config', 'vitest.config.device.mts']);
} finally {
  const kept = path.join(scratch, '.harness');
  if (process.env.TESTAPP_RESULTS && fs.existsSync(kept)) fs.cpSync(kept, process.env.TESTAPP_RESULTS, {recursive: true, force: true});
  try {
    fs.rmSync(scratch, {recursive: true, force: true, maxRetries: 4, retryDelay: 500});
  } catch (error) {
    // The dev server the run started, or agent-device's daemon, may hold the
    // copy as its own folder for a while after the tests have answered.
    console.warn(`left ${scratch} behind: ${error.message}`);
  }
}

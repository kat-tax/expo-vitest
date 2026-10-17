#!/usr/bin/env node
/**
 * The harness: run an app on a platform, drive it, and look at what it drew.
 *
 *   expo-harness doctor
 *   expo-harness -p web --url http://localhost:8085 open / tree
 *   expo-harness -p windows --target <exe> press 'label="New"' screenshot after.png
 *
 * Steps run in order in one session, so a sequence is a flow rather than four
 * disconnected commands. Targets are `agent-device`'s: a ref from a snapshot
 * (`@e7`), a selector (`label="New"`, `role=button`), or a bare label.
 *
 * Windows is driven here (there is no `agent-device` backend for it); iOS and
 * Android are driven by `agent-device`; web by a headless Chromium through
 * `playwright-core`.
 *
 * Everything is relative to the project the command is run in, or to
 * `HARNESS_ROOT` when that is set.
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {FEWEST, bench, iterationsFrom, renderBench} from './lib/bench.ts';
import type {Options} from './lib/cli.ts';
import {USAGE, parse, screenshotPath, unmangleRoute} from './lib/cli.ts';
import {driverFor} from './lib/drivers.ts';
import {codeOf} from './lib/errors.ts';
import {DEFAULT_TIMING, timingFor, withTiming} from './lib/settle.ts';
import {isWindowsDriver} from './platforms/windows.ts';
import {installArguments, playwrightBases} from './platforms/web-browsers.ts';
import {renderSnapshot} from './lib/snapshot.ts';
import type {Driver, StepResult} from './lib/types.ts';
import {PLATFORMS, elsewhere, failed, ok} from './lib/types.ts';

const ROOT = path.resolve(process.env.HARNESS_ROOT ?? process.cwd());

// A press, a fill and typing are synthetic input on Windows, and the driver
// refuses them while someone is using the machine, unless it was made with
// --force: the same refusal a device test gets.
// Each step waits for the screen to hold still (src/harness/lib/settle.ts);
// bench times the driver's own work, so it is handed the driver unwrapped.
async function step(driver: Driver, options: Options, [name, ...args]: string[], raw: Driver): Promise<StepResult> {
  switch (name) {
    case 'open':
      return driver.open(unmangleRoute(args[0] ?? ''));
    case 'snapshot': {
      const tree = await driver.snapshot({interactive: options.interactive});
      const json = JSON.stringify(tree, null, 1);
      if (!args[0]) return ok(`${tree.nodes.length} nodes`, json);
      const out = path.resolve(ROOT, screenshotPath(args[0], options.out));
      fs.mkdirSync(path.dirname(out), {recursive: true});
      fs.writeFileSync(out, json);
      return ok(`${tree.nodes.length} nodes written to ${path.relative(ROOT, out)}`);
    }
    case 'tree': {
      const tree = await driver.snapshot({interactive: options.interactive});
      return ok(`${tree.nodes.length} nodes`, renderSnapshot(tree));
    }
    case 'press':
      return driver.press(args[0] ?? '');
    case 'tap':
      return driver.press({x: Number(args[0]), y: Number(args[1])});
    case 'fill':
      return driver.fill(args[0] ?? '', args[1] ?? '');
    case 'type':
      return driver.type(args[0] ?? '');
    case 'screenshot':
      return driver.screenshot(path.resolve(ROOT, screenshotPath(args[0] ?? 'screen.png', options.out)));
    case 'raise':
      if (!isWindowsDriver(driver)) return elsewhere('raising a window', driver.platform);
      return driver.raise();
    case 'wait':
      await new Promise(resolve => setTimeout(resolve, Number(args[0])));
      return ok(`waited ${args[0]} ms`);
    case 'idle': {
      const idle = await driver.idleSeconds();
      return idle === null ? ok('idleness does not apply to this platform') : ok(`quiet for ${Math.round(idle)} seconds`);
    }
    case 'bench': {
      const iterations = iterationsFrom(args[0] ?? options.iterations);
      if (iterations === null) return failed(`bench takes a whole number of iterations, at least ${FEWEST}: of fewer, the p95 is only the slowest`, 'INVALID_ARGUMENT');
      const folder = path.resolve(ROOT, options.out, 'bench');
      fs.mkdirSync(folder, {recursive: true});
      const result = await bench(raw, {iterations, press: options.press, field: options.field, directory: folder, timing: timingFor(DEFAULT_TIMING, {settle: options.settle, transition: options.transition})});
      const file = path.join(folder, `${result.platform}-${result.at.replace(/:/g, '-')}.json`);
      fs.writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`);
      const filled = result.samples.some(sample => sample.operation === 'fill' && sample.cold !== null);
      return ok(
        `timed on ${result.platform}, written to ${path.relative(ROOT, file)}${filled ? '; the field keeps what fill typed into it' : ''}`,
        options.json ? JSON.stringify(result, null, 1) : renderBench(result),
      );
    }
    default:
      return failed(`${name} is not a step`, 'INVALID_ARGUMENT');
  }
}

async function doctor(options: Options): Promise<number> {
  console.log('what this machine can drive:\n');
  for (const platform of PLATFORMS) {
    const driver = driverFor(platform, {root: ROOT, browser: options.browser, cdp: options.cdp});
    const state = await driver.available();
    await driver.close();
    console.log(`  ${state.ready ? 'yes' : 'no '}  ${platform.padEnd(8)} ${state.ready ? (state.found ?? '') : (state.reason ?? '')}`);
    for (const line of [...(state.details ?? []), ...(state.notes ?? [])]) console.log(`${' '.repeat(16)}${line}`);
  }
  console.log('\nnothing here changes your machine; a "no" says what is missing.');
  return 0;
}

/**
 * `install`: a browser for the web tests, fetched by the installer of the
 * playwright-core the web driver loads, so it is the build that version
 * launches. `npx playwright-core install` could be another version, or one
 * fetched from the registry where the project does not list it.
 */
function install(args: string[]): number {
  for (const base of playwrightBases(ROOT, fileURLToPath(import.meta.url))) {
    let manifest: string;
    try {
      manifest = createRequire(base).resolve('playwright-core/package.json');
    } catch {
      continue;
    }
    const ran = spawnSync(process.execPath, [path.join(path.dirname(manifest), 'cli.js'), ...installArguments(args)], {stdio: 'inherit'});
    return ran.status ?? 1;
  }
  console.error('playwright-core did not load: it comes with expo-vitest, so install expo-vitest again');
  return 1;
}

/** `cache`: the agent's replay cache, in the folder the harness config's `cache.dir` names, else `.harness/cache`. */
async function cacheCommand(args: string[]): Promise<number> {
  const [{findHarnessFile, loadHarnessSync}, {cacheSettings}, {cache}] = await Promise.all([import('../device/config.ts'), import('../agent/cache.ts'), import('../cli/cache.ts')]);
  const config = loadHarnessSync(findHarnessFile(ROOT));
  return cache(args, cacheSettings(config?.cache, process.env, ROOT).dir);
}

async function main(argv: string[]): Promise<number> {
  let options: Options;
  try {
    options = parse(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  if (options.command === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (options.command === 'doctor') return doctor(options);
  // Loaded only when asked for, so a step does not pay for what it does not use.
  if (options.command === 'init') return (await import('../cli/init.ts')).init(options.args);
  if (options.command === 'install') return install(options.args);
  if (options.command === 'guide') return (await import('../cli/guide.ts')).guide(options.args);
  if (options.command === 'cache') return cacheCommand(options.args);
  if (options.command === 'mcp') return (await import('./mcp/serve.ts')).serve(options.args, ROOT);
  if (options.command === 'explore') return (await import('./explore/command.ts')).explore(options.args, ROOT);
  if (options.command === 'bug-bash') return (await import('./bug-bash/command.ts')).bugBash(options.args, ROOT);
  if (!options.platform || !PLATFORMS.includes(options.platform)) {
    console.error(`name a platform with --platform (${PLATFORMS.join(', ')}), or run \`doctor\` to see what this machine can drive`);
    return 2;
  }
  if (options.steps.length === 0) {
    console.log(USAGE);
    return 0;
  }

  const driver = driverFor(options.platform, {root: ROOT, url: options.url, scheme: options.scheme, target: options.target, force: options.force, browser: options.browser, cdp: options.cdp});
  const state = await driver.available();
  if (!state.ready) {
    console.error(`${options.platform}: ${state.reason}`);
    await driver.close();
    return 1;
  }
  console.log(`${options.platform}: ${state.found ?? 'ready'}`);
  for (const note of state.notes ?? []) console.log(`  ${note}`);
  const stepped = withTiming(driver, timingFor(DEFAULT_TIMING, {settle: options.settle, transition: options.transition}));

  let failures = 0;
  try {
    for (const current of options.steps) {
      let result: StepResult;
      try {
        result = await step(stepped, options, current, driver);
      } catch (error) {
        result = failed(`${current[0]} threw: ${(error as Error).message}`, codeOf(error));
      }
      console.log(`  ${result.skipped ? '–' : result.ok ? '·' : '✗'} ${result.message}`);
      if (result.output) console.log(result.output.replace(/^/gm, '      '));
      if (!result.ok) {
        failures++;
        break;
      }
    }
  } finally {
    await driver.close();
  }
  return failures === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  error => {
    console.error(error);
    process.exit(1);
  },
);

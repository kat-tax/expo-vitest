/**
 * A device project's second global setup, once per platform in the main
 * process, after the first has started what serves the app. It asks the
 * platform's driver whether it can work here, and where it can, opens the
 * app's base route once, so the first test starts on a launched app, a
 * booted device and a page the bundler has already built.
 *
 * It applies no launch arguments or permissions: those belong to a fresh
 * launch, which a test that needs them asks for.
 *
 * A device a provider hosts is connected to here first, and released after
 * the run's last test. Its first command allocates it, so the warm-up's pays
 * for that too, and installs the app where the config names a build, since
 * a hosted device starts without it.
 *
 * Each device of a pool is warmed by name, in the session a test file will
 * hold it in, so none is left to agent-device's choice, which could be any
 * device on the machine. After the run the pool's locks go, with any claim
 * agent-device still holds for an owner that is gone.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {TestProject} from 'vitest/node';
import {driverFor} from '../harness/lib/drivers.ts';
import type {Availability, DriverOptions, Platform} from '../harness/lib/types.ts';
import type {ResolvedRun} from './config.ts';
import {configFromRun, loadHarness, resolveRun} from './config.ts';
import {sessionName} from './pool.ts';
import './provided.ts';

export default async function warmUp(project: TestProject): Promise<(() => Promise<void>) | void> {
  const provided = project.getProvidedContext();
  const platform = provided['harness.platform'];
  const root = provided['harness.root'];
  const config = await loadHarness(provided['harness.file'], each => import(/* @vite-ignore */ pathToFileURL(each).href));
  const run = resolveRun(platform, config, process.env, root);
  const force = process.env.HARNESS_FORCE;
  const {app} = configFromRun(run, process.env);
  const options: DriverOptions = {root, url: run.url, scheme: run.scheme, target: run.target, force: Boolean(force && force !== '0'), actionTimeout: run.actionTimeout, ...(app ? {app} : {})};
  const runId = provided['harness.runId'];
  const after: (() => Promise<void>)[] = [];
  const teardown = async () => {
    for (const each of after) await each();
  };
  if (run.hosted) {
    const connecting = driverFor(platform, options);
    const connected = await connecting.connect?.(run.hosted);
    await connecting.close();
    if (!connected?.ok) {
      project.provide('harness.available', {ready: false, reason: connected?.message ?? `${platform} has no hosted devices`});
      return;
    }
    console.log(`${platform}: ${connected.message}`);
    const hosted = run.hosted.provider;
    // The tests' sessions come and go on the one connection, so it is released once, after the last.
    after.push(async () => {
      const releasing = driverFor(platform, options);
      const released = await releasing.disconnect?.();
      await releasing.close();
      if (released && !released.ok) console.warn(`${platform}: ${released.message}; release it at ${hosted}`);
    });
  }
  if (run.devices) {
    after.push(async () => {
      const locks = path.join(root, '.harness', 'locks', runId);
      fs.rmSync(path.join(locks, platform), {recursive: true, force: true});
      // The run's folder goes with the last platform's locks in it.
      if (fs.existsSync(locks) && fs.readdirSync(locks).length === 0) fs.rmdirSync(locks);
      const releasing = driverFor(platform, options);
      const released = await releasing.releaseStale?.();
      await releasing.close();
      if (released && !released.ok) console.warn(`${platform}: ${released.message}`);
    });
  }
  const each = run.devices?.map(device => ({...options, target: device, session: sessionName(runId, device)})) ?? [options];
  const warmed = await Promise.all(each.map(one => warm(platform, one, run)));
  const absent = warmed.findIndex(availability => !availability.ready);
  const [first] = warmed as [Availability];
  if (absent >= 0) {
    const reason = warmed[absent]?.reason ?? `nothing on this machine can drive ${platform}`;
    project.provide('harness.available', {ready: false, reason: run.devices ? `${run.devices[absent]} of the pool: ${reason}` : reason});
  } else {
    const found = run.devices ? `a pool of ${run.devices.length}: ${warmed.map(availability => availability.found).join('; ')}` : first.found;
    project.provide('harness.available', {ready: true, ...(found ? {found} : {}), ...(first.device ? {device: first.device} : {})});
  }
  // Said here, once for the run, rather than by each test file's driver.
  for (const note of first.notes ?? []) console.warn(`${platform}: ${note}`);
  return after.length ? teardown : undefined;
}

/** One device asked whether it can be driven, and where it can, its app opened once. */
async function warm(platform: Platform, options: DriverOptions, run: ResolvedRun): Promise<Availability> {
  const driver = driverFor(platform, options);
  try {
    const availability = await driver.available();
    if (!availability.ready) return availability;
    if (run.hosted && run.appPath) {
      const installed = await driver.control?.({name: 'installApp'});
      if (installed && !installed.ok) console.warn(`${platform}: ${installed.message}`);
    }
    // What the first open costs, a bundle built or an app launched, is paid here. A test that opens a route of its own reports any failure better than this could.
    await driver.open('/');
    return availability;
  } finally {
    await driver.close();
  }
}

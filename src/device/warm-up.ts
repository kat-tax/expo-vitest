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
 */
import {pathToFileURL} from 'node:url';
import type {TestProject} from 'vitest/node';
import {driverFor} from '../harness/lib/drivers.ts';
import {configFromRun, loadHarness, resolveRun} from './config.ts';
import './provided.ts';

export default async function warmUp(project: TestProject): Promise<(() => Promise<void>) | void> {
  const provided = project.getProvidedContext();
  const platform = provided['harness.platform'];
  const root = provided['harness.root'];
  const config = await loadHarness(provided['harness.file'], each => import(/* @vite-ignore */ pathToFileURL(each).href));
  const run = resolveRun(platform, config, process.env, root);
  const force = process.env.HARNESS_FORCE;
  const {app} = configFromRun(run, process.env);
  const options = {root, url: run.url, scheme: run.scheme, target: run.target, force: Boolean(force && force !== '0'), actionTimeout: run.actionTimeout, ...(app ? {app} : {})};
  const driver = driverFor(platform, options);
  let release: (() => Promise<void>) | undefined;
  try {
    if (run.hosted) {
      const connected = await driver.connect?.(run.hosted);
      if (!connected?.ok) {
        project.provide('harness.available', {ready: false, reason: connected?.message ?? `${platform} has no hosted devices`});
        return;
      }
      console.log(`${platform}: ${connected.message}`);
      const hosted = run.hosted.provider;
      // The tests' sessions come and go on the one connection, so it is released once, after the last.
      release = async () => {
        const releasing = driverFor(platform, options);
        const released = await releasing.disconnect?.();
        await releasing.close();
        if (released && !released.ok) console.warn(`${platform}: ${released.message}; release it at ${hosted}`);
      };
    }
    const availability = await driver.available();
    const found = {...(availability.found ? {found: availability.found} : {}), ...(availability.device ? {device: availability.device} : {})};
    project.provide('harness.available', availability.ready ? {ready: true, ...found} : {ready: false, reason: availability.reason ?? `nothing on this machine can drive ${platform}`});
    // Said here, once for the run, rather than by each test file's driver.
    for (const note of availability.notes ?? []) console.warn(`${platform}: ${note}`);
    if (!availability.ready) return release;
    if (run.hosted && run.appPath) {
      const installed = await driver.control?.({name: 'installApp'});
      if (installed && !installed.ok) console.warn(`${platform}: ${installed.message}`);
    }
    // What the first open costs, a bundle built or an app launched, is paid here. A test that opens a route of its own reports any failure better than this could.
    await driver.open('/');
    return release;
  } finally {
    await driver.close();
  }
}

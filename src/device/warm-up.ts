/**
 * A device project's second global setup, once per platform in the main
 * process, after the first has started what serves the app. It asks the
 * platform's driver whether it can work here, and where it can, opens the
 * app's base route once, so the first test starts on a launched app, a
 * booted device and a page the bundler has already built.
 *
 * It applies no launch arguments or permissions: those belong to a fresh
 * launch, which a test that needs them asks for.
 */
import {pathToFileURL} from 'node:url';
import type {TestProject} from 'vitest/node';
import {driverFor} from '../harness/lib/drivers.ts';
import {loadHarness, resolveRun} from './config.ts';
import './provided.ts';

export default async function warmUp(project: TestProject): Promise<void> {
  const provided = project.getProvidedContext();
  const platform = provided['harness.platform'];
  const root = provided['harness.root'];
  const config = await loadHarness(provided['harness.file'], each => import(/* @vite-ignore */ pathToFileURL(each).href));
  const run = resolveRun(platform, config, process.env, root);
  const force = process.env.HARNESS_FORCE;
  const driver = driverFor(platform, {root, url: run.url, scheme: run.scheme, target: run.target, force: Boolean(force && force !== '0')});
  try {
    const availability = await driver.available();
    const found = {...(availability.found ? {found: availability.found} : {}), ...(availability.device ? {device: availability.device} : {})};
    project.provide('harness.available', availability.ready ? {ready: true, ...found} : {ready: false, reason: availability.reason ?? `nothing on this machine can drive ${platform}`});
    if (!availability.ready) return;
    // What the first open costs, a bundle built or an app launched, is paid here. A test that opens a route of its own reports any failure better than this could.
    await driver.open('/');
  } finally {
    await driver.close();
  }
}

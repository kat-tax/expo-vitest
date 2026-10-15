/**
 * A device project's setup file, in the worker before each test file, and
 * before anything loads the device. It loads the harness config again,
 * checks it is the one the run started with, and hands the device the run
 * it resolves to.
 *
 * Where the warm-up found the platform cannot be driven here, every test is
 * skipped with the driver's reason, or failed with `DRIVER_UNAVAILABLE`
 * under `HARNESS_REQUIRE` or in CI.
 */
import {pathToFileURL} from 'node:url';
import {afterAll, beforeEach, expect, inject} from 'vitest';
import {HarnessError} from '../harness/lib/errors.ts';
import {rememberFacts} from './capabilities.ts';
import {loadHarness, requiresDriver, resolveRun, sameConfig, setRun} from './config.ts';
import {device} from './index.ts';
import './provided.ts';

const platform = inject('harness.platform');
const file = inject('harness.file');
const config = await loadHarness(file, each => import(/* @vite-ignore */ pathToFileURL(each).href));
sameConfig(config, inject('harness.config'), file);
// The run's id and the file name a pool's claim by, so files spread over its devices.
setRun({...resolveRun(platform, config, process.env, inject('harness.root')), runId: inject('harness.runId'), ...testFileOf(expect.getState().testPath)});

// The device closes with its file, after the file's own hooks: a device of a pool goes back for the next file, and no browser or session is left open.
afterAll(() => device.close());

const available = inject('harness.available');
// What the warm-up found of the device, so a capability that depends on it is known before the driver opens here.
if (available.device) rememberFacts(available.device);
if (!available.ready) {
  const reason = `no ${platform} device to drive here: ${available.reason}`;
  if (requiresDriver(process.env)) {
    beforeEach(() => {
      throw new HarnessError('DRIVER_UNAVAILABLE', reason, {platform});
    });
  } else {
    beforeEach(context => context.skip(reason));
  }
}

function testFileOf(file: string | undefined): {testFile?: string} {
  return file ? {testFile: file} : {};
}

/**
 * A device project's global setup, in Vitest's main process before any
 * test. It loads the harness config and starts the command that serves the
 * project's app, unless one already answers.
 *
 * Every project's global setup runs before the first test and every
 * teardown after the last, so a command two platforms share is started by
 * the first of them and stopped after both. What decides is in
 * `app-process.ts`; this hands it Node's own calls.
 */
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import type {TestProject} from 'vitest/node';
import {prepare} from '../harness/lib/run.ts';
import {realClock} from '../harness/lib/settle.ts';
import type {System} from './app-process.ts';
import {acquire, commandKey, registry, release, startCommand} from './app-process.ts';
import {loadHarness, resolveRun, serialisable} from './config.ts';
import './provided.ts';

const system: System = {
  platform: process.platform,
  env: process.env,
  exists: fs.existsSync,
  spawn: (file, args, options) => spawn(file, args, options),
  signal: (pid, signal) => process.kill(pid, signal),
  killTree: pid => void spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {windowsHide: true}),
  openLog: file => fs.openSync(prepare(file), 'w'),
  closeLog: fd => fs.closeSync(fd),
  readLog: file => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  },
  fetcher: (url, init) => fetch(url, init),
  clock: realClock,
  onExit: stop => {
    process.once('exit', stop);
    return () => void process.off('exit', stop);
  },
};

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const provided = project.getProvidedContext();
  const platform = provided['harness.platform'];
  const file = provided['harness.file'];
  // A file URL, which the module runner takes and Node's own import needs on Windows.
  const config = await loadHarness(file, each => import(/* @vite-ignore */ pathToFileURL(each).href));
  project.provide('harness.config', serialisable(config).hash);
  const run = resolveRun(platform, config, process.env, provided['harness.root']);
  if (!run.command || !run.readyUrl) {
    project.provide('harness.command', null);
    return undefined;
  }
  const {command, readyUrl} = run;
  const key = commandKey(command);
  const commands = registry();
  const started = await acquire(commands, key, () => startCommand(platform, command, readyUrl, system));
  project.provide('harness.command', {key, pid: started.pid, reused: started.reused, log: started.log});
  return () => release(commands, key);
}

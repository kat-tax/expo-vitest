/**
 * Node's own calls, as starting and stopping an app's command needs them:
 * the device run's global setup hands them over, and so does an MCP
 * session that serves its app. What decides is in `app-process.ts`.
 */
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {prepare} from '../harness/lib/run.ts';
import {realClock} from '../harness/lib/settle.ts';
import type {System} from './app-process.ts';

export const system: System = {
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

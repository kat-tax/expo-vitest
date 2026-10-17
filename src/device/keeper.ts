/**
 * The process an app's command runs under, so that the command ends with
 * the run however the run ends: a teardown, a Ctrl+C, a closed terminal or
 * a hard kill. Without it a killed run leaves its dev server for the next
 * run to find. On macOS and Linux the command is in a process group a
 * terminal does not reach. On Windows Node ends a child with its parent,
 * but a `.cmd` such as `npx` starts its program outside that, so Metro
 * outlives the run.
 *
 * The run starts the keeper detached, which puts it outside both, and holds
 * an IPC channel to it. When the run's process goes, the system closes the
 * channel, and the keeper ends the command and everything it started, as
 * the run's teardown would. It is handed the launch as JSON in its one
 * argument, answers over the channel with the command's pid or why it could
 * not be started, and exits as the command exits, so the run reads the
 * command's end in the keeper's.
 */
import {spawn} from 'node:child_process';
import type {KeptLaunch} from './app-process.ts';
import {stopTree} from './app-process.ts';
import {system} from './system.ts';

const launch = JSON.parse(process.argv[2] ?? '') as KeptLaunch;
let ended = false;

// A stop sent to the keeper's group or tree is for the command: the keeper waits for it to end, and ends as it did.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => {});

const command = spawn(launch.file, launch.args, {stdio: ['ignore', 'inherit', 'inherit'], shell: false, windowsHide: true, windowsVerbatimArguments: launch.verbatim});
// With a callback, a channel already closed is an error handed to it rather than thrown.
command.once('spawn', () => process.send?.({started: command.pid}, () => {}));
command.once('error', error => {
  ended = true;
  process.send?.({refused: error.message}, () => process.exit(127));
});
command.once('exit', (code, signal) => {
  ended = true;
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 1);
});
process.once('disconnect', () => {
  if (ended) return;
  // On macOS and Linux the keeper leads the group the command is in. On Windows the command's tree is ended
  // before the keeper, whose own end would end the command's first process and orphan what that started.
  const pid = system.platform === 'win32' ? (command.pid as number) : process.pid;
  void stopTree(pid, {...system, alive: () => !ended, timeout: launch.shutdownTimeout}).finally(() => process.exit(1));
});

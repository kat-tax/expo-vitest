// A device run's main process, as the keeper's test kills it: it starts a
// server under the keeper, as a run's global setup does, says so, and waits.
// On Windows the server starts through a .cmd, as npx does, whose program
// Node does not end with the run.
import fs from 'node:fs';
import path from 'node:path';
import {startCommand} from '../app-process.ts';
import {system} from '../system.ts';

const [port, folder] = process.argv.slice(2) as [string, string];
const server = path.join(folder, 'serve.cjs');
fs.writeFileSync(server, `require('node:fs').writeFileSync(${JSON.stringify(path.join(folder, 'pid'))}, String(process.pid)); require('node:http').createServer((_, response) => response.end('up')).listen(${port}, '127.0.0.1');\n`);
const batch = path.join(folder, 'serve.cmd');
if (process.platform === 'win32') fs.writeFileSync(batch, `@"${process.execPath}" "%~dp0serve.cjs"\r\n`);
const [executable, args] = process.platform === 'win32' ? [batch, []] : [process.execPath, [server]];
const started = await startCommand('web', {executable, args, cwd: folder, env: {}, startupTimeout: 20_000, shutdownTimeout: 2000, log: false, reuseExisting: false}, `http://127.0.0.1:${port}/`, system);
process.stdout.write(`ready ${started.pid}\n`);
setInterval(() => {}, 60_000);

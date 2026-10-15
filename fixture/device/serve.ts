// Serves the page the device tests drive, on a free port, for the run: the
// app under test, as small as an app can be. The tests reach it through
// HARNESS_URL, which the workers inherit, since they start after this.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const page = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page.html');

export default async function serve(): Promise<() => Promise<void>> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(fs.readFileSync(page));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as {port: number};
  process.env.HARNESS_URL = `http://127.0.0.1:${port}`;
  process.env.HARNESS_PLATFORM ??= 'web';
  return () => new Promise<void>(resolve => server.close(() => resolve()));
}

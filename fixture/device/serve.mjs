// The app under test, as small as an app can be: the page beside this file,
// on the port given. harness.config.ts starts this for the run, on the port
// of its url, and the run stops it after.
import fs from 'node:fs';
import http from 'node:http';

const page = new URL('./page.html', import.meta.url);
const port = Number(process.argv[2]);

http
  .createServer((_request, response) => {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(fs.readFileSync(page));
  })
  .listen(port, '127.0.0.1', () => console.log(`serving device/page.html on ${port}`));

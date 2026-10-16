// The app under test, as small as an app can be: the pages beside this file,
// on the port given. harness.config.ts starts this for the run, on the port
// of its url, and the run stops it after. /web is the page device.web's tests
// drive, with a frame, a download and an API for a route to answer; /sign-in
// is the page the agent signs in on; /press counts clicks and double clicks;
// every other path is the profile page.
import fs from 'node:fs';
import http from 'node:http';

const port = Number(process.argv[2]);
const file = name => fs.readFileSync(new URL(`./${name}`, import.meta.url));
const html = {'content-type': 'text/html; charset=utf-8'};

http
  .createServer((request, response) => {
    const {pathname} = new URL(request.url ?? '/', 'http://localhost');
    if (pathname === '/web') return response.writeHead(200, html).end(file('web.html'));
    if (pathname === '/sign-in') return response.writeHead(200, html).end(file('sign-in.html'));
    if (pathname === '/press') return response.writeHead(200, html).end(file('press.html'));
    if (pathname === '/web/frame') return response.writeHead(200, html).end(file('frame.html'));
    if (pathname === '/web/report.csv') {
      return response.writeHead(200, {'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"'}).end('name,drafts\nAda,3\n');
    }
    if (pathname === '/api/greeting') return response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({greeting: 'Hello from the server'}));
    response.writeHead(200, html).end(file('page.html'));
  })
  .listen(port, '127.0.0.1', () => console.log(`serving device/page.html and device/web.html on ${port}`));

import http from 'node:http';
import { Readable } from 'node:stream';

const listenPort = 5006;
const upstreamOrigin = 'https://docker.1panel.live';

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/v2/')) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  try {
    const startedAt = Date.now();
    const headers = new Headers();
    for (const name of ['accept', 'range', 'if-none-match']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    headers.set('user-agent', 'curl/8.0 maxun-poc-registry-proxy');

    const upstream = await fetch(`${upstreamOrigin}${req.url}`, {
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    const responseHeaders = {};
    for (const [name, value] of upstream.headers.entries()) {
      if (!['connection', 'keep-alive', 'transfer-encoding', 'content-encoding'].includes(name)) {
        responseHeaders[name] = value;
      }
    }

    res.writeHead(upstream.status, responseHeaders);
    if (!upstream.body) {
      res.end();
      return;
    }
    let transferredBytes = 0;
    const body = Readable.fromWeb(upstream.body);
    body.on('data', (chunk) => {
      transferredBytes += chunk.length;
    });
    body.on('end', () => {
      console.log(`${upstream.status} ${req.url} ${transferredBytes} bytes ${Date.now() - startedAt} ms`);
    });
    body.on('error', (error) => {
      console.error(`STREAM_ERROR ${req.url} ${error.message}`);
    });
    body.pipe(res);
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Registry proxy error: ${error.message}`);
  }
});

server.listen(listenPort, '0.0.0.0', () => {
  console.log(`Host registry proxy listening on ${listenPort}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

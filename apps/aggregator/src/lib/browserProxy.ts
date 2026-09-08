import { Agent, createServer, request } from 'node:http';
import { connect, type LookupFunction, type Socket } from 'node:net';
import { assertPublicUrl } from './ssrf.js';
import { publicLookup } from './publicTransport.js';

/** A local forward proxy keeps Chromium's TLS handshake while validating socket DNS. */
export async function createPublicBrowserProxy(resolve?: LookupFunction) {
  const lookup = publicLookup(resolve);
  const agent = new Agent({ keepAlive: true });
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const server = createServer((incoming, outgoing) => {
    try {
      const url = incoming.url ?? '';
      assertPublicUrl(url);
      if (new URL(url).protocol !== 'http:') throw new Error('HTTPS requires CONNECT');
      const headers = { ...incoming.headers };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      headers.host = new URL(url).host;
      const upstream = request(url, { method: incoming.method, headers, agent, lookup, timeout: 12_000 }, response => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      });
      upstream.on('socket', track);
      upstream.on('timeout', () => upstream.destroy(new Error('Proxy upstream timeout')));
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.on('aborted', () => upstream.destroy());
      outgoing.on('close', () => upstream.destroy());
      incoming.pipe(upstream);
    } catch {
      outgoing.writeHead(403).end();
    }
  });
  server.on('connection', track);
  server.on('connect', (incoming, client, head) => {
    try {
      const url = new URL(`https://${incoming.url ?? ''}`);
      assertPublicUrl(url.href);
      if (url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid CONNECT authority');
      const upstream = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 443), lookup });
      track(upstream);
      upstream.setTimeout(12_000, () => upstream.destroy(new Error('Proxy connect timeout')));
      upstream.once('connect', () => {
        upstream.setTimeout(0);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream).pipe(client);
      });
      upstream.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Browser proxy failed to listen');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      agent.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

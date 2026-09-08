import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createPublicBrowserProxy } from './browserProxy.js';

function probe(proxy: string, method: 'GET' | 'CONNECT', path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(proxy, { method, path });
    req.on('response', response => { response.resume(); resolve(response.statusCode!); });
    req.on('connect', (response, socket) => { socket.destroy(); resolve(response.statusCode!); });
    req.on('error', reject);
    req.end();
  });
}

describe('browser proxy socket policy', () => {
  it.each(['GET', 'CONNECT'] as const)('blocks private IPs in %s requests before opening a tunnel', async method => {
    const proxy = await createPublicBrowserProxy();
    try {
      expect(await probe(proxy.url, method, method === 'GET' ? 'http://127.0.0.1/' : '127.0.0.1:443')).toBe(403);
    } finally { await proxy.close(); }
  });
  it.each(['GET', 'CONNECT'] as const)('blocks private DNS results for a public-looking %s target', async method => {
    const proxy = await createPublicBrowserProxy((_host, _options, done) => {
      done(null, [{ address: '127.0.0.1', family: 4 }]);
    });
    try {
      expect(await probe(proxy.url, method, method === 'GET' ? 'http://unsafe.example/' : 'unsafe.example:443')).toBe(502);
    } finally { await proxy.close(); }
  });
});

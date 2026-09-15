import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { S3ObjectStore, objectStoreConfigured, objectStoreFromEnv, STORAGE_ENV } from './objectStore.js';

const objects = new Map<string, Buffer>();
const requests: { method: string; url: string; signed: boolean }[] = [];
const server = createServer(async (req, res) => {
  requests.push({ method: req.method!, url: req.url!.split('?')[0], signed: req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') ?? false });
  if (req.url?.includes('missing')) { res.writeHead(404); res.end('<Error><Code>NoSuchKey</Code></Error>'); return; }
  if (req.url?.includes('oversized')) { res.writeHead(200, { 'content-length': '33000000' }); res.flushHeaders(); return; }
  if (req.method === 'PUT') {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    objects.set(req.url!.split('?')[0], Buffer.concat(chunks)); res.writeHead(200, { etag: '"fixture-etag"' }); res.end();
  } else { const body = objects.get(req.url!.split('?')[0]) ?? Buffer.from(''); res.writeHead(200, { 'content-length': body.length }); res.end(body); }
});
let endpoint: string;
beforeAll(async () => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const config = () => ({ endpoint, region: 'test-region', bucket: 'test-bucket', accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret', prefix: 'isolated-test' });

describe('private archive transport', () => {
  it('signs and restores bytes through the real SDK transport with environment-scoped object keys', async () => {
    const store = new S3ObjectStore(config()); const bytes = Buffer.from('exact archive bytes');
    expect(await store.put('sha256/a space/é.gz', bytes)).toEqual({ etag: '"fixture-etag"' });
    expect(await store.get('sha256/a space/é.gz')).toEqual(bytes);
    expect(requests.slice(-2)).toEqual([
      { method: 'PUT', url: '/test-bucket/isolated-test/sha256/a%20space/%C3%A9.gz', signed: true },
      { method: 'GET', url: '/test-bucket/isolated-test/sha256/a%20space/%C3%A9.gz', signed: true },
    ]);
  });
  it('requires an explicit environment prefix and never exposes credentials through its description', () => {
    const values = config();
    const env: NodeJS.ProcessEnv = {};
    for (const [key, variable] of Object.entries(STORAGE_ENV)) {
      if (key !== 'forcePathStyle') env[variable] = values[key as keyof typeof values];
    }
    expect(objectStoreConfigured(env)).toBe(true);
    expect(JSON.stringify(objectStoreFromEnv(env).describe())).not.toContain('fixture-secret');
    expect(() => objectStoreFromEnv({ ...env, [STORAGE_ENV.forcePathStyle]: 'invalid' })).toThrow('path style');
    delete env[STORAGE_ENV.prefix]; expect(objectStoreConfigured(env)).toBe(false);
    expect(() => objectStoreFromEnv(env)).toThrow('explicit environment prefix');
  });
  it('refuses credential-bearing endpoints and keys that escape their prefix', async () => {
    expect(() => new S3ObjectStore({ ...config(), endpoint: 'https://user:password@example.com' })).toThrow('endpoint');
    expect(() => new S3ObjectStore({ ...config(), prefix: '../outside' })).toThrow('prefix');
    const store = new S3ObjectStore(config()); await expect(store.put('../outside', Buffer.from('x'))).rejects.toThrow();
  });
  it('fails explicitly on missing and oversized archives', async () => {
    const store = new S3ObjectStore(config());
    await expect(store.get('missing')).rejects.toThrow('HTTP 404');
    await expect(store.get('oversized')).rejects.toThrow('GET failed');
  });
});

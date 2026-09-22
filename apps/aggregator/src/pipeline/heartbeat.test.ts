import { afterEach, expect, it, vi } from 'vitest';
import { pingHeartbeat } from './heartbeat.js';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('keeps success and failure signals distinct and reports an unreachable monitor', async () => {
  vi.stubEnv('HEALTHCHECK_PING_URL', 'https://monitor.example/witness/');
  const request = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
  vi.stubGlobal('fetch', request);
  expect(await pingHeartbeat(true)).toBe('pinged');
  expect(request.mock.calls[0][0]).toBe('https://monitor.example/witness/');
  expect(await pingHeartbeat(false)).toBe('pinged');
  expect(request.mock.calls[1][0]).toBe('https://monitor.example/witness/fail');
  request.mockResolvedValue(new Response('', { status: 503 }));
  expect(await pingHeartbeat(true)).toBe('failed');
});
it('makes the absence of a configured monitor explicit without a network call', async () => {
  vi.stubEnv('HEALTHCHECK_PING_URL', '');
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  expect(await pingHeartbeat(true)).toBe('skipped');
  expect(request).not.toHaveBeenCalled();
});

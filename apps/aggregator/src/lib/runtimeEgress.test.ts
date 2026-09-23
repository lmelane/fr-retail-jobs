import { afterEach, expect, it, vi } from 'vitest';
import { fetchFollowingSafely } from './http.js';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('refuses a redirect out of the canary host before issuing the next request', async () => {
  vi.stubEnv('CATWALKS_RUNTIME_PROFILE', 'validation-ohmycream');
  vi.stubEnv('PIPELINE_PAUSED', '0');
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302,
    headers: { location: 'https://other.example/jobs' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(fetchFollowingSafely('https://careers.ohmycream.com/jobs.json', {}, new AbortController().signal))
    .rejects.toThrow('business egress outside selected profile');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('https://careers.ohmycream.com/jobs.json');
});
it('refuses an out-of-scope first hop without issuing any request', async () => {
  vi.stubEnv('CATWALKS_RUNTIME_PROFILE', 'validation-ohmycream');
  vi.stubEnv('PIPELINE_PAUSED', '0');
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(fetchFollowingSafely('https://other.example/jobs', {}, new AbortController().signal))
    .rejects.toThrow('business egress outside selected profile');
  expect(fetch).not.toHaveBeenCalled();
});

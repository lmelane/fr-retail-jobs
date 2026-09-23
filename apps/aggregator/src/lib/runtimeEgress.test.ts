import { afterEach, expect, it, vi } from 'vitest';
import { fetchFollowingSafely } from './http.js';
import { withCaptureContext } from '../capture/context.js';
import { matchingAccessScope, type AccessScope } from '../connectors/accessScope.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const scope = (origin: string): AccessScope => ({ origin, path: { kind: 'EXACT', value: '/jobs' },
  methods: ['GET'], query: { fixed: {}, variable: [] }, surface: 'PUBLIC_ATS_JOB_API' });
const request = (url: string, origin: string) => withCaptureContext({ sequence: 0,
  requestAccess: req => { matchingAccessScope([scope(origin)], req); },
}, () => fetchFollowingSafely(url, {}, new AbortController().signal));

it('normal runtime executes different sources with their own access scope', async () => {
  vi.stubEnv('CATWALKS_RUNTIME_PROFILE', 'production');
  vi.stubEnv('PIPELINE_PAUSED', '0');
  const fetch = vi.fn().mockImplementation(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  for (const origin of ['https://careers.ohmycream.com', 'https://other.example'])
    expect((await request(`${origin}/jobs`, origin)).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('redirect outside the source access scope is refused before the next request', async () => {
  vi.stubEnv('CATWALKS_RUNTIME_PROFILE', 'production');
  vi.stubEnv('PIPELINE_PAUSED', '0');
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302,
    headers: { location: 'https://other.example/jobs' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(request('https://careers.ohmycream.com/jobs', 'https://careers.ohmycream.com'))
    .rejects.toThrow('outside the reviewed public HTTP scope');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('out-of-scope and internal first hops never dispatch', async () => {
  vi.stubEnv('CATWALKS_RUNTIME_PROFILE', 'production');
  vi.stubEnv('PIPELINE_PAUSED', '0');
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const url of ['https://other.example/jobs', 'http://169.254.169.254/latest/meta-data/'])
    await expect(request(url, 'https://careers.ohmycream.com')).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

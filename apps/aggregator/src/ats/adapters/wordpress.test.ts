import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseWordpressPost, fetchWordpressJobs } from './wordpress.js';
import { fetchWithRetry } from '../../lib/http.js';
vi.mock('../../lib/http.js', () => ({ fetchWithRetry: vi.fn() }));
const raw = { id: 42, title: { rendered: 'Advisor' }, content: { rendered: '<p>Native description</p>' },
  link: 'https://jobs.example/42', date: '2026-09-15T16:00:00', date_gmt: '2026-09-15T14:00:00' };
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('WordPress publication time', () => {
  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Auckland'])('reads GMT independently of worker TZ=%s', zone => {
    vi.stubEnv('TZ', zone);
    expect(parseWordpressPost(raw)?.postedAt?.toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });
  it.each([undefined, null, '', '2026-02-30T10:00:00'])('never substitutes a site-local or malformed date: %s', date_gmt => {
    expect(parseWordpressPost({ ...raw, date_gmt })?.postedAt).toBeUndefined();
  });
  it('uses the same date and exact RAW through the live collector', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response(JSON.stringify([raw]), { headers: { 'x-wp-totalpages': '1' } }));
    const [job] = await fetchWordpressJobs({ origin: 'https://jobs.example', categoryId: 1 });
    expect(job.postedAt?.toISOString()).toBe('2026-09-15T14:00:00.000Z');
    expect(job.raw).toEqual(raw);
  });
});

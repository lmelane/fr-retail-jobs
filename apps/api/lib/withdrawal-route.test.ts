import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/offres/[id]/route';
import { resolveOfferParam, getSimilarJobs, getCompanyAside } from './jobs';
vi.mock('./jobs', () => ({ resolveOfferParam: vi.fn(), getSimilarJobs: vi.fn(), getCompanyAside: vi.fn(), DatabaseUnavailableError: class extends Error {} }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('historical public ID withdrawal contract', () => {
  it('returns a 410 with the same ID, no job, guessed redirect, or fabricated alternatives', async () => {
    vi.stubEnv('CATALOGUE_API_KEY', 'withdrawal-test-key');
    vi.mocked(resolveOfferParam).mockResolvedValue({ status: 'withdrawn', canonicalId: 'historical-id', matchedId: 'historical-id', job: null });
    const response = await GET(new NextRequest('https://example.com/api/offres/historical-id', { headers: { authorization: 'Bearer withdrawal-test-key' } }), { params: Promise.resolve({ id: 'historical-id' }) });
    expect(response.status).toBe(410);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({ status: 'withdrawn', canonicalId: 'historical-id', canonicalSlugPath: null, job: null, similaires: [], maison: null });
    expect(getSimilarJobs).not.toHaveBeenCalled(); expect(getCompanyAside).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/offre-status/[id]/route';
import { getOfferState } from './jobs';

vi.mock('./jobs', () => ({ getOfferState: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('public offer status probe', () => {
  const request = () => {
    vi.stubEnv('CATALOGUE_API_KEY', 'status-test-key');
    return new NextRequest('https://example.com/api/offre-status/fixture', { headers: { authorization: 'Bearer status-test-key' } });
  };
  it.each(['active', 'closed', 'missing'] as const)('returns the proven %s state', async status => {
    vi.mocked(getOfferState).mockResolvedValue(status);
    const response = await GET(request(), { params: Promise.resolve({ id: 'fixture' }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status });
  });
  it('returns a non-cacheable 503 on failure without inventing activity or closure', async () => {
    vi.mocked(getOfferState).mockRejectedValue(new Error('Fixture database failure'));
    const response = await GET(request(), { params: Promise.resolve({ id: 'fixture' }) });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: 'unavailable' });
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('retry-after')).toBe('60');
  });
});

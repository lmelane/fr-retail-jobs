import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@catwalks/db', () => ({ prisma: db }));
import { GET } from '../app/api/health/route';

beforeEach(() => vi.resetAllMocks());

describe('deployment readiness', () => {
  it('returns a non-cacheable success only when schema queries succeed', async () => {
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn() };
    db.$transaction.mockImplementation(async work => work(tx));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it('blocks traffic activation on a missing schema or unavailable database', async () => {
    db.$transaction.mockRejectedValue(new Error('private database connection details'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});

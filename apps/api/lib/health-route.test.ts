import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@catwalks/db', () => ({ prisma: db }));
import { GET } from '../app/api/health/route';

const migration = { name: '20260909232000_talent_recruiter_opportunity', checksum: 'a'.repeat(64) };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CATWALKS_SCHEMA_MIGRATIONS', JSON.stringify([migration]));
});

describe('deployment readiness', () => {
  it('returns a non-cacheable success only when schema queries succeed', async () => {
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValueOnce([
      { migration_name: migration.name, checksum: migration.checksum, finished_at: new Date() },
    ]) };
    db.$transaction.mockImplementation(async work => work(tx));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it.each([
    ['pending migration', []],
    ['failed migration', [{ migration_name: migration.name, checksum: migration.checksum, finished_at: null }]],
    ['modified migration', [{ migration_name: migration.name, checksum: 'b'.repeat(64), finished_at: new Date() }]],
  ])('refuses a %s even when database connectivity works', async (_label, applied) => {
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue(applied) };
    db.$transaction.mockImplementation(async work => work(tx));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('refuses a missing build contract before accessing the database', async () => {
    vi.stubEnv('CATWALKS_SCHEMA_MIGRATIONS', '');
    expect((await GET()).status).toBe(503);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('blocks traffic activation on a missing schema or unavailable database', async () => {
    db.$transaction.mockRejectedValue(new Error('private database connection details'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runStats } from './stats.js';

function database(memberships: Array<{ sectorCodes: string[]; _count: { _all: number } }>) {
  return {
    job: { count: vi.fn().mockResolvedValue(12) },
    company: {
      count: vi.fn().mockResolvedValue(memberships.reduce((n, row) => n + row._count._all, 0)),
      groupBy: vi.fn().mockResolvedValue(memberships),
      findMany: vi.fn().mockResolvedValue([
        { name: 'Reviewed employer', sectorCodes: ['FASHION', 'RETAIL'], _count: { jobs: 8 } },
        { name: 'Unclassified employer', sectorCodes: [], _count: { jobs: 4 } },
      ]),
    },
    jobSource: { count: vi.fn().mockResolvedValue(12), groupBy: vi.fn().mockResolvedValue([]) },
  };
}

describe('statistics from reviewed employer memberships', () => {
  it('counts overlapping memberships and reports employers without a reviewed sector explicitly', async () => {
    const db = database([
      { sectorCodes: ['FASHION', 'RETAIL'], _count: { _all: 2 } },
      { sectorCodes: ['FASHION'], _count: { _all: 3 } },
      { sectorCodes: [], _count: { _all: 4 } },
    ]);
    const stats = await runStats(db as unknown as PrismaClient);
    expect(stats.companies).toBe(9);
    expect(stats.sectors).toEqual([
      { sector: 'FASHION', count: 5 },
      { sector: 'RETAIL', count: 2 },
      { sector: 'unclassified', count: 4 },
    ]);
    expect(stats.topEmployers).toEqual([
      { name: 'Reviewed employer', sectorCodes: ['FASHION', 'RETAIL'], jobs: 8 },
      { name: 'Unclassified employer', sectorCodes: [], jobs: 4 },
    ]);
    expect(db.company.groupBy).toHaveBeenCalledWith({ by: ['sectorCodes'], _count: { _all: true } });
    expect(db.company.findMany).toHaveBeenCalledWith({
      select: { name: true, sectorCodes: true, _count: { select: { jobs: true } } },
      orderBy: { jobs: { _count: 'desc' } }, take: 12,
    });
  });

  it('returns no sector bucket when no employer exists', async () => {
    const db = database([]);
    db.company.findMany.mockResolvedValue([]);
    const stats = await runStats(db as unknown as PrismaClient);
    expect(stats.companies).toBe(0);
    expect(stats.sectors).toEqual([]);
    expect(stats.topEmployers).toEqual([]);
  });
});

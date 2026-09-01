import type { PrismaClient } from '@prisma/client';

/**
 * Database snapshot, for checking what the pipeline actually produced.
 *
 * Ingest logs say what a run did; this says what the database HOLDS. The two
 * diverge as soon as a run reports UPDATED instead of CREATED, which is exactly
 * when the counts matter.
 */
export async function runStats(prisma: PrismaClient) {
  const [jobsTotal, franceActive, geocoded, companies, withSources] = await Promise.all([
    prisma.job.count(),
    prisma.job.count({ where: { isFrance: true, isActive: true } }),
    prisma.job.count({ where: { isFrance: true, isActive: true, latitude: { not: null } } }),
    prisma.company.count(),
    prisma.jobSource.count(),
  ]);

  const bySector = await prisma.company.groupBy({
    by: ['sector'],
    _count: { _all: true },
  });

  const topEmployers = await prisma.company.findMany({
    select: { name: true, sector: true, _count: { select: { jobs: true } } },
    orderBy: { jobs: { _count: 'desc' } },
    take: 12,
  });

  const bySource = await prisma.jobSource.groupBy({
    by: ['sourceKey'],
    where: { isActive: true },
    _count: { _all: true },
  });

  return {
    jobsTotal,
    franceActive,
    geocoded,
    companies,
    jobSources: withSources,
    sectors: bySector.map((row) => ({ sector: row.sector, count: row._count._all })),
    sources: bySource.map((row) => ({ source: row.sourceKey, count: row._count._all })),
    topEmployers: topEmployers.map((row) => ({
      name: row.name,
      sector: row.sector,
      jobs: row._count.jobs,
    })),
  };
}

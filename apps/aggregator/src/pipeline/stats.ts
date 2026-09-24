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
    prisma.job.count({ where: { countryCode: 'FR', isActive: true } }),
    prisma.job.count({ where: { countryCode: 'FR', isActive: true, latitude: { not: null } } }),
    prisma.company.count(),
    prisma.jobSource.count(),
  ]);

  const memberships = await prisma.company.groupBy({
    by: ['sectorCodes'],
    _count: { _all: true },
  });
  // Each reviewed membership counts once per employer. Totals overlap for
  // multi-sector employers; an empty membership remains explicitly unclassified.
  const bySector = new Map<string, number>();
  for (const row of memberships) {
    for (const code of row.sectorCodes.length ? row.sectorCodes : ['unclassified']) {
      bySector.set(code, (bySector.get(code) ?? 0) + row._count._all);
    }
  }

  const topEmployers = await prisma.company.findMany({
    select: { name: true, sectorCodes: true, _count: { select: { jobs: true } } },
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
    sectors: [...bySector].sort(([a], [b]) => a.localeCompare(b)).map(([sector, count]) => ({ sector, count })),
    sources: bySource.map((row) => ({ source: row.sourceKey, count: row._count._all })),
    topEmployers: topEmployers.map((row) => ({
      name: row.name,
      sectorCodes: row.sectorCodes,
      jobs: row._count.jobs,
    })),
  };
}

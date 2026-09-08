import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const result = await p.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const fj = { sourceKey: 'fashionjobs', isActive: true };
    const other = { sourceKey: { not: 'fashionjobs' }, isActive: true };
    return {
      at: new Date().toISOString(), readOnly: true,
      source: await tx.source.findUnique({ where: { key: 'fashionjobs' }, select: { key: true, maison: true, status: true, config: true, robotsVerdict: true, robotsCheckedAt: true, verifiedJobCount: true } }),
      cursor: await tx.sourceCursor.findUnique({ where: { sourceKey: 'fashionjobs' } }),
      activeRepresentations: await tx.jobSource.count({ where: { ...fj, job: { isActive: true } } }),
      activeUniqueJobs: await tx.job.count({ where: { isActive: true, sources: { some: fj } } }),
      firstLastObservation: await tx.jobSource.aggregate({ where: { sourceKey: 'fashionjobs' }, _min: { firstSeenAt: true }, _max: { lastSeenAt: true } }),
      france: {
        total: await tx.job.count({ where: { isActive: true, isFrance: true } }),
        withFashionjobs: await tx.job.count({ where: { isActive: true, isFrance: true, sources: { some: fj } } }),
        onlyFashionjobs: await tx.job.count({ where: { isActive: true, isFrance: true, AND: [{ sources: { some: fj } }, { sources: { none: other } }] } }),
        fashionjobsAndOther: await tx.job.count({ where: { isActive: true, isFrance: true, AND: [{ sources: { some: fj } }, { sources: { some: other } }] } }),
        withoutFashionjobs: await tx.job.count({ where: { isActive: true, isFrance: true, sources: { none: fj } } }),
      },
      sourceCoverage: await tx.$queryRaw`SELECT js."sourceKey", s.maison, s.kind, s.tier, count(DISTINCT j.id)::int AS france FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id LEFT JOIN "Source" s ON s.key=js."sourceKey" WHERE j."isActive" AND j."isFrance" AND js."isActive" GROUP BY js."sourceKey", s.maison, s.kind, s.tier ORDER BY france DESC`,
      runs: await tx.sourceRun.findMany({ where: { sourceKey: 'fashionjobs' }, orderBy: { ranAt: 'desc' }, take: 12 }),
      missingCountrySources: await tx.$queryRaw`SELECT js."sourceKey", count(DISTINCT j.id)::int AS missing FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id WHERE j."isActive" AND js."isActive" AND j."countryCode" IS NULL GROUP BY js."sourceKey" ORDER BY missing DESC LIMIT 10`,
      lorealCountries: await tx.job.groupBy({ by: ['countryCode'], where: { isActive: true, sources: { some: { isActive: true, sourceKey: 'l-oreal-professionnel' } } }, _count: true }),
    };
  }, { timeout: 30000 });
  console.log(JSON.stringify(result, null, 2));
} finally { await p.$disconnect(); }

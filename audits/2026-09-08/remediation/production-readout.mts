import { PrismaClient } from '@prisma/client';
import { assertIdentityReview } from '../../../apps/aggregator/src/connectors/sourceIdentity.js';

const p = new PrismaClient();
try {
  const result = await p.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const countries = await tx.job.groupBy({ by: ['countryCode'], where: { isActive: true }, _count: true, orderBy: { _count: { countryCode: 'desc' } } });
    const cohorts: Record<string, unknown> = {};
    for (const key of ['sandro', 'parfums-chanel', 'l-oreal-professionnel', 'lovisa', 'browns', 'tiffany-oracle']) {
      const source = await tx.source.findUnique({ where: { key } });
      const rows = await tx.job.findMany({ where: { isActive: true, sources: { some: { sourceKey: key, isActive: true } } }, select: { company: { select: { name: true } } } });
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.company.name] = (counts[row.company.name] ?? 0) + 1;
      cohorts[key] = { source: source && { key: source.key, maison: source.maison, status: source.status }, counts };
    }
    const coast = await tx.source.findUniqueOrThrow({ where: { key: 'coast' } });
    const latestReview = await tx.sourceIdentityReview.findFirst({ where: { sourceKey: coast.key }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    let guard = 'ACCEPTED';
    try { assertIdentityReview(coast, latestReview); } catch (error) { guard = String(error); }
    const excluded = await tx.source.findMany({ where: { key: { in: ['via', 'ashoka', 'coast', 'blend', 'tala', 'ion', 'gate', 'didi', 'fay', 'honor', 'hone', 'cleo', 'gridline', 'novara', 'sep', 'public', 'galileo', 'eclipse', 'seer', 'yes'] } }, select: { key: true, maison: true, status: true } });
    return {
      at: new Date().toISOString(), readOnly: true,
      activeJobs: await tx.job.count({ where: { isActive: true } }),
      companies: await tx.company.count(),
      companiesWithActiveJobs: await tx.company.count({ where: { jobs: { some: { isActive: true } } } }),
      companyKinds: await tx.company.groupBy({ by: ['kind'], _count: true }),
      sourceStatuses: await tx.source.groupBy({ by: ['status'], _count: true }),
      activeAdapterFamilies: (await tx.source.groupBy({ by: ['kind'], where: { status: 'ACTIVE' } })).length,
      companiesWithoutActiveSourceFootprint: (await tx.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "Company" c WHERE NOT EXISTS (SELECT 1 FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id JOIN "Source" s ON s.key=js."sourceKey" WHERE j."companyId"=c.id AND s.status='ACTIVE')`)[0].count,
      sourceIdentityReviews: await tx.sourceIdentityReview.count(),
      activeCompaniesWithoutDomain: await tx.company.count({ where: { domain: null, jobs: { some: { isActive: true } } } }),
      franceCanonical: await tx.job.count({ where: { isActive: true, countryCode: 'FR' } }),
      franceFilter: await tx.job.count({ where: { isActive: true, isFrance: true } }),
      franceDisagreements: await tx.job.findMany({ where: { isActive: true, OR: [{ countryCode: 'FR', isFrance: false }, { isFrance: true, OR: [{ countryCode: { not: 'FR' } }, { countryCode: null }] }] }, select: { id: true, title: true, location: true, countryCode: true, isFrance: true } }),
      countries, cohorts, excluded,
      oracleExamples: await tx.job.findMany({ where: { sources: { some: { sourceKey: 'tiffany-oracle', OR: [{ url: { contains: '/job/63763' } }, { url: { contains: '/job/63762' } }] } } }, select: { id: true, title: true, city: true, countryCode: true, isActive: true, sources: { select: { url: true, isActive: true } } } }),
      identityGuard: { source: coast.key, outcome: guard, method: 'Pure assertion against actual stored source and latest review; no promotion or writes attempted.' },
    };
  }, { timeout: 30000 });
  console.log(JSON.stringify(result, null, 2));
} finally { await p.$disconnect(); }

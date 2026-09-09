/** Read-only production snapshot for the directory comparison. Contains no credentials. */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
const output=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
if(!output) throw new Error('--out=<private snapshot path> required');
const p = new PrismaClient();
try {
  const result = await p.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return {
      at: new Date().toISOString(),
      companies: await tx.company.findMany({ select: { id: true, name: true, canonicalKey: true, domain: true, careersUrl: true, parentGroup: true, kind: true, sector: true, aliases: { select: { aliasKey: true, displayName: true } } } }),
      counts: await tx.$queryRaw`WITH active AS (
        SELECT j.id, j."companyId", j."isFrance", j."countryCode",
          EXISTS(SELECT 1 FROM "JobSource" js JOIN "Source" s ON s.key=js."sourceKey"
            WHERE js."jobId"=j.id AND js."isActive" AND s.status='ACTIVE'
            AND s.tier IN ('EMPLOYER_DIRECT','ATS_OFFICIAL','GROUP_OFFICIAL')) AS direct
        FROM "Job" j WHERE j."isActive"
      ) SELECT "companyId", COUNT(*)::int AS world,
        COUNT(*) FILTER (WHERE "isFrance")::int AS france,
        COUNT(*) FILTER (WHERE direct)::int AS "directWorld",
        COUNT(*) FILTER (WHERE direct AND "isFrance")::int AS "directFrance",
        COUNT(*) FILTER (WHERE direct AND "countryCode" IS NULL)::int AS "directCountryMissing"
      FROM active GROUP BY "companyId"`,
      links: await tx.$queryRaw`SELECT DISTINCT j."companyId",js."sourceKey"
        FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id WHERE j."isActive" AND js."isActive"`,
      sources: await tx.source.findMany({ select: { key: true, maison: true, status: true, kind: true, tier: true, careersDomain: true, tenantKey: true, config: true, verifiedJobCount: true } }),
      identityReviews: await tx.sourceIdentityReview.findMany({ orderBy: { createdAt: 'desc' } }),
    };
  }, { timeout: 60000 });
  writeFileSync(output, JSON.stringify(result), { mode: 0o600 });
  console.log(JSON.stringify({ at: result.at, companies: result.companies.length, sources: result.sources.length, identityReviews: result.identityReviews.length }));
} finally { await p.$disconnect(); }

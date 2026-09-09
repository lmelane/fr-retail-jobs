import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6);
if (!out) throw new Error('--out required');
const db = new PrismaClient();
try {
 const result = await db.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  return {
   at: new Date().toISOString(),
   metrics: await tx.$queryRaw`SELECT COUNT(*)::int AS active,
    COUNT(*) FILTER(WHERE "isFrance")::int AS france,
    COUNT(*) FILTER(WHERE "countryCode"='FR')::int AS "canonicalFrance",
    COUNT(*) FILTER(WHERE "countryCode" IS NULL)::int AS "countryMissing",
    COUNT(*) FILTER(WHERE "countryCode" IS NOT NULL AND "isFrance" IS DISTINCT FROM ("countryCode"='FR'))::int AS "franceFlagContradictions",
    COUNT(*) FILTER(WHERE "jobFunction" IS NULL)::int AS "functionMissing",
    COUNT(*) FILTER(WHERE "seniority"='MID')::int AS "seniorityMID",
    COUNT(*) FILTER(WHERE "postedAt" IS NULL)::int AS "publicationDateMissing",
    COUNT(*) FILTER(WHERE "postedAt">NOW())::int AS "futurePublicationDates",
    COUNT(*) FILTER(WHERE "validThrough"<NOW())::int AS "pastValidThrough",
    COUNT(*) FILTER(WHERE "lastSeenAt"<NOW()-interval '48 hours')::int AS "unseen48h"
    FROM "Job" WHERE "isActive"`,
   countries: await tx.$queryRaw`SELECT "countryCode",COUNT(*)::int AS active FROM "Job" WHERE "isActive" GROUP BY "countryCode" ORDER BY active DESC`,
   functions: await tx.$queryRaw`SELECT "jobFunction",COUNT(*)::int AS active FROM "Job" WHERE "isActive" GROUP BY "jobFunction" ORDER BY active DESC`,
   companyCounts: await tx.$queryRaw`SELECT COUNT(*)::int AS records,COUNT(DISTINCT "canonicalKey")::int AS "distinctCanonicalKeys",COUNT(DISTINCT "parentGroup")::int AS "parentGroupLabels",COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM "Job" j WHERE j."companyId"=c.id AND j."isActive"))::int AS "withActiveJobs" FROM "Company" c`,
   missingCanonicalEmployer: await tx.$queryRaw`SELECT COUNT(*)::int AS active FROM "Job" j LEFT JOIN "Company" c ON c.id=j."companyId" WHERE j."isActive" AND (c.id IS NULL OR btrim(c."canonicalKey")='')`,
   directCoverage: await tx.$queryRaw`WITH direct AS (SELECT j.id,j."companyId",j."isFrance" FROM "Job" j WHERE j."isActive" AND EXISTS (SELECT 1 FROM "JobSource" js JOIN "Source" s ON s.key=js."sourceKey" WHERE js."jobId"=j.id AND js."isActive" AND s.status='ACTIVE' AND s.tier IN ('EMPLOYER_DIRECT','ATS_OFFICIAL','GROUP_OFFICIAL'))) SELECT COUNT(*)::int AS "directActiveJobs",COUNT(*) FILTER(WHERE "isFrance")::int AS "directFrance",COUNT(DISTINCT "companyId")::int AS "companiesWithDirectActiveJobs" FROM direct`,
   companyKinds: await tx.$queryRaw`SELECT kind,COUNT(*)::int AS records FROM "Company" GROUP BY kind ORDER BY records DESC`,
   sourceCounts: await tx.$queryRaw`SELECT status,COUNT(*)::int AS sources,COUNT(DISTINCT kind)::int AS "implementationKinds" FROM "Source" GROUP BY status ORDER BY status`,
   applicationPoolCandidates: await tx.$queryRaw`SELECT id,title,"canonicalSourceKey",url FROM "Job" WHERE "isActive" AND title ~* '^(candidatures? spontan|spontaneous applications?|unsolicited applications?|general applications?)' ORDER BY title`,
  };
 }, { timeout: 60000 });
 writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
 console.log(JSON.stringify({at:result.at,metrics:result.metrics,companyCounts:result.companyCounts,sourceCounts:result.sourceCounts}));
} finally { await db.$disconnect(); }

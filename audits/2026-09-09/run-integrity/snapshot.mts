import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
const p = new PrismaClient();
try {
 const result = await p.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  return {
   at: new Date().toISOString(),
   metrics: await tx.$queryRaw`SELECT COUNT(*)::int AS active,
    COUNT(*) FILTER (WHERE "isFrance")::int AS france,
    COUNT(*) FILTER (WHERE "countryCode"='FR')::int AS countryFrance,
    COUNT(*) FILTER (WHERE "countryCode" IS NULL)::int AS countryMissing,
    COUNT(*) FILTER (WHERE "postedAt" IS NULL)::int AS publicationDateMissing,
    COUNT(*) FILTER (WHERE "postedAt">NOW())::int AS publicationDateFuture,
    COUNT(*) FILTER (WHERE "lastSeenAt"<NOW()-interval '48 hours')::int AS unseen48h,
    COUNT(*) FILTER (WHERE "validThrough"<NOW())::int AS expiredActive
    FROM "Job" WHERE "isActive"`,
   countries: await tx.$queryRaw`SELECT "countryCode", COUNT(*)::int AS active FROM "Job" WHERE "isActive" GROUP BY "countryCode" ORDER BY active DESC`,
   sources: await tx.$queryRaw`WITH latest AS (SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey","ranAt" DESC,id DESC)
    SELECT s.key,s.kind,l.status,l."ranAt",l.fetched,l.accepted,l.complete,l."canAttestAbsence",l.errors,l.note
    FROM "Source" s LEFT JOIN latest l ON l."sourceKey"=s.key WHERE s.status='ACTIVE' ORDER BY s.key`,
   loreal: {
    runs: await tx.sourceRun.findMany({where:{sourceKey:'l-oreal-professionnel'},orderBy:{ranAt:'desc'},take:5}),
    sources: await tx.$queryRaw`SELECT COUNT(*)::int AS representations, COUNT(*) FILTER (WHERE "isActive")::int AS active, MAX("lastSeenAt") AS "lastSeenAt" FROM "JobSource" WHERE "sourceKey"='l-oreal-professionnel'`,
    closedDuringRun: await tx.$queryRaw`SELECT e.type,COUNT(*)::int AS events FROM "JobEvent" e WHERE e.type='CLOSED' AND e."at">='2026-09-08T22:00:00Z' AND e."at"<='2026-09-08T23:00:00Z' AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId"=e."jobId" AND js."sourceKey"='l-oreal-professionnel') GROUP BY e.type`,
   },
  };
 }, { timeout: 60000 });
 writeFileSync('audits/2026-09-09/run-integrity/production-snapshot.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({at:result.at,metrics:result.metrics,loreal:result.loreal}));
} finally {await p.$disconnect()}

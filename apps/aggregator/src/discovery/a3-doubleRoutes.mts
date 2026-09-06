/**
 * a3 — clés à deux routes (API + sitemap sous la même clé), historique
 * FashionJobs, état des clés loreal/wttj. LECTURE SEULE.
 * Usage : DATABASE_URL=… npx tsx src/discovery/a3-doubleRoutes.mts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const q = (sql: string) => prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
try {
  console.log('\n## Run 1 — les 5 clés qui ont produit DEUX lignes SourceRun (API puis sitemap)');
  console.table(await q(`
    SELECT "sourceKey", to_char("ranAt",'HH24:MI:SS') AS at, status, jobs, "previousJobs", "descriptionRate", "countryRate", left(note,60) AS note
    FROM "SourceRun" WHERE "ranAt" BETWEEN '2026-09-06T07:59:00Z' AND '2026-09-06T09:02:00Z'
      AND "sourceKey" IN ('puig','galeries-lafayette','courir','lacoste','kering','loreal','wttj','decathlon','michael-page-france','fashionjobs')
    ORDER BY "sourceKey", "ranAt"`));

  console.log('\n## Source — kering / loreal / wttj / lacoste / courir / puig / galeries-lafayette');
  console.table(await q(`
    SELECT key, kind, status, "jobUrlPattern", "lastRunStatus", "lastRunJobs", to_char("updatedAt",'MM-DD HH24:MI') AS updated
    FROM "Source" WHERE key IN ('kering','loreal','wttj','lacoste','courir','puig','galeries-lafayette') ORDER BY key`));

  console.log('\n## JobSource par clé (actives / inactives) pour ces clés');
  console.table(await q(`
    SELECT "sourceKey", count(*) FILTER (WHERE "isActive")::int AS active, count(*) FILTER (WHERE NOT "isActive")::int AS inactive,
           count(*) FILTER (WHERE "externalId" LIKE 'http%')::int AS url_ids
    FROM "JobSource" WHERE "sourceKey" IN ('kering','loreal','wttj','lacoste','courir','puig','galeries-lafayette','fashionjobs','michael-page-france','decathlon','l-oreal-professionnel')
    GROUP BY 1 ORDER BY 1`));

  console.log('\n## FashionJobs — 12 derniers SourceRun (offres vues par run)');
  console.table(await q(`
    SELECT to_char("ranAt",'MM-DD HH24:MI') AS at, status, jobs, "previousJobs", left(note,50) AS note
    FROM "SourceRun" WHERE "sourceKey"='fashionjobs' ORDER BY "ranAt" DESC LIMIT 12`));

  console.log('\n## FashionJobs — Jobs fermés (isActive=false) dont la seule source est fashionjobs');
  console.table(await q(`
    SELECT count(*)::int AS closed_jobs FROM "Job" j WHERE NOT j."isActive"
      AND EXISTS (SELECT 1 FROM "JobSource" s WHERE s."jobId"=j.id AND s."sourceKey"='fashionjobs')`));

  console.log('\n## Michael Page — 8 derniers SourceRun');
  console.table(await q(`
    SELECT to_char("ranAt",'MM-DD HH24:MI') AS at, status, jobs, "previousJobs", left(note,50) AS note
    FROM "SourceRun" WHERE "sourceKey"='michael-page-france' ORDER BY "ranAt" DESC LIMIT 8`));

  console.log('\n## Decathlon — 8 derniers SourceRun');
  console.table(await q(`
    SELECT to_char("ranAt",'MM-DD HH24:MI') AS at, status, jobs, "previousJobs" FROM "SourceRun" WHERE "sourceKey"='decathlon' ORDER BY "ranAt" DESC LIMIT 8`));
} finally { await prisma.$disconnect(); }

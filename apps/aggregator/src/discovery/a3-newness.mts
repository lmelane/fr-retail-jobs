/**
 * a3 — d'où viennent les offres NOUVELLES d'une journée stable (09-05, 6 runs à
 * 4 h) : concentration par source, pour juger une « voie rapide ». LECTURE SEULE.
 * Usage : DATABASE_URL=… npx tsx src/discovery/a3-newness.mts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const q = (sql: string) => prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
try {
  console.log('\n## Offres créées le 09-05 (firstSeenAt), par source de rattachement — top 15');
  console.table(await q(`
    SELECT s."sourceKey", count(DISTINCT j.id)::int AS new_jobs
    FROM "Job" j JOIN "JobSource" s ON s."jobId"=j.id
    WHERE j."firstSeenAt"::date = '2026-09-05' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`));
  console.table(await q(`
    SELECT count(DISTINCT s."sourceKey")::int AS sources_with_new, count(DISTINCT j.id)::int AS new_jobs
    FROM "Job" j JOIN "JobSource" s ON s."jobId"=j.id WHERE j."firstSeenAt"::date = '2026-09-05'`));
  console.log('\n## Offres créées le 09-05 par run (heure de firstSeenAt)');
  console.table(await q(`
    SELECT to_char(date_trunc('hour',"firstSeenAt"),'HH24:00') AS h, count(*)::int AS new_jobs FROM "Job" WHERE "firstSeenAt"::date='2026-09-05' GROUP BY 1 ORDER BY 1`));
  console.log('\n## Lacoste — SourceRun du run 2 (ordre API puis sitemap ?)');
  console.table(await q(`
    SELECT "sourceKey", to_char("ranAt",'HH24:MI:SS') AS at, status, jobs, "previousJobs", left(note,60) AS note
    FROM "SourceRun" WHERE "sourceKey" IN ('lacoste','courir') AND "ranAt" BETWEEN '2026-09-06T09:11:00Z' AND '2026-09-06T09:56:00Z' ORDER BY 1, "ranAt"`));
  console.log('\n## postedAt : part des offres actives publiées il y a < 7 j / < 30 j (fraîcheur réelle du marché)');
  console.table(await q(`
    SELECT count(*) FILTER (WHERE "postedAt" > now()-interval '7 days')::int AS posted_7d,
           count(*) FILTER (WHERE "postedAt" > now()-interval '30 days')::int AS posted_30d,
           count(*) FILTER (WHERE "postedAt" IS NOT NULL)::int AS with_posted, count(*)::int AS active
    FROM "Job" WHERE "isActive"`));
} finally { await prisma.$disconnect(); }

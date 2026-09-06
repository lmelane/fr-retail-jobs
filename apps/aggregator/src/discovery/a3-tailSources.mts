/**
 * a3 — les sources coupées par la deadline douce relisent-elles toujours la
 * même tête de liste ? Attestation par jour des JobSource actives pour les
 * sources géantes. LECTURE SEULE.
 * Usage : DATABASE_URL=… npx tsx src/discovery/a3-tailSources.mts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT "sourceKey", to_char("lastSeenAt", 'MM-DD') AS last_seen_day, count(*)::int AS active_job_sources,
           count(*) FILTER (WHERE "lastSeenAt" BETWEEN '2026-09-06T07:59:00Z' AND '2026-09-06T09:02:00Z')::int AS seen_run1,
           count(*) FILTER (WHERE "lastSeenAt" >= '2026-09-06T09:11:00Z')::int AS seen_run2
    FROM "JobSource" WHERE "isActive" AND "sourceKey" IN ('michael-page-france','decathlon','lacoste','fashionjobs','kering','loreal','wttj','courir')
    GROUP BY 1,2 ORDER BY 1,2`);
  console.table(rows);
  const tot = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT "sourceKey", count(*)::int AS active, count(*) FILTER (WHERE NOT "isActive")::int AS inactive_dummy
    FROM "JobSource" WHERE "sourceKey" IN ('michael-page-france','decathlon','lacoste','fashionjobs','kering','loreal','wttj','courir') AND "isActive" GROUP BY 1 ORDER BY 2 DESC`);
  console.table(tot);
  const kering = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT key, kind, "jobUrlPattern" IS NOT NULL AS has_job_url_pattern, left(config::text, 120) AS config, "lastRunJobs" FROM "Source" WHERE key IN ('kering','loreal','michael-page-france','decathlon','lacoste','fashionjobs')`);
  console.table(kering);
} finally { await prisma.$disconnect(); }

/** a3 — la base bouge-t-elle pendant l'audit ? LECTURE SEULE. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  console.table(await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT now() AS now,
      (SELECT count(*) FROM "Job" WHERE "isActive")::int AS jobs_active,
      (SELECT count(*) FROM "Job" WHERE NOT "isActive")::int AS jobs_inactive,
      (SELECT count(*) FROM "JobSource" WHERE "isActive")::int AS js_active,
      (SELECT max("ranAt") FROM "SourceRun") AS last_sourcerun,
      (SELECT max("lastSeenAt") FROM "JobSource") AS last_seen,
      (SELECT count(*) FROM "Job" WHERE "updatedAt" > now() - interval '20 minutes')::int AS jobs_updated_20min,
      (SELECT count(*) FROM "Company" WHERE "updatedAt" > now() - interval '20 minutes')::int AS companies_updated_20min,
      (SELECT count(*) FROM pg_stat_activity WHERE datname='railway' AND state='active')::int AS active_queries`));
  console.table(await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT application_name, client_addr::text, state, count(*)::int AS n FROM pg_stat_activity WHERE datname='railway' GROUP BY 1,2,3 ORDER BY 4 DESC`));
} finally { await prisma.$disconnect(); }

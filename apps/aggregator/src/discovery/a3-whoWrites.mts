/** a3 — qui écrit dans la base en ce moment ? (rejeu local en cours ?) LECTURE SEULE. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  console.table(await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT "sourceKey", count(*)::int AS touched, to_char(min("lastSeenAt"),'HH24:MI:SS') AS first, to_char(max("lastSeenAt"),'HH24:MI:SS') AS last
    FROM "JobSource" WHERE "lastSeenAt" > now() - interval '25 minutes' GROUP BY 1 ORDER BY 3`));
  console.table(await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT "sourceKey", status, jobs, "previousJobs", to_char("ranAt",'HH24:MI:SS') AS at FROM "SourceRun" WHERE "ranAt" > '2026-09-06T09:52:00Z' ORDER BY "ranAt"`));
  console.table(await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT key, "lastRunStatus", "lastRunJobs", to_char("lastRunAt",'HH24:MI:SS') AS last_run_at, to_char("updatedAt",'HH24:MI:SS') AS updated FROM "Source" WHERE "updatedAt" > '2026-09-06T09:52:00Z' ORDER BY "updatedAt"`));
} finally { await prisma.$disconnect(); }

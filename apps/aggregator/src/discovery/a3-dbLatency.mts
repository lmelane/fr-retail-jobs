/**
 * a3 — latence d'un aller-retour Postgres depuis un poste local vers la prod
 * (proxy TCP public Railway), pour chiffrer le coût d'un rejeu local d'une
 * source. LECTURE SEULE (SELECT only).
 *
 * Usage : DATABASE_URL=… npx tsx src/discovery/a3-dbLatency.mts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  await prisma.$queryRawUnsafe('SELECT 1');
  const samples: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    await prisma.$queryRawUnsafe('SELECT 1');
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `RTT "SELECT 1" via ${new URL(process.env.DATABASE_URL ?? '').host} — min ${samples[0].toFixed(1)} ms, médiane ${samples[15].toFixed(1)} ms, p90 ${samples[27].toFixed(1)} ms, max ${samples[29].toFixed(1)} ms (n=30)`,
  );

  // Une requête typique de l'upsert : le cluster de dédup d'une société.
  const t1 = performance.now();
  const sample = await prisma.job.findFirst({ where: { isActive: true }, select: { clusterKey: true, companyId: true } });
  const cluster = await prisma.job.findMany({ where: { clusterKey: sample?.clusterKey ?? '' }, select: { id: true } });
  console.log(`findFirst + findMany(clusterKey) : ${(performance.now() - t1).toFixed(0)} ms (${cluster.length} lignes)`);

  const stale = await prisma.$queryRawUnsafe<{ min_seen: Date; n_before_0904_0530: number }[]>(`
    SELECT min("lastSeenAt") AS min_seen,
           count(*) FILTER (WHERE "lastSeenAt" < '2026-09-04T05:30:00Z')::int AS n_before_0904_0530
    FROM "JobSource" WHERE "isActive"`);
  console.log('JobSource actives — lastSeenAt le plus ancien :', stale[0].min_seen.toISOString(), '; avant 09-04 05:30 :', stale[0].n_before_0904_0530);

  const run2 = await prisma.$queryRawUnsafe<{ n: number; distinct_keys: number }[]>(`
    SELECT count(*)::int AS n, count(DISTINCT "sourceKey")::int AS distinct_keys
    FROM "SourceRun" WHERE "ranAt" BETWEEN '2026-09-06T09:11:00Z' AND '2026-09-06T09:56:00Z'`);
  console.log('SourceRun run 2 (09:11→09:56) :', run2[0]);

  const closedBy = await prisma.$queryRawUnsafe<{ day: string; n: number }[]>(`
    SELECT to_char("lastSeenAt", 'MM-DD') AS day, count(*)::int AS n
    FROM "JobSource" WHERE "isActive" AND "lastSeenAt" < now() - interval '48 hours' GROUP BY 1 ORDER BY 1`);
  console.log('JobSource actives > 48 h, par jour de lastSeenAt :', closedBy);
} finally {
  await prisma.$disconnect();
}

import { PrismaClient } from '@prisma/client';
/**
 * Ferme les offres d'UNE source que son dernier passage n'a pas ré-attestées —
 * le refresh, mais ciblé sur une clé, sans attendre la reprise des crons.
 * Cas : Michael Page après le filtre sectoriel (3 258 offres hors secteur ne
 * seront plus jamais re-listées par nous).
 *
 * Usage : DATABASE_URL=… npx tsx src/discovery/ops-close-stale-source.mts <clé> <ISO de début du passage> [--apply]
 * Ne ferme que les offres dont TOUTES les sources sont périmées (D23).
 */
const [key, sinceRaw, ...flags] = process.argv.slice(2);
if (!key || !sinceRaw) throw new Error('usage: ops-close-stale-source <clé> <ISO> [--apply]');
const since = new Date(sinceRaw);
const apply = flags.includes('--apply');
const p = new PrismaClient();
const stale = await p.jobSource.findMany({ where: { sourceKey: key, isActive: true, lastSeenAt: { lt: since } }, select: { id: true, jobId: true } });
const jobIds = [...new Set(stale.map((s) => s.jobId))];
const orphans = await p.job.findMany({
  where: { id: { in: jobIds }, isActive: true, sources: { none: { isActive: true, lastSeenAt: { gte: since } } } },
  select: { id: true },
});
console.log(`${key}: ${stale.length} rattachements non revus depuis ${since.toISOString()}, ${orphans.length} offres sans autre source vivante`);
if (!apply) { await p.$disconnect(); process.exit(0); }
await p.jobSource.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { isActive: false } });
const closed = await p.job.updateMany({ where: { id: { in: orphans.map((j) => j.id) } }, data: { isActive: false } });
console.log(JSON.stringify({ jobSourcesClosed: stale.length, jobsClosed: closed.count }));
await p.$disconnect();

/**
 * MARC O'POLO (D-485) — ÉTAT DE LA SOURCE EN BASE, lecture seule.
 *
 *   PYTHONDONTWRITEBYTECODE=1 python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-09-30/marc-o-polo/scripts/etat-source.mts
 *
 * Rend la ligne `Source` (famille, configuration, statut, révision), les publications `JobSource` (actives ou non,
 * forme de leur identifiant, adresse), les offres `Job` rattachées encore en ligne, et les derniers `SourceRun`.
 * Sert à savoir ce que le changement de lecteur fera aux publications existantes : un identifiant qui change de forme
 * rend l'ancienne publication absente de la preuve suivante.
 */
import { PrismaClient } from '@prisma/client';

const KEY = 'marc-o-polo';
const prisma = new PrismaClient({ log: [] });
try {
  const source = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT key, maison, kind, config, status, tier, "tenantKey", "careersDomain", "currentRevisionId", "updatedAt" FROM "Source" WHERE key = $1`, KEY);
  const publications = await prisma.$queryRawUnsafe<Array<{ externalId: string; url: string; title: string | null; isActive: boolean; jobId: string | null;
    firstSeenAt: Date; lastSeenAt: Date; quarantinedAt: Date | null }>>(
    `SELECT "externalId", url, title, "isActive", "jobId", "firstSeenAt", "lastSeenAt", "quarantinedAt" FROM "JobSource" WHERE "sourceKey" = $1 ORDER BY "firstSeenAt"`, KEY);
  const jobs = await prisma.$queryRawUnsafe<Array<{ status: string; n: bigint }>>(
    `SELECT CASE WHEN j."isActive" THEN 'actif' ELSE 'inactif' END AS status, count(*) AS n
       FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id WHERE s."sourceKey" = $1 GROUP BY 1`, KEY);
  const runs = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT "ranAt", status, jobs, fetched, accepted, "declaredTotal", truncated, errors, complete, "canAttestAbsence", left(note, 160) AS note
       FROM "SourceRun" WHERE "sourceKey" = $1 ORDER BY "ranAt" DESC LIMIT 6`, KEY);
  const forme = (id: string) => /^[0-9a-f]{40}$/.test(id) ? 'sha1(adresse)' : /^\d{4}-\d{4}$/.test(id) ? 'natif' : 'autre';
  const formes: Record<string, number> = {};
  for (const p of publications) formes[`${forme(p.externalId)} actif=${p.isActive}`] = (formes[`${forme(p.externalId)} actif=${p.isActive}`] ?? 0) + 1;
  console.log(JSON.stringify({
    source,
    publications: { total: publications.length, formes,
      actives: publications.filter((p) => p.isActive).map((p) => ({ externalId: p.externalId, url: p.url, title: p.title, jobId: p.jobId,
        firstSeenAt: p.firstSeenAt, lastSeenAt: p.lastSeenAt, quarantinedAt: p.quarantinedAt })) },
    offresRattachees: jobs.map((j) => ({ status: j.status, n: Number(j.n) })),
    derniersRuns: runs,
  }, null, 1));
} finally {
  await prisma.$disconnect();
}

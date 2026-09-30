/**
 * LES FICHES D'OFFRE EN ÉCHEC D'UNE FAMILLE DE SOURCES, ET CE QU'ELLES SONT DEVENUES — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/fiches-en-echec.mts --kind=digitalrecruiters [--depuis=2026-09-23] [--motif=/annonce/]
 *
 * Pour chaque requête archivée d'une capture d'offres (`JOBS`) dont la réponse est un échec (statut ≥ 400 ou échec
 * de transport) et dont l'adresse contient `--motif` : la source, l'heure, le statut, puis la PREMIÈRE lecture
 * suivante de la même adresse dans une capture ultérieure de la même source (statut, délai). Sert à dire si un échec
 * de fiche est un état de l'éditeur (la fiche ne revient pas) ou un incident passager (elle revient, et après combien
 * de temps). N'écrit rien, ne contacte aucun éditeur.
 */
import { PrismaClient } from '@prisma/client';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const kind = arg('kind');
const depuis = arg('depuis') ?? '2026-09-23';
const motif = arg('motif') ?? '';
if (!kind) { console.error('usage: fiches-en-echec.mts --kind=<famille> [--depuis=AAAA-MM-JJ] [--motif=<fragment>]'); process.exit(2); }

const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.$queryRawUnsafe<{ sourceKey: string; batchId: string; startedAt: Date; capturedAt: Date; url: string; status: number | null;
    failure: string | null; nextStatus: number | null; nextAt: Date | null; nextBatchStartedAt: Date | null; sameBatchLater: number | null }[]>(`
    WITH echecs AS (
      SELECT b."sourceKey", b.id AS "batchId", b."startedAt", r."capturedAt", r."requestUrl" AS url, r.status, r.failure, r.sequence
        FROM "RawCapture" r JOIN "CaptureBatch" b ON b.id = r."batchId" JOIN "Source" s ON s.key = b."sourceKey"
       WHERE s.kind = $1 AND b.purpose = 'JOBS' AND b."startedAt" >= $2::timestamp
         AND (r.status IS NULL OR r.status >= 400) AND r."requestUrl" LIKE '%' || $3 || '%')
    SELECT e."sourceKey", e."batchId", e."startedAt", e."capturedAt", e.url, e.status, e.failure,
           n.status AS "nextStatus", n."capturedAt" AS "nextAt", n."startedAt" AS "nextBatchStartedAt",
           (SELECT r2.status FROM "RawCapture" r2 WHERE r2."batchId" = e."batchId" AND r2."requestUrl" = e.url AND r2.sequence > e.sequence
             ORDER BY r2.sequence LIMIT 1) AS "sameBatchLater"
      FROM echecs e
      LEFT JOIN LATERAL (
        SELECT r.status, r."capturedAt", b."startedAt" FROM "RawCapture" r JOIN "CaptureBatch" b ON b.id = r."batchId"
         WHERE b."sourceKey" = e."sourceKey" AND b.purpose = 'JOBS' AND b."startedAt" > e."startedAt" AND r."requestUrl" = e.url
         ORDER BY b."startedAt", r.sequence LIMIT 1) n ON true
     ORDER BY e."startedAt", e."sourceKey"`, kind, depuis, motif);
  const parSource: Record<string, { echecs: number; revenues: number; jamaisRevues: number; toujoursEnEchec: number }> = {};
  for (const row of rows) {
    const s = (parSource[row.sourceKey] ??= { echecs: 0, revenues: 0, jamaisRevues: 0, toujoursEnEchec: 0 });
    s.echecs++;
    if (row.nextStatus === null && row.nextAt === null) s.jamaisRevues++;
    else if (row.nextStatus !== null && row.nextStatus < 400) s.revenues++;
    else s.toujoursEnEchec++;
  }
  console.log(JSON.stringify({ kind, depuis, motif, echecs: rows.length, parSource, detail: rows.map((row) => ({
    source: row.sourceKey, capture: row.batchId.slice(0, 8), a: row.capturedAt.toISOString().slice(0, 19), url: row.url, status: row.status,
    ...(row.failure ? { echec: row.failure.slice(0, 120) } : {}),
    ...(row.sameBatchLater !== null ? { relueDansLeMemeLot: row.sameBatchLater } : {}),
    suivante: row.nextAt ? { status: row.nextStatus, a: row.nextAt.toISOString().slice(0, 19),
      apresMinutes: Math.round((row.nextAt.getTime() - row.capturedAt.getTime()) / 60_000) } : null })) }, null, 1));
} finally {
  await prisma.$disconnect();
}

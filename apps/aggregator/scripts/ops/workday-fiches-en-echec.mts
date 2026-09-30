/**
 * LES FICHES WORKDAY EN ÉCHEC DES CAPTURES RETENUES — lecture seule, aucun éditeur contacté (D-482, 30/09/2026).
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/workday-fiches-en-echec.mts [--jours=15] [--apercu=160]
 *
 * Une fiche est « en échec » dans une capture quand la DERNIÈRE réponse archivée pour elle y est un statut ≥ 400 ou
 * un échec de transport : les trois essais du transport sont alors tous tombés. La fiche est nommée par le dernier
 * segment de son chemin (son identifiant) : le chemin peut changer d'un jour à l'autre (parfums-chanel, 28/09 : le
 * segment de lieu disparaît, la fiche rend 403, puis quitte la liste).
 *
 * Pour chacune : la source, la capture, les essais, un extrait du corps de la dernière réponse, et surtout ce qu'elle
 * devient ENSUITE dans les captures ultérieures de la même source — encore listée (fiche demandée) ? relue en 200 ?
 * C'est la prémisse de toute relecture : un échec passager revient, une fiche retirée ne revient pas.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const jours = Number(arg('jours') ?? 15);
const apercu = Number(arg('apercu') ?? 160);
const prisma = new PrismaClient({ log: [] });
type Echec = { sourceKey: string; batchId: string; startedAt: Date; fiche: string; essais: string; blobHash: string | null;
  lues: number; avant200: number; ulterieures: number; listeeEnsuite: number; lueEnsuite200: number };
try {
  const echecs = await prisma.$queryRawUnsafe<Echec[]>(`
    WITH b AS (SELECT id, "sourceKey", "startedAt" FROM "CaptureBatch"
                WHERE "sourceKind" = 'WORKDAY' AND purpose = 'JOBS' AND "startedAt" > now() - ($1::int * interval '1 day')),
         d AS (SELECT b."sourceKey", b.id AS "batchId", b."startedAt", regexp_replace(r."requestUrl", '^.*/', '') AS fiche,
                      r.status, r.failure, r.sequence, r."capturedAt", r."blobHash"
                 FROM "RawCapture" r JOIN b ON b.id = r."batchId"
                WHERE r.method = 'GET' AND r."requestUrl" LIKE '%/job/%'),
         dernier AS (SELECT DISTINCT ON ("batchId", fiche) * FROM d ORDER BY "batchId", fiche, sequence DESC),
         lues AS (SELECT "batchId", count(*)::int AS n FROM dernier GROUP BY 1),
         e AS (SELECT * FROM dernier WHERE status IS NULL OR status >= 400 OR failure IS NOT NULL)
    SELECT e."sourceKey", e."batchId", e."startedAt", e.fiche, e."blobHash", lues.n AS lues,
           (SELECT string_agg(coalesce(d.status::text, d.failure) || '@' || to_char(d."capturedAt", 'HH24:MI:SS'), ',' ORDER BY d.sequence)
              FROM d WHERE d."batchId" = e."batchId" AND d.fiche = e.fiche) AS essais,
           (SELECT count(*)::int FROM dernier x WHERE x."sourceKey" = e."sourceKey" AND x.fiche = e.fiche AND x."startedAt" < e."startedAt" AND x.status = 200) AS avant200,
           (SELECT count(*)::int FROM b WHERE b."sourceKey" = e."sourceKey" AND b."startedAt" > e."startedAt") AS ulterieures,
           (SELECT count(*)::int FROM dernier x WHERE x."sourceKey" = e."sourceKey" AND x.fiche = e.fiche AND x."startedAt" > e."startedAt") AS "listeeEnsuite",
           (SELECT count(*)::int FROM dernier x WHERE x."sourceKey" = e."sourceKey" AND x.fiche = e.fiche AND x."startedAt" > e."startedAt" AND x.status = 200) AS "lueEnsuite200"
      FROM e JOIN lues ON lues."batchId" = e."batchId" ORDER BY e."startedAt"`, jours);
  const [{ captures }] = await prisma.$queryRawUnsafe<{ captures: number }[]>(`SELECT count(*)::int AS captures FROM "CaptureBatch"
    WHERE "sourceKind" = 'WORKDAY' AND purpose = 'JOBS' AND "startedAt" > now() - ($1::int * interval '1 day')`, jours);
  const detail = [];
  for (const e of echecs) {
    const corps = e.blobHash ? (await readRawBlob(prisma, e.blobHash)).toString('utf8').replace(/\s+/g, ' ').slice(0, apercu) : '';
    detail.push({ source: e.sourceKey, capture: e.batchId, debut: e.startedAt, fiche: e.fiche, lues: e.lues, essais: e.essais, corps,
      avant200: e.avant200, capturesUlterieures: e.ulterieures, listeeEnsuite: e.listeeEnsuite, lueEnsuite200: e.lueEnsuite200 });
  }
  const suivies = detail.filter((e) => e.capturesUlterieures > 0);
  console.log(JSON.stringify({ jours, capturesWorkday: captures, fichesEnEchec: detail.length,
    corps: Object.entries(detail.reduce<Record<string, number>>((acc, e) => { const k = /"errorCode":"([^"]+)".*"message":"([^"]+)"/.exec(e.corps)?.slice(1).join(' ') ?? e.corps.slice(0, 40); return { ...acc, [k]: (acc[k] ?? 0) + 1 }; }, {})),
    suiviesParUneCaptureUlterieure: suivies.length,
    revenues: suivies.filter((e) => e.lueEnsuite200 > 0).length,
    encoreListeesSansRevenir: suivies.filter((e) => e.listeeEnsuite > 0 && e.lueEnsuite200 === 0).length,
    retireesDeLaListe: suivies.filter((e) => e.listeeEnsuite === 0).length,
    detail }, null, 1));
} finally {
  await prisma.$disconnect();
}

/**
 * BILAN DE LA COLLECTE MASSIVE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/bilan-collecte.mts
 *
 * Répond aux questions posées par le CEO le 18/09/2026, dans l'ordre :
 *   sources tentées / réussies / partielles / échouées · RAW capturés · extractions ·
 *   offres publiées · offres retenues/refusées et motifs · couverture RAW native ·
 *   rejeu · anomalies par famille de connecteur.
 *
 * Tout est COMPTÉ en base. Aucun chiffre n'est repris d'un journal d'exécution : un rapport dit ce
 * que le programme a cru faire, la base dit ce qui est écrit.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const ligne = (t: string) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

/* ── 1. SOURCES : tentées, réussies, partielles, échouées ─────────────────────────────────────
 * « Tentée » = un lot d'offres existe. « Réussie » = au moins une offre publiée et aucun échec
 * d'écriture. « Partielle » = des offres publiées ET des échecs (le cas Beiersdorf). « Échouée » =
 * tentée, aucune offre publiée. */
const [s] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
  WITH tentees AS (SELECT DISTINCT "sourceKey" FROM "CaptureBatch" WHERE purpose='JOBS'),
  publiees AS (SELECT "sourceKey", count(*)::int AS n FROM "JobSource" GROUP BY "sourceKey"),
  echecs AS (SELECT "sourceKey", count(*)::int AS n FROM "PipelineEvent"
              WHERE event='job.write_failed' GROUP BY "sourceKey")
  SELECT (SELECT count(*)::int FROM "Source" WHERE status='ACTIVE')                          AS actives,
         (SELECT count(*)::int FROM tentees)                                                  AS tentees,
         (SELECT count(*)::int FROM tentees t JOIN publiees p ON p."sourceKey"=t."sourceKey"
            LEFT JOIN echecs e ON e."sourceKey"=t."sourceKey" WHERE e.n IS NULL)              AS reussies,
         (SELECT count(*)::int FROM tentees t JOIN publiees p ON p."sourceKey"=t."sourceKey"
            JOIN echecs e ON e."sourceKey"=t."sourceKey")                                     AS partielles,
         (SELECT count(*)::int FROM tentees t LEFT JOIN publiees p ON p."sourceKey"=t."sourceKey"
            WHERE p.n IS NULL)                                                                AS echouees`);

ligne('1. SOURCES');
console.log(`   ACTIVE au registre     ${String(s.actives).padStart(6)}`);
console.log(`   tentées                ${String(s.tentees).padStart(6)}   (un lot d'offres existe)`);
console.log(`   réussies               ${String(s.reussies).padStart(6)}   (offres publiées, aucun refus)`);
console.log(`   partielles             ${String(s.partielles).padStart(6)}   (offres publiées ET refus)`);
console.log(`   échouées               ${String(s.echouees).padStart(6)}   (tentées, zéro offre publiée)`);
console.log(`   jamais tentées         ${String(s.actives - s.tentees).padStart(6)}`);

/* ── 2. RAW, extractions, offres ───────────────────────────────────────────────────────────── */
const [v] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
  SELECT (SELECT count(*)::int FROM "RawCapture")                                   AS raw,
         (SELECT count(*)::int FROM "RawBlob")                                      AS blobs,
         -- Une conversion en entier déborde ici : la somme dépasse 2 Go. On rend des mégaoctets.
         (SELECT (sum("byteLength") / 1048576)::int FROM "RawBlob")                 AS megaoctets,
         (SELECT count(*)::int FROM "CaptureBatch")                                 AS lots,
         (SELECT count(*)::int FROM "SourceExtraction")                             AS extractions,
         (SELECT count(*)::int FROM "Job")                                          AS offres,
         (SELECT count(*)::int FROM "Job" WHERE "isActive")                         AS offres_actives`);

ligne('2. VOLUMES');
console.log(`   captures RAW natives   ${String(v.raw).padStart(6)}`);
console.log(`   blobs archivés         ${String(v.blobs).padStart(6)}   (${v.megaoctets} Mo)`);
console.log(`   lots de capture        ${String(v.lots).padStart(6)}`);
console.log(`   extractions            ${String(v.extractions).padStart(6)}`);
console.log(`   offres publiées        ${String(v.offres).padStart(6)}   (actives : ${v.offres_actives})`);

/* ── 3. OFFRES REFUSÉES ET MOTIFS ─────────────────────────────────────────────────────────────
 * Le CEO a demandé que ces cas soient MESURÉS et regroupés, jamais arbitrés pendant la collecte. */
const refus = await prisma.$queryRawUnsafe<Array<{ motif: string; n: number; sources: number }>>(`
  SELECT coalesce(payload->'error'->>'name', 'inconnu') AS motif,
         count(*)::int AS n, count(DISTINCT "sourceKey")::int AS sources
    FROM "PipelineEvent" WHERE event='job.write_failed'
   GROUP BY 1 ORDER BY n DESC`);

ligne('3. OFFRES REFUSÉES — motifs (à arbitrer APRÈS la collecte)');
if (!refus.length) console.log('   aucune');
for (const r of refus) console.log(`   ${r.motif.padEnd(34)} ${String(r.n).padStart(6)} offre(s) · ${r.sources} source(s)`);

/* Les groupes multi-entités : le cas Beiersdorf AG / SpA, à regrouper pour arbitrage. */
const entites = await prisma.$queryRawUnsafe<Array<{ sourceKey: string; propose: string; libelles: string; n: number }>>(`
  SELECT "sourceKey",
         payload->'error'->>'proposedName' AS propose,
         string_agg(DISTINCT payload->'error'->>'rawEmployerName', ' · ') AS libelles,
         count(*)::int AS n
    FROM "PipelineEvent" WHERE event='job.write_failed'
     AND payload->'error'->>'name'='EmployerIdentityReviewRequired'
   GROUP BY 1, 2 ORDER BY n DESC LIMIT 20`);

if (entites.length) {
  ligne('4. AMBIGUÏTÉS D\'IDENTITÉ EMPLOYEUR — mesurées, non arbitrées');
  for (const e of entites) {
    console.log(`   ${e.sourceKey.padEnd(26)} ${String(e.n).padStart(4)} offre(s)`);
    console.log(`      libellés observés : ${String(e.libelles).slice(0, 120)}`);
    console.log(`      proposé           : ${e.propose}`);
  }
}

/* ── 5. COUVERTURE RAW NATIVE ─────────────────────────────────────────────────────────────────
 * Chaque offre publiée est-elle adossée à une capture native archivée ? */
const [c] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
  SELECT (SELECT count(*)::int FROM "JobSource")                                                AS liens,
         (SELECT count(*)::int FROM "JobSource" js WHERE EXISTS
            (SELECT 1 FROM "CaptureBatch" b WHERE b."sourceKey"=js."sourceKey" AND b.purpose='JOBS')) AS avec_raw,
         (SELECT count(*)::int FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
           WHERE b.purpose='JOBS' AND o."transportCoverage"='HTTP_ONLY')                        AS lots_http,
         (SELECT count(*)::int FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
           WHERE b.purpose='JOBS' AND o."transportCoverage" IS DISTINCT FROM 'HTTP_ONLY')       AS lots_autre`);

ligne('5. COUVERTURE RAW NATIVE');
const taux = c.liens ? (100 * c.avec_raw / c.liens).toFixed(2) : '—';
console.log(`   offres adossées à un RAW natif   ${c.avec_raw}/${c.liens}  (${taux} %)`);
console.log(`   lots d'offres en HTTP_ONLY       ${c.lots_http}`);
console.log(`   lots avec transport non observé  ${c.lots_autre}`);

/* ── 6. ANOMALIES PAR FAMILLE DE CONNECTEUR ───────────────────────────────────────────────── */
const familles = await prisma.$queryRawUnsafe<Array<Record<string, number | string>>>(`
  WITH t AS (SELECT DISTINCT b."sourceKey", s.kind FROM "CaptureBatch" b JOIN "Source" s ON s.key=b."sourceKey" WHERE b.purpose='JOBS'),
  p AS (SELECT js."sourceKey", count(*)::int AS n FROM "JobSource" js GROUP BY 1),
  e AS (SELECT "sourceKey", count(*)::int AS n FROM "PipelineEvent" WHERE event='job.write_failed' GROUP BY 1)
  SELECT t.kind,
         count(*)::int                                              AS tentees,
         count(p.n)::int                                            AS avec_offres,
         coalesce(sum(p.n), 0)::int                                 AS offres,
         coalesce(sum(e.n), 0)::int                                 AS refusees,
         count(*) FILTER (WHERE p.n IS NULL)::int                   AS sans_offre
    FROM t LEFT JOIN p ON p."sourceKey"=t."sourceKey" LEFT JOIN e ON e."sourceKey"=t."sourceKey"
   GROUP BY t.kind ORDER BY offres DESC`);

ligne('6. PAR FAMILLE DE CONNECTEUR');
console.log(`   ${'famille'.padEnd(28)} ${'tentées'.padStart(8)} ${'publiantes'.padStart(11)} ${'offres'.padStart(8)} ${'refusées'.padStart(9)} ${'muettes'.padStart(8)}`);
for (const f of familles) {
  const muettes = Number(f.sans_offre);
  console.log(`   ${String(f.kind).padEnd(28)} ${String(f.tentees).padStart(8)} ${String(f.avec_offres).padStart(11)} ` +
    `${String(f.offres).padStart(8)} ${String(f.refusees).padStart(9)} ${String(muettes).padStart(8)}${muettes ? '  ⚠' : ''}`);
}

console.log('');
await prisma.$disconnect();

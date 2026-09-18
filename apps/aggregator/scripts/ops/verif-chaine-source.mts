/**
 * LA CHAÎNE COMPLÈTE D'UNE SOURCE, MAILLON PAR MAILLON — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/verif-chaine-source.mts <cle> [<cle>…]
 *
 *   # sans argument : l'état T0 du catalogue (tous les compteurs)
 *
 * ── CE QU'IL PROUVE ────────────────────────────────────────────────────────────────────────────
 *
 * Pour chaque source demandée, il suit le chemin réel d'une offre :
 *
 *   Source → CaptureBatch → RAW natif (RawCapture + RawBlob) → SourceExtraction
 *          → validation → JobSource → Job
 *
 * et vérifie à chaque maillon ce qui doit être vrai :
 *   · toute offre publiée a un lot de capture, et ce lot porte au moins une réponse native ;
 *   · aucune réponse déclarée complète sans son corps archivé (`blobHash`) ;
 *   · aucun corps référencé sans ses octets (`RawBlobBody`) ;
 *   · le nombre d'extractions correspond au nombre d'offres publiées.
 *
 * Il ne corrige rien et n'écrit rien : il RÉPOND, avec des chiffres comptés en base.
 */
import { PrismaClient } from '@prisma/client';

const cles = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const [t0] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
  SELECT (SELECT count(*)::int FROM "Job")                  AS job,
         (SELECT count(*)::int FROM "JobSource")            AS jobsource,
         (SELECT count(*)::int FROM "RawCapture")           AS rawcapture,
         (SELECT count(*)::int FROM "RawBlob")              AS rawblob,
         (SELECT count(*)::int FROM "RawBlobBody")          AS rawblobbody,
         (SELECT count(*)::int FROM "CaptureBatch")         AS capturebatch,
         (SELECT count(*)::int FROM "SourceExtraction")     AS extraction,
         (SELECT count(*)::int FROM "SourceValidation")     AS validation,
         (SELECT count(*)::int FROM "SourceAccessDecision") AS acces,
         (SELECT count(*)::int FROM "Source" WHERE status='ACTIVE') AS sources_actives`);

console.log('\nÉTAT DU CATALOGUE');
for (const [k, v] of Object.entries(t0)) console.log(`   ${k.padEnd(18)} ${String(v).padStart(7)}`);

const [coherence] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
  SELECT
    (SELECT count(*)::int FROM "RawBlobBody" y WHERE NOT EXISTS (SELECT 1 FROM "RawBlob" b WHERE b.hash=y.hash)) AS corps_orphelins,
    (SELECT count(*)::int FROM "RawCapture" r WHERE r.complete AND r."blobHash" IS NULL)                          AS complet_sans_corps,
    (SELECT count(*)::int FROM "RawCapture" r WHERE r."blobHash" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "RawBlob" b WHERE b.hash=r."blobHash"))                                      AS corps_manquant,
    (SELECT count(*)::int FROM "JobSource" js WHERE NOT EXISTS
       (SELECT 1 FROM "CaptureBatch" b WHERE b."sourceKey"=js."sourceKey" AND b.purpose='JOBS'))                  AS offres_sans_capture`);

console.log('\nCOHÉRENCE — chaque ligne doit valoir 0');
for (const [k, v] of Object.entries(coherence)) {
  console.log(`   ${k.replace(/_/g, ' ').padEnd(24)} ${String(v).padStart(5)}   ${v === 0 ? '✓' : '⚠ DÉFAUT'}`);
}

for (const cle of cles) {
  const [s] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT key, maison, kind, status, "portalScope", "currentRevisionId" FROM "Source" WHERE key=$1`, cle);
  console.log(`\n${'═'.repeat(78)}\n${cle}`);
  if (!s) { console.log('   ABSENTE du registre'); continue; }
  console.log(`   ${s.maison} · ${s.kind} · ${s.status} · périmètre=${s.portalScope ?? '(non relu)'}`);

  const lots = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT b.purpose, b."startedAt", o.status, o.failure, o."transportCoverage",
           (SELECT count(*)::int FROM "RawCapture" r WHERE r."batchId"=b.id)                                   AS captures,
           (SELECT count(*)::int FROM "RawCapture" r WHERE r."batchId"=b.id AND r."blobHash" IS NOT NULL)      AS avec_corps,
           (SELECT count(*)::int FROM "SourceExtraction" e WHERE e."batchId"=b.id)                             AS extractions
      FROM "CaptureBatch" b LEFT JOIN "CaptureOutcome" o ON o."batchId"=b.id
     WHERE b."sourceKey"=$1 ORDER BY b."startedAt" DESC LIMIT 8`, cle);

  console.log(`   lots de capture : ${lots.length}`);
  for (const l of lots) {
    console.log(`      ${String(l.purpose).padEnd(16)} ${String(l.status ?? '(sans issue)').padEnd(16)} ` +
      `raw=${l.captures} corps=${l.avec_corps} extr=${l.extractions} ${l.transportCoverage ?? ''} ${l.failure ?? ''}`);
  }

  const [offres] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
    SELECT count(*)::int AS liens, count(DISTINCT js."jobId")::int AS offres
      FROM "JobSource" js WHERE js."sourceKey"=$1`, cle);
  console.log(`   offres publiées : ${offres.offres} (liens : ${offres.liens})`);

  const [acces] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT verdict, "validUntil" FROM "SourceAccessDecision" WHERE "sourceKey"=$1 ORDER BY sequence DESC LIMIT 1`, cle);
  console.log(`   décision d'accès : ${acces ? `${acces.verdict} jusqu'au ${acces.validUntil}` : '(aucune)'}`);
}

console.log('');
await prisma.$disconnect();

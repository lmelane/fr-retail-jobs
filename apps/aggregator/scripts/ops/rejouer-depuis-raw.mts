/**
 * REJOUER L'EXTRACTION DEPUIS LE RAW ARCHIVÉ — sans aucun appel réseau.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/rejouer-depuis-raw.mts <cle-source>
 *
 * ── CE QUE CE SCRIPT PROUVE, ET POURQUOI ÇA COMPTE ─────────────────────────────────────────────
 *
 * Qu'une offre existe en base ne prouve pas qu'on pourrait la reconstruire. Si le RAW archivé était
 * tronqué, ou si l'adaptateur avait complété la réponse avec un second appel non enregistré,
 * personne ne le verrait — jusqu'au jour où il faut rejouer ou justifier une offre.
 *
 * `replayExtraction` (capture/batch.ts) impose exactement cela : il sert à l'adaptateur les
 * réponses ARCHIVÉES, une par une, appariées par empreinte de requête. Un appel réseau que le
 * journal ne contient pas lève `OfflineReplayError`, et une réponse archivée que l'adaptateur ne
 * consomme PAS est elle aussi une erreur — le rejeu doit épuiser le journal, ni plus ni moins.
 *
 * On compare ensuite le nombre d'offres rejouées à celui que le lot avait extrait. Une divergence
 * signifie que le RAW ne suffit pas à reconstruire ce qui a été publié.
 *
 * Aucune écriture : ce script lit, rejoue en mémoire, et compte.
 */
import { PrismaClient } from '@prisma/client';
import { replayExtraction } from '../../src/capture/batch.js';
import { fetchAtsJobs } from '../../src/ats/index.js';
import { KIND_TO_ATS } from '../../src/ats/catalogKinds.js';
import { effectiveSourceConfig } from '../../src/connectors/sourceConfig.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';

const cle = process.argv[2];
if (!cle) {
  console.error('Usage : rejouer-depuis-raw.mts <cle-source>');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;

type Lot = { id: string; sourceKind: string | null; configHash: string; startedAt: Date; extraites: number };
const lots = await prisma.$queryRawUnsafe<Lot[]>(`
  SELECT b.id, b."sourceKind", b."configHash", b."startedAt",
         (SELECT count(*)::int FROM "SourceExtraction" e WHERE e."batchId"=b.id) AS extraites
    FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
   WHERE b."sourceKey"=$1 AND b.purpose='JOBS' AND o.status='EXTRACTED'
   ORDER BY b."startedAt" DESC LIMIT 1`, cle);

if (!lots.length) {
  console.error(`Aucun lot d'offres extrait pour « ${cle} ».`);
  await prisma.$disconnect();
  process.exit(1);
}
const lot = lots[0];

const [source] = await prisma.$queryRawUnsafe<Array<{ kind: string; config: unknown }>>(
  `SELECT kind, config FROM "Source" WHERE key=$1`, cle);

console.log(`\nREJEU HORS RÉSEAU — ${cle}`);
console.log(`   lot        : ${lot.id}`);
console.log(`   capturé le : ${new Date(lot.startedAt).toISOString()}`);
console.log(`   extraites  : ${lot.extraites} offre(s) au moment de la capture`);

const config = effectiveSourceConfig(source.config as Record<string, unknown>);
const kind = KIND_TO_ATS[source.kind];

try {
  /*
   * Le rejeu n'ouvre AUCUNE connexion : `replayExtraction` installe un contexte qui sert les
   * réponses archivées et fait échouer toute requête absente du journal. Si ce bloc réussit, la
   * capture suffit à reconstruire les offres — c'est précisément ce qu'on veut démontrer.
   */
  const resultat = await replayExtraction(prisma, lot.id, () => fetchAtsJobs(kind, config), store);
  const rejouees = resultat.jobs.length;
  console.log(`   rejouées   : ${rejouees} offre(s), sans aucun appel réseau`);

  if (rejouees !== lot.extraites) {
    console.error(`\n⚠ DIVERGENCE : ${rejouees} rejouée(s) contre ${lot.extraites} extraite(s).`);
    console.error(`   Le RAW archivé ne reconstruit pas ce qui a été publié.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`\n✔ Le RAW archivé suffit : rejeu identique à la capture, journal épuisé, zéro réseau.\n`);
} catch (error) {
  console.error(`\n⚠ REJEU IMPOSSIBLE : ${error instanceof Error ? error.message : String(error)}`);
  console.error(`   Une requête absente du journal, ou une réponse archivée non consommée.`);
  await prisma.$disconnect();
  process.exit(1);
}

await prisma.$disconnect();

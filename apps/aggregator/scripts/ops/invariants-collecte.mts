/**
 * LES INVARIANTS DE LA COLLECTE — lecture seule, sortie 1 si un seul est violé.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/invariants-collecte.mts
 *
 * ── POURQUOI CE SCRIPT REND UN CODE DE SORTIE ──────────────────────────────────────────────────
 *
 * Il est lancé ENTRE chaque vague de collecte massive. Une vérification qui rend un chiffre à
 * interpréter finit par être mal interprétée : celle-ci BLOQUE. Code 1 = un invariant est violé,
 * la vague suivante ne doit pas partir.
 *
 * Les six invariants sont ceux validés à l'étape 1, sur 3 sources et 3 familles :
 *
 *   1. aucune offre publiée sans lot de capture natif ;
 *   2. aucune capture déclarée complète sans son corps archivé ;
 *   3. aucun corps référencé dont le blob a disparu ;
 *   4. aucun corps de blob orphelin — le défaut mesuré le 18/09, qui bloquait TOUTE capture
 *      ultérieure sous un message qui ne le nommait pas ;
 *   5. aucun lot d'offres EXTRACTED sans extraction enregistrée ;
 *   6. les déclencheurs d'immuabilité sont tous en place (55 au 18/09/2026).
 *
 * Un défaut ici est SYSTÉMIQUE : il ne concerne pas une source mais la chaîne. C'est le signal
 * d'arrêt. Une source qui échoue, ou une offre légitimement refusée, ne viole aucun invariant et
 * n'apparaît pas ici — elle est comptée dans le bilan.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Nombre de déclencheurs non internes constaté à la fin de l'étape 1. Une baisse = un garde-fou perdu. */
const DECLENCHEURS_ATTENDUS = 55;

const [r] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
  SELECT
    (SELECT count(*)::int FROM "JobSource" js WHERE NOT EXISTS
       (SELECT 1 FROM "CaptureBatch" b WHERE b."sourceKey"=js."sourceKey" AND b.purpose='JOBS'))        AS offres_sans_capture,
    (SELECT count(*)::int FROM "RawCapture" c WHERE c.complete AND c."blobHash" IS NULL)                 AS complet_sans_corps,
    (SELECT count(*)::int FROM "RawCapture" c WHERE c."blobHash" IS NOT NULL AND NOT EXISTS
       (SELECT 1 FROM "RawBlob" b WHERE b.hash=c."blobHash"))                                            AS corps_manquant,
    (SELECT count(*)::int FROM "RawBlobBody" y WHERE NOT EXISTS
       (SELECT 1 FROM "RawBlob" b WHERE b.hash=y.hash))                                                  AS corps_orphelins,
    (SELECT count(*)::int FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
      WHERE b.purpose='JOBS' AND o.status='EXTRACTED' AND o."extractedCount">0
        AND NOT EXISTS (SELECT 1 FROM "SourceExtraction" e WHERE e."batchId"=b.id))                      AS lots_sans_extraction,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal) AS declencheurs`);

const controles: Array<{ nom: string; valeur: number; ok: boolean; explication: string }> = [
  { nom: 'offres sans capture native', valeur: r.offres_sans_capture, ok: r.offres_sans_capture === 0,
    explication: 'une offre publiée sans lot de capture : sa provenance est perdue' },
  { nom: 'captures complètes sans corps', valeur: r.complet_sans_corps, ok: r.complet_sans_corps === 0,
    explication: 'une réponse déclarée complète dont le corps n\'est pas archivé' },
  { nom: 'corps référencés manquants', valeur: r.corps_manquant, ok: r.corps_manquant === 0,
    explication: 'une capture pointe un blob absent : le RAW n\'est plus lisible' },
  { nom: 'corps de blob orphelins', valeur: r.corps_orphelins, ok: r.corps_orphelins === 0,
    explication: 'défaut du 18/09 : bloque TOUTE capture ultérieure, masqué en « capture unavailable »' },
  { nom: 'lots extraits sans extraction', valeur: r.lots_sans_extraction, ok: r.lots_sans_extraction === 0,
    explication: 'un lot dit EXTRACTED sans sortie enregistrée' },
  { nom: 'déclencheurs d\'immuabilité', valeur: r.declencheurs, ok: r.declencheurs >= DECLENCHEURS_ATTENDUS,
    explication: `attendu au moins ${DECLENCHEURS_ATTENDUS} ; une baisse signifie un garde-fou perdu` },
];

console.log('\nINVARIANTS DE LA COLLECTE');
let viole = 0;
for (const c of controles) {
  const marque = c.ok ? '✓' : '⚠ VIOLÉ';
  console.log(`   ${c.nom.padEnd(30)} ${String(c.valeur).padStart(6)}   ${marque}`);
  if (!c.ok) { viole++; console.log(`      ${c.explication}`); }
}

const [etat] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
  SELECT (SELECT count(*)::int FROM "Job")              AS offres,
         (SELECT count(*)::int FROM "RawCapture")       AS raw,
         (SELECT count(*)::int FROM "SourceExtraction") AS extractions,
         (SELECT count(DISTINCT "sourceKey")::int FROM "JobSource") AS sources_publiantes`);
console.log(`\n   catalogue : ${etat.offres} offre(s) · ${etat.raw} capture(s) RAW · ${etat.extractions} extraction(s) · ${etat.sources_publiantes} source(s) publiante(s)`);

if (viole) {
  console.error(`\n⚠ STOP — ${viole} invariant(s) violé(s). Défaut SYSTÉMIQUE : ne pas lancer la vague suivante.\n`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`\n✔ Les 6 invariants tiennent. La vague suivante peut partir.\n`);
await prisma.$disconnect();

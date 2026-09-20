/**
 * DÉCLARER UN PORTAIL DE GROUPE ET LIBÉRER LA CLÉ D'UNE FICHE ABANDONNÉE — inspection par défaut.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/declarer-portail-groupe.mts
 *
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/declarer-portail-groupe.mts --ecrire
 *
 * ── LE CAS, ET LA DÉCISION DU CEO (19/09/2026) ─────────────────────────────────────────────────
 *
 * `careers.elcompanies.com` est le portail du groupe Estée Lauder. Il sert 1 606 postes pour
 * TOUTES ses marques — Dr. Jart+, MAC, La Mer, Jo Malone, Aveda, Bobbi Brown. Le CEO l'a établi
 * et a validé les deux gestes ci-dessous.
 *
 * DEUX FICHES visent ce portail, ce qui bloque la qualification :
 *
 *   estee-lauder-companies  ACTIVE   tenantKey `eightfold:elcompanies.eightfold.ai`
 *   dr-jart-13              RETIRED  tenantKey `eightfold:elcompanies.com`   ← occupe la clé
 *
 * La campagne recalcule `eightfold:elcompanies.com` pour la fiche ACTIVE, la trouve détenue par
 * une fiche RETIRED, et conclut au conflit. La garde d'unicité porte sur la table entière : une
 * fiche abandonnée réserve sa clé quand même. Dr. Jart+ n'est pas un portail distinct, c'est une
 * marque DU groupe : la fiche est un doublon d'import, pas une source.
 *
 * ── CE QUE CHAQUE GESTE FAIT, ET CE QU'IL NE FAIT PAS ──────────────────────────────────────────
 *
 * 1. `portalScope = MULTI_BRAND` sur la fiche ACTIVE.
 *
 *    ATTENTION à ne pas se tromper sur son sens. `SINGLE_BRAND` sert à COMBLER un manque : quand
 *    une annonce ne nomme aucun employeur, elle prend le propriétaire du portail
 *    (`portalEmployer.ts`, décision du 09/09). `MULTI_BRAND` dit l'INVERSE — ne comble jamais —
 *    parce qu'attribuer une offre MAC à « Estée Lauder » serait une fausse attribution.
 *
 *    Ce geste n'ouvre donc AUCUNE vanne : il déclare la réalité du portail. Les offres seront
 *    attribuées d'après ce que l'annonce nomme ; celles qui ne nomment rien resteront en attente.
 *    C'est protecteur, et c'est voulu.
 *
 *    `portalScope` ne figure pas dans `source_revision_payload` (migration 20260918100000) :
 *    l'écrire ne crée pas de révision et n'invalide donc aucune preuve déjà acquise.
 *
 * 2. Libérer la clé de la fiche RETIRED, en lui donnant une clé qui lui est propre et ne peut
 *    entrer en conflit avec rien. On ne SUPPRIME pas la fiche : son historique reste lisible, et
 *    une suppression serait irréversible là où un renommage ne l'est pas.
 */
import { PrismaClient } from '@prisma/client';

const ECRIRE = process.argv.includes('--ecrire');
const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const PORTAIL = { actif: 'estee-lauder-companies', abandonnee: 'dr-jart-13', scope: 'MULTI_BRAND' as const };

type Fiche = { key: string; maison: string; status: string; tenantKey: string; portalScope: string | null; careersDomain: string | null };
const fiches = await prisma.$queryRawUnsafe<Fiche[]>(
  `SELECT key, maison, status, "tenantKey", "portalScope", "careersDomain" FROM "Source" WHERE key = ANY($1::text[])`,
  [PORTAIL.actif, PORTAIL.abandonnee]);

const actif = fiches.find((f) => f.key === PORTAIL.actif);
const abandonnee = fiches.find((f) => f.key === PORTAIL.abandonnee);

console.log('\n── état actuel ──\n');
for (const f of fiches)
  console.log(`   ${f.key.padEnd(26)} ${f.status.padEnd(9)} scope=${(f.portalScope ?? '—').padEnd(12)} ${f.tenantKey}`);

if (!actif) { console.error(`\n⚠ ${PORTAIL.actif} absente — rien à faire.\n`); process.exit(1); }

/* La garde : on ne libère une clé que sur une fiche RETIRED, jamais sur une fiche vivante. */
if (abandonnee && abandonnee.status !== 'RETIRED') {
  console.error(`\n⚠ REFUS : ${PORTAIL.abandonnee} est ${abandonnee.status}, pas RETIRED.`);
  console.error('  Libérer la clé d\'une fiche vivante casserait sa collecte. Arbitrage requis.\n');
  process.exit(1);
}

const nouvelleCle = abandonnee ? `retire:${abandonnee.key}:${abandonnee.tenantKey}` : null;

console.log('\n── ce qui sera écrit ──\n');
console.log(`   ${PORTAIL.actif}`);
console.log(`      portalScope : ${actif.portalScope ?? '—'} → ${PORTAIL.scope}`);
if (abandonnee && nouvelleCle) {
  console.log(`   ${PORTAIL.abandonnee} [RETIRED]`);
  console.log(`      tenantKey   : ${abandonnee.tenantKey}`);
  console.log(`                  → ${nouvelleCle.slice(0, 92)}`);
}

if (!ECRIRE) {
  console.log('\nINSPECTION SEULEMENT — rien n\'a été écrit. Ajouter --ecrire pour appliquer.\n');
  await prisma.$disconnect();
  process.exit(0);
}

/* Les deux écritures dans UNE transaction : un demi-état laisserait le conflit en place. */
await prisma.$transaction(async (tx) => {
  if (abandonnee && nouvelleCle)
    await tx.$executeRawUnsafe(
      `UPDATE "Source" SET "tenantKey" = $1 WHERE key = $2 AND status = 'RETIRED' AND "tenantKey" = $3`,
      nouvelleCle, abandonnee.key, abandonnee.tenantKey);
  await tx.$executeRawUnsafe(
    `UPDATE "Source" SET "portalScope" = $1 WHERE key = $2`, PORTAIL.scope, PORTAIL.actif);
});

const apres = await prisma.$queryRawUnsafe<Fiche[]>(
  `SELECT key, maison, status, "tenantKey", "portalScope", "careersDomain" FROM "Source" WHERE key = ANY($1::text[])`,
  [PORTAIL.actif, PORTAIL.abandonnee]);
console.log('\n── état après écriture ──\n');
for (const f of apres)
  console.log(`   ${f.key.padEnd(26)} ${f.status.padEnd(9)} scope=${(f.portalScope ?? '—').padEnd(12)} ${f.tenantKey.slice(0, 60)}`);
console.log('');

await prisma.$disconnect();

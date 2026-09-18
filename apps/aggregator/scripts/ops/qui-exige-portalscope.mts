/**
 * QUELLES SOURCES ONT BESOIN DE `portail_une_seule_marque` ? — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/qui-exige-portalscope.mts
 *
 * ── LA QUESTION ────────────────────────────────────────────────────────────────────────────────
 *
 * `portalScope` (colonne `portail_une_seule_marque` du tableau) n'est PAS demandé à toutes les
 * sources. `ingest.ts:193` pose `employerLabelOrigin` selon ce que l'adaptateur a rendu :
 *
 *   · l'offre porte un employeur natif        → 'ADAPTER_COMPANY'        → portalScope inutile
 *   · elle n'en porte pas                     → 'SOURCE_CATALOGUE_LABEL' → portalScope EXIGÉ
 *                                               (`resolve.ts:41-43`, scope SINGLE_BRAND obligatoire)
 *
 * Lire les adaptateurs pour répondre est un piège : un `company:` dans le fichier peut être une
 * valeur optionnelle, absente en pratique. La seule preuve est ce que la collecte a RÉELLEMENT
 * écrit. On compte donc `JobSource.employerLabelOrigin` par famille, et on ne conclut que sur les
 * familles réellement collectées ; les autres sont dites « non mesurées », jamais devinées.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Mesure = { kind: string; origine: string; offres: number };
/*
 * L'origine du libellé employeur vit dans `EmployerObservation.labelOrigin` (« ce que l'adaptateur
 * a dit »), pas sur `JobSource` : c'est une observation par offre et par révision, pas un attribut
 * du lien. Vérifié dans `schema.prisma:348-355` après qu'une première version de ce script eut
 * échoué sur une colonne inexistante — la base a refusé la requête plutôt que de rendre un chiffre faux.
 */
const mesures = await prisma.$queryRawUnsafe<Mesure[]>(`
  SELECT s.kind, o."labelOrigin" AS origine, count(*)::int AS offres
    FROM "EmployerObservation" o JOIN "Source" s ON s.key = o."sourceKey"
   GROUP BY s.kind, o."labelOrigin" ORDER BY s.kind, offres DESC`);

const exige = new Map<string, boolean>();
for (const m of mesures) {
  // Une seule offre sans employeur natif suffit : la famille passera par le garde-fou.
  if (m.origine === 'SOURCE_CATALOGUE_LABEL') exige.set(m.kind, true);
  else if (!exige.has(m.kind)) exige.set(m.kind, false);
}

console.log('\nMESURÉ — ce que la collecte a réellement écrit');
for (const m of mesures) {
  console.log(`   ${m.kind.padEnd(24)} ${m.origine.padEnd(26)} ${String(m.offres).padStart(5)} offre(s)`);
}

const familles = await prisma.$queryRawUnsafe<Array<{ kind: string; actives: number }>>(`
  SELECT kind, count(*)::int AS actives FROM "Source" WHERE status = 'ACTIVE'
   GROUP BY kind ORDER BY actives DESC, kind`);

let besoin = 0, dispense = 0, inconnu = 0;
console.log('\nPAR FAMILLE — combien de sources ACTIVE concernées');
for (const f of familles) {
  const verdict = exige.has(f.kind)
    ? (exige.get(f.kind) ? 'EXIGE portalScope' : 'dispensée (employeur natif)')
    : 'NON MESURÉ (aucune offre collectée)';
  if (!exige.has(f.kind)) inconnu += f.actives;
  else if (exige.get(f.kind)) besoin += f.actives;
  else dispense += f.actives;
  console.log(`   ${f.kind.padEnd(28)} ${String(f.actives).padStart(4)}   ${verdict}`);
}

console.log(`\n   ${String(besoin).padStart(4)} source(s) ACTIVE exigent la colonne, mesuré`);
console.log(`   ${String(dispense).padStart(4)} dispensées, mesuré`);
console.log(`   ${String(inconnu).padStart(4)} non mesurées — famille jamais collectée, statut inconnu\n`);

await prisma.$disconnect();

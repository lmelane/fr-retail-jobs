/**
 * EFFACER LES DONNÉES DE COLLECTE — le registre est CONSERVÉ.
 *
 *   # inspection, n'écrit RIEN :
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/nettoyer-collecte.mts
 *
 *   # exécution :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/nettoyer-collecte.mts --ecrire
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────────────────────────
 *
 * Le lot F5 change la règle d'attribution d'employeur : elle ne vient plus d'une revue d'identité
 * par capture mais du registre relu. Les 65 offres déjà collectées l'ont été sous l'ANCIENNE règle,
 * avec des revues d'identité comme source d'attribution. Les garder produirait un catalogue où deux
 * régimes cohabitent sans qu'on puisse dire, pour une offre donnée, lequel l'a produite.
 *
 * On repart donc d'un catalogue vide, sous une seule règle.
 *
 * ── CE QUI EST EFFACÉ, ET CE QUI NE L'EST PAS ──────────────────────────────────────────────────
 *
 * EFFACÉ : offres, liens offre↔source, observations d'employeur, captures et leurs blobs,
 * extractions, admissions, validations, revues d'identité, décisions d'accès, exécutions.
 *
 * CONSERVÉ, intégralement :
 *   · `Source` et `SourceRevision` — LE REGISTRE : 536 lignes, relues à la main, avec leur
 *     `portalScope`, leurs domaines officiels et leurs révisions. C'est le travail qu'on ne refait pas.
 *   · `Company` — les Maisons et leurs domaines officiels.
 *
 * L'ordre de suppression suit les clés étrangères, des feuilles vers les racines. Les tables sont
 * nommées explicitement : un TRUNCATE CASCADE sur une base dont on ne relit pas le schéma emporte
 * ce qu'on n'avait pas prévu.
 */
import { PrismaClient } from '@prisma/client';

const ECRIRE = process.argv.includes('--ecrire');

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/* Des feuilles vers les racines : chaque table ne dépend que de celles qui la précèdent. */
const TABLES = [
  'EmployerObservation',
  'JobSource',
  'Job',
  'SourceIngestionAdmission',
  'SourceValidation',
  'SourceIdentityReview',
  'SourceAccessDecision',
  'SourceExtraction',
  'CaptureOutcome',
  'RawCapture',
  'CaptureBatch',
  /*
   * `RawBlobBody` AVANT `RawBlob`, et surtout : JAMAIS L'UN SANS L'AUTRE.
   *
   * Défaut mesuré le 18/09/2026 — la première version de ce script vidait `RawBlob` et oubliait
   * `RawBlobBody`, où vivent réellement les octets. Résultat : 3 134 corps orphelins, et TOUTE
   * capture ultérieure échouait. `store.ts:23` lit `RawBlob`, ne trouve rien, et `store.ts:25`
   * crée le blob AVEC son corps imbriqué — dont la ligne existe déjà : P2002 sur la clé `hash`.
   *
   * L'erreur remontait masquée en « Native response capture unavailable », et elle a bloqué la
   * campagne Railway de 11:58 sur les 12 sources. Le symptôme était à trois niveaux de l'origine.
   */
  'RawBlobBody',
  'RawBlob',
] as const;

const CONSERVEES = ['Source', 'SourceRevision', 'Company'] as const;

async function compter(tables: readonly string[]) {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${t}"`);
    out[t] = row.n;
  }
  return out;
}

const avant = await compter(TABLES);
const garde = await compter(CONSERVEES);

console.log('\nÀ EFFACER — données de collecte');
for (const [t, n] of Object.entries(avant)) if (n) console.log(`   ${t.padEnd(28)} ${String(n).padStart(6)}`);
console.log(`   ${'TOTAL'.padEnd(28)} ${String(Object.values(avant).reduce((a, b) => a + b, 0)).padStart(6)}`);

console.log('\nCONSERVÉ — le registre et les Maisons');
for (const [t, n] of Object.entries(garde)) console.log(`   ${t.padEnd(28)} ${String(n).padStart(6)}`);

if (!ECRIRE) {
  console.log(`\nINSPECTION SEULEMENT — rien n'a été effacé. Ajouter --ecrire pour appliquer.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

/*
 * Une seule transaction : si une suppression échoue, aucune ne s'applique. Un catalogue à moitié
 * effacé serait pire que les deux régimes qu'on veut supprimer.
 */
/*
 * LES DÉCLENCHEURS D'IMMUABILITÉ, ET POURQUOI ON LES SUSPEND ICI.
 *
 * `EmployerObservation`, `Job`, `JobSource` et `SourceIdentityReview` portent des déclencheurs
 * `append-only` : ils refusent tout DELETE. C'est leur rôle — ils empêchent une réécriture
 * silencieuse de l'historique, et ils ont raison de refuser une suppression ordinaire.
 *
 * Ici la suppression est assumée et sa raison est écrite en tête de ce fichier : les 65 offres ont
 * été attribuées sous une règle qui n'existe plus. On suspend donc ces déclencheurs le temps de la
 * transaction, avec `session_replication_role = replica` — qui les désactive POUR CETTE SESSION
 * SEULEMENT, sans les supprimer ni les modifier. Aucun `DROP TRIGGER` : une remise à zéro ne doit
 * pas pouvoir laisser la base sans ses gardes.
 *
 * Le rétablissement est vérifié plus bas en recomptant les déclencheurs : si l'un manquait, ce
 * script échouerait au lieu de rendre la main sur une base désarmée.
 */
const AVANT_TRIGGERS = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
  `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal`);

await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
  for (const t of TABLES) await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
}, { maxWait: 30_000, timeout: 900_000 });

const [apresTriggers] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
  `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal`);
if (apresTriggers.n !== AVANT_TRIGGERS[0].n) {
  console.error(`\n⚠ ARRÊT : ${AVANT_TRIGGERS[0].n} déclencheurs avant, ${apresTriggers.n} après — la base a perdu des gardes.`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`\n   ${apresTriggers.n} déclencheurs d'immuabilité en place (inchangé)`);

const apres = await compter(TABLES);
const gardeApres = await compter(CONSERVEES);

console.log('\nAPRÈS');
const reste = Object.values(apres).reduce((a, b) => a + b, 0);
console.log(`   données de collecte restantes : ${reste}`);
for (const [t, n] of Object.entries(gardeApres)) console.log(`   ${t.padEnd(28)} ${String(n).padStart(6)}  (conservé)`);

if (reste !== 0) {
  console.error('\n⚠ Des données de collecte subsistent — vérifier les contraintes.');
  await prisma.$disconnect();
  process.exit(1);
}
if (gardeApres.Source !== garde.Source || gardeApres.Company !== garde.Company) {
  console.error('\n⚠ Le registre a changé pendant le nettoyage — à vérifier immédiatement.');
  await prisma.$disconnect();
  process.exit(1);
}

/*
 * TÉMOIN DE COHÉRENCE — il doit ÉCHOUER si le défaut du 18/09 revient.
 *
 * Un corps sans son blob ne se voit pas : les compteurs sont à zéro, le registre est intact, tout
 * paraît propre. Le défaut n'apparaît qu'à la PROCHAINE capture, sous un message qui ne le nomme
 * pas. Ce contrôle le rend visible ici, pendant qu'on regarde.
 */
const [orphelins] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
  `SELECT count(*)::int AS n FROM "RawBlobBody" y WHERE NOT EXISTS (SELECT 1 FROM "RawBlob" b WHERE b.hash = y.hash)`);
if (orphelins.n > 0) {
  console.error(`\n⚠ ARRÊT : ${orphelins.n} corps de blob sans leur RawBlob. Toute capture ultérieure échouerait`);
  console.error(`   sur une violation d'unicité, masquée en « Native response capture unavailable ».`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`   0 corps de blob orphelin (vérifié)`);

console.log('\n✔ Catalogue vide, registre intact.\n');
await prisma.$disconnect();

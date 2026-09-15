/**
 * LES VILLES QUI EXISTENT DANS PLUSIEURS PAYS — et celles dont le pays manque.
 *
 * LECTURE SEULE : uniquement des `SELECT`. Aucune écriture.
 *
 * ── LA QUESTION À LAQUELLE CE SCRIPT RÉPOND ───────────────────────────────
 *
 * La route de suggestions (`/api/suggest?type=city`) ne reçoit ni marché ni
 * pays : elle groupe sur `Job.city` pour tout le catalogue actif. Un candidat
 * du marché français qui tape « Paris » reçoit donc, dans la même liste et sans
 * rien qui les distingue, le Paris de France, celui du Texas et celui d'Espagne.
 *
 * Trois chiffres décident de la conception, et ce script les mesure :
 *
 *  1. COMBIEN de villes portent le même nom dans plusieurs pays ? C'est la
 *     taille réelle du défaut. S'il n'y en avait que deux, un cas particulier
 *     suffirait ; s'il y en a des centaines, il faut cloisonner.
 *
 *  2. COMBIEN d'offres n'ont AUCUN pays ? Ces villes-là disparaîtraient de
 *     TOUS les marchés sous un cloisonnement strict — le cloisonnement ne doit
 *     jamais produire une liste vide là où il y avait des résultats.
 *
 *  3. Parmi ces villes sans pays, combien sont DÉDUCTIBLES sans ambiguïté —
 *     c'est-à-dire : le même nom de ville n'apparaît ailleurs dans le catalogue
 *     qu'avec UN SEUL code pays ? Celles-là, on peut leur attribuer ce pays.
 *     Deux valeurs ou plus, ou zéro : on s'abstient. Deviner le pays d'une
 *     ville, c'est envoyer un candidat vers un marché qui n'est pas le sien.
 *
 * ── CE QU'IL NE MESURE PAS ────────────────────────────────────────────────
 *
 * Il ne dit pas si le pays porté par une offre est JUSTE. `countryCode` est
 * normalisé en amont ; ce script le prend tel quel. Une ville rattachée au
 * mauvais pays à la source resterait mal rattachée après déduction — la
 * déduction ne fait que PROPAGER ce que le catalogue affirme déjà, elle ne le
 * corrige pas.
 *
 * Il ne mesure pas non plus la casse : « PARIS » et « Paris » sont des valeurs
 * distinctes en base, et les comparaisons ci-dessous sont donc faites sur
 * `UPPER(TRIM(city))` — exactement la clé que le code de suggestion devra
 * utiliser, sans quoi la mesure décrirait un autre objet que le produit.
 *
 *   DB_URL=… node audits/mesures-d435-d436/villes-multi-pays-2026-09-15.mjs
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const lire = (sql) => prisma.$queryRawUnsafe(sql);
const n = (v) => Number(v ?? 0);
const fr = (v) => n(v).toLocaleString('fr-FR');
const pct = (a, b) => (n(b) ? ((n(a) / n(b)) * 100).toFixed(1) + ' %' : '—');

/*
 * LA CLÉ DE COMPARAISON, définie une fois et réutilisée partout.
 *
 * `UPPER(TRIM(city))` — la colonne mélange les casses (« Paris » / « PARIS »
 * sont deux groupes distincts pour un `GROUP BY city` nu) et porte des espaces
 * de bord. Mesurer sur la graphie brute compterait des doublons de casse comme
 * des villes différentes et gonflerait artificiellement chaque total.
 */
const CLE = `UPPER(TRIM("city"))`;

console.log(`\n  MESURE DU ${new Date().toISOString().slice(0, 10)} — lecture seule\n`);

/* ── 0. LE CATALOGUE, POUR SITUER TOUS LES RATIOS ────────────────────────── */
const [socle] = await lire(`
  SELECT COUNT(*)::int                                           AS offres,
         COUNT("city")::int                                      AS avec_ville,
         COUNT(*) FILTER (WHERE "countryCode" IS NOT NULL)::int   AS avec_pays,
         COUNT(DISTINCT ${CLE})::int                              AS villes
    FROM "Job" WHERE "isActive"`);

console.log('  CATALOGUE ACTIF');
console.log('  ' + '─'.repeat(72));
console.log(`  offres actives                  ${fr(socle.offres).padStart(10)}`);
console.log(`  dont une ville renseignée       ${fr(socle.avec_ville).padStart(10)}   ${pct(socle.avec_ville, socle.offres)}`);
console.log(`  dont un pays renseigné          ${fr(socle.avec_pays).padStart(10)}   ${pct(socle.avec_pays, socle.offres)}`);
console.log(`  villes distinctes (clé UPPER)   ${fr(socle.villes).padStart(10)}`);

/* ── 1. LES VILLES MULTI-PAYS : la taille réelle du défaut ───────────────── */
const [multi] = await lire(`
  WITH par_ville AS (
    SELECT ${CLE} AS cle, COUNT(DISTINCT "countryCode")::int AS pays
      FROM "Job"
     WHERE "isActive" AND "city" IS NOT NULL AND "countryCode" IS NOT NULL
     GROUP BY 1)
  SELECT COUNT(*) FILTER (WHERE pays > 1)::int AS villes_multi,
         COUNT(*)::int                          AS villes_avec_pays
    FROM par_ville`);

console.log('\n\n  1. VILLES PORTANT LE MÊME NOM DANS PLUSIEURS PAYS');
console.log('  ' + '─'.repeat(72));
console.log(`  villes distinctes ayant au moins un pays   ${fr(multi.villes_avec_pays).padStart(8)}`);
console.log(`  dont présentes dans PLUSIEURS pays         ${fr(multi.villes_multi).padStart(8)}   ${pct(multi.villes_multi, multi.villes_avec_pays)}`);

/* Les plus grosses, celles que le candidat rencontre vraiment. */
const grosses = await lire(`
  SELECT ${CLE}                                        AS cle,
         COUNT(DISTINCT "countryCode")::int             AS nb_pays,
         STRING_AGG(DISTINCT "countryCode", ' ' ORDER BY "countryCode") AS pays,
         COUNT(*)::int                                  AS offres
    FROM "Job"
   WHERE "isActive" AND "city" IS NOT NULL AND "countryCode" IS NOT NULL
   GROUP BY 1 HAVING COUNT(DISTINCT "countryCode") > 1
   ORDER BY COUNT(*) DESC LIMIT 12`);

console.log('\n  Les douze plus grosses — c’est ce que le candidat voit :\n');
console.log('    ville'.padEnd(26) + 'pays'.padEnd(6) + 'codes'.padEnd(22) + 'offres'.padStart(9));
for (const g of grosses) {
  console.log(
    '    ' + String(g.cle).slice(0, 22).padEnd(22) +
    String(g.nb_pays).padEnd(6) + String(g.pays).slice(0, 20).padEnd(22) +
    fr(g.offres).padStart(9),
  );
}

/* ── 2. LES OFFRES SANS PAYS : ce que le cloisonnement ferait disparaître ── */
const [sansPays] = await lire(`
  SELECT COUNT(*)::int                  AS offres,
         COUNT(DISTINCT ${CLE})::int    AS villes
    FROM "Job"
   WHERE "isActive" AND "city" IS NOT NULL AND "countryCode" IS NULL`);

console.log('\n\n  2. OFFRES SANS PAYS — le trou du cloisonnement strict');
console.log('  ' + '─'.repeat(72));
console.log(`  offres actives avec ville mais SANS pays   ${fr(sansPays.offres).padStart(8)}   ${pct(sansPays.offres, socle.offres)} du catalogue`);
console.log(`  villes distinctes concernées              ${fr(sansPays.villes).padStart(8)}`);
console.log('\n  Sans traitement, ces villes-là sortiraient des suggestions de TOUS');
console.log('  les marchés : elles n’appartiennent à aucun.');

/* ── 3. LA DÉDUCTIBILITÉ : combien peut-on rattacher sans deviner ? ──────── */
/*
 * La règle, mot pour mot : une ville sans pays dont UNE SEULE valeur de pays
 * existe ailleurs dans le catalogue prend ce pays. Deux ou plus : abstention.
 * Zéro : abstention.
 *
 * `pays_connus` porte, pour chaque clé de ville, l'ensemble des pays observés
 * sur les offres QUI EN ONT UN. On le joint ensuite aux villes orphelines.
 */
const [deduction] = await lire(`
  WITH orphelines AS (
    SELECT DISTINCT ${CLE} AS cle
      FROM "Job" WHERE "isActive" AND "city" IS NOT NULL AND "countryCode" IS NULL),
  pays_connus AS (
    SELECT ${CLE} AS cle, COUNT(DISTINCT "countryCode")::int AS nb_pays
      FROM "Job" WHERE "isActive" AND "city" IS NOT NULL AND "countryCode" IS NOT NULL
     GROUP BY 1)
  SELECT COUNT(*) FILTER (WHERE p.nb_pays = 1)::int  AS deductibles,
         COUNT(*) FILTER (WHERE p.nb_pays > 1)::int  AS ambigues,
         COUNT(*) FILTER (WHERE p.nb_pays IS NULL)::int AS sans_occurrence,
         COUNT(*)::int                                 AS total
    FROM orphelines o LEFT JOIN pays_connus p ON p.cle = o.cle`);

console.log('\n\n  3. DÉDUCTIBILITÉ DES VILLES SANS PAYS');
console.log('  ' + '─'.repeat(72));
console.log(`  villes orphelines                        ${fr(deduction.total).padStart(8)}`);
console.log(`  ├─ DÉDUCTIBLES (un seul pays ailleurs)   ${fr(deduction.deductibles).padStart(8)}   ${pct(deduction.deductibles, deduction.total)}`);
console.log(`  ├─ AMBIGUËS (deux pays ou plus)          ${fr(deduction.ambigues).padStart(8)}   ${pct(deduction.ambigues, deduction.total)}`);
console.log(`  └─ SANS OCCURRENCE ailleurs              ${fr(deduction.sans_occurrence).padStart(8)}   ${pct(deduction.sans_occurrence, deduction.total)}`);
console.log('\n  Les deux dernières lignes restent HORS suggestions : on s’abstient.');

/* Des exemples nommés, pour que la règle soit vérifiable à l'œil. */
const exemples = await lire(`
  WITH orphelines AS (
    SELECT DISTINCT ${CLE} AS cle
      FROM "Job" WHERE "isActive" AND "city" IS NOT NULL AND "countryCode" IS NULL),
  pays_connus AS (
    SELECT ${CLE} AS cle, COUNT(DISTINCT "countryCode")::int AS nb_pays,
           STRING_AGG(DISTINCT "countryCode", ' ' ORDER BY "countryCode") AS pays
      FROM "Job" WHERE "isActive" AND "city" IS NOT NULL AND "countryCode" IS NOT NULL
     GROUP BY 1)
  SELECT o.cle, COALESCE(p.nb_pays, 0) AS nb_pays, COALESCE(p.pays, '(aucune)') AS pays
    FROM orphelines o LEFT JOIN pays_connus p ON p.cle = o.cle
   WHERE COALESCE(p.nb_pays, 0) > 1
   ORDER BY p.nb_pays DESC, o.cle LIMIT 8`);

console.log('\n  Exemples d’AMBIGUËS, qu’on refuse de deviner :\n');
for (const e of exemples) {
  console.log('    ' + String(e.cle).slice(0, 24).padEnd(26) + '→ ' + e.pays);
}

/* ── 4. LE CAS « PARIS », DE BOUT EN BOUT ────────────────────────────────── */
console.log('\n\n  4. LE CAS « PARIS » — ce que le candidat français reçoit aujourd’hui');
console.log('  ' + '─'.repeat(72));
const paris = await lire(`
  SELECT COALESCE("countryCode", '(sans pays)') AS pays, COUNT(*)::int AS offres
    FROM "Job" WHERE "isActive" AND ${CLE} = 'PARIS'
   GROUP BY 1 ORDER BY 2 DESC`);
for (const p of paris) {
  console.log('    ' + String(p.pays).padEnd(14) + fr(p.offres).padStart(8) + ' offres');
}

console.log('\n' + '  ' + '─'.repeat(72));
console.log('  LECTURE SEULE — aucune donnée modifiée.\n');

await prisma.$disconnect();

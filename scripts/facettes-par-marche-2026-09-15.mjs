/**
 * QUELLE FACETTE A DU SENS SUR QUEL MARCHÉ — mesuré sur tout le catalogue.
 *
 * LECTURE SEULE : uniquement des `SELECT`. Aucune écriture.
 *
 * ── LA QUESTION À LAQUELLE CE SCRIPT RÉPOND ───────────────────────────────
 *
 * Le CEO, le 15/09/2026 : « respecter les data natives des pays et des offres,
 * donc adapter les filtres en fonction du pays ».
 *
 * Une facette n'est utile que si le marché la RENSEIGNE. Aux États-Unis, la
 * question « CDI ou CDD ? » n'a pas de sens — l'emploi y est *at-will* — et la
 * colonne le montre : 19,2 % renseignée contre 69,2 % en France. Afficher ce
 * filtre à un candidat américain lui pose une question que son marché ne se
 * pose pas, et lui rend 80 % de « non précisé ».
 *
 * Ce script ne DÉCIDE pas : il mesure. Le seuil d'affichage reste un arbitrage
 * du CEO — le script l'affiche pour plusieurs valeurs afin d'éclairer ce choix.
 *
 * ── CE QU'IL NE MESURE PAS ────────────────────────────────────────────────
 *
 * Le taux de remplissage dit qu'une information EXISTE, jamais qu'elle est
 * JUSTE. Une facette bien remplie peut l'être avec des valeurs fausses — le
 * salaire en est l'exemple : 1,7 % de remplissage, et parmi eux des montants
 * annuels étiquetés horaires. La qualité se vérifie dimension par dimension.
 *
 *   DB_URL=… node scripts/facettes-par-marche-2026-09-15.mjs
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

/**
 * Les dimensions candidates à une facette, et la colonne qui les porte.
 * `distincte` marque celles dont il faut aussi connaître le NOMBRE DE VALEURS :
 * une facette à une seule valeur ne filtre rien, même remplie à 100 %.
 */
const DIMENSIONS = [
  ['jobFunction', 'Métier'],
  ['seniority', 'Séniorité'],
  ['employmentTerm', 'Contrat'],
  ['workTime', 'Temps de travail'],
  ['programType', 'Programme'],
  ['engagementType', 'Engagement'],
  ['workplaceType', 'Mode de travail'],
  ['salaryMin', 'Salaire'],
  ['language', 'Langue'],
  ['city', 'Ville'],
  ['seniority', 'Séniorité'],
];

/* Dédoublonne en gardant l'ordre. */
const COLONNES = [...new Map(DIMENSIONS.map(([c, l]) => [c, l])).entries()];

const [{ total }] = await lire(`SELECT COUNT(*)::int AS total FROM "Job" WHERE "isActive"`);
console.log(`\n  CATALOGUE : ${fr(total)} offres actives — mesure du ${new Date().toISOString().slice(0, 10)}\n`);

/* Les marchés qui pèsent : au moins 500 offres, sinon le taux n'est pas lisible. */
const marches = await lire(`
  SELECT "countryCode" AS pays, COUNT(*)::int AS offres
    FROM "Job" WHERE "isActive" AND "countryCode" IS NOT NULL
   GROUP BY 1 HAVING COUNT(*) >= 500 ORDER BY 2 DESC`);

/* ── LE TABLEAU PRINCIPAL : couverture de chaque dimension par marché ──── */
const colonnes = COLONNES.map(([c]) => `COUNT("${c}")::int AS "${c}"`).join(', ');
const lignes = await lire(`
  SELECT "countryCode" AS pays, COUNT(*)::int AS offres, ${colonnes}
    FROM "Job" WHERE "isActive" AND "countryCode" IS NOT NULL
   GROUP BY 1 HAVING COUNT(*) >= 500 ORDER BY 2 DESC`);

const entete = '  marché' + ' '.padEnd(3) + 'offres'.padStart(8) + COLONNES.map(([, l]) => l.slice(0, 9).padStart(11)).join('');
console.log(entete);
console.log('  ' + '─'.repeat(entete.length - 2));

for (const l of lignes) {
  const cells = COLONNES.map(([c]) => {
    const taux = (n(l[c]) / n(l.offres)) * 100;
    return (taux.toFixed(1) + '%').padStart(11);
  }).join('');
  console.log('  ' + String(l.pays).padEnd(8) + fr(l.offres).padStart(8) + cells);
}

/* La ligne « monde », pour comparer chaque marché à la moyenne. */
const [monde] = await lire(`SELECT COUNT(*)::int AS offres, ${colonnes} FROM "Job" WHERE "isActive"`);
console.log('  ' + '─'.repeat(entete.length - 2));
console.log(
  '  ' + 'MONDE'.padEnd(8) + fr(monde.offres).padStart(8) +
  COLONNES.map(([c]) => (((n(monde[c]) / n(monde.offres)) * 100).toFixed(1) + '%').padStart(11)).join(''),
);

/* ── COMBIEN DE VALEURS DISTINCTES : une facette à 1 valeur ne filtre rien ─ */
console.log('\n\n  VALEURS DISTINCTES PAR DIMENSION (une facette à 1 valeur ne filtre rien)');
console.log('  ' + '─'.repeat(70));
for (const [col, label] of COLONNES) {
  if (col === 'salaryMin' || col === 'city') continue;
  const [r] = await lire(`SELECT COUNT(DISTINCT "${col}")::int AS n FROM "Job" WHERE "isActive"`);
  console.log('  ' + label.padEnd(22) + fr(r.n).padStart(6) + ' valeurs distinctes');
}

/* ── CE QUE CHAQUE MARCHÉ MET VRAIMENT DANS SES FACETTES ───────────────── */
console.log('\n\n  LES VALEURS RÉELLES, MARCHÉ PAR MARCHÉ');
console.log('  Une facette dont une valeur écrase les autres n’aide pas à trier.');
console.log('  ' + '─'.repeat(70));

for (const pays of ['FR', 'US', 'GB', 'DE', 'IT', 'ES']) {
  const [{ offres }] = await lire(`SELECT COUNT(*)::int AS offres FROM "Job" WHERE "isActive" AND "countryCode" = '${pays}'`);
  if (!n(offres)) continue;
  console.log(`\n  ── ${pays} — ${fr(offres)} offres ──`);
  for (const [col, label] of [['employmentTerm', 'Contrat'], ['workTime', 'Temps'], ['programType', 'Programme'], ['workplaceType', 'Mode']]) {
    const vals = await lire(`
      SELECT "${col}"::text AS v, COUNT(*)::int AS nb FROM "Job"
       WHERE "isActive" AND "countryCode" = '${pays}' AND "${col}" IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC LIMIT 4`);
    const renseignees = vals.reduce((s, x) => s + n(x.nb), 0);
    if (!renseignees) { console.log(`     ${label.padEnd(12)} —`); continue; }
    const detail = vals.map((x) => `${x.v} ${((n(x.nb) / n(offres)) * 100).toFixed(0)}%`).join(' · ');
    console.log(`     ${label.padEnd(12)} ${detail}`);
  }
}

/* ── LA RECOMMANDATION, À PLUSIEURS SEUILS ────────────────────────────── */
console.log('\n\n  QUELLE FACETTE AFFICHER, SELON LE SEUIL RETENU');
console.log('  Le seuil est un ARBITRAGE CEO : ce tableau l’éclaire, il ne le tranche pas.');
console.log('  ' + '─'.repeat(70));

const FACETTABLES = [
  ['jobFunction', 'Métier'],
  ['employmentTerm', 'Contrat'],
  ['workTime', 'Temps de travail'],
  ['programType', 'Programme'],
  ['seniority', 'Séniorité'],
  ['workplaceType', 'Mode de travail'],
  ['salaryMin', 'Salaire'],
];

for (const seuil of [10, 15, 20, 30]) {
  console.log(`\n  ▸ seuil ${seuil} % de couverture`);
  for (const l of lignes.slice(0, 8)) {
    const retenues = FACETTABLES.filter(([c]) => (n(l[c]) / n(l.offres)) * 100 >= seuil).map(([, lab]) => lab);
    console.log('     ' + String(l.pays).padEnd(5) + (retenues.length ? retenues.join(' · ') : '(aucune)'));
  }
}

console.log('\n' + '  ' + '─'.repeat(70));
console.log('  Rappel : le remplissage dit qu’une information EXISTE, jamais');
console.log('  qu’elle est JUSTE. Le salaire est bien renseigné sur certains');
console.log('  marchés mais contient des montants annuels étiquetés horaires.');
console.log('  LECTURE SEULE — aucune donnée modifiée.\n');

await prisma.$disconnect();

/**
 * ÉTAT RÉEL DES FILTRES — entrée brute, sortie canonique, exploitabilité.
 *
 * LECTURE SEULE ABSOLUE : uniquement des `SELECT`. Aucun `UPDATE`, `DELETE`,
 * `INSERT`, aucune migration, aucun `$executeRaw`. Le script DIT l'état, il ne
 * le change pas.
 *
 * ── CE QUE CE SCRIPT RÉPOND ───────────────────────────────────────────────
 *
 * Pour chaque dimension de filtre :
 *   1. combien d'offres actives portent une valeur canonique ;
 *   2. combien n'en portent pas — et ce que la source avait pourtant envoyé ;
 *   3. quelles valeurs brutes reviennent le plus souvent sans être reconnues.
 *
 * Le point 3 est le plus important : un `null` peut venir d'une source
 * silencieuse OU d'un vocabulaire que nous ne savons pas lire. Les deux ne se
 * corrigent pas de la même façon, et seul le brut permet de les distinguer.
 *
 *   DB_URL=… node scripts/etat-filtres-2026-09-14.mjs
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}

/*
 * GARDE-FOU : ce script ne doit jamais servir à écrire. On le rappelle ici
 * pour que l'intention soit lisible à la relecture, et on n'expose qu'une
 * fonction de lecture dans la suite du fichier.
 */
const prisma = new PrismaClient({ datasources: { db: { url } } });
const lire = (sql) => prisma.$queryRawUnsafe(sql);

/** Les entiers Postgres reviennent en BigInt : on les rend affichables. */
const n = (v) => Number(v ?? 0);
const pct = (part, total) => (total ? ((part / total) * 100).toFixed(1) : '0.0');

function titre(t) {
  console.log('\n' + '═'.repeat(74));
  console.log('  ' + t);
  console.log('═'.repeat(74));
}

const [{ total }] = await lire(`SELECT COUNT(*)::int AS total FROM "Job" WHERE "isActive"`);
const TOTAL = n(total);

titre(`CATALOGUE — ${TOTAL.toLocaleString('fr-FR')} offres actives`);

/* ── 1. REMPLISSAGE DE CHAQUE DIMENSION CANONIQUE ─────────────────────── */
titre('1. CE QUE NOS FILTRES PEUVENT RÉELLEMENT FILTRER');

const DIMENSIONS = [
  ['countryCode', 'Pays'],
  ['city', 'Ville'],
  ['employmentTerm', 'Contrat (durée)'],
  ['workTime', 'Temps de travail'],
  ['programType', 'Programme'],
  ['engagementType', 'Engagement'],
  ['workplaceType', 'Mode de travail'],
  ['language', 'Langue'],
  ['jobFunction', 'Métier'],
  ['seniority', 'Séniorité'],
  ['salaryMin', 'Salaire'],
];

console.log('  dimension'.padEnd(24) + 'renseignées'.padStart(12) + 'couverture'.padStart(12) + '   manquantes');
console.log('  ' + '─'.repeat(70));
const couverture = {};
for (const [col, label] of DIMENSIONS) {
  const [r] = await lire(`SELECT COUNT("${col}")::int AS remplies FROM "Job" WHERE "isActive"`);
  const remplies = n(r.remplies);
  couverture[col] = remplies;
  const barre = '█'.repeat(Math.round((remplies / TOTAL) * 20)).padEnd(20, '·');
  console.log(
    '  ' + label.padEnd(22) + remplies.toLocaleString('fr-FR').padStart(12) +
    (pct(remplies, TOTAL) + ' %').padStart(11) + '  ' + barre,
  );
}

/* ── 2. LE BRUT QUE LA SOURCE ENVOIE, ET QUE NOUS NE LISONS PAS ───────── */
titre('2. LA SOURCE PARLE, NOUS N’ENTENDONS PAS');
console.log('  Offres dont le champ brut est REMPLI mais le canonique VIDE.');
console.log('  C’est du vocabulaire non reconnu — pas une source silencieuse.\n');

const PAIRES = [
  ['contractRaw', 'employmentTerm', 'Contrat'],
  ['workingTimeRaw', 'workTime', 'Temps de travail'],
  ['remoteRaw', 'workplaceType', 'Mode de travail'],
];

for (const [brut, canon, label] of PAIRES) {
  try {
    const [r] = await lire(`
      SELECT COUNT(*)::int AS perdues FROM "Job"
       WHERE "isActive" AND "${brut}" IS NOT NULL AND "${canon}" IS NULL`);
    const perdues = n(r.perdues);
    console.log(`  ${label.padEnd(20)} ${perdues.toLocaleString('fr-FR').padStart(8)} offres perdues (${pct(perdues, TOTAL)} %)`);
    if (perdues > 0) {
      const top = await lire(`
        SELECT "${brut}" AS valeur, COUNT(*)::int AS nb FROM "Job"
         WHERE "isActive" AND "${brut}" IS NOT NULL AND "${canon}" IS NULL
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
      for (const t of top) console.log(`      « ${String(t.valeur).slice(0, 44)} »`.padEnd(54) + n(t.nb).toLocaleString('fr-FR').padStart(8));
    }
  } catch (e) {
    console.log(`  ${label.padEnd(20)} colonne brute absente (${String(e.message).split('\n')[0].slice(0, 50)})`);
  }
  console.log();
}

/* ── 3. RÉPARTITION DES VALEURS CANONIQUES ────────────────────────────── */
titre('3. CE QUE CONTIENNENT NOS FACETTES');

for (const col of ['employmentTerm', 'workTime', 'workplaceType', 'programType', 'language']) {
  const lignes = await lire(`
    SELECT COALESCE("${col}"::text, '(non renseigné)') AS valeur, COUNT(*)::int AS nb
      FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  console.log(`\n  ${col}`);
  for (const l of lignes) {
    console.log('    ' + String(l.valeur).padEnd(24) + n(l.nb).toLocaleString('fr-FR').padStart(9) + (pct(n(l.nb), TOTAL) + ' %').padStart(9));
  }
}

/* ── 4. LE DÉFAUT DE REQUÊTE : CE QUE LE FILTRE FAIT DISPARAÎTRE ──────── */
titre('4. COMBIEN D’OFFRES UN FILTRE FAIT DISPARAÎTRE');
console.log('  `{ in: [...] }` sur une colonne nullable exclut les NULL en SQL.');
console.log('  Ces offres ne sont ni affichées, ni comptées, ni signalées.\n');

for (const [col, label] of [
  ['employmentTerm', 'filtre Contrat'],
  ['workTime', 'filtre Temps de travail'],
  ['workplaceType', 'filtre Mode de travail'],
  ['language', 'filtre Langue'],
]) {
  const [r] = await lire(`SELECT COUNT(*)::int AS nb FROM "Job" WHERE "isActive" AND "${col}" IS NULL`);
  console.log(`  ${label.padEnd(26)} masque ${n(r.nb).toLocaleString('fr-FR').padStart(8)} offres (${pct(n(r.nb), TOTAL)} %)`);
}

/* ── 5. GÉOGRAPHIE : L'ÉTAT DU DÉFAUT CORRIGÉ CETTE SESSION ───────────── */
titre('5. GÉOGRAPHIE — le défaut pays/État, en production');

const collision = await lire(`
  SELECT j."countryCode" AS pays, COUNT(*)::int AS nb,
         MIN(j.location) AS exemple,
         COUNT(j."countryIntegrity")::int AS signalees
    FROM "Job" j
   WHERE j."isActive"
     AND j."countryCode" IN ('IN','KY','AR','VA','MA','IL','AL','GA','DE','CA','CO','ID','LA','MT','MS','NE','PA','SC','SD','TN','ME','MD','MN','MO','NC','AZ')
     AND j.location ~ ',\\s*[A-Z]{2}\\s*$'
     AND UPPER(RIGHT(TRIM(j.location), 2)) = j."countryCode"
   GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);

if (collision.length === 0) {
  console.log('  Aucune offre dont le pays stocké = le code final du libellé.');
} else {
  console.log('  pays   offres   signalées   exemple de libellé');
  console.log('  ' + '─'.repeat(66));
  let somme = 0;
  for (const c of collision) {
    somme += n(c.nb);
    console.log(
      '  ' + String(c.pays).padEnd(7) + n(c.nb).toLocaleString('fr-FR').padStart(6) +
      n(c.signalees).toString().padStart(11) + '   ' + String(c.exemple).slice(0, 34),
    );
  }
  console.log('  ' + '─'.repeat(66));
  console.log(`  TOTAL ${somme.toLocaleString('fr-FR')} offres — un pays déduit d’un code qui est aussi un État US.`);
}

/* ── 6. SALAIRE : L'EXPOSITION RÉELLE ─────────────────────────────────── */
titre('6. SALAIRE — la couverture par marché');

const salaires = await lire(`
  SELECT COALESCE("countryCode", '(inconnu)') AS pays,
         COUNT(*)::int AS offres,
         COUNT("salaryMin")::int AS avec_salaire
    FROM "Job" WHERE "isActive"
   GROUP BY 1 HAVING COUNT(*) > 300 ORDER BY 2 DESC LIMIT 12`);
console.log('  pays        offres    avec salaire   couverture');
console.log('  ' + '─'.repeat(56));
for (const s of salaires) {
  console.log(
    '  ' + String(s.pays).padEnd(12) + n(s.offres).toLocaleString('fr-FR').padStart(8) +
    n(s.avec_salaire).toLocaleString('fr-FR').padStart(14) + (pct(n(s.avec_salaire), n(s.offres)) + ' %').padStart(12),
  );
}

console.log('\n' + '═'.repeat(74));
console.log('  LECTURE SEULE — aucune donnée modifiée.');
console.log('═'.repeat(74) + '\n');

await prisma.$disconnect();

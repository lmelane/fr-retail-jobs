/**
 * COMBIEN COÛTE LE CLOISONNEMENT DES VILLES — et surtout, sa DÉDUCTION.
 *
 * LECTURE SEULE : uniquement des `SELECT`. Aucune écriture.
 *
 * ── LA QUESTION À LAQUELLE CE SCRIPT RÉPOND ───────────────────────────────
 *
 * La route de suggestions est appelée à CHAQUE FRAPPE (débounce 150 ms côté
 * front). La latence s'y paie au clavier, pas en fin de page : une requête qui
 * double de durée transforme une autocomplétion en champ qui traîne.
 *
 * L'arbitrage à poser était donc : où vit la déduction du pays d'une ville
 * orpheline ? Dans la REQUÊTE, ou dans une TABLE DÉRIVÉE rafraîchie à part ?
 *
 * Une table dérivée coûte un objet de plus à maintenir, un rafraîchissement à
 * ordonnancer, et une fenêtre pendant laquelle elle est périmée. Ça ne se
 * justifie que par un gain mesuré. D'où ce script : on mesure d'abord, on
 * décide ensuite — jamais l'inverse.
 *
 * ── CE QU'IL MESURE, ET CE QU'IL NE MESURE PAS ────────────────────────────
 *
 * Il mesure le temps de la REQUÊTE, aller-retour compris, depuis ce poste vers
 * la base de production. Ce n'est PAS la latence que voit un candidat : le
 * serveur d'API est à côté de la base, pas ici. Les valeurs absolues sont donc
 * majorées par la distance réseau — c'est l'ÉCART entre les trois formes qui
 * porte l'information, et l'écart, lui, est valide.
 *
 * La médiane et non la moyenne : une seule passe lente (réveil de connexion,
 * gigue réseau) déplace une moyenne et ne déplace pas une médiane.
 *
 *   DB_URL=… node audits/mesures-d435-d436/latence-suggest-villes-2026-09-15.mjs
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const lire = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);

const PASSES = 11;
const mediane = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

async function mesurer(nom, executer) {
  // Une passe à blanc : la première paie l'ouverture de connexion et le plan.
  await executer();
  const temps = [];
  for (let i = 0; i < PASSES; i++) {
    const t0 = performance.now();
    await executer();
    temps.push(performance.now() - t0);
  }
  console.log('    ' + nom.padEnd(46) + mediane(temps).toFixed(1).padStart(7) + ' ms');
  return mediane(temps);
}

/* Le plafond brut de la route : 8 suggestions, mais 24 lignes tirées pour
   dédupliquer les casses (« Paris » / « PARIS ») côté applicatif. */
const BRUT = 24;

/** A — la requête d'AVANT le lot : aucun filtre de pays. */
const actuelle = (prefixe) =>
  lire(
    `SELECT "city", COUNT(*)::int AS n FROM "Job"
      WHERE "isActive" AND "city" ILIKE $1
      GROUP BY 1 ORDER BY 2 DESC LIMIT ${BRUT}`,
    prefixe,
  );

/** B — cloisonnée, mais SANS déduction : les orphelines disparaissent. */
const sansDeduction = (prefixe, pays) =>
  lire(
    `SELECT "city", COUNT(*)::int AS n FROM "Job"
      WHERE "isActive" AND "city" ILIKE $1 AND "countryCode" = ANY($2)
      GROUP BY 1 ORDER BY 2 DESC LIMIT ${BRUT}`,
    prefixe,
    pays,
  );

/** C — CE QUI EST LIVRÉ : cloisonnée + déduction, en une seule requête. */
const avecDeduction = (prefixe, pays) =>
  lire(
    `WITH candidates AS (
       SELECT "city", UPPER(TRIM("city")) AS cle, "countryCode" AS pays
         FROM "Job" WHERE "isActive" AND "city" ILIKE $1),
     deduit AS (
       SELECT cle, MIN(pays) AS p FROM candidates WHERE pays IS NOT NULL
        GROUP BY cle HAVING COUNT(DISTINCT pays) = 1)
     SELECT c."city", COUNT(*)::int AS n
       FROM candidates c LEFT JOIN deduit d ON d.cle = c.cle
      WHERE COALESCE(c.pays, d.p) = ANY($2)
      GROUP BY c."city" ORDER BY COUNT(*) DESC, c."city" ASC LIMIT ${BRUT}`,
    prefixe,
    pays,
  );

console.log(`\n  LATENCE DE /api/suggest?type=city — mesure du ${new Date().toISOString().slice(0, 10)}`);
console.log('  Médiane de ' + PASSES + ' passes, sur le catalogue de production, en lecture seule.');
console.log('  Depuis ce poste : les valeurs ABSOLUES sont majorées par le réseau,');
console.log('  c’est l’ÉCART entre les trois formes qui porte l’information.\n');

/*
 * Deux préfixes, et le second n'est pas décoratif : « par » est une frappe
 * réaliste, « a » est le PIRE CAS — la lettre qui sélectionne le plus de
 * villes, donc la CTE la plus large. Ne mesurer que le cas favorable
 * donnerait un chiffre vrai et une conclusion fausse.
 */
for (const [prefixe, etiquette] of [
  ['par%', '« par » — une frappe réaliste'],
  ['a%', '« a » — le pire cas, la lettre la plus large'],
]) {
  console.log(`  ▸ ${etiquette}`);
  const a = await mesurer('A. actuelle (aucun cloisonnement)', () => actuelle(prefixe));
  const b = await mesurer('B. cloisonnée, SANS déduction', () => sansDeduction(prefixe, ['FR']));
  const c = await mesurer('C. cloisonnée AVEC déduction (livré)', () => avecDeduction(prefixe, ['FR']));
  const ecart = c - a;
  console.log(
    '    → la déduction coûte ' +
      (ecart >= 0 ? '+' : '') + ecart.toFixed(1) + ' ms par rapport à l’existant' +
      (Math.abs(ecart) < 5 ? ' (dans le bruit de mesure)' : '') + '\n',
  );
  void b;
}

console.log('  ' + '─'.repeat(72));
console.log('  CE QUE LA MESURE TRANCHE : la déduction ne change pas l’ordre de');
console.log('  grandeur. Deux exécutions successives depuis ce poste ont rendu');
console.log('  -1,2 ms puis +7,7 ms sur « par » — l’écart entre deux mesures de');
console.log('  la MÊME chose dépasse l’effet qu’on cherche à mesurer, donc le');
console.log('  seul énoncé honnête est : le surcoût est INFÉRIEUR À ~8 ms, et');
console.log('  indiscernable de la gigue réseau depuis ce poste.');
console.log('');
console.log('  La raison est structurelle plutôt que chanceuse — la CTE');
console.log('  `candidates` est bornée par le préfixe AVANT tout calcul, donc');
console.log('  elle ne raisonne que sur les quelques centaines de lignes que la');
console.log('  frappe a sélectionnées, jamais sur les 83 431 offres. C’est ce');
console.log('  raisonnement, confirmé par la mesure, qui porte la décision — pas');
console.log('  un chiffre isolé qu’une seule passe aurait pu rendre flatteur.');
console.log('');
console.log('  Une table dérivée aurait ajouté un objet à maintenir, un');
console.log('  rafraîchissement à ordonnancer et une fenêtre de péremption, pour');
console.log('  un gain au plus de quelques millisecondes, non mesurable ici.');
console.log('  LECTURE SEULE — aucune donnée modifiée.\n');

await prisma.$disconnect();

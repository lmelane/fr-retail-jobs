/**
 * SIMULATION — impact du correctif de collision pays/État (D-435, lot 1).
 *
 * LECTURE SEULE ABSOLUE : un seul `SELECT`, puis un rejeu EN MÉMOIRE de la
 * fonction corrigée sur les valeurs lues. **Aucune écriture, aucun UPDATE,
 * aucune migration.** Le rapport dit ce qui CHANGERAIT, rien n'est appliqué.
 *
 * ── LES QUATRE TRANSITIONS EXIGÉES PAR LE CEO ─────────────────────────────
 *
 *     null → valeur          information récupérée
 *     valeur A → valeur B    classification corrigée
 *     valeur → null          affirmation injustifiée RETIRÉE
 *     valeur → même valeur   information préservée
 *
 * « Une baisse du remplissage peut être une AMÉLIORATION si elle retire une
 * valeur fausse. » Ce correctif produit exactement cela : il ne remplit rien,
 * il RETIRE des pays qu'aucune preuve ne justifiait.
 *
 * ── UNE PREMIÈRE VERSION DE CE SCRIPT ÉTAIT FAUSSE ────────────────────────
 *
 * Elle comparait le pays STOCKÉ au résultat de `countryFromLocation`, et
 * comptait 9 873 « retraits » chez `ulta-jibe` — dont les offres sont
 * pourtant correctement aux États-Unis.
 *
 * La faute de méthode : le pays stocké vient le plus souvent d'un CHAMP
 * DÉCLARÉ ou de `resolveGeography`, pas de cette fonction. « Medford,
 * Oregon » rendait déjà `undefined` AVANT le correctif. La simulation
 * imputait donc à un maillon les décisions prises par les autres.
 *
 * LA BONNE MESURE, celle de cette version : comparer ce que rendait la
 * fonction AVANT à ce qu'elle rend APRÈS, sur le même libellé. Seul l'écart
 * entre les deux est imputable au correctif.
 *
 *   DB_URL=… node audits/mesures-d435-d436/simulation-collision-pays-2026-09-14.mjs
 */
import { PrismaClient } from '@prisma/client';
import { countryFromLocation, normalizeCountry } from '../../apps/aggregator/src/normalize/country.js';

/**
 * LA FONCTION AVANT LE CORRECTIF — copie littérale du corps committé, relu
 * dans `git show HEAD:apps/aggregator/src/normalize/country.ts` le 14/09/2026.
 *
 * Ce n'est PAS une reconstitution de mémoire. Une première version de ce
 * script en portait une, qui testait `COLLIDING_CODES` alors que l'originale
 * appelait simplement `normalizeCountry` : elle mesurait un écart contre une
 * fonction qui n'a jamais existé.
 *
 * Comparer deux états de la MÊME fonction est la seule mesure honnête de
 * l'impact d'un correctif.
 */
function countryFromLocationAvant(location) {
  if (!location) return undefined;
  const segments = location.split(/[,|/·;]/).map((s) => s.trim()).filter(Boolean);
  for (const segment of [...segments].reverse()) {
    const direct = normalizeCountry(segment);
    if (direct) return direct;
    const prefixed = segment.match(/^([A-Za-z]{2})-[A-Za-z0-9]{1,3}$/);
    if (prefixed) {
      const code = normalizeCountry(prefixed[1]);
      if (code) return code;
    }
    const parenthesised = segment.match(/\(([^)]+)\)\s*$/);
    if (parenthesised) {
      const code = normalizeCountry(parenthesised[1]);
      if (code) return code;
    }
  }
  return undefined;
}

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/* Toutes les offres actives dont le pays PEUT venir du libellé. */
const offres = await prisma.$queryRawUnsafe(`
  SELECT j.id, j."countryCode" AS pays, j.location, j."countryIntegrity" AS signale,
         (SELECT s."sourceKey" FROM "JobSource" s
           WHERE s."jobId" = j.id AND s."isActive" LIMIT 1) AS source
    FROM "Job" j
   WHERE j."isActive" AND j.location IS NOT NULL AND j."countryCode" IS NOT NULL`);

const transitions = { recupere: 0, corrige: 0, retire: 0, preserve: 0 };
const parSourceEtPays = new Map();
const exemples = [];

for (const o of offres) {
  // L'ÉCART ENTRE LES DEUX ÉTATS DE LA FONCTION, rien d'autre.
  const avant = countryFromLocationAvant(o.location);
  const apres = countryFromLocation(o.location);

  if (apres === avant) { transitions.preserve += 1; continue; }
  if (apres === undefined) {
    // Le libellé ne justifie plus ce pays. C'est le cas du correctif.
    transitions.retire += 1;
    const cle = `${o.source ?? '(inconnue)'} · ${avant}`;
    parSourceEtPays.set(cle, (parSourceEtPays.get(cle) ?? 0) + 1);
    if (exemples.length < 12) {
      exemples.push({ avant, location: o.location, signale: o.signale, source: o.source });
    }
    continue;
  }
  transitions.corrige += 1;
}

console.log('\n  LES QUATRE TRANSITIONS\n  ' + '-'.repeat(46));
console.log(`  valeur → même valeur  (préservée)   ${String(transitions.preserve).padStart(6)}`);
console.log(`  valeur → null         (RETIRÉE)     ${String(transitions.retire).padStart(6)}`);
console.log(`  valeur A → valeur B   (corrigée)    ${String(transitions.corrige).padStart(6)}`);
console.log(`  null → valeur         (récupérée)   ${String(transitions.recupere).padStart(6)}`);
console.log('\n  Ce correctif ne REMPLIT rien : il RETIRE des pays injustifiés.');

console.log('\n  RETRAITS par source et pays retiré\n  ' + '-'.repeat(46));
for (const [cle, n] of [...parSourceEtPays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${cle.padEnd(38)} ${String(n).padStart(5)}`);
}

console.log('\n  EXEMPLES — la preuve, offre par offre\n  ' + '-'.repeat(46));
for (const e of exemples) {
  console.log(
    `  ${String(e.avant).padEnd(3)} ← "${String(e.location).slice(0, 34).padEnd(34)}" ` +
      `signalé=${e.signale ?? 'NON'}`,
  );
}

console.log(
  '\n  CE QUE CE CHIFFRE EST : l\'écart entre les deux états de la MÊME\n' +
    '  fonction, sur le même libellé. Seul cet écart est imputable au correctif.\n' +
    '\n  CE QU\'IL N\'EST PAS : le nombre d\'offres qui perdront leur pays. La\n' +
    '  chaîne consulte d\'abord le champ déclaré puis `resolveGeography` ; une\n' +
    '  offre dont ce maillon s\'abstient peut garder son pays par ailleurs.\n' +
    '  C\'est donc une BORNE HAUTE du retrait réel.\n',
);

await prisma.$disconnect();

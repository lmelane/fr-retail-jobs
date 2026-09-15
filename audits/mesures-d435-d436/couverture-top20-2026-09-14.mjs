/**
 * COUVERTURE RÉELLE DU TOP 20 — et pourquoi une somme ne la donne pas.
 *
 * LECTURE SEULE : uniquement des `SELECT`. Aucune écriture.
 *
 * Le CEO, 14/09/2026 : « les vingt volumes affichés totalisent 48 919, alors
 * que la synthèse annonce 46 919 ; et une somme par source ne donne de toute
 * façon pas la couverture unique lorsque plusieurs sources servent la même
 * offre. »
 *
 * Les deux reproches sont fondés :
 *
 *  1. ERREUR D'ARITHMÉTIQUE — la somme des 20 volumes vaut bien 48 919.
 *     L'écart de 2 000 exactes suggère une saisie fautive, pas un arrondi.
 *
 *  2. ERREUR DE MÉTHODE, plus grave — même juste, cette somme ne mesure PAS
 *     la couverture. Une offre servie par `wttj-sector` ET `hermes` y compte
 *     deux fois. Seul un `count(DISTINCT j.id)` sur l'UNION des 20 sources
 *     donne le nombre d'offres réellement examinées.
 *
 * Ce script produit les deux nombres côte à côte, pour que l'écart soit
 * visible et qu'on ne confonde plus jamais les deux.
 *
 *   DB_URL=… node audits/mesures-d435-d436/couverture-top20-2026-09-14.mjs
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/* Le top 20, recalculé plutôt que recopié. */
const top = await prisma.$queryRawUnsafe(`
  SELECT s."sourceKey" AS source, count(DISTINCT j.id)::int AS offres
    FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
   WHERE j."isActive" AND s."isActive"
   GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);

const [{ total }] = await prisma.$queryRawUnsafe(
  `SELECT count(*)::int AS total FROM "Job" WHERE "isActive"`,
);

const cles = top.map((t) => `'${t.source}'`).join(', ');

/* LA mesure qui compte : l'union dédoublonnée. */
const [{ couverture }] = await prisma.$queryRawUnsafe(`
  SELECT count(DISTINCT j.id)::int AS couverture
    FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
   WHERE j."isActive" AND s."isActive" AND s."sourceKey" IN (${cles})`);

const somme = top.reduce((n, t) => n + t.offres, 0);

console.log('\n  Top 20 par volume\n  ' + '-'.repeat(38));
for (const t of top) {
  console.log(`  ${String(t.source).padEnd(26)} ${String(t.offres).padStart(6)}`);
}

console.log('\n  Les deux chiffres, à ne jamais confondre\n  ' + '-'.repeat(44));
console.log(`  SOMME des 20 volumes          : ${String(somme).padStart(6)}   ← PAS la couverture`);
console.log(`  COUVERTURE UNIQUE (distinct)  : ${String(couverture).padStart(6)}   ← la vraie mesure`);
console.log(`  offres comptées plusieurs fois: ${String(somme - couverture).padStart(6)}`);
console.log(`  catalogue actif               : ${String(total).padStart(6)}`);
console.log(`  part réellement examinée      : ${((couverture / total) * 100).toFixed(1)} %`);
console.log(
  `  NON examinée                  : ${String(total - couverture).padStart(6)} offres\n`,
);

await prisma.$disconnect();

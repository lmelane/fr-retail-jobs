/**
 * COMBIEN COÛTE LA FACETTE `engagements`, QUI N'EST SERVIE SUR AUCUN MARCHÉ ?
 *
 * LECTURE SEULE : uniquement des `SELECT` et des `EXPLAIN ANALYZE`. Aucune
 * écriture.
 *
 * ── LA QUESTION ───────────────────────────────────────────────────────────
 *
 * `apps/api/lib/jobs.ts` porte l'affirmation « le coût d'une facette calculée
 * puis écartée est nul (même requête d'agrégation) ». Un commentaire est un
 * témoignage, pas une preuve : ce script le met à l'épreuve en chronométrant la
 * requête de recherche AVEC et SANS la sous-requête `engagements`, sur la même
 * base et le même CTE `scoped`.
 *
 * Le résultat décide s'il y a une dette à retirer, ou seulement une ligne de
 * documentation à écrire.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const url = readFileSync(
  '/private/tmp/claude-501/-Users-lmelane-Documents-beauchoix-projects-catwalks-build/2ee090ff-88d2-4b03-9b91-030edca7855b/scratchpad/dburl',
  'utf8',
).trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Le corps de `searchSummary` réduit à sa forme sans filtre : le pire cas de
// cardinalité, donc le cas où une facette superflue coûterait le plus.
const base = `
  WITH base AS MATERIALIZED (
    SELECT j.id, j."occupationCode", j."countryCode", j."isFrance", j.city,
           j."employmentTerm", j."workTime", j."programType", j."engagementType",
           j."postedAt", j."firstSeenAt", j.language,
           c.name AS maison, c."sectorCodes", c."parentGroup" AS groupe
    FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
    WHERE j."isActive"
  ), scoped AS MATERIALIZED (SELECT * FROM base)`;

const facette = (colonne) => `
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT ${colonne}::text AS value, count(*)::int AS n FROM scoped
     WHERE ${colonne} IS NOT NULL AND ${colonne}::text <> '' GROUP BY ${colonne}
     ORDER BY n DESC, value) f)`;

const avec = `${base}
  SELECT
    (SELECT count(*)::int FROM scoped) AS total,
    ${facette('"employmentTerm"')} AS contracts,
    ${facette('"workTime"')} AS "workTimes",
    ${facette('"programType"')} AS programs,
    ${facette('"engagementType"')} AS engagements`;

const sans = `${base}
  SELECT
    (SELECT count(*)::int FROM scoped) AS total,
    ${facette('"employmentTerm"')} AS contracts,
    ${facette('"workTime"')} AS "workTimes",
    ${facette('"programType"')} AS programs`;

/** Le temps d'exécution réel rendu par PostgreSQL, pas un chronomètre côté client. */
const chronometre = async (sql) => {
  const plan = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
  return plan[0]['QUERY PLAN'][0]['Execution Time'];
};

/*
 * ONZE PASSES, ET C'EST LE NOMBRE QUI DÉCIDE DE LA CONCLUSION.
 *
 * À trois passes, l'écart mesuré ressortait à 11,5 ms (7,1 %) — un chiffre qui
 * aurait justifié à lui seul de retirer la facette. À onze, il retombe à 4,8 ms
 * (3,0 %) : les deux tiers de l'écart initial n'étaient que du bruit de cache.
 * Un écart de quelques millisecondes sur une requête de 160 ms se mesure en
 * médiane sur une dizaine de passes, jamais sur trois.
 */
const passes = 11;
const mesures = { avec: [], sans: [] };
for (let i = 0; i < passes; i += 1) {
  mesures.avec.push(await chronometre(avec));
  mesures.sans.push(await chronometre(sans));
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mAvec = median(mesures.avec);
const mSans = median(mesures.sans);

console.log('\n=== Coût de la facette `engagements` (ms, EXPLAIN ANALYZE) ===');
console.table([
  { variante: 'AVEC engagements', passes: mesures.avec.map((x) => x.toFixed(1)).join(' / '), mediane: mAvec.toFixed(1) },
  { variante: 'SANS engagements', passes: mesures.sans.map((x) => x.toFixed(1)).join(' / '), mediane: mSans.toFixed(1) },
]);
console.log(`\nÉcart médian : ${(mAvec - mSans).toFixed(1)} ms (${(((mAvec - mSans) / mSans) * 100).toFixed(1)} %)`);

// Ce que la facette rend réellement, pour dire ce qu'on retire.
const contenu = await prisma.$queryRawUnsafe(`${base} SELECT ${facette('"engagementType"')} AS engagements`);
console.log('\nContenu servi par la facette :', JSON.stringify(contenu[0].engagements));

await prisma.$disconnect();

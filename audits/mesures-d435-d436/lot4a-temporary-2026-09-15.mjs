/**
 * QUE MÉLANGE LA VALEUR `employmentTerm = TEMPORARY` ? — LECTURE SEULE.
 *
 * 93 offres sur 83 431 actives (2026-09-15). Le lot 4A ne TRANCHE pas son sort
 * — c'est un arbitrage produit qui appartient au CEO. Il le DOCUMENTE, chiffré,
 * pour que l'arbitrage se prenne sur une mesure et non sur une intuition.
 *
 * La question posée ici : la valeur désigne-t-elle UNE chose (l'intérim) ou
 * plusieurs (intérim, zéro heure, agency worker, Leiharbeit) rangées ensemble ?
 * Les expressions qui y aboutissent vivent dans `normalize/employment.ts` —
 * `TERM_PATTERNS[TEMPORARY]` et le token composite `INTERIM|AGENCY_WORKER`.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const url = readFileSync(
  '/private/tmp/claude-501/-Users-lmelane-Documents-beauchoix-projects-catwalks-build/2ee090ff-88d2-4b03-9b91-030edca7855b/scratchpad/dburl',
  'utf8',
).trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });
const lire = (sql) => prisma.$queryRawUnsafe(sql);

/*
 * Les cinq familles lexicales du motif TEMPORARY, comptées SÉPARÉMENT.
 *
 * On cherche dans `rawContract`, le titre ET la description, parce que c'est
 * exactement là que `readEmployment` et `extractEmployment` lisent. Compter sur
 * le seul `rawContract` sous-estimerait : il est NULL sur 82 des 93 offres.
 */
const champ = `lower(coalesce(j."rawContract",'') || ' ' || coalesce(j.title,'') || ' ' || coalesce(j.description,''))`;

const familles = await lire(`
  SELECT
    count(*) FILTER (WHERE ${champ} ~ 'int[eé]rim')::int                       AS "interim",
    count(*) FILTER (WHERE ${champ} ~ 'zero.?hour|z[eé]ro.?heure')::int        AS "zero_hour",
    count(*) FILTER (WHERE ${champ} ~ 'agency worker')::int                    AS "agency_worker",
    count(*) FILTER (WHERE ${champ} ~ 'leiharbeit')::int                       AS "leiharbeit",
    count(*) FILTER (WHERE ${champ} ~ '\\mtemporary\\M')::int                   AS "mot_temporary",
    count(*) FILTER (WHERE ${champ} !~ 'int[eé]rim|zero.?hour|z[eé]ro.?heure|agency worker|leiharbeit')::int AS "aucune_famille",
    count(*)::int                                                              AS "total"
  FROM "Job" j WHERE j."isActive" AND j."employmentTerm" = 'TEMPORARY'`);
console.log('\n=== TEMPORARY : familles lexicales (recouvrantes) ===');
console.table(familles);

console.log('\n=== TEMPORARY : par pays ===');
console.table(await lire(`
  SELECT coalesce(j."countryCode",'(inconnu)') AS pays, count(*)::int AS n
  FROM "Job" j WHERE j."isActive" AND j."employmentTerm" = 'TEMPORARY'
  GROUP BY 1 ORDER BY n DESC`));

console.log('\n=== TEMPORARY : cumul avec les autres dimensions ===');
console.table(await lire(`
  SELECT
    count(*) FILTER (WHERE j."isSeasonal" IS TRUE)::int      AS "aussi_saisonnier",
    count(*) FILTER (WHERE j."programType" IS NOT NULL)::int AS "aussi_programme",
    count(*) FILTER (WHERE j."workTime" IS NOT NULL)::int    AS "rythme_connu",
    count(*)::int                                            AS "total"
  FROM "Job" j WHERE j."isActive" AND j."employmentTerm" = 'TEMPORARY'`));

/*
 * LE CONTRE-CHAMP, et c'est le chiffre qui rend l'arbitrage nécessaire.
 *
 * Combien d'offres NOMMENT l'intérim sans porter TEMPORARY ? Si le gisement
 * réel est beaucoup plus large que 93, alors la valeur ne dit pas « il y a peu
 * d'intérim » mais « nous en détectons peu » — deux conclusions opposées.
 */
console.log('\n=== Le mot « intérim » AILLEURS que dans TEMPORARY ===');
console.table(await lire(`
  SELECT coalesce(j."employmentTerm",'(non renseigné)') AS terme, count(*)::int AS n
  FROM "Job" j
  WHERE j."isActive" AND ${champ} ~ 'int[eé]rim'
  GROUP BY 1 ORDER BY n DESC`));

await prisma.$disconnect();

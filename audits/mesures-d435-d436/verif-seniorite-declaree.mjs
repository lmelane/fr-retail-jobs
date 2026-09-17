/**
 * SÉNIORITÉ — CE QUI EST DÉCLARÉ PAR L'EMPLOYEUR, JAMAIS DÉDUIT DU TITRE.
 *
 * Décision CEO du 15/09/2026, verbatim : « je veux à l'écran des données
 * réelles, jamais de fausses DATA. Si certaines offres ont la séniorité, on la
 * laisse naturellement ; s'il n'y en a pas, on supprime ce filtre tout
 * simplement. On évite la data qui n'existe pas. »
 *
 * Ce script mesure donc DEUX populations distinctes, et ne les mélange jamais :
 *   · DÉDUITE  — `seniorityConfidence = 'TITLE_HEURISTIC'` : du regex sur
 *     l'intitulé. Elle ne compte PAS comme de la donnée.
 *   · DÉCLARÉE — l'expérience écrite par l'employeur dans `raw`. La seule qui
 *     puisse porter une facette.
 *
 * Le seuil d'exposition d'une facette est 0.2 (SEUIL_AFFICHAGE_FACETTE).
 * On l'applique ici à la DÉCLARÉE seule : c'est tout l'objet de la mesure.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/* Les clés d'expérience réellement écrites par les ATS, relevées dans `raw`. */
const CLES = [
  // Relevées par ÉNUMÉRATION de `raw` (verif-cles-raw-experience.mjs), jamais
  // devinées. Une première mesure avec 8 clés choisies d'avance sous-comptait :
  // `careerLevel`, `experienceRequired`, `workExperience`, `experience_code`,
  // `experience_min`/`_max` et `experience_level_minimum` manquaient à l'appel.
  'experienceLevel',            // SmartRecruiters — échelle LinkedIn (6 392)
  'requiredExperience',         // LVMH — valeurs traduites (6 373)
  'requiredExperienceFilter',   // LVMH — années, langue-neutre (5 277)
  'experience_level_minimum',   // entier 0 / 0,5 / 1 / 2 … 10 (1 515)
  'experienceRequired',         // (784)
  'workExperience',             // (784)
  'experience_code',            // (639)
  'experience_min',             // FR (487)
  'experience_max',             // FR (487)
  'careerLevel',                // (397)
  'experience',                 // (337)
  'seniority',                  // (186)
  'yearsOfExperience',          // (142)
  'seniorityLevel', 'experienceRequirements',
];

const clauseDeclaree = CLES.map((k) => `(j.raw -> '${k}') IS NOT NULL`).join(' OR ');

const lignes = await prisma.$queryRawUnsafe(`
  SELECT
    j."countryCode"                                            AS marche,
    count(*)::int                                              AS actives,
    count(*) FILTER (WHERE j.seniority IS NOT NULL)::int        AS avec_seniorite,
    0::int                                                      AS deduite_titre,
    count(*) FILTER (WHERE ${clauseDeclaree})::int              AS declaree_source
  FROM "Job" j
  WHERE j."isActive" = true
    AND j."countryCode" IN ('US','FR','GB','CA','DE','IT','ES','NL','AU','CH','BE','CN')
  GROUP BY j."countryCode"
  ORDER BY actives DESC
`);

console.log('marche | actives | seniorite | deduite titre | DECLAREE | %declaree | facette ?');
let gardeCount = 0;
for (const l of lignes) {
  const pct = l.actives ? l.declaree_source / l.actives : 0;
  const garde = pct >= 0.2;
  if (garde) gardeCount += 1;
  console.log(
    `${l.marche} | ${l.actives} | ${l.avec_seniorite} | ${l.deduite_titre} | ` +
    `${l.declaree_source} | ${(pct * 100).toFixed(1)}% | ${garde ? 'GARDE' : 'SUPPRIME'}`,
  );
}
console.log(`\nmarches ou la facette survit sur donnee DECLAREE : ${gardeCount} / ${lignes.length}`);

await prisma.$disconnect();

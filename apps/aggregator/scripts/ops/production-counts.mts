/**
 * Les six grandeurs qui prouvent qu'une restauration reproduit la production — lecture seule.
 *
 * Les mêmes que celles interrogées sur le clone restauré, dans le même ordre et sous les mêmes noms : une
 * comparaison n'a de valeur que si les deux relevés mesurent exactement la même chose. `activeWithClosedAt`
 * est l'invariant de cycle de vie ; `withCountryIntegrity` dit si la chaîne a déjà écrit des verdicts.
 *
 * Une seule transaction : deux requêtes séparées pourraient lire deux états différents.
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
try {
  const [row] = await p.$queryRaw<Array<Record<string, bigint>>>`
    SELECT (SELECT count(*) FROM "Job" WHERE "isActive")                                  AS "activeJobs",
           (SELECT count(*) FROM "Job")                                                   AS "allJobs",
           (SELECT count(*) FROM "JobSource")                                             AS "jobSources",
           (SELECT count(*) FROM "Source" WHERE status = 'ACTIVE')                        AS "sourcesActive",
           (SELECT count(*) FROM "Source" WHERE status = 'PAUSED')                        AS "sourcesPaused",
           (SELECT count(*) FROM "Job" WHERE "isActive" AND "closedAt" IS NOT NULL)       AS "activeWithClosedAt",
           (SELECT count(*) FROM "Job" WHERE "countryIntegrity" IS NOT NULL)              AS "withCountryIntegrity"`;
  console.log(JSON.stringify(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])), null, 1));
} finally {
  await p.$disconnect();
}

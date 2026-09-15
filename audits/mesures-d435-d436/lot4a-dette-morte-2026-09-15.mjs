// LECTURE SEULE. Aucune écriture. Lot 4A — inventaire des dimensions mortes.
import { readFileSync } from 'node:fs';


const url = readFileSync(
  '/private/tmp/claude-501/-Users-lmelane-Documents-beauchoix-projects-catwalks-build/2ee090ff-88d2-4b03-9b91-030edca7855b/scratchpad/dburl',
  'utf8',
).trim();

import { PrismaClient } from '@prisma/client';
const client = new PrismaClient({ datasources: { db: { url } } });


const q = async (label, sql) => {
  const rows = await client.$queryRawUnsafe(sql);
  console.log(`\n=== ${label} ===`);
  console.table(rows);
};

await q('total actives', `SELECT count(*)::int AS n FROM "Job" WHERE "isActive"`);

await q('engagementType distribution', `
  SELECT "engagementType", count(*)::int AS n
  FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY n DESC NULLS LAST`);

await q('isSeasonal distribution', `
  SELECT "isSeasonal", count(*)::int AS n
  FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY n DESC NULLS LAST`);

await q('employmentTerm distribution', `
  SELECT "employmentTerm", count(*)::int AS n
  FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY n DESC NULLS LAST`);

await q('TEMPORARY par pays', `
  SELECT "countryCode", count(*)::int AS n
  FROM "Job" WHERE "isActive" AND "employmentTerm" = 'TEMPORARY'
  GROUP BY 1 ORDER BY n DESC LIMIT 20`);

await q('TEMPORARY : rawContract brut (ce que la valeur MELANGE)', `
  SELECT lower(trim("rawContract")) AS brut, count(*)::int AS n
  FROM "Job" WHERE "isActive" AND "employmentTerm" = 'TEMPORARY'
  GROUP BY 1 ORDER BY n DESC LIMIT 40`);

await q('TEMPORARY : familles lexicales dans rawContract+title', `
  SELECT
    count(*) FILTER (WHERE lower(coalesce("rawContract",'') || ' ' || coalesce(title,'')) ~ 'interim|intérim|leiharbeit|zeitarbeit|agency worker|temp agency|uitzend')::int AS interim,
    count(*) FILTER (WHERE lower(coalesce("rawContract",'') || ' ' || coalesce(title,'')) ~ 'zero.?hour|zero.?uur')::int AS zero_hour,
    count(*) FILTER (WHERE lower(coalesce("rawContract",'') || ' ' || coalesce(title,'')) ~ 'seasonal|saison')::int AS saisonnier_mot,
    count(*) FILTER (WHERE lower(coalesce("rawContract",'') || ' ' || coalesce(title,'')) ~ 'casual')::int AS casual,
    count(*) FILTER (WHERE "isSeasonal" IS TRUE)::int AS flag_seasonal,
    count(*)::int AS total
  FROM "Job" WHERE "isActive" AND "employmentTerm" = 'TEMPORARY'`);

await q('salaryMin : remplissage + periode + devise', `
  SELECT "salaryPeriod", "salaryCurrency", count(*)::int AS n
  FROM "Job" WHERE "isActive" AND "salaryMin" IS NOT NULL
  GROUP BY 1,2 ORDER BY n DESC LIMIT 25`);

await q('salaryMin aberrants (HOUR mais montant annuel)', `
  SELECT count(*)::int AS n
  FROM "Job" WHERE "isActive" AND "salaryPeriod" = 'HOUR' AND "salaryMin" > 1000`);

await q('workplaceType distribution', `
  SELECT "workplaceType", count(*)::int AS n
  FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY n DESC NULLS LAST`);

await client.$disconnect();

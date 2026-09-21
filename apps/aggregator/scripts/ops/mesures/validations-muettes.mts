/** Les 144 sources muettes ont-elles une validation VALIDATED ? La publication l'exige (ingest.ts:262). */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const parVerdict = await q<{ verdict: string; n: bigint }>(
  `SELECT verdict, count(*) AS n FROM "SourceValidation" GROUP BY verdict ORDER BY 2 DESC`);
console.log('VALIDATIONS, toutes sources :');
for (const r of parVerdict) console.log(`  ${r.verdict.padEnd(14)} ${r.n}`);

const muettes = await q<{ n: bigint }>(
  `WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
        col AS (SELECT DISTINCT "sourceKey" FROM "CaptureBatch")
   SELECT count(*) AS n FROM col WHERE "sourceKey" NOT IN (SELECT "sourceKey" FROM pub)`);
console.log(`\nsources muettes : ${muettes[0].n}`);

const detail = await q<{ etat: string; n: bigint }>(
  `WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
        col AS (SELECT DISTINCT "sourceKey" FROM "CaptureBatch"),
        muettes AS (SELECT "sourceKey" FROM col WHERE "sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
   SELECT CASE
     WHEN v.verdict IS NULL THEN 'AUCUNE VALIDATION'
     ELSE v.verdict END AS etat, count(DISTINCT m."sourceKey") AS n
   FROM muettes m
   LEFT JOIN LATERAL (
     SELECT sv.verdict FROM "SourceValidation" sv
      JOIN "CaptureBatch" b ON b.id = sv."captureBatchId"
      WHERE b."sourceKey" = m."sourceKey" ORDER BY sv."validatedAt" DESC LIMIT 1) v ON true
   GROUP BY 1 ORDER BY 2 DESC`);
console.log('\nETAT DE VALIDATION DES MUETTES :');
for (const r of detail) console.log(`  ${r.etat.padEnd(20)} ${r.n} sources`);
await prisma.$disconnect();

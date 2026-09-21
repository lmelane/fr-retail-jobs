/** Les lots des muettes qui franchissent les 4 conditions de publication : ont-ils été admis ? */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);
const r = await q<{ src: string; lots: bigint; offres: bigint; admissions: bigint }>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT b."sourceKey" AS src, count(*) AS lots, sum(o."extractedCount") AS offres,
         count(a."batchId") AS admissions
    FROM "CaptureBatch" b
    JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
    JOIN "Source" s ON s.key = b."sourceKey"
    LEFT JOIN "SourceIngestionAdmission" a ON a."batchId" = b.id
   WHERE b."sourceKey" IN (SELECT "sourceKey" FROM muettes) AND b.purpose = 'JOBS'
     AND b."sourceRevisionId" IS NOT NULL AND b."accessDecisionId" IS NOT NULL
     AND s.status = 'ACTIVE' AND s."currentRevisionId" = b."sourceRevisionId"
   GROUP BY 1 ORDER BY 3 DESC LIMIT 12`);
console.log('LOTS CONFORMES AUX 4 CONDITIONS, par source :');
console.log('  (admissions = preuve que l\'ingestion a démarré sur ce lot)');
for (const x of r)
  console.log(`  ${x.src.padEnd(30)} ${String(x.lots).padStart(3)} lots ${String(x.offres).padStart(6)} offres  admissions=${x.admissions}`);
await prisma.$disconnect();

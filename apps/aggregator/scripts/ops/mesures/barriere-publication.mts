/**
 * OU LA CHAINE S ARRETE — les quatre conditions de `requireCurrentCaptureRevision`
 * (sourceRevision.ts:34) mesurees sur les lots EXTRACTED des sources muettes.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const r = await q<Record<string, bigint>>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub)),
       lots AS (
         SELECT b.id, b."sourceKey", b."sourceRevisionId", b."accessDecisionId", o."extractedCount"
           FROM "CaptureBatch" b
           JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
          WHERE b."sourceKey" IN (SELECT "sourceKey" FROM muettes) AND b.purpose = 'JOBS')
  SELECT
    count(*) AS lots_extracted,
    count(*) FILTER (WHERE l."sourceRevisionId" IS NULL) AS sans_revision,
    count(*) FILTER (WHERE s.status <> 'ACTIVE') AS source_non_active,
    count(*) FILTER (WHERE l."sourceRevisionId" IS NOT NULL
                       AND s."currentRevisionId" IS DISTINCT FROM l."sourceRevisionId") AS revision_perimee,
    count(*) FILTER (WHERE l."accessDecisionId" IS NULL) AS sans_decision_acces,
    sum(l."extractedCount") AS offres
  FROM lots l JOIN "Source" s ON s.key = l."sourceKey"`);
console.log('═══ LOTS EXTRACTED DES MUETTES : quelle condition echoue ? ═══');
const x = r[0];
for (const [k, v] of Object.entries(x)) console.log(`  ${k.padEnd(22)} ${v}`);

// Combien de lots franchiraient TOUTES les conditions ?
const ok = await q<{ n: bigint; offres: bigint }>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT count(*) AS n, coalesce(sum(o."extractedCount"),0) AS offres
    FROM "CaptureBatch" b
    JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
    JOIN "Source" s ON s.key = b."sourceKey"
   WHERE b."sourceKey" IN (SELECT "sourceKey" FROM muettes) AND b.purpose = 'JOBS'
     AND b."sourceRevisionId" IS NOT NULL AND b."accessDecisionId" IS NOT NULL
     AND s.status = 'ACTIVE' AND s."currentRevisionId" = b."sourceRevisionId"`);
console.log(`\n  lots franchissant les 4 conditions : ${ok[0].n}  (${ok[0].offres} offres)`);
await prisma.$disconnect();

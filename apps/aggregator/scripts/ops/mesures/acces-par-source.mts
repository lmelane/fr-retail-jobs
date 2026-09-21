/**
 * POURQUOI 92 SOURCES ONT COLLECTÉ SANS `accessDecisionId`.
 *
 * `assertSourceAccess` (sourceAccess.ts:19) exige une décision ALLOWED, liée à la RÉVISION
 * COURANTE, non expirée (`validUntil`), et portant la politique et le lecteur du moment.
 * On mesure lequel de ces critères manque — sans jamais rattacher rétroactivement une
 * décision à une collecte qu'elle n'a pas gouvernée.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const r = await q<Record<string, bigint>>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       m AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
              WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub)),
       sansacces AS (SELECT DISTINCT b."sourceKey" AS k
                       FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId" = b.id
                      WHERE b."sourceKey" IN (SELECT k FROM m) AND o.status = 'EXTRACTED'
                        AND b."accessDecisionId" IS NULL)
  SELECT count(*) AS sources,
         count(*) FILTER (WHERE d.id IS NULL) AS aucune_decision,
         count(*) FILTER (WHERE d.id IS NOT NULL AND d.verdict <> 'ALLOWED') AS decision_refusee,
         count(*) FILTER (WHERE d.id IS NOT NULL AND d."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId") AS revision_autre,
         count(*) FILTER (WHERE d.id IS NOT NULL AND d."validUntil" < now()) AS expiree,
         count(*) FILTER (WHERE d.id IS NOT NULL AND d.verdict = 'ALLOWED'
                            AND d."sourceRevisionId" = s."currentRevisionId"
                            AND d."validUntil" >= now()) AS utilisable
    FROM sansacces sa
    JOIN "Source" s ON s.key = sa.k
    LEFT JOIN LATERAL (SELECT * FROM "SourceAccessDecision" x
                        WHERE x."sourceKey" = sa.k ORDER BY x.sequence DESC LIMIT 1) d ON true`);
console.log('═══ 92 SOURCES SANS accessDecisionId — état de leur DERNIÈRE décision ═══\n');
for (const [k, v] of Object.entries(r[0])) console.log(`  ${k.padEnd(20)} ${v}`);

const q2 = await q<{ quand: string; n: bigint }>(`
  SELECT to_char(date_trunc('day', b."startedAt"), 'YYYY-MM-DD') AS quand, count(*) AS n
    FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId" = b.id
   WHERE o.status = 'EXTRACTED' AND b.purpose = 'JOBS' AND b."accessDecisionId" IS NULL
   GROUP BY 1 ORDER BY 1 DESC LIMIT 8`);
console.log('\n  quand ces collectes ont-elles eu lieu ?');
for (const x of q2) console.log(`    ${x.quand}  ${x.n} lots`);
await prisma.$disconnect();

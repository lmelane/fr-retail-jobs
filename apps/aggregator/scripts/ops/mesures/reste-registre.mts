/** Ce qui reste à qualifier dans le registre, groupé par cause, trié par volume. */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const r = await prisma.$queryRawUnsafe<Array<any>>(`
  WITH pretes AS (
    SELECT s.key FROM "Source" s
      JOIN LATERAL (SELECT * FROM "SourceAccessDecision" d WHERE d."sourceKey"=s.key ORDER BY d.sequence DESC LIMIT 1) d ON true
     WHERE s.status='ACTIVE' AND s."portalScope" IN ('SINGLE_BRAND','MULTI_BRAND')
       AND d.verdict='ALLOWED' AND d."sourceRevisionId"=s."currentRevisionId" AND d."validUntil">=now()
       AND s.key NOT IN (SELECT DISTINCT "sourceKey" FROM "JobSource"))
  SELECT CASE
    WHEN s.key IN (SELECT key FROM pretes) THEN 'A. deja traitees (43)'
    WHEN s.key IN (SELECT DISTINCT "sourceKey" FROM "JobSource") THEN 'B. publient deja en production'
    WHEN s.status <> 'ACTIVE' THEN 'C. source non ACTIVE'
    WHEN d.id IS NULL THEN 'D. aucune decision d acces'
    WHEN d."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" THEN 'E. decision sur autre revision'
    WHEN d.verdict <> 'ALLOWED' THEN 'F. acces REFUSE'
    WHEN s."portalScope" IS NULL THEN 'G. portalScope absent'
    ELSE 'H. autre' END AS groupe,
    count(*) AS sources,
    sum((SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
           JOIN "CaptureBatch" b ON b.id=e."batchId" WHERE b."sourceKey"=s.key)) AS annonces
   FROM "Source" s
   LEFT JOIN LATERAL (SELECT * FROM "SourceAccessDecision" x WHERE x."sourceKey"=s.key ORDER BY x.sequence DESC LIMIT 1) d ON true
  GROUP BY 1 ORDER BY 3 DESC NULLS LAST`);
console.log('═══ LE REGISTRE, PAR GROUPE ═══\n');
let tot = 0, ann = 0;
for (const x of r) { tot += Number(x.sources); ann += Number(x.annonces ?? 0);
  console.log(`  ${String(x.sources).padStart(4)} sources  ${String(x.annonces ?? 0).padStart(6)} annonces  ${x.groupe}`); }
console.log(`\n  TOTAL ${tot} sources, ${ann} annonces distinctes`);
await prisma.$disconnect();

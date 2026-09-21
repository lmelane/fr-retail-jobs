/** Les sources prêtes pour une ingestion normale : accès valide, scope renseigné, actives. */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const r = await prisma.$queryRawUnsafe<Array<{ key: string; kind: string; scope: string; maison: string; annonces: bigint }>>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       m AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
              WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT s.key, s.kind, s."portalScope" AS scope, s.maison,
         (SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
            JOIN "CaptureBatch" b2 ON b2.id = e."batchId" WHERE b2."sourceKey" = s.key) AS annonces
    FROM "Source" s
    JOIN LATERAL (SELECT * FROM "SourceAccessDecision" d WHERE d."sourceKey" = s.key
                   ORDER BY d.sequence DESC LIMIT 1) d ON true
   WHERE s.key IN (SELECT k FROM m) AND s.status = 'ACTIVE'
     AND s."portalScope" IN ('SINGLE_BRAND', 'MULTI_BRAND')
     AND d.verdict = 'ALLOWED' AND d."sourceRevisionId" = s."currentRevisionId" AND d."validUntil" >= now()
   ORDER BY 5 DESC`);
console.log(`═══ ${r.length} SOURCES PRÊTES POUR UNE INGESTION NORMALE ═══\n`);
console.log(`  ${'source'.padEnd(28)} ${'famille'.padEnd(26)} ${'scope'.padEnd(13)} ${'annonces'.padStart(8)}`);
for (const x of r.slice(0, 18))
  console.log(`  ${x.key.slice(0, 28).padEnd(28)} ${x.kind.padEnd(26)} ${x.scope.padEnd(13)} ${String(x.annonces).padStart(8)}`);
const parFamille = r.reduce<Record<string, number>>((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {});
console.log(`\n  familles techniques : ${Object.entries(parFamille).map(([k, n]) => `${k}=${n}`).join(', ')}`);
console.log(`  total annonces : ${r.reduce((a, x) => a + Number(x.annonces), 0)}`);
await prisma.$disconnect();

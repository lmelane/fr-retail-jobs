/**
 * POUR CHAQUE SOURCE BLOQUÉE : quelle branche de `resolve.ts` lève, d'après l'état des données ?
 *
 * Le rapport de complétion ne garde que le NOM de la classe, pas le motif détaillé — les six
 * causes de `resolve.ts` y sont indiscernables. On les reconstitue depuis le référentiel :
 * portée du portail, certification, propriétaire déclaré, existence de la Maison.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const r = await q<{
  src: string; scope: string | null; maison: string; annonces: bigint;
  revues: bigint; confirmees: bigint; proprietaire_existe: boolean; alias: bigint;
}>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub)),
       bloquees AS (SELECT DISTINCT b."sourceKey" AS k
                      FROM "SourceIngestionCompletion" c JOIN "CaptureBatch" b ON b.id=c."batchId"
                     WHERE b."sourceKey" IN (SELECT k FROM muettes) AND c."writeFailed" > 0)
  SELECT s.key AS src, s."portalScope"::text AS scope, s.maison,
         (SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
            JOIN "CaptureBatch" b2 ON b2.id=e."batchId" WHERE b2."sourceKey"=s.key) AS annonces,
         (SELECT count(*) FROM "SourceIdentityReview" r WHERE r."sourceKey"=s.key) AS revues,
         (SELECT count(*) FROM "SourceIdentityReview" r2 WHERE r2."sourceKey"=s.key AND r2.verdict='CONFIRMED') AS confirmees,
         EXISTS (SELECT 1 FROM "Company" co WHERE co.name ILIKE s.maison) AS proprietaire_existe,
         (SELECT count(*) FROM "CompanyAlias" a WHERE a."sourceKey"=s.key) AS alias
    FROM "Source" s WHERE s.key IN (SELECT k FROM bloquees)
   ORDER BY 4 DESC`);

console.log(`═══ ${r.length} SOURCES BLOQUÉES SUR L'IDENTITÉ EMPLOYEUR ═══\n`);
console.log(`  ${'source'.padEnd(26)} ${'annonces'.padStart(8)} ${'portalScope'.padEnd(13)} ${'revues'.padStart(6)} ${'confirm'.padStart(6)} ${'maison?'.padStart(7)} ${'alias'.padStart(5)}`);
for (const x of r.slice(0, 20))
  console.log(`  ${x.src.slice(0,26).padEnd(26)} ${String(x.annonces).padStart(8)} ${String(x.scope).padEnd(13)} ${String(x.revues).padStart(6)} ${String(x.confirmees).padStart(6)} ${String(x.proprietaire_existe).padStart(7)} ${String(x.alias).padStart(5)}`);

const tot = r.reduce((a, x) => a + Number(x.annonces), 0);
const sansScope = r.filter(x => x.scope === null);
const sansRevue = r.filter(x => Number(x.revues) === 0);
console.log(`\n  annonces distinctes concernées : ${tot}`);
console.log(`  sources sans portalScope       : ${sansScope.length} (${sansScope.reduce((a,x)=>a+Number(x.annonces),0)} annonces)`);
console.log(`  sources sans AUCUNE revue      : ${sansRevue.length} (${sansRevue.reduce((a,x)=>a+Number(x.annonces),0)} annonces)`);
console.log(`  sources dont la Maison existe  : ${r.filter(x=>x.proprietaire_existe).length}`);
await prisma.$disconnect();

/**
 * `portalScope` — LE VERROU DOMINANT, mesuré.
 *
 * `certifiedPortalIdentity` rend `null` si `portalScope` n'est ni SINGLE_BRAND ni MULTI_BRAND
 * (sourceIdentity.ts:189), et `resolve.ts:42` bloque alors la publication. Ce n'est pas une
 * ambiguïté d'identité : c'est un champ de configuration non renseigné.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const r = await q<{ etat: string; sources: bigint; annonces: bigint }>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       m AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
              WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT coalesce(s."portalScope", '(NULL)') AS etat, count(*) AS sources,
         sum((SELECT count(DISTINCT e."externalId") FROM "SourceExtraction" e
                JOIN "CaptureBatch" b2 ON b2.id = e."batchId" WHERE b2."sourceKey" = s.key)) AS annonces
    FROM "Source" s WHERE s.key IN (SELECT k FROM m) GROUP BY 1 ORDER BY 3 DESC`);
console.log('═══ portalScope SUR LES 144 SOURCES MUETTES ═══\n');
for (const x of r) console.log(`  ${x.etat.padEnd(14)} ${String(x.sources).padStart(4)} sources  ${String(x.annonces).padStart(6)} annonces distinctes`);

// Et sur les sources qui PUBLIENT : le scope est-il toujours renseigné ?
const p = await q<{ etat: string; n: bigint }>(`
  SELECT coalesce(s."portalScope", '(NULL)') AS etat, count(*) AS n
    FROM "Source" s WHERE s.key IN (SELECT DISTINCT "sourceKey" FROM "JobSource") GROUP BY 1 ORDER BY 2 DESC`);
console.log('\n  pour comparaison, les sources qui PUBLIENT :');
for (const x of p) console.log(`    ${x.etat.padEnd(14)} ${x.n} sources`);
await prisma.$disconnect();

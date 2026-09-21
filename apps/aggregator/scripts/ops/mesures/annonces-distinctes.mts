/**
 * COMBIEN D'ANNONCES DISTINCTES — pas combien d'occurrences d'extraction.
 *
 * 88 148 est une somme d'`extractedCount` sur 481 collectes. Une même annonce recollectée six
 * fois y compte six fois. L'espace d'identité réel est `[sourceKey, externalId]`
 * (`@@unique` sur JobSource et RawCapture) : on dédoublonne DANS la source, jamais mondialement.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const MUETTES = `
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))`;

const t = await q<Record<string, bigint>>(`${MUETTES}
  SELECT count(*) AS occurrences_extraction,
         count(*) FILTER (WHERE e."externalId" IS NULL) AS sans_identifiant,
         count(DISTINCT (b."sourceKey", e."externalId")) AS annonces_distinctes,
         count(DISTINCT e."outputHash") AS contenus_distincts
    FROM "SourceExtraction" e
    JOIN "CaptureBatch" b ON b.id = e."batchId"
   WHERE b."sourceKey" IN (SELECT k FROM muettes)`);
console.log('═══ SOURCES SANS PUBLICATION — occurrences vs annonces ═══');
for (const [k, v] of Object.entries(t[0])) console.log(`  ${k.padEnd(24)} ${v}`);

const oc = Number(t[0].occurrences_extraction), an = Number(t[0].annonces_distinctes);
console.log(`\n  ratio occurrences/annonces : ${(oc / an).toFixed(2)}×  (versions successives d'une même annonce)`);

// Ces annonces existent-elles DEJA au catalogue, via une autre source ?
const croise = await q<{ n: bigint }>(`${MUETTES}
  SELECT count(DISTINCT (b."sourceKey", e."externalId")) AS n
    FROM "SourceExtraction" e
    JOIN "CaptureBatch" b ON b.id = e."batchId"
   WHERE b."sourceKey" IN (SELECT k FROM muettes)
     AND e."externalId" IS NOT NULL
     AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."externalId" = e."externalId")`);
console.log(`\n  annonces dont l'externalId existe déjà dans JobSource (autre source) : ${croise[0].n}`);
console.log('    (indice de doublon inter-sources, à confirmer par le contenu — un externalId');
console.log('     seul ne prouve pas l\'identité entre deux portails différents)');
await prisma.$disconnect();

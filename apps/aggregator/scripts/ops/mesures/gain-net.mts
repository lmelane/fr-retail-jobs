/**
 * LE GAIN NET — des occurrences d'extraction aux annonces réellement récupérables.
 *
 * Les sept catégories demandées, chacune mesurée dans l'espace d'identité réel
 * `[sourceKey, externalId]`. On ne dédoublonne JAMAIS mondialement : deux portails peuvent
 * légitimement porter le même `externalId` pour des annonces sans rapport.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

const M = `WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub)),
       annonces AS (
         SELECT DISTINCT b."sourceKey" AS src, e."externalId" AS ext
           FROM "SourceExtraction" e JOIN "CaptureBatch" b ON b.id = e."batchId"
          WHERE b."sourceKey" IN (SELECT k FROM muettes) AND e."externalId" IS NOT NULL)`;

const [t] = await q<Record<string, bigint>>(`${M} SELECT count(*) AS n FROM annonces`);
const total = Number(t.n);

/* Déjà au catalogue : même `externalId` ET même Maison. L'externalId seul ne prouve rien —
 * c'est la paire (identifiant, employeur) qui rend un doublon crédible. */
const [dej] = await q<Record<string, bigint>>(`${M}
  SELECT count(*) AS n FROM annonces a
   WHERE EXISTS (
     SELECT 1 FROM "JobSource" js
       JOIN "Job" j ON j.id = js."jobId"
       JOIN "Company" co ON co.id = j."companyId"
       JOIN "Source" s ON s.key = a.src
      WHERE js."externalId" = a.ext AND co.name ILIKE s.maison)`);

/* La validité : une annonce vue pour la dernière fois il y a longtemps peut être fermée.
 * On distingue la RÉCENCE de la capture, qui ne prouve pas l'ouverture, mais la borne. */
const recence = await q<{ tranche: string; n: bigint }>(`${M},
  vues AS (SELECT a.src, a.ext, max(e."capturedAt") AS derniere
             FROM annonces a
             JOIN "CaptureBatch" b ON b."sourceKey" = a.src
             JOIN "SourceExtraction" e ON e."batchId" = b.id AND e."externalId" = a.ext
            GROUP BY 1, 2)
  SELECT CASE WHEN derniere > now() - interval '2 days' THEN 'vue il y a moins de 2 jours'
              WHEN derniere > now() - interval '7 days' THEN 'vue il y a 2 a 7 jours'
              ELSE 'vue il y a plus de 7 jours' END AS tranche,
         count(*) AS n FROM vues GROUP BY 1 ORDER BY 2 DESC`);

console.log('═══ DES OCCURRENCES AUX ANNONCES RÉCUPÉRABLES ═══\n');
console.log(`  1. occurrences d'extraction, toutes collectes    88148`);
console.log(`  2. ANNONCES DISTINCTES [sourceKey, externalId]   ${total}`);
console.log(`  3. versions successives (ratio)                  ${(88148 / total).toFixed(2)}x`);
console.log(`  4. déjà au catalogue (même ext + même Maison)    ${dej.n}`);
console.log(`\n  5. récence de la dernière capture :`);
for (const r of recence) console.log(`       ${String(r.n).padStart(6)}  ${r.tranche}`);
console.log(`\n  6. gain brut (annonces - déjà présentes)        ${total - Number(dej.n)}`);
console.log(`\n  LIMITES : la récence borne la validité, elle ne la démontre pas. L'état réel`);
console.log(`  (ouverte / fermée) exige de lire le RAW ou de recollecter — non fait ici.`);
await prisma.$disconnect();

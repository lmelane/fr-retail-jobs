/**
 * LE COMPTE RENDU D'INGESTION DES MUETTES — `SourceIngestionCompletion` dit ce que
 * l'ingestion a FAIT de chaque offre : publiée, retenue, en échec d'écriture, ignorée.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
const { prisma } = await ouvrirAccesAudit();
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const tot = await q<Record<string, bigint>>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT count(*) AS lots_avec_completion, sum(c.published) AS publiees, sum(c.held) AS retenues,
         sum(c."writeFailed") AS echecs_ecriture, sum(c.skipped) AS ignorees
    FROM "SourceIngestionCompletion" c
    JOIN "CaptureBatch" b ON b.id = c."batchId"
   WHERE b."sourceKey" IN (SELECT "sourceKey" FROM muettes)`);
console.log('═══ COMPTE RENDU D\'INGESTION DES 144 MUETTES ═══');
for (const [k, v] of Object.entries(tot[0])) console.log(`  ${k.padEnd(22)} ${v}`);

const det = await q<{ src: string; publiees: bigint; retenues: bigint; echecs: bigint; ignorees: bigint }>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT b."sourceKey" AS src, sum(c.published) AS publiees, sum(c.held) AS retenues,
         sum(c."writeFailed") AS echecs, sum(c.skipped) AS ignorees
    FROM "SourceIngestionCompletion" c JOIN "CaptureBatch" b ON b.id = c."batchId"
   WHERE b."sourceKey" IN (SELECT "sourceKey" FROM muettes)
   GROUP BY 1 ORDER BY (sum(c.held) + sum(c."writeFailed") + sum(c.skipped)) DESC LIMIT 12`);
console.log('\n  par source (retenues + échecs + ignorées décroissant) :');
for (const x of det)
  console.log(`  ${x.src.padEnd(28)} publiées=${String(x.publiees).padStart(5)} retenues=${String(x.retenues).padStart(5)} échecs=${String(x.echecs).padStart(5)} ignorées=${String(x.ignorees).padStart(5)}`);
await prisma.$disconnect();

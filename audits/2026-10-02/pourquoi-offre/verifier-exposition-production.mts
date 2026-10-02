/**
 * D-520 §3 — EXPOSÉE = CE QUE SERT LA RECHERCHE, mesuré sur une base servie par une révision antérieure à R-143 §2
 * (la production avant r6 : ni `availabilityHold` ni `publisherClosedAt`). Le prédicat comparé est celui que la
 * recherche de production exécute, recopié mot pour mot de `packages/db/availability.ts` à la révision servie (main
 * `9534573`, `git show 9534573:packages/db/availability.ts`). Lecture seule (transaction READ ONLY). Après r6, la commande
 * `pourquoi-offre --verifier` compare au `publicJobSql` du code courant ; ce script n'a plus d'objet.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { probeExposureSchema, verifyExposedAgainstSearch } from '../../../apps/aggregator/src/coverage/offerExposureReading.js';

const productionPredicate = (job: Prisma.Sql, at: Date) => Prisma.sql`${job}."isActive" AND ${job}."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = ${job}.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > (${at}::timestamptz AT TIME ZONE 'UTC')))`;

const prisma = new PrismaClient({ errorFormat: 'minimal', log: [] });
try {
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const schema = await probeExposureSchema(tx);
    if (schema.availabilityHold) throw new Error('Base à jour de R-143 §2 : utiliser `pourquoi-offre --verifier`.');
    return { schema, ...(await verifyExposedAgainstSearch(tx, { predicate: productionPredicate })) };
  }, { isolationLevel: 'RepeatableRead', timeout: 600_000, maxWait: 10_000 });
  console.log(JSON.stringify(result, null, 2));
  if (result.onlyExposedCount || result.onlyServedCount) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

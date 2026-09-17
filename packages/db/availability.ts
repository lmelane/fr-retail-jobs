import { Prisma } from '@prisma/client';

/** Publisher availability and a declared deadline must both permit publication. */
export function sourceIsAvailable(source: { isActive: boolean; expiresAt?: Date | null }, at = new Date()): boolean {
  return source.isActive && (!source.expiresAt || source.expiresAt > at);
}

export function availableSourceWhere(at = new Date()): Prisma.JobSourceWhereInput {
  return { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] };
}

/** Aggregated listings require at least one usable publication. */
export function publicJobWhere(at = new Date()): Prisma.JobWhereInput {
  return { isActive: true, mergedIntoId: null, sources: { some: availableSourceWhere(at) } };
}

/** Only trusted, static SQL identifiers may be supplied as the alias. */
export function publicJobSql(job: Prisma.Sql, at = new Date()): Prisma.Sql {
  return Prisma.sql`${job}."isActive" AND ${job}."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" available_source WHERE available_source."jobId" = ${job}.id
      AND available_source."isActive" AND (available_source."expiresAt" IS NULL OR available_source."expiresAt" > ${at}))`;
}

import type { Prisma } from '@prisma/client';

/** Retirement drains in-flight writes before making the source unavailable. */
export async function lockSourceWrites(tx: Prisma.TransactionClient, sourceKey: string, exclusive = false): Promise<void> {
  const key = JSON.stringify(['source-write', sourceKey]);
  if (exclusive) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  else await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
}

/** All lifecycle writers share database company IDs, never normalization keys. */
export async function lockCompanyRows(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    const key = JSON.stringify(['company-row', id]);
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

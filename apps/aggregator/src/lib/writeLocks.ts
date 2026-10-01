import type { Prisma } from '@prisma/client';

/**
 * Le budget d'une transaction courte du chemin d'une source : celui de l'écriture d'une offre (`dedup/upsert.ts`).
 *
 * Sans options, Prisma ferme une transaction interactive après 5 s. Ces transactions ne font que prendre un verrou
 * de source et lire ou écrire une ligne, mais elles ATTENDENT ce verrou et la base : au RUN du 01/10/2026, deux sources
 * sont tombées pour une transaction de cette taille close à 5 066 ms (browns-shoes, contrôle avant écriture) et à
 * 7 446 ms (diptyque-workday, décision d'accès), la seconde pendant qu'un service voisin mettait 7 s au lieu d'une
 * à répondre. Une attente de quelques secondes n'est pas une panne ; 30 s reste très en deçà du budget d'une source.
 */
export const SOURCE_WRITE_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

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

export async function lockEmployerCatalogue(tx: Prisma.TransactionClient, exclusive = false) {
  const key = 'employer-identity-catalogue-v1';
  if (exclusive) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  else await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
}

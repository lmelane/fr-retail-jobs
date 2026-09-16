import { Prisma, type Source } from '@prisma/client';

/** Read JSON text so the database driver cannot round numeric config values before hashing. */
export async function readIdentitySource(db: Prisma.TransactionClient, key: string, forUpdate = false): Promise<Source | null> {
  const rows = await db.$queryRaw<(Source & { configText: string })[]>(Prisma.sql`
    SELECT s.*, s.config::text AS "configText" FROM "Source" s WHERE s.key=${key}
    ${forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  if (!rows[0]) return null;
  const { configText, ...source } = rows[0];
  return { ...source, config: JSON.parse(configText) };
}

/** Private reporting inventory uses the same JSON decoding as the review writer. */
export async function readIdentitySources(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<Source[]> {
  const rows = await db.$queryRaw<(Source & { configText: string })[]>`
    SELECT s.*, s.config::text AS "configText" FROM "Source" s ORDER BY s.key`;
  return rows.map(({ configText, ...source }) => ({ ...source, config: JSON.parse(configText) }));
}

import type { Prisma } from '@prisma/client';

/** Resolve preserved posting IDs. Corrupt chains fail explicitly, never as 404. */
export async function canonicalJobId(db: Pick<Prisma.TransactionClient, 'job'>, id: string): Promise<string | null> {
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(id)) throw new Error(`Job redirect cycle: ${id}`);
    seen.add(id);
    const row = await db.job.findUnique({ where: { id }, select: { mergedIntoId: true } });
    if (!row) {
      if (seen.size > 1) throw new Error(`Missing job redirect target: ${id}`);
      return null;
    }
    if (!row.mergedIntoId) return id;
    id = row.mergedIntoId;
  }
}

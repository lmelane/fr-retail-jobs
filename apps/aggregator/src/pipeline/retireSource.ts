import type { PrismaClient } from '@prisma/client';
import { withdrawRetiredSource } from './deactivateSources.js';
import { lockSourceWrites } from '../lib/writeLocks.js';

export type RetireOptions = { externalIdPrefix?: string };

/** Retirement withdraws attestations; it never proves employer closure. */
export async function retireSource(prisma: PrismaClient, sourceKey: string, options: RetireOptions = {}) {
  const prefix = options.externalIdPrefix;
  if (!prefix) await prisma.$transaction(async tx => {
    await lockSourceWrites(tx, sourceKey, true);
    await tx.source.updateMany({ where: { key: sourceKey }, data: { status: 'RETIRED' } });
  }, { maxWait: 10_000, timeout: 30_000 });
  const sourceWhere = { sourceKey, ...(prefix ? { externalId: { startsWith: prefix } } : {}) };
  return { sourceKey, ...await withdrawRetiredSource(prisma, sourceWhere) };
}

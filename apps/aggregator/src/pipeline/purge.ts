import type { PrismaClient } from '@prisma/client';
import { deactivateSources } from './deactivateSources.js';

/** Called only after a complete, trusted collection. Preserve IDs and history. */
export async function purgeStaleForSource(prisma: PrismaClient, sourceKey: string, version: number) {
  return { sourceKey, ...await deactivateSources(prisma, { sourceKey }, { pipelineVersion: { lt: version } }) };
}

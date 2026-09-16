import type { PrismaClient } from '@prisma/client';
import { deactivateAdministrativeSources } from './deactivateSources.js';

/** Called only after a complete, trusted collection. Preserve IDs and history. */
export async function purgeStaleForSource(prisma: PrismaClient, sourceKey: string, version: number) {
  return { sourceKey, ...await deactivateAdministrativeSources(prisma, { sourceKey }, { kind: 'CLOSED' }, { pipelineVersion: { lt: version } }) };
}

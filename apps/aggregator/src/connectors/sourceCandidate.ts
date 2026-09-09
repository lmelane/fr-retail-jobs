import type { Prisma, PrismaClient } from '@prisma/client';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { tenantKeyOf } from './sourceStore.js';
import { sourceIdentityHash } from './sourceIdentity.js';

export type SourceCandidate = {
  key: string; maison: string; kind: string; config: Record<string, unknown>;
  careersDomain: string; tier: 'EMPLOYER_DIRECT' | 'GROUP_OFFICIAL' | 'ATS_OFFICIAL';
};
/** Discovery creates an unqualified candidate. Identity and native execution
 * evidence pass the existing promotion gate separately. Replays cannot overwrite
 * operational settings or resurrect a retired source. */
export async function registerSourceCandidate(prisma: PrismaClient, candidate: SourceCandidate) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.key) || !candidate.maison.trim() || !KIND_TO_ATS[candidate.kind] ||
    !['EMPLOYER_DIRECT','GROUP_OFFICIAL','ATS_OFFICIAL'].includes(candidate.tier) || !Object.keys(candidate.config).length ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(candidate.careersDomain)) throw new Error('Invalid source candidate');
  const tenantKey = tenantKeyOf(candidate.kind, JSON.stringify(candidate.config), candidate.careersDomain, candidate.maison);
  const data = { ...candidate, tenantKey, config: candidate.config as Prisma.InputJsonValue };
  return prisma.$transaction(async tx => {
    await lockSourceWrites(tx, candidate.key, true);
    const previous = await tx.source.findUnique({ where: { key: candidate.key } });
    if (previous) {
      if (sourceIdentityHash(previous) !== sourceIdentityHash({ ...data, config: data.config as Prisma.JsonValue })) throw new Error('Candidate conflicts with existing source; an explicit configuration review is required');
      return { created: false, source: previous };
    }
    const holder = await tx.source.findUnique({ where: { tenantKey } });
    if (holder) throw new Error(`Tenant already registered: ${holder.key}`);
    return { created: true, source: await tx.source.create({ data: { ...data, status: 'DRAFT' } }) };
  });
}

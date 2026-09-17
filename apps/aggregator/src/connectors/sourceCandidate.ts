import type { Prisma, PrismaClient } from '@prisma/client';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { captureConfig } from '../capture/config.js';
import { tenantKeyOf } from './sourceStore.js';
import { sourceIdentityHash } from './sourceIdentity.js';
import { readIdentitySource } from './sourceRegistryRead.js';

export type SourceCandidate = {
  key: string; maison: string; kind: string; config: Record<string, unknown>;
  careersDomain: string; tier: 'EMPLOYER_DIRECT' | 'GROUP_OFFICIAL' | 'ATS_OFFICIAL';
  jobUrlPattern?: string | null;
};

export function parseSourceCandidate(value: unknown): SourceCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid source candidate');
  const v = value as Record<string, unknown>;
  const fields = ['key','maison','kind','config','careersDomain','tier','jobUrlPattern'];
  if (Object.keys(v).some(key => !fields.includes(key)) ||
    typeof v.key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.key) ||
    typeof v.maison !== 'string' || !v.maison.trim() ||
    typeof v.kind !== 'string' || !Object.hasOwn(KIND_TO_ATS, v.kind) ||
    !v.config || typeof v.config !== 'object' || Array.isArray(v.config) ||
    typeof v.tier !== 'string' || !['EMPLOYER_DIRECT','GROUP_OFFICIAL','ATS_OFFICIAL'].includes(v.tier) ||
    typeof v.careersDomain !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(v.careersDomain) ||
    (v.jobUrlPattern != null && (typeof v.jobUrlPattern !== 'string' || !v.jobUrlPattern.trim()))) throw new Error('Invalid source candidate');
  const config = captureConfig(v.config as Record<string, unknown>);
  if (!Object.keys(config).length) throw new Error('Candidate configuration is empty');
  return { key: v.key, maison: v.maison, kind: v.kind, config, careersDomain: v.careersDomain,
    tier: v.tier as SourceCandidate['tier'], jobUrlPattern: v.jobUrlPattern as string | null | undefined ?? null };
}

/** Discovery creates an unqualified DRAFT. Preview checks the same collisions;
 * repeat registration never overwrites settings or resurrects a retired source. */
export async function registerSourceCandidate(prisma: PrismaClient, input: SourceCandidate, apply = true) {
  const candidate = parseSourceCandidate(input);
  const tenantKey = tenantKeyOf(candidate.kind, JSON.stringify(candidate.config), candidate.careersDomain, candidate.maison);
  const data = { ...candidate, tenantKey, config: candidate.config as Prisma.InputJsonValue };
  return prisma.$transaction(async tx => {
    await lockSourceWrites(tx, candidate.key, true);
    const previous = await readIdentitySource(tx, candidate.key, true);
    if (previous) {
      if (sourceIdentityHash(previous) !== sourceIdentityHash({ ...data, config: data.config as Prisma.JsonValue }) ||
        previous.jobUrlPattern !== (candidate.jobUrlPattern ?? null)) throw new Error('Candidate conflicts with existing source; an explicit configuration review is required');
      return { created: false, willCreate: false, key: candidate.key, tenantKey, source: previous };
    }
    const holder = await tx.source.findUnique({ where: { tenantKey } });
    if (holder) throw new Error(`Tenant already registered: ${holder.key}`);
    return { created: apply, willCreate: !apply, key: candidate.key, tenantKey,
      source: apply ? await tx.source.create({ data: { ...data, status: 'DRAFT' } }) : null };
  });
}

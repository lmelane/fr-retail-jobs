import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { smartRecruitersEmployer, type SmartRecruitersPosting } from '../ats/adapters/smartrecruiters.js';
import { resolveCompany } from '../normalize/company.js';
import { blockingKey } from '../dedup/match.js';
import { json, type RepairPlan, type Operation } from './plan.js';

export async function planSmcpRepair(prisma: PrismaClient): Promise<RepairPlan> {
  const source = await prisma.source.findUniqueOrThrow({ where: { key: 'sandro' } });
  const config = source.config as Record<string, unknown>;
  if (config.company !== 'SMCP') throw new Error('SMCP tenant evidence changed');
  const entries = await prisma.jobSource.findMany({ where: { sourceKey: source.key, isActive: true, job: { isActive: true } }, include: { job: { omit: { searchText: true } } } });
  const allowed = new Set(['Sandro', 'Maje', 'Claudie Pierlot', 'Fursac', 'SMCP']);
  const assignment = entries.map(entry => {
    const brand = smartRecruitersEmployer((entry.raw ?? {}) as SmartRecruitersPosting, 'Brands');
    if (brand && !allowed.has(brand)) throw new Error(`Unreviewed SMCP brand ${brand} on ${entry.id}`);
    return { entry, brand, identity: resolveCompany(brand ?? 'SMCP') };
  });
  if (new Set(entries.map(e => e.jobId)).size !== entries.length) throw new Error('Multiple SMCP IDs on one Job require identity repair first');
  const operations: Operation[] = [{ entity: 'Source', id: source.id, before: json(source), patch: {
    maison: 'SMCP (toutes Maisons)', config: { ...config, employerField: 'Brands' },
  }, reason: 'Official SMCP tenant covers five identities; Brands is the explicit brand field' }];
  const targetIds = new Map<string, string>();
  for (const name of allowed) {
    const identity = resolveCompany(name);
    const existing = await prisma.company.findUnique({ where: { fashionjobsUrl: `resolved:${identity.companyId}` } });
    const id = existing?.id ?? `cr${createHash('sha256').update(`SMCP:${identity.companyId}`).digest('hex').slice(0,24)}`;
    const patch = { name: identity.displayName, canonicalKey: identity.companyId, kind: name === 'SMCP' ? 'GROUP' : 'MAISON', sector: 'FASHION', parentGroup: name === 'SMCP' ? null : 'SMCP' };
    if (!existing || Object.entries(patch).some(([key, value]) => (existing as unknown as Record<string, unknown>)[key] !== value)) {
      operations.push({ entity: 'Company', id, before: json(existing), patch: existing ? patch : { ...patch, fashionjobsUrl: `resolved:${identity.companyId}` }, reason: 'Canonical identity documented by official SMCP Brands field and group portfolio' });
    }
    targetIds.set(identity.companyId, id);
  }
  let changedBrand = 0; let unknownBrand = 0;
  for (const { entry, brand, identity } of assignment) {
    const companyId = targetIds.get(identity.companyId)!;
    if (entry.job.companyId === companyId) continue;
    if (entry.job.url !== entry.url) throw new Error(`Another canonical owner requires review: ${entry.jobId}`);
    if (!brand) unknownBrand++; else changedBrand++;
    const clusterKey = blockingKey({ company: identity.displayName, title: entry.job.title, city: entry.job.city ?? undefined, location: entry.job.location ?? undefined, externalId: entry.externalId, sourceKey: entry.sourceKey, sourceTier: 'EMPLOYER_DIRECT', url: entry.url });
    operations.push({ entity: 'Job', id: entry.jobId, before: json(entry.job), patch: {
      companyId, clusterKey, fingerprint: `${clusterKey}|${entry.job.title}`,
      canonicalSourceKey: entry.sourceKey, canonicalExternalId: entry.externalId, canonicalTier: entry.sourceTier,
    }, reason: brand ? `RAW customField[fieldLabel=Brands].valueLabel=${brand}` : 'No proven brand: attach to the proven SMCP group, never infer Sandro' });
  }
  return { version: 1, batchId: '20260908-P0-SMCP-v1', finding: 'P0_SMCP_BRAND', createdAt: new Date().toISOString(),
    sourceKeys: [source.key], companyIds: [...new Set([...entries.map(e => e.job.companyId), ...targetIds.values()])], operations,
    evidence: { officialPortal: 'https://www.smcp.com/en/talents/job-offers/', rawPath: 'customField[fieldLabel=Brands].valueLabel', sourceEntries: entries.length, explicitBrandsReassigned: changedBrand, unknownBrandAssignedToGroup: unknownBrand },
    observations: entries.filter(e => e.raw != null).map(e => ({ sourceKey: e.sourceKey, externalId: e.externalId, raw: e.raw!, observedAt: e.lastSeenAt.toISOString() })),
    invariants: ['oracle', 'lifecycle', 'smcp'],
  };
}

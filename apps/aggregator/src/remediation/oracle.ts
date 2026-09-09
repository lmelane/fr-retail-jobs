import { classifyOccupationContent, occupationState } from '../occupation/persist.js';
import { loadOccupationTaxonomy } from '@catwalks/db/occupations';
import type { PrismaClient, Prisma } from '@prisma/client';
import { postingIdentity, hasRequisitionConflict } from '../dedup/postingIdentity.js';
import { canonicalJobContent } from '../dedup/upsert.js';
import { toCandidate } from '../pipeline/ingest.js';
import { loadTrust } from '../trust/persist.js';
import type { NormalizedJob } from '../types.js';
import { json, type RepairPlan, type Operation, type Row } from './plan.js';

type Evidence = { at: string; declaredTotal: number; listedCount: number; results: {
  id: string; listed: boolean; at: string; hasDetail: boolean; job: NormalizedJob;
}[] };

/** Reattach real representations to their requisition, keeping existing Job IDs. */
export async function planOracleRepair(prisma: PrismaClient, evidence: Evidence): Promise<RepairPlan> {
  const all = await prisma.job.findMany({
    where: { sources: { some: { url: { contains: '.oraclecloud.com/hcmUI/' } } } },
    include: { sources: true, company: true }, omit: { searchText: true },
  });
  const idOf = (url: string) => { const i = postingIdentity(url); return i && `${i.tenant}|${i.requisition}`; };
  const conflicts = all.filter(j => j.isActive && hasRequisitionConflict(j.sources.filter(s => s.isActive).map(s => s.url)));
  if (!conflicts.length) throw new Error('No Oracle conflict; do not generate a second repair');
  const identities = new Set(conflicts.flatMap(j => j.sources.filter(s => s.isActive).map(s => idOf(s.url))).filter((x): x is string => !!x));
  const affected = all.filter(j => j.sources.some(s => s.isActive && identities.has(idOf(s.url) ?? '')));
  const keepers = new Map<string, typeof all[number]>();
  for (const identity of identities) {
    const req = identity.split('|').at(-1)!;
    const eligible = affected.filter(j => j.isActive && j.externalId === req && j.sources.some(s => idOf(s.url) === identity))
      .sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.id.localeCompare(b.id));
    if (!eligible[0]) throw new Error(`No independently identified existing Job for ${identity}`);
    keepers.set(identity, eligible[0]);
  }
  if (new Set([...keepers.values()].map(j => j.id)).size !== identities.size) throw new Error('Ambiguous keeper assignment');
  const sources = affected.flatMap(j => j.sources);
  const operations: Operation[] = [];
  const byProof = new Map(evidence.results.map(r => [r.id, r]));
  const sourceRow = await prisma.source.findUniqueOrThrow({ where: { key: 'tiffany-oracle' } });
  const trust = await loadTrust(prisma);
  const occupations = await loadOccupationTaxonomy(prisma);
  const proofBySource = new Map<string, NormalizedJob>();
  const observations: NonNullable<RepairPlan['observations']> = [];
  for (const [identity] of keepers) {
    const req = identity.split('|').at(-1)!;
    const proof = byProof.get(req);
    if (!proof?.listed || !proof.hasDetail || !proof.job.raw || idOf(proof.job.url) !== identity) throw new Error(`Missing official evidence: ${identity}`);
    const oracle = sources.find(s => s.sourceKey === 'tiffany-oracle' && idOf(s.url) === identity && s.isActive);
    if (!oracle) throw new Error(`No existing Oracle representation: ${identity}`);
    const normalized = { ...proof.job, postedAt: proof.job.postedAt ? new Date(proof.job.postedAt) : undefined };
    proofBySource.set(oracle.id, normalized);
    observations.push({ sourceKey: oracle.sourceKey, externalId: oracle.externalId, raw: normalized.raw as Prisma.InputJsonValue, observedAt: proof.at });
  }
  const afterSources = sources.map(source => {
    const identity = idOf(source.url);
    if (!source.isActive) return source;
    const keeper = identity && keepers.get(identity);
    if (!keeper) throw new Error(`Unreviewed representation on affected Job: ${source.id}`);
    const proof = proofBySource.get(source.id);
    const patch = { jobId: keeper.id, ...(proof ? {
      title: proof.title, raw: proof.raw, postedAt: proof.postedAt ?? null, lastSeenAt: new Date(evidence.at),
    } : {}) };
    if (source.jobId !== keeper.id || proof) operations.push({ entity: 'JobSource', id: source.id, before: json(source), patch: json(patch), reason: `Official Oracle tenant/requisition ${identity}` });
    return { ...source, ...patch };
  });
  for (const job of affected) {
    const { sources: _sources, company, ...before } = job;
    const assigned = [...keepers.entries()].find(([, keeper]) => keeper.id === job.id);
    let patch: Row;
    if (assigned) {
      const oracle = afterSources.find(s => s.jobId === job.id && proofBySource.has(s.id))!;
      const normalized = proofBySource.get(oracle.id)!;
      const candidate = toCandidate(normalized, { key: oracle.sourceKey, company: company.name, tier: 'EMPLOYER_DIRECT' }, company.name, 'ORACLE_HCM', trust);
      patch = json({ ...canonicalJobContent(candidate, occupations),
        // Coordinates/INSEE inherited from another requisition are not evidence.
        inseeCode: null, adminArea2: null, countryIntegrity: null,
        lastSeenAt: new Date(evidence.at), isActive: true, closedAt: null, withdrawnAt: null, withdrawalReason: null,
      });
    } else {
      const own = afterSources.find(s => s.jobId === job.id && s.externalId === job.externalId);
      if (afterSources.some(s => s.jobId === job.id && s.isActive)) throw new Error(`Unassigned live source: ${job.id}`);
      patch = { isActive: false, closedAt: evidence.at, withdrawnAt: null, withdrawalReason: null };
      // A historical old requisition (62948) had inherited a live one's content.
      if (own) Object.assign(patch, {
        title: own.title ?? job.title, url: own.url, canonicalSourceKey: own.sourceKey, canonicalExternalId: own.externalId,
        description: null, location: null, city: null, countryCode: null, isFrance: false,
        adminArea1: null, adminArea2: null, inseeCode: null, postalCode: null, latitude: null, longitude: null,
        employmentTerm: null, workTime: null, programType: null, engagementType: null, isSeasonal: null,
        workplaceType: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null,
        seniority: null, jobFunction: null, department: null, experienceYears: null, educationLevel: null,
        skills: [], isRetail: null, isAiRelated: false, validThrough: null, postedAt: own.postedAt,
        raw: own.raw, clusterKey: null,
      });
    }
    if(!assigned && 'title' in patch) Object.assign(patch,occupationState(classifyOccupationContent({
      title:String(patch.title),department:null,rawTitle:null,
      sourceKey:String(patch.canonicalSourceKey),externalId:String(patch.canonicalExternalId),
    },occupations)));
    operations.push({ entity: 'Job', id: job.id, before: json(before), patch, reason: assigned ? `Reproject only requisition ${assigned[0]} from official evidence` : 'Remove duplicate representation from active catalogue; retain ID and all history' });
  }
  const config = { ...(sourceRow.config as Record<string, unknown>), siteNumber: 'CX' };
  operations.unshift({ entity: 'Source', id: sourceRow.id, before: json(sourceRow), patch: { config }, reason: 'Site CX established by the official URLs; required by the Oracle adapter' });
  return {
    version: 1, batchId: '20260908-P0-ORACLE-v1', finding: 'P0_ORACLE_IDENTITY', createdAt: new Date().toISOString(),
    sourceKeys: [...new Set(sources.map(s => s.sourceKey))], companyIds: [...new Set(affected.map(j => j.companyId))],
    operations, observations, invariants: ['oracle', 'lifecycle'], evidence: {
      officialObservedAt: evidence.at, officialListed: evidence.listedCount, declaredTotal: evidence.declaredTotal,
      conflictsBefore: conflicts.length, distinctRequisitions: identities.size, affectedJobs: affected.length,
      preserve: 'All existing Job/JobSource IDs, firstSeenAt and JobEvent rows; snapshots in DataCorrection',
    },
  };
}

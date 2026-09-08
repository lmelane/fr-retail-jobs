import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { lockCompanyRows, lockSourceWrites } from '../lib/writeLocks.js';
import { hasRequisitionConflict } from '../dedup/postingIdentity.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';
import { smartRecruitersEmployer, type SmartRecruitersPosting } from '../ats/adapters/smartrecruiters.js';
import { resolveCompany } from '../normalize/company.js';
import { leverEmployer, type LeverJob } from '../ats/adapters/lever.js';

export type Entity = 'Job' | 'JobSource' | 'Company' | 'Source';
export type Row = Record<string, unknown>;
export type Operation = { entity: Entity; id: string; before: Row | null; patch: Row; reason: string };
export type RepairPlan = {
  version: 1; batchId: string; finding: string; createdAt: string;
  sourceKeys: string[]; companyIds: string[]; operations: Operation[];
  evidence: Row; invariants: ('oracle' | 'lifecycle' | 'smcp' | 'excluded-identities' | 'source-owners')[];
  excludedSourceKeys?: string[];
  ownerRules?: { sourceKey: string; name: string; departmentMap?: Record<string, string> }[];
  observations?: { sourceKey: string; externalId: string; raw: Prisma.InputJsonValue; observedAt: string }[];
};

export function json<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) => createHash('sha256').update(stable(json(value))).digest('hex');

async function rows(tx: Prisma.TransactionClient, operations: Operation[]): Promise<Map<string, Row>> {
  const result = new Map<string, Row>();
  for (const entity of ['Job', 'JobSource', 'Company', 'Source'] as const) {
    const ids = operations.filter(o => o.entity === entity).map(o => o.id);
    for (let offset = 0; offset < ids.length; offset += 500) {
      const where = { id: { in: ids.slice(offset, offset + 500) } };
      const found = entity === 'Job' ? await tx.job.findMany({ where, omit: { searchText: true } })
        : entity === 'JobSource' ? await tx.jobSource.findMany({ where })
        : entity === 'Company' ? await tx.company.findMany({ where }) : await tx.source.findMany({ where });
      for (const r of found) result.set(`${entity}:${r.id}`, json(r));
    }
  }
  return result;
}

async function write(tx: Prisma.TransactionClient, op: Operation) {
  const patch = { ...op.patch };
  if ('raw' in patch && patch.raw === null) patch.raw = Prisma.DbNull;
  switch (op.entity) {
    case 'Job': return tx.job.update({ where: { id: op.id }, data: patch as Prisma.JobUncheckedUpdateInput });
    case 'JobSource': return tx.jobSource.update({ where: { id: op.id }, data: patch as Prisma.JobSourceUncheckedUpdateInput });
    case 'Source': return tx.source.update({ where: { id: op.id }, data: patch as Prisma.SourceUncheckedUpdateInput });
    case 'Company': return op.before === null
      ? tx.company.create({ data: { ...patch, id: op.id } as Prisma.CompanyUncheckedCreateInput })
      : tx.company.update({ where: { id: op.id }, data: patch as Prisma.CompanyUncheckedUpdateInput });
  }
}

export async function verifyRepair(prisma: Prisma.TransactionClient, invariants: RepairPlan['invariants'], excludedSourceKeys = ['via', 'ashoka'], ownerRules: RepairPlan['ownerRules'] = []) {
  const result: Record<string, number> = {};
  if (invariants.includes('source-owners')) {
    if (!ownerRules.length) throw new Error('Source owner invariant needs reviewed rules');
    for (const rule of ownerRules) {
      const sources = await prisma.jobSource.findMany({ where: { sourceKey: rule.sourceKey, isActive: true, job: { isActive: true } }, select: { id: true, raw: true, job: { select: { company: { select: { canonicalKey: true } } } } } });
      for (const source of sources) {
        const name = leverEmployer((source.raw ?? {}) as LeverJob, rule.departmentMap) ?? rule.name;
        if (source.job.company.canonicalKey !== resolveCompany(name).companyId) throw new Error(`Source owner invariant failed: ${source.id}`);
      }
    }
    result.sourceOwnerContradictions = 0;
  }
  if (invariants.includes('smcp')) {
    const sources = await prisma.jobSource.findMany({ where: { sourceKey: 'sandro', isActive: true, job: { isActive: true } }, select: { id: true, raw: true, job: { select: { company: { select: { canonicalKey: true } } } } } });
    for (const source of sources) {
      const brand = smartRecruitersEmployer((source.raw ?? {}) as SmartRecruitersPosting, 'Brands') ?? 'SMCP';
      if (source.job.company.canonicalKey !== resolveCompany(brand).companyId) throw new Error(`SMCP brand invariant failed: ${source.id}`);
    }
    result.smcpBrandContradictions = 0;
  }
  if (invariants.includes('excluded-identities')) {
    if (!excludedSourceKeys.length) throw new Error('Excluded identity invariant needs reviewed source keys');
    const bad = await prisma.jobSource.findFirst({ where: { sourceKey: { in: excludedSourceKeys }, isActive: true }, select: { id: true } });
    if (bad) throw new Error(`Excluded employer source remains active: ${bad.id}`);
    const source = await prisma.source.findFirst({ where: { key: { in: excludedSourceKeys }, status: { not: 'RETIRED' } }, select: { key: true } });
    if (source) throw new Error(`Excluded employer source not retired: ${source.key}`);
    result.excludedActiveRepresentations = 0;
  }
  if (invariants.includes('oracle')) {
    const jobs = await prisma.job.findMany({
      where: { isActive: true, sources: { some: { url: { contains: '.oraclecloud.com/hcmUI/' } } } },
      select: { id: true, sources: { where: { isActive: true }, select: { url: true } } },
    });
    const bad = jobs.filter(j => hasRequisitionConflict(j.sources.map(s => s.url)));
    result.oracleConflicts = bad.length;
    if (bad.length) throw new Error(`Oracle identity invariant failed: ${bad.map(j => j.id).join(',')}`);
  }
  if (invariants.includes('lifecycle')) {
    const bad = await prisma.job.findFirst({ where: { OR: [
      { isActive: true, closedAt: { not: null } },
      { isActive: false, closedAt: null },
      { isActive: true, sources: { none: { isActive: true } } },
    ] }, select: { id: true } });
    if (bad) throw new Error(`Lifecycle invariant failed: ${bad.id}`);
    result.lifecycleViolations = 0;
  }
  return result;
}

/** A reviewed plan is all-or-nothing. A changed row invalidates the whole plan. */
export async function applyRepairPlan(prisma: PrismaClient, plan: RepairPlan, expectedHash: string, commitHash: string) {
  const hash = digest(plan);
  if (hash !== expectedHash) throw new Error('Plan hash mismatch');
  if (plan.version !== 1 || !plan.operations.length) throw new Error('Empty or unsupported plan');
  if (new Set(plan.operations.map(o => `${o.entity}:${o.id}`)).size !== plan.operations.length) throw new Error('Duplicate operation');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`repair:${plan.batchId}`}, 0))`;
    for (const key of [...new Set(plan.sourceKeys)].sort()) await lockSourceWrites(tx, key, true);
    await lockCompanyRows(tx, plan.companyIds);
    const existing = await tx.dataCorrection.findMany({ where: { batchId: plan.batchId }, select: { planHash: true } });
    if (existing.length) {
      if (existing.length !== plan.operations.length || existing.some(r => r.planHash !== hash)) throw new Error('Correction batch evidence mismatch');
      return { alreadyApplied: true, written: 0, ...await verifyRepair(tx, plan.invariants, plan.excludedSourceKeys, plan.ownerRules) };
    }
    // Validate ALL rows before any write, including rows introduced by the plan.
    const beforeRows = await rows(tx, plan.operations);
    for (const op of plan.operations) {
      const current = beforeRows.get(`${op.entity}:${op.id}`) ?? null;
      if (digest(current) !== digest(op.before)) throw new Error(`Stale plan: ${op.entity}/${op.id}`);
    }
    // Thousands of identity-only corrections share this exact text-field shape.
    // Batch them after creating their target Companies; all before-images were
    // already checked and the entire transaction still rolls back on failure.
    const identityOnly = plan.operations.filter(o => o.entity === 'Job' && Object.keys(o.patch).sort().join(',') === 'clusterKey,companyId,fingerprint' && Object.values(o.patch).every(v => typeof v === 'string'));
    const identityIds = new Set(identityOnly.map(o => o.id));
    for (const op of plan.operations) if (op.entity !== 'Job' || !identityIds.has(op.id)) await write(tx, op);
    for (let offset = 0; offset < identityOnly.length; offset += 500) {
      const updates = JSON.stringify(identityOnly.slice(offset, offset + 500).map(o => ({ id: o.id, ...o.patch })));
      const n = await tx.$executeRaw`UPDATE "Job" j SET "companyId"=v."companyId", "clusterKey"=v."clusterKey", fingerprint=v.fingerprint, "updatedAt"=NOW()
        FROM jsonb_to_recordset(${updates}::jsonb) AS v(id text, "companyId" text, "clusterKey" text, fingerprint text) WHERE j.id=v.id`;
      if (n !== Math.min(500, identityOnly.length - offset)) throw new Error('Identity correction target disappeared');
    }
    for (const observation of plan.observations ?? []) {
      const contentHash = createHash('sha256').update(JSON.stringify(observation.raw)).digest('hex');
      await tx.sourceObservation.upsert({
        where: { sourceKey_externalId_contentHash: { sourceKey: observation.sourceKey, externalId: observation.externalId, contentHash } },
        create: { ...observation, observedAt: new Date(observation.observedAt), contentHash, pipelineVersion: PIPELINE_VERSION }, update: {},
      });
    }
    const records: Prisma.DataCorrectionCreateManyInput[] = [];
    const afterRows = await rows(tx, plan.operations);
    for (const op of plan.operations) {
      const after = afterRows.get(`${op.entity}:${op.id}`)!;
      records.push({ batchId: plan.batchId, planHash: hash, commitHash, finding: plan.finding,
        entityType: op.entity, entityId: op.id,
        before: op.before as Prisma.InputJsonValue ?? Prisma.JsonNull,
        after: after as Prisma.InputJsonValue,
        evidence: { ...plan.evidence, reason: op.reason } as Prisma.InputJsonValue });
    }
    await tx.dataCorrection.createMany({ data: records });
    await tx.jobEvent.createMany({ data: plan.operations.filter(o => o.entity === 'Job').map(o => ({
      jobId: o.id, type: 'CORRECTED', field: plan.finding, after: plan.batchId,
    })) });
    return { alreadyApplied: false, written: records.length, ...await verifyRepair(tx, plan.invariants, plan.excludedSourceKeys, plan.ownerRules) };
  }, { maxWait: 15_000, timeout: 180_000 });
}

import { sourceIdentityHash } from '../connectors/sourceIdentity.js';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { lockCompanyRows, lockSourceWrites, lockEmployerCatalogue } from '../lib/writeLocks.js';
import { employerAliasKey, normalizedEmployerName } from '../normalize/employerName.js';
import { digest, json, stable } from '../remediation/plan.js';
import { validatePostingMerges, type PostingMerge } from './postingRepair.js';

export type EmployerRepairSpec = {
  batchId: string;
  statement: string;
  reviewedBy: string;
  reviewedAt: string;
  evidence: { url: string; sha256: string; artifactText: string; explanation: string }[];
  merges: { fromId: string; toId: string }[];
  postingMerges?: PostingMerge[];
  aliases: { sourceKey: string; rawName: string; companyId: string; legacyAliasId?: string }[];
  companies?: { id: string; name?: string; kind?: 'MAISON' | 'BRAND' | 'GROUP' | 'RETAILER'; parentGroupId?: string | null }[];
};
export type EmployerRepairPlan = EmployerRepairSpec & {
  version: 1; createdAt: string; companyIds: string[]; sourceKeys: string[];
  beforeHash: string; sourceHashes: Record<string, string>; jobCount: number; activeJobCount: number; sourceCount: number;
};


function companyRow<T extends { aliases: unknown }>(company: T): Omit<T, 'aliases'> {
  const { aliases, ...row } = company;
  return row;
}

function validate(spec: EmployerRepairSpec) {
  if (!spec.batchId || !spec.reviewedBy || !spec.statement || !Number.isFinite(Date.parse(spec.reviewedAt))) throw new Error('Incomplete employer review');
  if (!spec.evidence.length) throw new Error('An identity change requires evidence');
  for (const e of spec.evidence) {
    if (!/^https:\/\//.test(e.url) || !e.explanation || !e.artifactText || createHash('sha256').update(e.artifactText).digest('hex') !== e.sha256) throw new Error(`Invalid evidence: ${e.url}`);
  }
  if (new Set(spec.merges.map(m => m.fromId)).size !== spec.merges.length) throw new Error('Repeated merge origin');
  const origins = new Set(spec.merges.map(m => m.fromId));
  if (new Set(spec.aliases.map(a => employerAliasKey(a.sourceKey, a.rawName))).size !== spec.aliases.length) throw new Error('Duplicate scoped alias in plan');
  if (new Set((spec.companies ?? []).map(c => c.id)).size !== (spec.companies ?? []).length) throw new Error('Duplicate company edit in plan');
  for (const m of spec.merges) if (m.fromId === m.toId || origins.has(m.toId)) throw new Error('Merge chains/cycles are forbidden; flatten the reviewed plan');
  if ((spec.companies ?? []).some(c => origins.has(c.id))) throw new Error('Edit canonical targets separately from merged origins');
  for (const a of spec.aliases) if (!a.sourceKey || a.sourceKey === '*' || !normalizedEmployerName(a.rawName) || origins.has(a.companyId)) throw new Error('Alias must target a canonical root');
}

async function snapshot(tx: Prisma.TransactionClient, ids: string[]) {
  const companies = await tx.company.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, include: { aliases: { orderBy: { id: 'asc' } } } });
  if (companies.length !== ids.length) throw new Error('Missing company in repair plan');
  // All offers, including closed ones. Full rows detect edits after planning.
  const jobs = await tx.job.findMany({ where: { companyId: { in: ids } }, orderBy: { id: 'asc' }, omit: { searchText: true }, include: { sources: { orderBy: { id: 'asc' } }, events: { orderBy: { id: 'asc' } } } });
  return { companies, jobs };
}

export async function buildEmployerRepair(prisma: PrismaClient, spec: EmployerRepairSpec): Promise<EmployerRepairPlan> {
  validate(spec);
  const companyIds = [...new Set([...spec.merges.flatMap(m => [m.fromId, m.toId]), ...spec.aliases.map(a => a.companyId), ...(spec.companies ?? []).flatMap(c => [c.id, ...(c.parentGroupId ? [c.parentGroupId] : [])])])].sort();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    // Preserve old URLs/aliases when a previously merged root is merged again.
    // Include all predecessor rows in the reviewed snapshot, then flatten them.
    for (;;) {
      const predecessors = await tx.company.findMany({ where: { mergedIntoId: { in: companyIds }, id: { notIn: companyIds } }, select: { id: true } });
      if (!predecessors.length) break;
      companyIds.push(...predecessors.map(c => c.id)); companyIds.sort();
    }
    const before = await snapshot(tx, companyIds);
    const sourceKeys = [...new Set([...before.jobs.flatMap(j => j.sources.map(s => s.sourceKey)), ...spec.aliases.filter(a => a.sourceKey !== '*').map(a => a.sourceKey)])].sort();
    const catalogue = await tx.source.findMany({ where: { key: { in: sourceKeys } } });
    const sourceHashes = Object.fromEntries(sourceKeys.map(key => { const row=catalogue.find(s=>s.key===key); return [key, row ? sourceIdentityHash(row) : 'UNCATALOGUED']; }));
    return { ...spec, version: 1, sourceHashes, createdAt: new Date().toISOString(), companyIds, sourceKeys, beforeHash: digest(before), jobCount: before.jobs.length, activeJobCount: before.jobs.filter(j => j.isActive).length, sourceCount: before.jobs.reduce((n, j) => n + j.sources.length, 0) };
  }, { isolationLevel: 'RepeatableRead', timeout: 120_000 });
}

/** No deletes or inferred aliases: one atomic, replayable reviewed decision. */
export async function applyEmployerRepair(prisma: PrismaClient, plan: EmployerRepairPlan, expectedHash: string, commitHash: string) {
  validate(plan);
  const planHash = digest(plan);
  if (planHash !== expectedHash || !/^[a-f0-9]{7,40}$/.test(commitHash)) throw new Error('Plan/commit hash mismatch');
  return prisma.$transaction(async tx => {
    await lockEmployerCatalogue(tx, true);
    const previous = await tx.employerIdentityReview.findUnique({ where: { id: plan.batchId } });
    if (previous) {
      if (previous.planHash !== planHash) throw new Error('Batch already applied with different content');
      return { alreadyApplied: true, movedJobs: 0, aliases: 0 };
    }
    for (const key of plan.sourceKeys) await lockSourceWrites(tx, key, true);
    await lockCompanyRows(tx, plan.companyIds);
    const catalogue = await tx.source.findMany({ where: { key: { in: plan.sourceKeys } } });
    for (const key of plan.sourceKeys) {
      const row = catalogue.find(s => s.key === key);
      if (plan.sourceHashes[key] !== (row ? sourceIdentityHash(row) : 'UNCATALOGUED')) throw new Error(`Source identity changed since planning: ${key}`);
    }
    const before = await snapshot(tx, plan.companyIds);
    if (digest(before) !== plan.beforeHash) throw new Error('Employer data changed since planning; rebuild and review');
    const companies = new Map(before.companies.map(c => [c.id, c]));
    const jobsById = new Map(before.jobs.map(j => [j.id, j]));
    const sourcesById = new Map(before.jobs.flatMap(j => j.sources.map(s => [s.id, s] as const)));
    const moves = new Map(plan.merges.map(m => [m.fromId, m.toId]));
    for (const m of plan.merges) {
      if (companies.get(m.fromId)?.mergedIntoId || companies.get(m.toId)?.mergedIntoId) throw new Error('Merge must join current roots');
      const from = companies.get(m.fromId)!, to = companies.get(m.toId)!;
      if ((from.kind === 'GROUP') !== (to.kind === 'GROUP')) throw new Error('A group and its brand cannot be merged');
      if (from.parentGroupId && from.parentGroupId !== to.parentGroupId) throw new Error('Parent relationship conflict requires a separate review');
    }
    const postingMerges = plan.postingMerges ?? [];
    validatePostingMerges(before.jobs, postingMerges, moves);
    const postingTargets = new Map(postingMerges.map(m => [m.fromId, m.toId]));
    // A collision must be covered by explicit RAW witnesses. Existing redirects
    // are historical IDs, not additional canonical postings.
    const keys = new Map<string, string>();
    for (const job of before.jobs) {
      if (job.mergedIntoId) continue;
      const key = JSON.stringify([moves.get(job.companyId) ?? job.companyId, job.source, job.externalId]);
      const other = keys.get(key);
      if (other && (postingTargets.get(other) ?? other) !== (postingTargets.get(job.id) ?? job.id)) throw new Error(`Posting identity collision: ${other}/${job.id}`);
      keys.set(key, job.id);
    }
    for (const a of plan.aliases) {
      const priors = await tx.companyAlias.findMany({ where: { normalizedName: normalizedEmployerName(a.rawName), ...(a.sourceKey === '*' ? {} : { sourceKey: { in: [a.sourceKey, '*'] } }) } });
      for (const prior of priors) {
        const current = companies.get(prior.companyId)?.mergedIntoId ?? prior.companyId;
        if ((moves.get(current) ?? current) !== a.companyId) throw new Error(`Conflicting alias: ${a.sourceKey}/${a.rawName}`);
      }
    }
    // Native witnesses must survive the next source refresh, including legacy
    // representations that predate SourceObservation. Archive the exact reviewed
    // snapshot in the immutable review, not merely a pointer to mutable RAW.
    const nativeWitnesses = new Map<string, (typeof plan.evidence)[number]>();
    for (const decision of postingMerges) for (const witness of decision.witnesses) {
      const source = sourcesById.get(witness.sourceId)!;
      const artifactText = stable(json(source));
      if (!source.url.startsWith('https://')) throw new Error(`Posting witness needs an HTTPS evidence URL: ${source.id}`);
      nativeWitnesses.set(source.id, {
        url: source.url, artifactText, sha256: createHash('sha256').update(artifactText).digest('hex'),
        explanation: `Archived pre-correction representation ${source.id}; source=${source.sourceKey}; externalId=${source.externalId}; issuerPath=${witness.issuerPath.join('.')}; postingIdPath=${witness.postingIdPath.join('.')}. This preserves the stored evidence, not a new source attestation.`,
      });
    }
    await tx.employerIdentityReview.create({ data: { id: plan.batchId, statement: plan.statement, evidence: json([...plan.evidence, ...nativeWitnesses.values()]) as Prisma.InputJsonValue, planHash, reviewedBy: plan.reviewedBy, reviewedAt: new Date(plan.reviewedAt) } });
    let movedJobs = 0;
    for (const job of before.jobs) {
      const companyId = moves.get(job.companyId);
      if (!companyId) continue;
      const key = companies.get(companyId)!.canonicalKey;
      // Prefix only: city/title/fingerprint suffix are preserved byte for byte.
      const rekey = (value: string | null) => value === null ? null : value.includes('|') ? key + value.slice(value.indexOf('|')) : value;
      const patch = { companyId, clusterKey: rekey(job.clusterKey), fingerprint: rekey(job.fingerprint)! };
      await tx.job.update({ where: { id: job.id }, data: patch });
      await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_EMPLOYER_IDENTITY', entityType: 'Job', entityId: job.id, before: { companyId: job.companyId, clusterKey: job.clusterKey, fingerprint: job.fingerprint }, after: patch, evidence: { reviewId: plan.batchId } } });
      await tx.jobEvent.create({ data: { jobId: job.id, type: 'CORRECTED', field: 'companyId', before: job.companyId, after: companyId } });
      movedJobs++;
    }
    for (const decision of postingMerges) {
      const from = jobsById.get(decision.fromId)!;
      // One keeper can absorb several reviewed duplicates. Read its current
      // lifecycle to preserve the union of observations through this transaction.
      const to = await tx.job.findUniqueOrThrow({ where: { id: decision.toId }, omit: { searchText: true } });
      for (const source of from.sources) {
        await tx.jobSource.update({ where: { id: source.id }, data: { jobId: to.id } });
        await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_POSTING_CONSOLIDATION', entityType: 'JobSource', entityId: source.id, before: { jobId: from.id }, after: { jobId: to.id }, evidence: json(decision) as Prisma.InputJsonValue } });
      }
      const patch = {
        firstSeenAt: new Date(Math.min(from.firstSeenAt.getTime(), to.firstSeenAt.getTime())),
        lastSeenAt: new Date(Math.max(from.lastSeenAt.getTime(), to.lastSeenAt.getTime())),
        isActive: from.isActive || to.isActive,
        closedAt: from.isActive || to.isActive ? null : to.closedAt,
      };
      await tx.job.update({ where: { id: to.id }, data: patch });
      await tx.job.update({ where: { id: from.id }, data: { isActive: false, mergedIntoId: to.id, events: { create: { type: 'MERGED', field: 'mergedInto', after: to.id } } } });
      await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_POSTING_CONSOLIDATION', entityType: 'PostingMerge', entityId: from.id, before: json({ from: { isActive: from.isActive, mergedIntoId: from.mergedIntoId }, to: { id: to.id, firstSeenAt: to.firstSeenAt, lastSeenAt: to.lastSeenAt, isActive: to.isActive, closedAt: to.closedAt } }) as Prisma.InputJsonValue, after: json({ from: { isActive: false, mergedIntoId: to.id }, to: { id: to.id, ...patch } }) as Prisma.InputJsonValue, evidence: json(decision) as Prisma.InputJsonValue } });
    }
    for (const m of plan.merges) {
      await tx.company.update({ where: { id: m.fromId }, data: { mergedIntoId: m.toId, identityReviewId: plan.batchId } });
      await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_EMPLOYER_IDENTITY', entityType: 'Company', entityId: m.fromId, before: json(companyRow(companies.get(m.fromId)!)) as Prisma.InputJsonValue, after: json(await tx.company.findUniqueOrThrow({ where: { id: m.fromId } })) as Prisma.InputJsonValue, evidence: { reviewId: plan.batchId } } });
    }
    // A previous A→B proof followed by this B→C proof yields A→C. Keep the
    // previous decision in DataCorrection and preserve both historical labels.
    for (const old of before.companies) {
      const newRoot = moves.get(old.mergedIntoId ?? '');
      if (newRoot && !moves.has(old.id)) {
        await tx.company.update({ where: { id: old.id }, data: { mergedIntoId: newRoot, identityReviewId: plan.batchId } });
        await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_EMPLOYER_IDENTITY', entityType: 'Company', entityId: old.id, before: json(companyRow(old)) as Prisma.InputJsonValue, after: json(await tx.company.findUniqueOrThrow({ where: { id: old.id } })) as Prisma.InputJsonValue, evidence: { reviewId: plan.batchId, transitive: true } } });
      }
      for (const alias of old.aliases) {
        const newCompanyId = moves.get(alias.companyId) ?? newRoot;
        if (!newCompanyId) continue;
        await tx.companyAlias.update({ where: { id: alias.id }, data: { companyId: newCompanyId } });
        await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_EMPLOYER_IDENTITY', entityType: 'CompanyAlias', entityId: alias.id, before: json(alias) as Prisma.InputJsonValue, after: { companyId: newCompanyId }, evidence: { reviewId: plan.batchId } } });
      }
    }
    for (const patch of plan.companies ?? []) {
      const { id, ...data } = patch;
      if (data.parentGroupId && (data.parentGroupId === id || companies.get(data.parentGroupId)?.kind !== 'GROUP')) throw new Error('Parent must be a separate canonical GROUP');
      await tx.company.update({ where: { id }, data: { ...data, identityReviewId: plan.batchId } });
      await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_EMPLOYER_IDENTITY', entityType: 'Company', entityId: id, before: json(companyRow(companies.get(id)!)) as Prisma.InputJsonValue, after: json(await tx.company.findUniqueOrThrow({ where: { id } })) as Prisma.InputJsonValue, evidence: { reviewId: plan.batchId } } });
    }
    let aliases = 0;
    for (const a of plan.aliases) {
      const normalizedName = normalizedEmployerName(a.rawName);
      const prior = await tx.companyAlias.findUnique({ where: { sourceKey_normalizedName: { sourceKey: a.sourceKey, normalizedName } } });
      if (a.legacyAliasId) {
        const legacy = before.companies.flatMap(c => c.aliases).find(alias => alias.id === a.legacyAliasId);
        if (!legacy || legacy.reviewId || legacy.companyId !== a.companyId || normalizedEmployerName(legacy.displayName) !== normalizedName || (prior && prior.id !== legacy.id)) throw new Error('Invalid legacy alias migration');
        const upgraded = await tx.companyAlias.update({ where: { id: legacy.id }, data: { aliasKey: employerAliasKey(a.sourceKey, a.rawName), sourceKey: a.sourceKey, normalizedName, sourceHash: plan.sourceHashes[a.sourceKey], reviewId: plan.batchId } });
        await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_EMPLOYER_IDENTITY', entityType: 'CompanyAlias', entityId: legacy.id, before: json(legacy) as Prisma.InputJsonValue, after: json(upgraded) as Prisma.InputJsonValue, evidence: { reviewId: plan.batchId } } });
      } else if (prior && !prior.reviewId) throw new Error('Legacy alias needs an explicit reviewed migration');
      else if (prior && prior.sourceHash !== plan.sourceHashes[a.sourceKey]) {
        // Rebinding requires a new reviewed plan; preserve the superseded proof
        // and alias ID instead of silently inheriting today's configuration.
        const rebound = await tx.companyAlias.update({ where: { id: prior.id }, data: { sourceHash: plan.sourceHashes[a.sourceKey], reviewId: plan.batchId } });
        await tx.dataCorrection.create({ data: { batchId: plan.batchId, planHash, commitHash, finding: 'LOT1_EMPLOYER_IDENTITY', entityType: 'CompanyAlias', entityId: prior.id, before: json(prior) as Prisma.InputJsonValue, after: json(rebound) as Prisma.InputJsonValue, evidence: { reviewId: plan.batchId } } });
      }
      else if (!prior) {
        await tx.companyAlias.create({ data: { aliasKey: employerAliasKey(a.sourceKey, a.rawName), displayName: a.rawName, normalizedName, sourceKey: a.sourceKey, sourceHash: plan.sourceHashes[a.sourceKey], companyId: a.companyId, reviewId: plan.batchId } });
        aliases++;
      }
    }
    const after = await snapshot(tx, plan.companyIds);
    const expected = new Map(before.jobs.map(j => [j.id, { ...j, sources: [...j.sources], events: [...j.events] }]));
    for (const j of expected.values()) {
      const toId = moves.get(j.companyId);
      if (!toId) continue;
      j.companyId = toId;
      const rekey = (v: string | null) => v === null ? null : v.includes('|') ? companies.get(toId)!.canonicalKey + v.slice(v.indexOf('|')) : v;
      j.clusterKey = rekey(j.clusterKey); j.fingerprint = rekey(j.fingerprint)!;
    }
    for (const d of postingMerges) {
      const from = expected.get(d.fromId)!, to = expected.get(d.toId)!;
      to.sources.push(...from.sources.map(s => ({ ...s, jobId: to.id })));
      to.sources.sort((a, b) => a.id.localeCompare(b.id)); from.sources = [];
      to.firstSeenAt = new Date(Math.min(from.firstSeenAt.getTime(), to.firstSeenAt.getTime()));
      to.lastSeenAt = new Date(Math.max(from.lastSeenAt.getTime(), to.lastSeenAt.getTime()));
      to.isActive ||= from.isActive; if (to.isActive) to.closedAt = null;
      from.isActive = false; from.mergedIntoId = to.id;
    }
    if (before.jobs.length !== after.jobs.length || [...expected.values()].filter(j => j.isActive).length !== after.jobs.filter(j => j.isActive).length) throw new Error('Job conservation failed');
    // Strong invariant: every pre-existing representation, RAW and event survives;
    // every job field outside the allowed identity changes is byte-identical.
    const byId = new Map(after.jobs.map(j => [j.id, j]));
    for (const old of before.jobs) {
      const next = byId.get(old.id);
      if (!next) throw new Error(`Missing job ${old.id}`);
      const strip = ({ updatedAt, events, ...rest }: typeof old) => rest;
      if (stable(json(strip(expected.get(old.id)!))) !== stable(json(strip(next)))) throw new Error(`Unexpected job/RAW/source change: ${old.id}`);
      const preserved = new Map(next.events.map(e => [e.id, stable(json(e))]));
      if (old.events.some(e => preserved.get(e.id) !== stable(json(e)))) throw new Error(`History loss: ${old.id}`);
      if (moves.has(next.companyId)) throw new Error(`Job still references merged employer: ${old.id}`);
    }
    const invalidParent = await tx.company.findFirst({ where: {
      parentGroupId: { not: null }, OR: [{ parent: { kind: { not: 'GROUP' } } }, { parent: { mergedIntoId: { not: null } } }],
    }, select: { id: true } });
    if (invalidParent) throw new Error(`Invalid canonical parent: ${invalidParent.id}`);
    const cycles = await tx.$queryRaw<{ id: string }[]>`WITH RECURSIVE chain AS (
      SELECT id, "parentGroupId" AS next, ARRAY[id] AS path, false AS cycle FROM "Company"
      UNION ALL SELECT c.id, c."parentGroupId", chain.path || c.id, c.id=ANY(chain.path)
      FROM chain JOIN "Company" c ON c.id=chain.next WHERE NOT chain.cycle
    ) SELECT id FROM chain WHERE cycle LIMIT 1`;
    if (cycles.length) throw new Error(`Employer parent cycle: ${cycles[0].id}`);
    return { alreadyApplied: false, movedJobs, aliases };
  }, { maxWait: 15_000, timeout: 180_000 });
}

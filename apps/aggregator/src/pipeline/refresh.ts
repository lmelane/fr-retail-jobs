import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { lockOccupationTaxonomy } from '@catwalks/db/occupations';
import { publicationJobPatch } from '../publication/presentation.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { deployedCommitHash } from '../capture/revision.js';
import { log } from '../observability/logger.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { selectApplySource } from '@catwalks/db/publications';
import { lockSourceWrites, lockCompanyRows } from '../lib/writeLocks.js';
import { chunk } from '../lib/chunk.js';
import { recordEvents, changedEvents, diffStructuralFields, structuralValuesOf } from './jobEvents.js';
import { recordOccupationObservation } from '../occupation/persist.js';
import { deactivateJob, reactivateJob } from './lifecycle.js';
import { readAbsencePlan } from './refreshEvidence.js';
import { availableSourceWhere, sourceIsAvailable } from '@catwalks/db/availability';
import { objectStoreConfigured, objectStoreFromEnv } from '../retention/objectStore.js';
import { randomUUID } from 'node:crypto';
import { quarantineSnapshot, freezeManifest, refreshSnapshot, verifyManifest, REFRESH_LIMITS, type ManifestEntry, type RefreshManifest } from './refreshManifest.js';

/** A fresh, complete enumeration may prove absence; silence alone never does. */
const STALE_HOURS = Number(process.env.REFRESH_STALE_HOURS ?? REFRESH_LIMITS.staleHours);
/** Sealed proofs may already live in the verified cold archive; the reader needs the same store as the writers. */
const proofStore = () => objectStoreConfigured() ? objectStoreFromEnv() : undefined;
const MAX_CLOSE_RATIO = Number(process.env.REFRESH_MAX_CLOSE_RATIO ?? REFRESH_LIMITS.maxCloseRatio);
const MIN_CLOSE_FOR_GUARD = Number(process.env.REFRESH_MIN_CLOSE_FOR_GUARD ?? REFRESH_LIMITS.minCloseForGuard);

export type RefreshOptions = {
  staleHours?: number;
  maxCloseRatio?: number;
  minCloseForGuard?: number;
  /** Undefined is unbounded; an explicit empty list permits no mutation. */
  onlyKeys?: string[];
  /** Reviewed representation IDs are a ceiling, never permission to ignore new evidence. */
  onlySourceIds?: string[];
  /** A frozen deactivation operation cannot withdraw or reopen unrelated jobs. */
  manifest?: RefreshManifest;
};

/** Source keys are validated against the catalogue, including currently empty sources. */
export function refreshScope(keys: string[], raw = process.env.REFRESH_ONLY_KEYS): string[] | undefined {
  if (raw === undefined) return undefined;
  const wanted = (raw ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const known = new Set(keys);
  const unknown = wanted.filter((k) => !known.has(k));
  if (unknown.length > 0) throw new Error(`REFRESH_ONLY_KEYS : clés inconnues — ${unknown.join(', ')}`);
  return [...new Set(wanted)];
}

export type RefreshStats = {
  checked: number;
  closedSources: number;
  closedJobs: number;
  reopened: number;
  withdrawn: number;
  republished: number;
  /** Sources whose current evidence cannot establish absence. */
  unverifiableSources: string[];
  /** True when a mass-closure guard refused the run without closing anything. */
  refused: boolean;
  auditBatchId?: string;
};

export async function readRefreshPlan(prisma: PrismaClient, options: RefreshOptions = {}) {
  if (options.manifest) {
    const check = verifyManifest(options.manifest);
    if (!check.valid) throw new Error(check.problems.join('; '));
    if (options.onlyKeys && evidenceHash([...options.onlyKeys].sort()) !== evidenceHash(options.manifest.allowedSourceKeys)) throw new Error('Manifest source scope mismatch');
    if (options.onlySourceIds !== undefined) throw new Error('A manifest already fixes its representation scope');
    for (const key of ['staleHours', 'maxCloseRatio', 'minCloseForGuard'] as const) {
      if (options[key] !== undefined && options[key] !== options.manifest.limits[key]) throw new Error(`Manifest limit mismatch: ${key}`);
    }
    options = { manifest: options.manifest, onlyKeys: options.manifest.allowedSourceKeys,
      onlySourceIds: options.manifest.entries.map(entry => entry.jobSourceId), ...options.manifest.limits };
  }
  const staleHours = options.staleHours ?? STALE_HOURS;
  const maxCloseRatio = options.maxCloseRatio ?? MAX_CLOSE_RATIO;
  const minCloseForGuard = options.minCloseForGuard ?? MIN_CLOSE_FOR_GUARD;
  if (!Number.isFinite(staleHours) || staleHours <= 0 ||
      !Number.isFinite(maxCloseRatio) || maxCloseRatio < 0 || maxCloseRatio > 1 ||
      !Number.isInteger(minCloseForGuard) || minCloseForGuard < 1) {
    throw new Error('Invalid refresh limits');
  }
  const asOf = new Date();
  const cutoff = new Date(asOf.getTime() - staleHours * 3_600_000);


  /**
   * Le périmètre autorisé, quand une reprise bornée en impose un. `in` est un filtre FERMÉ : une source
   * absente de la liste ne peut être ni désactivée ni fermée, quel que soit son statut ou son ancienneté.
   */
  const allowed = options.onlyKeys !== undefined ? { sourceKey: { in: options.onlyKeys } } : {};
  /**
   * La liste d'identifiants borne les lignes, en plus de l'allowlist par source. Les deux se cumulent :
   * une ligne doit appartenir à une source autorisée ET figurer dans la liste. Une liste VIDE ne signifie
   * pas « aucune borne » — il signifie « rien à désactiver », et `in: []` le traduit exactement.
   */
  const manifested = options.onlySourceIds !== undefined
    ? { id: { in: options.onlySourceIds } } : {};
  const sourceScope: Prisma.JobSourceWhereInput = { AND: [allowed, manifested] };
  const jobScope: Prisma.JobWhereInput = {
    mergedIntoId: null,
    ...((options.onlyKeys !== undefined || options.onlySourceIds !== undefined)
      ? { sources: { some: sourceScope } } : {}),
  };

  const absencePlan = await readAbsencePlan(prisma, sourceScope, cutoff, asOf, proofStore());
  const unverifiableSources = absencePlan.eligibility.filter(source => !source.eligible).map(source => source.source);
  const expiredSources = await prisma.jobSource.findMany({
    where: { AND: [sourceScope, { isActive: true, expiresAt: { lte: asOf } }] },
    select: { id: true, jobId: true, sourceKey: true, externalId: true, lastSeenAt: true, expiresAt: true, expiryEvidence: true },
  });
  const staleSources = [...new Map([
    ...absencePlan.deactivations.map(source => ({ id: source.jobSourceId, jobId: source.jobId })),
    ...expiredSources,
  ].map(source => [source.id, source])).values()];

  // Which jobs WOULD close: those where, after deactivating the stale sources
  // above, no active source would remain. Compute before writing anything so the
  // mass-closure guard can refuse first.
  const staleJobIds = new Set(staleSources.flatMap((s) => s.jobId ? [s.jobId] : []));
  const orphans = options.manifest ? [] : await prisma.job.findMany({
    where: { AND: [jobScope, { isActive: true, sources: { none: { isActive: true } } }] }, select: { id: true },
  });
  const wouldClose: string[] = orphans.map(j => j.id);
  if (staleJobIds.size > 0) {
    for (const ids of chunk([...staleJobIds])) {
    const affected = await prisma.job.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, sources: { select: { id: true, isActive: true, expiresAt: true } } },
    });
    const staleSourceIds = new Set(staleSources.map((s) => s.id));
    for (const job of affected) {
      const remainsActive = job.sources.some((s) => sourceIsAvailable(s, asOf) && !staleSourceIds.has(s.id));
      if (!remainsActive) wouldClose.push(job.id);
    }
    }
  }

  const liveTotal = await prisma.job.count({ where: { isActive: true, mergedIntoId: null,
    ...(options.onlyKeys !== undefined ? { sources: { some: { sourceKey: { in: options.onlyKeys } } } } : {}),
  } });

  const refused = wouldClose.length >= minCloseForGuard && liveTotal > 0 && wouldClose.length / liveTotal > maxCloseRatio;

  const revived = options.manifest ? [] : (await prisma.job.findMany({
    where: { AND: [jobScope, { isActive: false,
      OR: [{ withdrawnAt: null }, { withdrawalReason: 'ATTESTATION_MISSING' }],
      sources: { some: { AND: [sourceScope, availableSourceWhere(asOf), { lastSeenAt: { gte: cutoff } }] } },
    }] }, include: { sources: { omit: { raw: true } } }, omit: { raw: true, searchText: true },
  })).filter(job => canRefreshReactivate(job, cutoff, options, asOf));
  return { sourceScope, jobScope, asOf, cutoff, absencePlan, staleSources, expiredSources, orphans, revived,
    wouldClose, liveTotal, refused, unverifiableSources, options,
    limits: { staleHours, maxCloseRatio, minCloseForGuard } };
}

function plannedEvidence(absence: Awaited<ReturnType<typeof readAbsencePlan>>, expired: { id: string; jobId: string | null; sourceKey: string; externalId: string; lastSeenAt: Date; expiresAt: Date | null; expiryEvidence: unknown }[]) {
  const observed = new Map(absence.representations.map(row => [row.jobSourceId, row]));
  const evidence = new Map<string, Omit<ManifestEntry, 'beforeHash' | 'consequence'>>();
  for (const row of absence.deactivations) {
    const proof = absence.proofs.get(row.sourceKey)!;
    evidence.set(row.jobSourceId, { jobSourceId: row.jobSourceId, jobId: row.jobId, sourceKey: row.sourceKey, externalId: row.externalId,
      observedAt: observed.get(row.jobSourceId)!.lastSeenAt.toISOString(), state: 'ABSENT_FROM_PROVEN_ENUMERATION', proof });
  }
  for (const row of expired) evidence.set(row.id, { jobSourceId: row.id, jobId: row.jobId, sourceKey: row.sourceKey, externalId: row.externalId,
    observedAt: row.lastSeenAt.toISOString(), state: 'DECLARED_DEADLINE_ELAPSED',
    proof: { kind: 'DEADLINE', expiresAt: row.expiresAt!.toISOString(), hash: evidenceHash(row.expiryEvidence) } });
  return evidence;
}

/** Freeze the deactivation subset of the same preview; other lifecycle actions stay separate. */
export async function createRefreshManifest(prisma: PrismaClient, plan: Awaited<ReturnType<typeof readRefreshPlan>>) {
  if (plan.options.onlyKeys === undefined) throw new Error('A bounded manifest requires explicit source keys');
  if (plan.refused) throw new Error('Refresh closure guard refused the preview');
  const evidence = plannedEvidence(plan.absencePlan, plan.expiredSources);
  const entries: ManifestEntry[] = [];
  for (const ids of chunk([...new Set(plan.staleSources.flatMap(source => source.jobId ? [source.jobId] : []))])) {
    const jobs = await prisma.job.findMany({ where: { id: { in: ids } },
      include: { sources: { omit: { raw: true } } }, omit: { raw: true, searchText: true } });
    for (const job of jobs) {
      const beforeHash = evidenceHash(refreshSnapshot(job));
      for (const source of job.sources) {
        const entry = evidence.get(source.id);
        if (!entry) continue;
        entries.push({ ...entry, beforeHash, consequence: !job.isActive ? 'JOB_ALREADY_INACTIVE'
          : plan.wouldClose.includes(job.id) ? 'JOB_CANDIDATE_FOR_CLOSURE' : 'JOB_KEPT_BY_ANOTHER_SOURCE' });
      }
    }
  }
  const quarantined = await prisma.jobSource.findMany({ where: { id: { in: plan.staleSources.filter(source => source.jobId === null).map(source => source.id) }, jobId: null }, omit: { raw: true } });
  for (const source of quarantined) entries.push({ ...evidence.get(source.id)!, beforeHash: evidenceHash(quarantineSnapshot(source)), consequence: 'QUARANTINED_PUBLICATION' });
  return freezeManifest(plan.options.onlyKeys, entries, plan.limits);
}

function canRefreshReactivate(job: { closedAt: Date | null; withdrawnAt: Date | null; withdrawalReason: string | null;
  sources: { id: string; sourceKey: string; isActive: boolean; lastSeenAt: Date; expiresAt: Date | null }[] }, cutoff: Date, options: RefreshOptions, at: Date) {
  if (job.withdrawnAt && job.withdrawalReason !== 'ATTESTATION_MISSING') return false;
  const since = Math.max(cutoff.getTime(), job.closedAt?.getTime() ?? 0, job.withdrawnAt?.getTime() ?? 0);
  return job.sources.some(source => sourceIsAvailable(source, at) && source.lastSeenAt.getTime() >= since &&
    (options.onlyKeys === undefined || options.onlyKeys.includes(source.sourceKey)) &&
    (options.onlySourceIds === undefined || options.onlySourceIds.includes(source.id)));
}

export async function runRefresh(prisma: PrismaClient, options: RefreshOptions = {}): Promise<RefreshStats> {
  assertPipelineRunning();
  const plan = await readRefreshPlan(prisma, options);
  options = plan.options;
  const manifest = options.manifest;
  const auditBatchId = `refresh:${manifest?.planHash ?? randomUUID()}`;
  const store = proofStore();
  const { sourceScope, jobScope, cutoff, staleSources, orphans, revived, unverifiableSources } = plan;
  if (plan.refused) {
    await log.error('refresh.refused', { liveInScope: plan.liveTotal, plannedRemovals: plan.wouldClose.length });
    return { checked: plan.liveTotal, closedSources: 0, closedJobs: 0, reopened: 0, withdrawn: 0,
      republished: 0, unverifiableSources, refused: true };
  }
  const candidates = new Set(manifest ? manifest.entries.flatMap(entry => entry.jobId ? [entry.jobId] : [])
    : [...staleSources.flatMap(source => source.jobId ? [source.jobId] : []), ...orphans.map(job => job.id), ...revived.map(job => job.id)]);
  const closedSources = { count: 0 }, closedJobs = { count: 0 }, reopened = { count: 0 };
  let withdrawn = 0, republished = 0;
  for (const ids of chunk([...candidates], 100)) {
    const planned = await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, companyId: true } });
    const companies = new Map<string, string[]>();
    for (const job of planned) companies.set(job.companyId, [...(companies.get(job.companyId) ?? []), job.id]);
    for (const [companyId, jobIds] of companies) {
      const counts = await prisma.$transaction(async tx => {
        await lockCompanyRows(tx, [companyId]);
        const already = await tx.dataCorrection.findMany({ where: { batchId: auditBatchId, entityType: 'Job', entityId: { in: jobIds } }, select: { entityId: true } });
        const done = new Set(already.map(row => row.entityId));
        const currentJobs = await tx.job.findMany({
          where: { AND: [jobScope, { id: { in: jobIds.filter(id => !done.has(id)) }, companyId }] },
          include: { sources: { omit: { raw: true } } }, omit: { raw: true, searchText: true },
        });
        const before = new Map(currentJobs.map(job => [job.id, refreshSnapshot(job)]));
        const skipped = new Map<string, string>();
        const entriesByJob = new Map<string, ManifestEntry[]>();
        for (const entry of manifest?.entries ?? []) {
          if (!entry.jobId) continue;
          if (!entriesByJob.has(entry.jobId)) entriesByJob.set(entry.jobId, []);
          entriesByJob.get(entry.jobId)!.push(entry);
        }
        for (const job of currentJobs) {
          if (manifest && entriesByJob.get(job.id)?.[0]?.beforeHash !== evidenceHash(before.get(job.id))) skipped.set(job.id, 'BEFORE_STATE_CHANGED');
        }
        const currentIds = currentJobs.filter(job => !skipped.has(job.id)).map(job => job.id);
        const currentIdSet = new Set(currentIds);
        const plannedSourceIds = (manifest?.entries.map(entry => ({ id: entry.jobSourceId, jobId: entry.jobId })) ?? staleSources)
          .filter(source => source.jobId !== null && currentIdSet.has(source.jobId)).map(source => source.id);
        const now = new Date();
        // Re-read the sealed source evidence under the lifecycle locks; the publication
        // gate inside it rechecks registry, access, admission and qualification currency.
        const currentPlan = await readAbsencePlan(tx, { AND: [sourceScope,
          { jobId: { in: currentIds }, id: { in: plannedSourceIds } }] }, cutoff, now, store);
        const expired = await tx.jobSource.findMany({ where: { AND: [sourceScope,
          { jobId: { in: currentIds }, id: { in: plannedSourceIds }, isActive: true, expiresAt: { lte: now } }] },
          select: { id: true, jobId: true, sourceKey: true, externalId: true, lastSeenAt: true, expiresAt: true, expiryEvidence: true } });
        const evidence = plannedEvidence(currentPlan, expired);
        if (manifest) for (const job of currentJobs.filter(job => !skipped.has(job.id))) {
          const expected = entriesByJob.get(job.id)!;
          for (const entry of expected) {
            const { consequence: _consequence, beforeHash: _beforeHash, ...expectedEvidence } = entry;
            if (evidenceHash(evidence.get(entry.jobSourceId) ?? null) !== evidenceHash(expectedEvidence)) skipped.set(job.id, 'EVIDENCE_CHANGED');
          }
          const projected = job.sources.map(source => ({ ...source, isActive: source.isActive && !evidence.has(source.id) }));
          const consequence = !job.isActive ? 'JOB_ALREADY_INACTIVE' : selectApplySource(projected, job, now)
            ? 'JOB_KEPT_BY_ANOTHER_SOURCE' : 'JOB_CANDIDATE_FOR_CLOSURE';
          // The ledger names the root cause: a proof that changed or vanished explains the changed outcome.
          if (!skipped.has(job.id) && expected.some(entry => entry.consequence !== consequence)) skipped.set(job.id, 'OUTCOME_CHANGED');
        }
        const acceptedIds = currentIds.filter(id => !skipped.has(id));
        const deactivated = await tx.jobSource.updateMany({
          where: { AND: [sourceScope, { jobId: { in: acceptedIds }, isActive: true, id: { in: [...evidence.keys()] } }] },
          data: { isActive: false },
        });
        const jobs = await tx.job.findMany({ where: { id: { in: acceptedIds } },
          include: { sources: { omit: { raw: true } } }, omit: { raw: true, searchText: true } });
        let closed = 0, opened = 0, removed = 0, published = 0;
        for (const job of jobs) {
          if (job.withdrawnAt && job.withdrawalReason !== 'ATTESTATION_MISSING') continue;
          const owner = selectApplySource(job.sources, job, now);
          const active = !!owner;
          if (active && !job.isActive && (manifest || !canRefreshReactivate(job, cutoff, options, now))) continue;
          const hasClosureEvidence = [...evidence.values()].some(source => source.jobId === job.id);
          const transition = active ? reactivateJob(job) : deactivateJob(job,
            hasClosureEvidence ? { kind: 'CLOSED' } : { kind: 'WITHDRAWN', reason: 'ATTESTATION_MISSING' }, now);
          const changedOwner = owner && (job.canonicalSourceKey !== owner.sourceKey ||
            job.canonicalExternalId !== owner.externalId || job.url !== owner.url);
          if (!transition && !changedOwner) continue;
          const content = changedOwner ? publicationJobPatch(await tx.jobSource.findUniqueOrThrow({ where: { id: owner.id } }), await lockOccupationTaxonomy(tx)) : {};
          const written = await tx.job.update({ where: { id: job.id }, data: { ...transition?.data, ...content } });
          if (changedOwner) {
            await recordOccupationObservation(tx, written, job);
            await recordEvents(tx, changedEvents(job.id, diffStructuralFields(structuralValuesOf(job), structuralValuesOf(content)), now));
          }
          if (transition) {
            await recordEvents(tx, [{ jobId: job.id, type: transition.type, at: now,
              ...(transition.type === 'WITHDRAWN' ? { after: 'ATTESTATION_MISSING' } : {}) }]);
            if (transition.type === 'REOPENED') opened++;
            else if (transition.type === 'REPUBLISHED') published++;
            else if (transition.type === 'WITHDRAWN') removed++;
            else closed++;
          }
        }
        const after = await tx.job.findMany({ where: { id: { in: currentJobs.map(job => job.id) } },
          include: { sources: { omit: { raw: true } } }, omit: { raw: true, searchText: true } });
        for (const job of after) {
          const beforeState = before.get(job.id)!, afterState = refreshSnapshot(job);
          const changed = evidenceHash(beforeState) !== evidenceHash(afterState);
          if (!changed && !manifest) continue;
          const deactivatedIds = beforeState.sources.filter((source: { id: string; isActive: boolean }) => source.isActive &&
            job.sources.some(afterSource => afterSource.id === source.id && !afterSource.isActive)).map((source: { id: string }) => source.id);
          await tx.dataCorrection.create({ data: { batchId: auditBatchId, planHash: manifest?.planHash ?? evidenceHash({ beforeState, evidence: [...evidence.values()] }),
            commitHash: deployedCommitHash(), finding: 'REFRESH_LIFECYCLE', entityType: 'Job', entityId: job.id,
            before: beforeState, after: afterState,
            evidence: { outcome: skipped.get(job.id) ?? (changed ? 'APPLIED' : 'UNCHANGED'), deactivatedIds,
              proofs: [...evidence.values()].filter(source => source.jobId === job.id), cutoff: cutoff.toISOString() },
          } });
        }
        return { sources: deactivated.count, closed, opened, removed, published };
      }, { maxWait: 10_000, timeout: 30_000 });
      closedSources.count += counts.sources;
      closedJobs.count += counts.closed;
      reopened.count += counts.opened;
      withdrawn += counts.removed;
      republished += counts.published;
    }
  }

  // Quarantine is independent of the public Job lifecycle. Recheck the same
  // absence/deadline evidence under the source lock and journal only this row.
  const detachedIds = manifest ? manifest.entries.filter(entry => entry.jobId === null).map(entry => entry.jobSourceId)
    : staleSources.filter(source => source.jobId === null).map(source => source.id);
  for (const id of detachedIds) {
    const known = await prisma.jobSource.findUnique({ where: { id }, select: { sourceKey: true } });
    if (!known) continue;
    closedSources.count += await prisma.$transaction(async tx => {
      await lockSourceWrites(tx, known.sourceKey, true);
      if (await tx.dataCorrection.count({ where: { batchId: auditBatchId, entityType: 'JobSource', entityId: id } })) return 0;
      const source = await tx.jobSource.findFirst({ where: { AND: [sourceScope, { id, jobId: null }] }, omit: { raw: true } });
      const expected = manifest?.entries.find(entry => entry.jobSourceId === id);
      const before = source ? quarantineSnapshot(source) : { available: false };
      let outcome = !source ? 'MISSING_OR_OUTSIDE_SCOPE' : expected && evidenceHash(before) !== expected.beforeHash ? 'BEFORE_STATE_CHANGED' : 'UNCHANGED';
      let proof: ReturnType<typeof plannedEvidence> extends Map<string, infer T> ? T | undefined : never;
      if (source?.isActive && outcome === 'UNCHANGED') {
        const now = new Date();
        const absence = await readAbsencePlan(tx, { AND: [sourceScope, { id, jobId: null }] }, cutoff, now, store);
        proof = plannedEvidence(absence, source.expiresAt && source.expiresAt <= now ? [source] : []).get(id);
        const expectedProof = expected && (({ beforeHash: _hash, consequence: _outcome, ...value }) => value)(expected);
        if (!proof || expectedProof && evidenceHash(expectedProof) !== evidenceHash(proof)) outcome = 'EVIDENCE_CHANGED';
        else {
          await tx.jobSource.update({ where: { id }, data: { isActive: false } });
          outcome = 'APPLIED';
        }
      }
      if (outcome !== 'APPLIED' && !manifest) return 0;
      await tx.dataCorrection.create({ data: { batchId: auditBatchId,
        planHash: manifest?.planHash ?? evidenceHash({ before, proof: proof ?? null }),
        commitHash: deployedCommitHash(), finding: 'REFRESH_LIFECYCLE',
        entityType: 'JobSource', entityId: id, before,
        after: outcome === 'APPLIED' ? { ...before, isActive: false } : before,
        evidence: { outcome, deactivatedIds: outcome === 'APPLIED' ? [id] : [], proofs: proof ? [proof] : [], cutoff: cutoff.toISOString() } } });
      return outcome === 'APPLIED' ? 1 : 0;
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  if (manifest) {
    const audited = new Set((await prisma.dataCorrection.findMany({ where: { batchId: auditBatchId, entityType: 'Job' }, select: { entityId: true } })).map(row => row.entityId));
    const missing = [...new Set(manifest.entries.flatMap(entry => entry.jobId ? [entry.jobId] : []))].filter(id => !audited.has(id));
    if (missing.length) await prisma.dataCorrection.createMany({ data: missing.map(id => ({
      batchId: auditBatchId, planHash: manifest.planHash, commitHash: deployedCommitHash(),
      finding: 'REFRESH_LIFECYCLE', entityType: 'Job', entityId: id,
      before: { expectedHash: manifest.entries.find(entry => entry.jobId === id)!.beforeHash }, after: { available: false },
      evidence: { outcome: 'MISSING_OR_OUTSIDE_SCOPE', deactivatedIds: [] },
    })), skipDuplicates: true });
  }
  const checked = await prisma.job.count({ where: jobScope });

  return {
    checked,
    closedSources: closedSources.count,
    closedJobs: closedJobs.count,
    reopened: reopened.count,
    withdrawn,
    republished,
    unverifiableSources,
    refused: false,
    auditBatchId,
  };
}

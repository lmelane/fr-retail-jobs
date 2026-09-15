import { Prisma } from '@prisma/client';
import { chunk } from '../lib/chunk.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { identifiersComparable, planRefresh, representationState, sourceEligibility,
  type EnumerationEvidence, type Representation, type RepresentationState, type SourceRunFacts } from './refreshPlan.js';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Decode only the observed posting IDs. Listing/page IDs are not posting IDs. */
export function enumerationEvidence(sourceKey: string, runId: string, payload: unknown): EnumerationEvidence {
  const enumeration = object(object(payload)?.enumeration);
  const pages = Array.isArray(enumeration?.pageEvidence) ? enumeration.pageEvidence : [];
  const ids: string[] = [];
  let declared = pages.length > 0;
  for (const page of pages) {
    const values = object(page)?.canonicalIds;
    if (!Array.isArray(values) || values.some(id => typeof id !== 'string' || !id.trim())) declared = false;
    else ids.push(...values);
  }
  const issues = enumeration?.issues;
  return { sourceKey, runId,
    termination: typeof enumeration?.termination === 'string' ? enumeration.termination : null,
    canonicalSet: [...new Set(ids)], canonicalContractDeclared: declared,
    canonicalContractBroken: Array.isArray(issues) && issues.includes('CANONICAL_ID_CONTRACT_BROKEN'),
    canonicalAbsenceProofUsable: enumeration?.canonicalAbsenceProofUsable !== false,
  };
}

/** The same persisted proof reader is used by preview and by the locked write. */
export async function readAbsencePlan(db: Prisma.TransactionClient, scope: Prisma.JobSourceWhereInput, cutoff: Date, now: Date) {
  const rows = await db.jobSource.findMany({ where: { AND: [scope, { isActive: true }] },
    select: { id: true, jobId: true, sourceKey: true, externalId: true, lastSeenAt: true },
    orderBy: [{ sourceKey: 'asc' }, { externalId: 'asc' }],
  });
  const keys = [...new Set(rows.map(row => row.sourceKey))];
  const runs = keys.length ? await db.$queryRaw<SourceRunFacts[]>`
    SELECT DISTINCT ON ("sourceKey") "sourceKey", "runId", status, errors, truncated, complete,
      "canAttestAbsence", "ranAt" FROM "SourceRun" WHERE "sourceKey" = ANY(${keys})
    ORDER BY "sourceKey", "ranAt" DESC, id DESC` : [];
  const runBy = new Map(runs.map(run => [run.sourceKey, run]));
  const runIds = [...new Set(runs.flatMap(run => run.runId ? [run.runId] : []))];
  const events = runIds.length ? await db.pipelineEvent.findMany({
    where: { sourceKey: { in: keys }, runId: { in: runIds }, event: 'source.enumeration_observed', at: { lte: now } },
    select: { sourceKey: true, runId: true, payload: true }, orderBy: [{ at: 'desc' }, { id: 'desc' }],
  }) : [];
  const evidenceBy = new Map<string, EnumerationEvidence>();
  for (const event of events) {
    if (!event.sourceKey || !event.runId || event.runId !== runBy.get(event.sourceKey)?.runId || evidenceBy.has(event.sourceKey)) continue;
    evidenceBy.set(event.sourceKey, enumerationEvidence(event.sourceKey, event.runId, event.payload));
  }
  const observedBy = new Map([...evidenceBy].map(([key, evidence]) => [key, new Set(evidence.canonicalSet)]));
  const dispositions = runIds.length ? await db.pipelineEvent.findMany({
    where: { sourceKey: { in: keys }, runId: { in: runIds }, event: { in: ['job.write_failed', 'job.publication_held', 'source.rows_rejected'] } },
    select: { sourceKey: true, runId: true, event: true, jobId: true, payload: true },
  }) : [];
  const keyOf = (source: string, id: string) => JSON.stringify([source, id]);
  const held = new Set<string>(), failed = new Set<string>(), rejected = new Set<string>(), anonymous = new Set<string>(), contradictory = new Set<string>();
  for (const event of dispositions) {
    if (!event.sourceKey || event.runId !== runBy.get(event.sourceKey)?.runId) continue;
    if (event.event === 'source.rows_rejected') {
      const rows = object(event.payload)?.rejectedRows;
      if (!Array.isArray(rows)) anonymous.add(event.sourceKey);
      else for (const row of rows) {
        const id = object(row)?.canonicalId;
        if (typeof id === 'string' && id.trim()) {
          rejected.add(keyOf(event.sourceKey, id));
          if (!observedBy.get(event.sourceKey)?.has(id)) contradictory.add(event.sourceKey);
        }
        else anonymous.add(event.sourceKey);
      }
      continue;
    }
    if (!event.jobId) anonymous.add(event.sourceKey);
    else {
      (event.event === 'job.write_failed' ? failed : held).add(keyOf(event.sourceKey, event.jobId));
      if (!observedBy.get(event.sourceKey)?.has(event.jobId)) contradictory.add(event.sourceKey);
    }
  }
  const representations: Representation[] = rows.map(row => ({ ...row, jobSourceId: row.id,
    held: held.has(keyOf(row.sourceKey, row.externalId)), writeFailed: failed.has(keyOf(row.sourceKey, row.externalId)),
    rejected: rejected.has(keyOf(row.sourceKey, row.externalId)) }));
  const storedRows = await db.jobSource.findMany({ where: { sourceKey: { in: keys }, isActive: true },
    select: { sourceKey: true, externalId: true } });
  const storedBy = new Map<string, string[]>();
  for (const row of storedRows) {
    if (!storedBy.has(row.sourceKey)) storedBy.set(row.sourceKey, []);
    storedBy.get(row.sourceKey)!.push(row.externalId);
  }
  const eligibility = keys.map(source => {
    const run = runBy.get(source), evidence = evidenceBy.get(source);
    const result = sourceEligibility(run, evidence);
    if (run && (run.ranAt < cutoff || run.ranAt > now)) result.reasons.push('preuve trop ancienne ou datée dans le futur');
    if (anonymous.has(source)) result.reasons.push('échec, retenue ou rejet sans identifiant de publication');
    if (contradictory.has(source)) result.reasons.push('publication traitée mais absente de l’énumération : preuve contradictoire');
    const observed = observedBy.get(source) ?? new Set<string>();
    const stored = storedBy.get(source) ?? [];
    if (result.eligible && observed.size && !identifiersComparable(observed, stored)) {
      result.reasons.push('identifiants observés incomparables avec ceux stockés');
    }
    return { source, eligible: result.reasons.length === 0, reasons: result.reasons, runId: run?.runId ?? null,
      ranAt: run?.ranAt ?? null, termination: evidence?.termination ?? null };
  });
  const allowed = new Set(eligibility.filter(row => row.eligible).map(row => row.source));
  const states = new Map<string, RepresentationState>();
  for (const rep of representations) {
    states.set(rep.jobSourceId, representationState(rep, observedBy.get(rep.sourceKey) ?? null, allowed.has(rep.sourceKey)));
  }
  const jobIds = [...new Set(rows.flatMap(row => row.jobId ? [row.jobId] : []))];
  const activeByJob = new Map<string, string[]>();
  for (const ids of chunk(jobIds)) {
    const allActive = await db.jobSource.findMany({ where: { jobId: { in: ids }, isActive: true }, select: { id: true, jobId: true } });
    for (const source of allActive) {
      if (!source.jobId) throw new Error('Attached refresh source lost its Job');
      if (!activeByJob.has(source.jobId)) activeByJob.set(source.jobId, []);
      activeByJob.get(source.jobId)!.push(source.id);
    }
  }
  // A re-attestation newer than the proof (or inside the grace window) wins.
  const stale = representations.filter(rep => {
    const run = runBy.get(rep.sourceKey);
    return run && rep.lastSeenAt < cutoff && rep.lastSeenAt < run.ranAt;
  });
  const proofs = new Map(keys.flatMap(key => {
    const run = runBy.get(key), evidence = evidenceBy.get(key);
    return run?.runId && evidence ? [[key, { kind: 'ENUMERATION' as const, runId: run.runId,
      hash: evidenceHash({ run, evidence: { ...evidence, canonicalSet: [...evidence.canonicalSet].sort() } }) }] as const] : [];
  }));
  return { ...planRefresh(stale, states, activeByJob), representations, states, eligibility, proofs };
}

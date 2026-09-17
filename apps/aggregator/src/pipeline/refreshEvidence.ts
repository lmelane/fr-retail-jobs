import type { Prisma } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { chunk } from '../lib/chunk.js';
import { readAttestingCapture, type CaptureDispositions } from './attestingCapture.js';
import { identifiersComparable, planRefresh, representationState, sourceEligibility,
  type Representation, type RepresentationState } from './refreshPlan.js';

export type SourceEligibilityRow = {
  source: string; eligible: boolean; reasons: string[]; captureBatchId: string | null; startedAt: Date | null; termination: string | null;
};

/** Every identifier the capture treated must have been observed, and every observed identifier must have a known fate. */
function dispositionContract(observed: ReadonlySet<string>, dispositions: CaptureDispositions): string[] {
  const reasons: string[] = [];
  const disposed = [dispositions.held, dispositions.writeFailed, dispositions.skipped, dispositions.rejected, dispositions.published];
  if (disposed.some(set => [...set].some(id => !observed.has(id)))) reasons.push('publication traitée mais absente de l’énumération : preuve contradictoire');
  const accounted = new Set(disposed.flatMap(set => [...set]));
  const unknown = [...observed].filter(id => !accounted.has(id));
  if (unknown.length) reasons.push(`${unknown.length} identifiant(s) observé(s) sans devenir connu`);
  return reasons;
}

/** The same persisted proof reader is used by preview and by the locked write. Proof is
 * read from admitted, sealed, completed captures only; health rows and logs never decide. */
export async function readAbsencePlan(db: Prisma.TransactionClient, scope: Prisma.JobSourceWhereInput, cutoff: Date, now: Date, store?: ObjectStore) {
  const rows = await db.jobSource.findMany({ where: { AND: [scope, { isActive: true }] },
    select: { id: true, jobId: true, sourceKey: true, externalId: true, lastSeenAt: true },
    orderBy: [{ sourceKey: 'asc' }, { externalId: 'asc' }],
  });
  const keys = [...new Set(rows.map(row => row.sourceKey))];
  const storedRows = keys.length ? await db.jobSource.findMany({ where: { sourceKey: { in: keys }, isActive: true },
    select: { sourceKey: true, externalId: true } }) : [];
  const storedBy = new Map<string, string[]>();
  for (const row of storedRows) {
    if (!storedBy.has(row.sourceKey)) storedBy.set(row.sourceKey, []);
    storedBy.get(row.sourceKey)!.push(row.externalId);
  }
  const captures = new Map<string, Awaited<ReturnType<typeof readAttestingCapture>>>();
  for (const key of keys) captures.set(key, await readAttestingCapture(db, key, now, store));
  const observedBy = new Map<string, Set<string>>();
  const dispositionsBy = new Map<string, CaptureDispositions>();
  const eligibility: SourceEligibilityRow[] = keys.map(source => {
    const result = captures.get(source)!;
    if (!result.ok) return { source, eligible: false, reasons: result.reasons, captureBatchId: result.captureBatchId, startedAt: null, termination: null };
    const { capture } = result;
    const verdict = sourceEligibility(capture.facts, capture.evidence);
    const reasons = [...verdict.reasons];
    if (capture.startedAt < cutoff || capture.startedAt > now) reasons.push('preuve trop ancienne ou datée dans le futur');
    if (capture.dispositions.anonymous > 0) reasons.push('échec, retenue ou rejet sans identifiant de publication');
    const observed = new Set(capture.evidence.canonicalSet);
    if (capture.evidence.canonicalContractDeclared && !capture.evidence.canonicalContractBroken) reasons.push(...dispositionContract(observed, capture.dispositions));
    const stored = storedBy.get(source) ?? [];
    const disposed = new Set([...capture.dispositions.held, ...capture.dispositions.writeFailed, ...capture.dispositions.skipped, ...capture.dispositions.rejected]);
    if (!reasons.length && observed.size && !identifiersComparable(observed, stored, disposed)) reasons.push('identifiants observés incomparables avec ceux stockés');
    observedBy.set(source, observed);
    dispositionsBy.set(source, capture.dispositions);
    return { source, eligible: reasons.length === 0, reasons, captureBatchId: capture.captureBatchId, startedAt: capture.startedAt, termination: capture.evidence.termination };
  });
  const allowed = new Set(eligibility.filter(row => row.eligible).map(row => row.source));
  const representations: Representation[] = rows.map(row => {
    const dispositions = dispositionsBy.get(row.sourceKey);
    return { ...row, jobSourceId: row.id,
      held: dispositions?.held.has(row.externalId) ?? false, writeFailed: dispositions?.writeFailed.has(row.externalId) ?? false,
      rejected: dispositions?.rejected.has(row.externalId) ?? false, skipped: dispositions?.skipped.has(row.externalId) ?? false };
  });
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
    const result = captures.get(rep.sourceKey);
    return result?.ok && rep.lastSeenAt < cutoff && rep.lastSeenAt < result.capture.startedAt;
  });
  const proofs = new Map(keys.flatMap(key => {
    const result = captures.get(key);
    return result?.ok ? [[key, { kind: 'ENUMERATION' as const, captureBatchId: result.capture.captureBatchId, hash: result.capture.proofHash }] as const] : [];
  }));
  return { ...planRefresh(stale, states, activeByJob), representations, states, eligibility, proofs };
}

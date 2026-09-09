import { Prisma } from '@prisma/client';
import { hasRequisitionConflict } from '../dedup/postingIdentity.js';

export type PostingMerge = {
  fromId: string;
  toId: string;
  // The same issuer and native posting ID must be present in each archived RAW.
  // A vendor ID alone, a shared domain, or a similar title is insufficient.
  issuer: string;
  postingId: string;
  witnesses: { sourceId: string; issuerPath: string[]; postingIdPath: string[] }[];
};
type SnapshotJob = Prisma.JobGetPayload<{ omit: { searchText: true }; include: { sources: true; events: true } }>;

function scalarAt(raw: unknown, path: string[]): string | undefined {
  if (!path.length || path.some(p => !p || ['__proto__', 'constructor', 'prototype'].includes(p))) return;
  let value = raw;
  for (const part of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' && value.trim() ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

/** Fail closed on any unreviewed member of a consolidation, before writing. */
export function validatePostingMerges(jobs: SnapshotJob[], decisions: PostingMerge[], employers: Map<string, string>) {
  const byId = new Map(jobs.map(j => [j.id, j]));
  const origins = new Set(decisions.map(m => m.fromId));
  if (origins.size !== decisions.length) throw new Error('Repeated posting merge origin');
  for (const d of decisions) {
    const from = byId.get(d.fromId), to = byId.get(d.toId);
    if (!from || !to || from.mergedIntoId || to.mergedIntoId || d.fromId === d.toId || origins.has(d.toId)) throw new Error('Posting merge must join snapshotted roots without chains');
    if ((employers.get(from.companyId) ?? from.companyId) !== (employers.get(to.companyId) ?? to.companyId)) throw new Error('Posting merge employer mismatch');
    if (!d.issuer || !d.postingId || from.source !== to.source || d.witnesses.length !== 2) throw new Error('Posting merge requires matching native issuer and ID');
    const witnessed = new Set<string>();
    for (const w of d.witnesses) {
      const job = [from, to].find(j => j.sources.some(s => s.id === w.sourceId));
      const source = job?.sources.find(s => s.id === w.sourceId);
      if (!job || !source || scalarAt(source.raw, w.issuerPath) !== d.issuer || scalarAt(source.raw, w.postingIdPath) !== d.postingId) throw new Error(`Invalid posting RAW witness: ${w.sourceId}`);
      witnessed.add(job.id);
    }
    if (witnessed.size !== 2) throw new Error('Both posting records require a RAW witness');
    if (hasRequisitionConflict([from.url, to.url, ...from.sources.map(s => s.url), ...to.sources.map(s => s.url)])) throw new Error('Posting requisition contradiction');
    if (from.sources.some(s => to.sources.some(t => s.sourceKey === t.sourceKey && s.externalId !== t.externalId))) throw new Error('Distinct postings from the same source');
  }
}

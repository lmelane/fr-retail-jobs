import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { sourceIdentityHash } from '../connectors/sourceIdentity.js';
import { deactivateJob } from '../pipeline/lifecycle.js';
import { json, type RepairPlan } from './plan.js';

export type SourceWithdrawalReview = {
  batchId: string; reviewedAt: string; reviewer: string; statement: string;
  sources: Array<{ sourceKey: string; expectedSourceHash: string; statement: string;
    evidence: Array<{ url: string; artifactText: string; sha256: string; explanation: string }> }>;
};

/** A reviewed invalid board is withdrawn without manufacturing a new employer
 * identity or an employer closure. All decisions use the same immutable repair
 * mechanism, including stale-plan rejection and idempotent replay. */
export async function planReviewedSourceWithdrawal(prisma: PrismaClient, review: SourceWithdrawalReview): Promise<RepairPlan> {
  if (!review.batchId || !review.reviewer.trim() || review.statement.trim().length < 30 || !review.sources.length || !Number.isFinite(Date.parse(review.reviewedAt))) throw new Error('Explicit source withdrawal review required');
  if (new Set(review.sources.map(s => s.sourceKey)).size !== review.sources.length) throw new Error('Duplicate reviewed source');
  for (const source of review.sources) {
    if (source.statement.trim().length < 30 || !source.evidence.length) throw new Error('Archived source evidence required');
    for (const evidence of source.evidence) {
      const url = new URL(evidence.url);
      if (url.protocol !== 'https:' || url.username || url.password || !evidence.artifactText || evidence.explanation.trim().length < 30 || createHash('sha256').update(evidence.artifactText).digest('hex') !== evidence.sha256) throw new Error('Invalid source withdrawal evidence');
    }
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const operations: RepairPlan['operations'] = [], companyIds = new Set<string>(), handled = new Set<string>();
    const sourceKeys = review.sources.map(s => s.sourceKey);
    for (const spec of review.sources) {
      const source = await tx.source.findUniqueOrThrow({ where: { key: spec.sourceKey } });
      if (sourceIdentityHash(source) !== spec.expectedSourceHash) throw new Error(`Source configuration changed: ${source.key}`);
      operations.push({ entity: 'Source', id: source.id, before: json(source), patch: { status: 'RETIRED', note: [source.note, `${review.reviewedAt} ${review.batchId}: ${spec.statement}`].filter(Boolean).join('\n') }, reason: spec.statement });
      const entries = await tx.jobSource.findMany({ where: { sourceKey: source.key }, include: { job: { omit: { searchText: true }, include: { sources: true } } } });
      for (const { job, ...entry } of entries) {
        if (entry.isActive) operations.push({ entity: 'JobSource', id: entry.id, before: json(entry), patch: { isActive: false }, reason: spec.statement });
        if (handled.has(job.id)) continue;
        handled.add(job.id); companyIds.add(job.companyId);
        // Another valid representation may warrant keeping the opening and
        // promoting its content. That requires a separate content authority review.
        if (job.isActive && job.sources.some(s => s.isActive && !sourceKeys.includes(s.sourceKey))) throw new Error(`Competing active source requires content review: ${job.id}`);
        if (job.isActive && new Date(review.reviewedAt) < job.firstSeenAt) throw new Error(`Withdrawal predates observation: ${job.id}`);
        const transition = deactivateJob(job, { kind: 'WITHDRAWN', reason: 'SOURCE_RETIRED' }, new Date(review.reviewedAt));
        if (!transition) continue;
        const { sources: _sources, ...before } = job;
        operations.push({ entity: 'Job', id: job.id, before: json(before), patch: transition.data, reason: spec.statement });
      }
    }
    return { version: 1, batchId: review.batchId, finding: 'REVIEWED_INVALID_SOURCE_CONTENT', createdAt: new Date().toISOString(), sourceKeys, companyIds: [...companyIds], operations,
      reviewDocument: { statement: review.statement, reviewedBy: review.reviewer, reviewedAt: review.reviewedAt, evidence: review.sources.flatMap(s => s.evidence) },
      evidence: { reason: review.statement, reviewedAt: review.reviewedAt, sourceConfigurations: review.sources.map(s => ({ sourceKey: s.sourceKey, expectedSourceHash: s.expectedSourceHash })), preservation: 'No employer reassignment or deletion. Job IDs, RAW, historical events and true employer closures retained.' },
      invariants: ['lifecycle', 'excluded-identities'], excludedSourceKeys: sourceKeys };
  }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
}

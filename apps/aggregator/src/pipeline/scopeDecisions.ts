import type { PrismaClient } from '@prisma/client';
import type { NormalizedJob } from '../types.js';

/**
 * Sector-perimeter decisions per posting (D59 follow-up, 2026-09-10): Aptar publishes Beauty AND
 * Pharma-only postings on one portal, URBN publishes its restaurants next to its fashion brands.
 * The catalogue keeps reading every posting (collection), a reviewed decision says which ones the
 * product publishes (publication), and the two never mix: an OUT_OF_SCOPE decision turns the posting
 * into a publication hold with an explicit withdrawal time, so the existing hold machinery archives
 * the raw payload, withdraws the representation as OUT_OF_SCOPE and never re-attests it. IN_SCOPE and
 * UNDETERMINED decisions change nothing at ingest: an undetermined posting stays published.
 */
export const SCOPE_HOLD = 'SCOPE_OUT_OF_PERIMETER';

export type ScopeExclusion = { externalId: string; ruleVersion: string; decidedAt: Date };

/** Loaded once per source run (never one query per posting). A registry failure excludes nothing. */
export async function loadScopeExclusions(prisma: PrismaClient, sourceKey: string): Promise<Map<string, ScopeExclusion>> {
  try {
    const rows = await prisma.postingScopeDecision.findMany({ where: { sourceKey, verdict: 'OUT_OF_SCOPE' }, select: { externalId: true, ruleVersion: true, decidedAt: true } });
    return new Map(rows.map((r) => [r.externalId, r]));
  } catch {
    return new Map();
  }
}

/** The posting keeps its raw payload and identity; only its publication is withheld, dated by the decision. */
export function applyScopeExclusion(job: NormalizedJob, exclusions: Map<string, ScopeExclusion>): NormalizedJob {
  const decision = exclusions.get(job.externalId);
  if (!decision || job.publicationHold) return job;
  return { ...job, publicationHold: SCOPE_HOLD, publicationWithdrawnAt: decision.decidedAt, raw: { ...(job.raw as Record<string, unknown> | undefined), scopeDecision: { verdict: 'OUT_OF_SCOPE', ruleVersion: decision.ruleVersion, decidedAt: decision.decidedAt.toISOString() } } };
}

export type SourceTier = 'EMPLOYER_DIRECT' | 'GROUP_OFFICIAL' | 'ATS_OFFICIAL' | 'SPECIALIST_JOBBOARD' | 'AGGREGATOR';
export const SOURCE_PRIORITY: readonly SourceTier[] = ['EMPLOYER_DIRECT', 'GROUP_OFFICIAL', 'ATS_OFFICIAL', 'SPECIALIST_JOBBOARD', 'AGGREGATOR'];
import { sourceIsAvailable } from './availability.ts';

export type ApplySource = {
  sourceKey: string;
  externalId: string;
  sourceTier: string;
  isActive: boolean;
  expiresAt?: Date | null;
  url: string;
};

/** Preserve the current owner on ties; choose deterministically otherwise. */
export function selectApplySource<T extends ApplySource>(
  sources: readonly T[],
  current: { canonicalSourceKey?: string | null; canonicalExternalId?: string | null; url?: string | null },
  at = new Date(),
): T | undefined {
  const rank = (tier: string) => {
    const n = SOURCE_PRIORITY.indexOf(tier as typeof SOURCE_PRIORITY[number]);
    return n < 0 ? SOURCE_PRIORITY.length : n;
  };
  const live = sources.filter(s => sourceIsAvailable(s, at)).sort((a, b) =>
    rank(a.sourceTier) - rank(b.sourceTier) ||
    a.sourceKey.localeCompare(b.sourceKey) || a.externalId.localeCompare(b.externalId),
  );
  const first = live[0];
  if (!first) return undefined;
  const owner = current.canonicalSourceKey && current.canonicalExternalId
    ? live.find(s => s.sourceKey === current.canonicalSourceKey && s.externalId === current.canonicalExternalId)
    : live.find(s => s.url === current.url);
  return owner && rank(owner.sourceTier) === rank(first.sourceTier) ? owner : first;
}

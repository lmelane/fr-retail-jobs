import { SOURCE_PRIORITY } from './match.js';

export type CanonicalSource = {
  sourceKey: string;
  externalId: string;
  sourceTier: string;
  isActive: boolean;
  url: string;
};

/** Preserve the current owner on ties; choose deterministically otherwise. */
export function selectCanonicalSource<T extends CanonicalSource>(
  sources: readonly T[],
  current: { canonicalSourceKey?: string | null; canonicalExternalId?: string | null; url?: string | null },
): T | undefined {
  const rank = (tier: string) => {
    const n = SOURCE_PRIORITY.indexOf(tier as typeof SOURCE_PRIORITY[number]);
    return n < 0 ? SOURCE_PRIORITY.length : n;
  };
  const live = sources.filter(s => s.isActive).sort((a, b) =>
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

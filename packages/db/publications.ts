export type SourceTier = 'EMPLOYER_DIRECT' | 'GROUP_OFFICIAL' | 'ATS_OFFICIAL' | 'SPECIALIST_JOBBOARD' | 'AGGREGATOR';
export const SOURCE_PRIORITY: readonly SourceTier[] = ['EMPLOYER_DIRECT', 'GROUP_OFFICIAL', 'ATS_OFFICIAL', 'SPECIALIST_JOBBOARD', 'AGGREGATOR'];
/** R-143 §3 : la source officielle de la Maison, son ATS ou son portail. Un job board et un agrégateur n'en sont pas. */
export const OFFICIAL_TIERS: ReadonlySet<string> = new Set<SourceTier>(['EMPLOYER_DIRECT', 'GROUP_OFFICIAL', 'ATS_OFFICIAL']);
import { sourceIsAvailable } from './availability.ts';

export type ApplySource = {
  sourceKey: string;
  externalId: string;
  sourceTier: string;
  isActive: boolean;
  expiresAt?: Date | null;
  url: string;
};

const rank = (tier: string) => {
  const n = SOURCE_PRIORITY.indexOf(tier as typeof SOURCE_PRIORITY[number]);
  return n < 0 ? SOURCE_PRIORITY.length : n;
};

/** Preserve the current owner on ties; choose deterministically otherwise. */
export function selectApplySource<T extends ApplySource>(
  sources: readonly T[],
  current: { canonicalSourceKey?: string | null; canonicalExternalId?: string | null; url?: string | null },
  at = new Date(),
): T | undefined {
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

export type AuthoritySource = ApplySource & { publisherClosedAt?: Date | null };

/**
 * R-143 §3 (D-513) — LA FERMETURE PAR LA SOURCE OFFICIELLE FAIT FOI.
 *
 * Rend la représentation officielle dont la source a elle-même prouvé la fin (`publisherClosedAt` : absence d'une
 * énumération prouvée, retrait natif « fermée », ou échéance déclarée atteinte) quand elle est de rang STRICTEMENT
 * supérieur à toutes les représentations encore disponibles : une source de rang inférieur (un job board, ou un
 * portail officiel de rang inférieur) ne maintient plus l'offre en vie. Rien quand une représentation de même rang
 * ou de rang supérieur reste disponible, ou quand la fin n'est pas prouvée par la source (retrait administratif d'une
 * source, retenue, quarantaine) : ces gestes ne disent rien de l'offre de la Maison.
 *
 * L'offre se rouvre d'elle-même quand l'officiel la republie : la représentation redevient disponible et l'écrivain
 * efface `publisherClosedAt` (`dedup/upsert.ts`).
 */
export function authorityClosure<T extends AuthoritySource>(sources: readonly T[], at = new Date()): T | undefined {
  const best = Math.min(...sources.filter(s => sourceIsAvailable(s, at)).map(s => rank(s.sourceTier)));
  return sources
    .filter(s => OFFICIAL_TIERS.has(s.sourceTier) && !sourceIsAvailable(s, at) && rank(s.sourceTier) < best &&
      (s.publisherClosedAt != null || (s.expiresAt != null && s.expiresAt <= at)))
    .sort((a, b) => rank(a.sourceTier) - rank(b.sourceTier) || a.sourceKey.localeCompare(b.sourceKey) || a.externalId.localeCompare(b.externalId))[0];
}

/** The publication that keeps an offer open: the apply source, unless an official closure outranks it (R-143 §3). */
export function selectServingSource<T extends AuthoritySource>(
  sources: readonly T[],
  current: { canonicalSourceKey?: string | null; canonicalExternalId?: string | null; url?: string | null },
  at = new Date(),
): T | undefined {
  return authorityClosure(sources, at) ? undefined : selectApplySource(sources, current, at);
}

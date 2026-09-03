/**
 * Offer URLs: /offre/[slug]-[id] (S-01).
 *
 * The slug exists for people and for search engines — the id alone is the
 * identity. Old /offre/[id] URLs keep working through a 301 to the canonical
 * form, and a stale slug (title edited at the source) 301s to the fresh one.
 *
 * Zero-dependency on purpose: client components (the offer cards) build these
 * links too, so nothing here may touch node built-ins.
 */

const SLUG_MAX = 70;

/** "Chargé(e) de clientèle — CDI" -> "charge-e-de-clientele-cdi". */
export function offerSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-$/, '');
}

/** Canonical path for an offer. Falls back to the bare id on an empty slug. */
export function offerPath(job: { id: string; title: string }): string {
  const slug = offerSlug(job.title);
  return slug ? `/offre/${slug}-${job.id}` : `/offre/${job.id}`;
}

/**
 * Candidate ids for a /offre/[param] value.
 *
 * The param is either a bare id (old URLs) or slug-id, and an id may itself
 * contain hyphens (the e2e fixtures do; production cuids do not) — so the
 * boundary between slug and id is ambiguous. Tried in order: the raw value
 * (bare ids resolve in one lookup), then each hyphen-suffix from the shortest
 * (a production cuid is always the last segment). Capped: a hostile param must
 * not turn into unbounded lookups.
 */
const MAX_SUFFIX_CANDIDATES = 4;

export function offerIdCandidates(raw: string): string[] {
  const candidates = [raw];
  const suffixes: string[] = [];
  for (let cut = raw.lastIndexOf('-'); cut > 0; cut = raw.lastIndexOf('-', cut - 1)) {
    if (cut < raw.length - 1) suffixes.push(raw.slice(cut + 1));
    if (suffixes.length >= MAX_SUFFIX_CANDIDATES) break;
  }
  return [...candidates, ...suffixes];
}

import { normalizeJobTitle } from '../lib/normalize.js';
import { normalizeLocationString } from '../normalize/location.js';
import { resolveCompany } from '../normalize/company.js';
import type { NormalizedJob } from '../types.js';

/**
 * Deduplication.
 *
 * The same opening reaches us from several sources — the Maison's careers site,
 * the group portal, a specialised jobboard — and Catwalks must keep ONE canonical
 * job carrying N JobSources, never three listings.
 *
 * Two passes, in order:
 *   1. exact  — same company + normalized title + normalized city
 *   2. fuzzy  — same company + city, titles close enough, postings close in time
 *
 * Company and city are never fuzzy-matched: "Dior Paris" and "Dior Lyon" are two
 * real jobs. Only the title tolerates variation ("Conseiller de vente" vs
 * "Sales Advisor"), and only inside an already-identical company+city bucket.
 */

/** Source ranking: the highest-priority source owns the canonical apply URL. */
export const SOURCE_PRIORITY = [
  'EMPLOYER_DIRECT',
  'GROUP_OFFICIAL',
  'ATS_OFFICIAL',
  'SPECIALIST_JOBBOARD',
  'AGGREGATOR',
] as const;

export type SourceTier = (typeof SOURCE_PRIORITY)[number];

export type CandidateJob = NormalizedJob & {
  company: string;
  sourceKey: string;
  sourceTier: SourceTier;
};

/** Postings more than this far apart are treated as separate openings. */
const MAX_DAYS_APART = 45;
/** Title similarity required to merge two postings. */
const TITLE_SIMILARITY_THRESHOLD = 0.72;

/**
 * Blocking key: only jobs sharing it are ever compared.
 * Company goes through alias resolution first, so "DIOR" and
 * "Christian Dior Couture SA" land in the same bucket.
 */
export function blockingKey(job: CandidateJob): string {
  const city = normalizeLocationString(job.location).city ?? '';
  return `${resolveCompany(job.company).companyId}|${city}`;
}

/** Strict identity: company + title + city all match after normalization. */
export function exactKey(job: CandidateJob): string {
  return `${blockingKey(job)}|${normalizeJobTitle(job.title)}`;
}

/**
 * Job titles arrive in French and English for the same role, so token overlap
 * alone scores "Conseiller de vente" against "Sales Advisor" at zero. Mapping both
 * onto a shared concept lets the fuzzy pass see them as one opening. Only roles
 * whose equivalence is unambiguous are listed — a loose entry merges real jobs.
 */
const ROLE_SYNONYMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['ROLE_SALES', /CONSEILLER|CONSEILLERE|VENDEUR|VENDEUSE|SALES ADVISOR|CLIENT ADVISOR|SALES ASSISTANT|FASHION ADVISOR|BEAUTY ADVISOR|VENTE\b/],
  ['ROLE_STORE_MANAGER', /DIRECTEUR DE (MAGASIN|BOUTIQUE)|STORE MANAGER|RESPONSABLE (DE )?(MAGASIN|BOUTIQUE)|BOUTIQUE MANAGER/],
  ['ROLE_STOCK', /STOCKIST|STOCKISTA|STOCK KEEPER|MAGASINIER|RESERVE\b/],
  ['ROLE_VM', /VISUAL MERCHANDIS|MERCHANDISEUR/],
  ['ROLE_CRM', /CRM\b|CLIENT ?TELING|RELATION CLIENT/],
];

function tokenSet(title: string): Set<string> {
  // Gender markers (H/F) and seniority noise are already stripped upstream.
  const normalized = normalizeJobTitle(title);
  const tokens = new Set(normalized.split(' ').filter((t) => t.length > 2));
  for (const [concept, pattern] of ROLE_SYNONYMS) {
    if (pattern.test(normalized)) tokens.add(concept);
  }
  return tokens;
}

function roleConcepts(title: string): Set<string> {
  const normalized = normalizeJobTitle(title);
  return new Set(
    ROLE_SYNONYMS.filter(([, pattern]) => pattern.test(normalized)).map(([concept]) => concept),
  );
}

/**
 * Jaccard similarity over title tokens, robust to word order and padding.
 *
 * When both titles resolve to the same role concept, that agreement outranks raw
 * word overlap: "Conseiller de vente H/F" and "Sales Advisor - Paris" describe one
 * job but share no word, so plain Jaccard scores them near zero. The concept is
 * only ever a floor — a higher literal overlap still wins.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  const jaccard = shared / (left.size + right.size - shared);

  const conceptsA = roleConcepts(a);
  const conceptsB = roleConcepts(b);
  const sharedConcept = [...conceptsA].some((concept) => conceptsB.has(concept));
  // Same role and no competing concept on either side: treat as a strong match.
  if (sharedConcept && conceptsA.size === 1 && conceptsB.size === 1) {
    return Math.max(jaccard, 0.8);
  }
  return jaccard;
}

function daysApart(a?: Date, b?: Date): number {
  // An unknown date must not by itself prevent a merge.
  if (!a || !b) return 0;
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

export function isProbableDuplicate(a: CandidateJob, b: CandidateJob): boolean {
  if (blockingKey(a) !== blockingKey(b)) return false;
  if (normalizeJobTitle(a.title) === normalizeJobTitle(b.title)) return true;
  if (daysApart(a.postedAt, b.postedAt) > MAX_DAYS_APART) return false;
  return titleSimilarity(a.title, b.title) >= TITLE_SIMILARITY_THRESHOLD;
}

export type JobCluster = {
  /** The posting whose source ranks highest; its URL is the canonical one. */
  canonical: CandidateJob;
  /** Every posting in the cluster, canonical included. */
  sources: CandidateJob[];
};

function tierRank(tier: SourceTier): number {
  return SOURCE_PRIORITY.indexOf(tier);
}

/** Picks the canonical posting: best tier, then the richest description. */
function pickCanonical(jobs: CandidateJob[]): CandidateJob {
  return [...jobs].sort((a, b) => {
    const byTier = tierRank(a.sourceTier) - tierRank(b.sourceTier);
    if (byTier !== 0) return byTier;
    return (b.description?.length ?? 0) - (a.description?.length ?? 0);
  })[0];
}

/**
 * Groups postings into clusters of one real opening.
 * Blocking keeps this near-linear instead of comparing every pair.
 */
export function clusterJobs(jobs: readonly CandidateJob[]): JobCluster[] {
  const buckets = new Map<string, CandidateJob[][]>();

  for (const job of jobs) {
    const key = blockingKey(job);
    const groups = buckets.get(key) ?? [];
    const target = groups.find((group) => group.some((other) => isProbableDuplicate(job, other)));
    if (target) target.push(job);
    else groups.push([job]);
    buckets.set(key, groups);
  }

  return [...buckets.values()]
    .flat()
    .map((group) => ({ canonical: pickCanonical(group), sources: group }));
}

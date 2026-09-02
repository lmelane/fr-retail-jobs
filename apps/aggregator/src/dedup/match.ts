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

import type { AtsType } from '@prisma/client';
import type { SourceTier } from '../connectors/registry.js';

/** Source ranking: the highest-priority source owns the canonical apply URL. */
export const SOURCE_PRIORITY: readonly SourceTier[] = [
  'EMPLOYER_DIRECT',
  'GROUP_OFFICIAL',
  'ATS_OFFICIAL',
  'SPECIALIST_JOBBOARD',
  'AGGREGATOR',
];

export type { SourceTier };

export type CandidateJob = NormalizedJob & {
  company: string;
  sourceKey: string;
  sourceTier: SourceTier;
  /**
   * The real ATS this posting came from, stored on Job.source. A sitemap/JSON-LD
   * source genuinely is GENERIC_JSONLD; an API feed carries its true vendor
   * (WORKDAY, GREENHOUSE…), so the unique key (companyId, source, externalId)
   * separates two different sources that happen to share an externalId.
   */
  atsType?: AtsType;
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

/**
 * Weekly hours written into the title: "30H", "25h", "12,5hrs", "37.5hrs/wk".
 * Retail part-time contracts differ ONLY by this number, so it decides identity.
 */
const WEEKLY_HOURS = /\b(\d{1,2}(?:[.,]\d)?)\s*H(?:RS?|EURES?)?\b(?:\/?(?:WK|W|SEM))?/gi;

function weeklyHours(title: string): string | undefined {
  const found = [...title.matchAll(WEEKLY_HOURS)].map((m) => m[1].replace(',', '.'));
  // Several numbers means the hours are not the distinguishing feature.
  return found.length === 1 ? found[0] : undefined;
}

/**
 * True when two postings cannot be the same opening, whatever their titles score.
 *
 * Found on a real board, not in a fabricated test: Beaumanoir publishes ten
 * distinct part-time roles — 24H, 25H, 30H, 35H, a 7H student contract — that
 * every title metric rates 0.80 to 1.00 because the hours are the only
 * difference. Clustering them lost 122 of 408 offers, and someone searching for
 * a 35H post would have seen a single "30H" listing.
 */
function cannotBeSameOpening(a: CandidateJob, b: CandidateJob): boolean {
  // One source never publishes one opening twice. Two rows from the same feed
  // with different ids are two jobs — this alone would have caught Beaumanoir.
  if (a.sourceKey === b.sourceKey && a.externalId !== b.externalId) return true;

  const hoursA = weeklyHours(a.title);
  const hoursB = weeklyHours(b.title);
  return hoursA !== undefined && hoursB !== undefined && hoursA !== hoursB;
}

export function isProbableDuplicate(a: CandidateJob, b: CandidateJob): boolean {
  if (blockingKey(a) !== blockingKey(b)) return false;
  if (cannotBeSameOpening(a, b)) return false;
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

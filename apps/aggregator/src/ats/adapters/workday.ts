import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

// externalPath is optional in practice: some tenants (Richemont) return rows
// without it, and treating it as always-present crashed the whole source.
type WorkdayPosting = { title: string; externalPath?: string; locationsText?: string; postedOn?: string; bulletFields?: string[] };

/**
 * Locale demandé à Workday, liste ET détail. Le transport commun envoie fr-FR
 * par défaut ; Workday traduit alors tout par machine : 1 794 offres Tapestry en
 * français, « Entraîneur Netherlands B.V. » pour Coach, pays « États-Unis
 * d'Amérique » (98 lignes non ISO), 161 Levi's / 108 Richemont en `fr` hors pays
 * francophones (audit a4, 2026-09-06). En en-US, le tenant rend ses propres
 * textes et des libellés que la frontière sait normaliser.
 */
const EN_US = { 'accept-language': 'en-US,en;q=0.9' } as const;

/** Matches a requisition id (R_778886, JR12345, REQ-90210) — never a place. */
const REQUISITION_ID = /^(r|jr|req)[_-]?\d+$/i;

/**
 * The location a tenant put in `bulletFields` instead of `locationsText`.
 *
 * Workday's own UI shows the bullets as "location · location · requisition id".
 * Taking the first non-id bullet therefore reads the location exactly where the
 * candidate sees it. Returns undefined rather than a wrong guess when the only
 * bullets are ids — a missing location is honest, a requisition id shown as a
 * city is not.
 */
export function locationFromBullets(bullets?: string[]): string | undefined {
  return bullets?.map((b) => b.trim()).find((b) => b.length > 1 && !REQUISITION_ID.test(b));
}

type WorkdayFacetValue = { descriptor?: string; id?: string; count?: number };
type WorkdayFacet = { facetParameter?: string; descriptor?: string; values?: WorkdayFacetValue[] };
type WorkdayPage = { total?: number; jobPostings?: WorkdayPosting[]; facets?: WorkdayFacet[] };

type Scope = NonNullable<NonNullable<AdapterResult['enumeration']>['scopes']>[number];
type PageEvidence = NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']>[number];

/** One board to enumerate: the whole site, or one value of the partition facet. */
type Board = {
  appliedFacets: Record<string, string[]>;
  scope: string;
  /** Set when the board is one value of a partition facet: every posting read on it carries that value as its employer. */
  partition?: { parameter: string; value: string; id: string };
  /** The whole site, read AFTER the partitions: postings that carry no value of the facet (Tapestry: 6 of 2 091). */
  remainder?: boolean;
};

/** State shared by every board of one source: postings, ids, evidence, rejects. */
/**
 * Tenant store coding in `locationsText` (Saks, 2026-09-10: "NM_0114_Houston", "SF_0669_NAPLES FL",
 * "BG_9066_BG CORPORATE", "O5_0842_BUCKHEAD" — 701 of 747 postings): the prefix is the banner, the
 * tenant's own attribution of the posting. Opt-in per Source: `brandFromLocationPrefix: { map: { NM:
 * "Neiman Marcus", … }, otherwise?: "Group name" }`. A posting without a mapped prefix takes `otherwise`
 * when set (the group, for corporate/remote rows) and stays unattributed here otherwise.
 */
type LocationPrefixRule = { map: Record<string, string>; otherwise?: string };
export const LOCATION_PREFIX_RULE = 'LOCATION_CODE_PREFIX';
export const LOCATION_PREFIX_OTHERWISE_RULE = 'LOCATION_CODE_PREFIX_ABSENT';
export function locationPrefixRule(config: Record<string, unknown>): LocationPrefixRule | undefined {
  const raw = config.brandFromLocationPrefix as { map?: unknown; otherwise?: unknown } | undefined;
  if (!raw || typeof raw !== 'object' || !raw.map || typeof raw.map !== 'object') return undefined;
  const map = Object.fromEntries(Object.entries(raw.map as Record<string, unknown>).filter(([k, v]) => /^[A-Z0-9]{1,6}$/.test(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).trim()]));
  if (!Object.keys(map).length) return undefined;
  return { map, ...(typeof raw.otherwise === 'string' && raw.otherwise.trim() ? { otherwise: raw.otherwise.trim() } : {}) };
}
export function brandFromLocationPrefix(locationsText: string | undefined, rule: LocationPrefixRule): { brand: string; prefix: string | null } | undefined {
  const m = /^([A-Z0-9]{1,6})_/.exec(locationsText?.trim() ?? '');
  const prefix = m?.[1];
  if (prefix && rule.map[prefix]) return { brand: rule.map[prefix]!, prefix };
  return rule.otherwise ? { brand: rule.otherwise, prefix: null } : undefined;
}

type Shared = {
  endpoint: string; origin: string; site: string;
  prefixRule?: LocationPrefixRule;
  out: NormalizedJob[]; seen: Set<string>; pageEvidence: PageEvidence[]; issues: Set<string>;
  rejectedRows: NonNullable<AdapterResult['rejectedRows']>; pathlessRows: Set<string>;
};

type BoardResult = {
  scope: string; total: number; uniqueIds: number; pages: number; rawCount: number; repeatedIds: number; withoutPath: number;
  /** Ids of this board already read on an EARLIER board: a posting cannot belong to two partition values. */
  overlap: number;
  /** Postings this board added to the source (on the remainder board: postings outside every partition). */
  fresh: number; termination: string; complete: boolean;
};

const PARTITION_RULE = 'PARTITION_FACET_VALUE';

async function readPage(shared: Shared, board: Board, offset: number): Promise<WorkdayPage> {
  return fetchJson<WorkdayPage>(shared.endpoint, {
    method: 'POST',
    /**
     * `accept-language` fixé à en-US : le transport commun envoie fr-FR par
     * défaut, et un tenant dont le site carrière n'est pas traduit en
     * français répond 500 à cette seule en-tête — mesuré le 2026-09-05 sur
     * nordstrom.wd501 (200 en en-US, 500 en fr-FR, body identique). en-US est
     * le locale que tout site Workday sert ; la langue des offres, elle,
     * vient du tenant, pas de l'en-tête.
     */
    headers: { 'content-type': 'application/json', ...EN_US },
    body: JSON.stringify({ appliedFacets: board.appliedFacets, limit: 20, offset, searchText: '' }),
  });
}

function toJob(shared: Shared, board: Board, job: WorkdayPosting, externalId: string): NormalizedJob {
  const base: NormalizedJob = {
    externalId,
    title: job.title,
    /**
     * Not every tenant fills `locationsText`. Capri (Versace, Michael Kors,
     * Jimmy Choo) leaves it empty and puts the site in `bulletFields[0]`
     * instead — measured 2026-09-04: 621 offers, ALL with a location on the
     * page, ALL location-less once parsed. An offer with no location is
     * unusable for a candidate, so fall back to the first bullet field,
     * which is where Workday's own UI reads the location from. The last
     * bullet is the requisition id (R_778886), never a place: it is
     * excluded so an id is never displayed as a city.
     */
    location: job.locationsText || locationFromBullets(job.bulletFields),
    postedAt: postedAtFromWorkday(job.postedOn),
    // The public career URL is {origin}/{site}{externalPath}, joined by
    // string — NOT new URL(externalPath, `${origin}/${site}/`), which
    // silently DROPS the /{site}/ segment because externalPath is an
    // absolute path ("/job/…") that overrides the base path. That produced
    // `${origin}/job/…` on every Richemont/Cartier offer → a 404 on every
    // apply link. Verified: `${origin}/${site}${externalPath}` → 200.
    url: `${shared.origin.replace(/\/$/, '')}/${shared.site}${job.externalPath}`,
    raw: job,
  };
  if (!board.partition) {
    if (!shared.prefixRule) return base;
    const attributed = brandFromLocationPrefix(job.locationsText, shared.prefixRule);
    if (!attributed) return base;
    // The tenant's store code names the banner; the code stays in the raw row for replay.
    return {
      ...base,
      company: attributed.brand,
      employerEvidence: attributed.prefix
        ? { rawName: attributed.brand, path: 'listing.locationsText.prefix', rule: LOCATION_PREFIX_RULE }
        : { rawName: attributed.brand, path: 'listing.locationsText.prefix', rule: LOCATION_PREFIX_OTHERWISE_RULE },
      raw: { ...job, locationPrefix: attributed.prefix },
    };
  }
  // The partition value is the tenant's own attribution of the posting (Tapestry
  // 2026-09-10: facet "Brand" = Coach 1 514 · Kate Spade 502 · Tapestry 69, while the
  // legal entity of 1 570 of them reads "Tapestry, Inc."). It is the employer; the
  // legal entity and the logo stay in the detail for replay.
  return {
    ...base,
    company: board.partition.value,
    employerEvidence: { rawName: board.partition.value, path: `listing.facets.${board.partition.parameter}`, rule: PARTITION_RULE },
    raw: { ...job, facet: board.partition },
  };
}

/**
 * Enumerate one board page by page, with the second sweep when an unstable sort
 * repeated ids. Postings go to the shared list unless an earlier board already
 * read them (overlap, counted and named, never pushed twice).
 */
async function enumerateBoard(shared: Shared, board: Board): Promise<BoardResult> {
  /**
   * Workday reports `total` ONLY on the first page — every later page returns
   * total: 0. Comparing against it each time stops the loop at 40 of 1088, so
   * the count is captured once and the loop otherwise ends on a short page.
   *
   * Enumeration proof (2026-09-09): each page is archived (offset, ids, sha256,
   * the publisher total when the page carries one). Nordstrom and Swatch read
   * one posting fewer than the announced total run after run; the proof now
   * says WHY — a posting repeated across pages (unstable sort), a row without
   * `externalPath`, or a total that the board simply never serves — instead of
   * an unexplained −1.
   */
  let total = 0, totalChanged = false;
  const local = new Set<string>();
  const localPathless = new Set<string>();
  let pages = 0, rawCount = 0, repeatedIds = 0, overlap = 0, fresh = 0, termination = 'PAGE_BUDGET_EXHAUSTED';
  const suffix = board.partition ? `&${board.partition.parameter}=${encodeURIComponent(board.partition.id)}` : '';
  const take = (job: WorkdayPosting, externalId: string): boolean => {
    if (local.has(externalId)) return false;
    local.add(externalId);
    // The remainder board re-reads what the partitions read: expected, not an overlap.
    if (shared.seen.has(externalId)) { if (!board.remainder) overlap += 1; return true; }
    shared.seen.add(externalId); fresh += 1;
    shared.out.push(toJob(shared, board, job, externalId));
    return true;
  };

  for (let offset = 0; offset < 5000; offset += 20) {
    const page = await readPage(shared, board, offset);
    const postings = page.jobPostings ?? [];
    pages += 1; rawCount += postings.length;
    if (page.total) {
      if (!total) total = page.total;
      else if (page.total !== total) { totalChanged = true; shared.issues.add('SOURCE_TOTAL_CHANGED'); }
    }
    const pageIds: string[] = [];
    for (const job of postings) {
      // A posting without an externalPath has neither a stable id nor a URL to
      // send a candidate to — skip it rather than crash the whole source on
      // `undefined.split`. Richemont's tenant returned such rows, and the throw
      // lost all ~1300 of its offers ("cartier-3 failed: reading 'split'").
      if (!job.externalPath) {
        // A path-less row has no id: the same row served twice (unstable sort — Mango, 2026-09-10: {"bulletFields":["Fix-Term"]}
        // read on two pages) is one announced row, not two. Distinct rows are told apart by their content.
        // Every occurrence is a witness in the rejects; the COUNT of announced rows is by distinct content.
        const hash = createHash('sha256').update(JSON.stringify(job)).digest('hex');
        shared.rejectedRows.push({ reason: 'ROW_WITHOUT_EXTERNAL_PATH', raw: job });
        shared.pathlessRows.add(hash); localPathless.add(hash);
        continue;
      }
      const externalId = job.externalPath.split('/').filter(Boolean).pop() ?? job.externalPath;
      pageIds.push(externalId);
      if (!take(job, externalId)) repeatedIds += 1;
    }
    shared.pageEvidence.push({ url: `${shared.endpoint}#offset=${offset}${suffix}`, checkedAt: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(page)).digest('hex'), offset, pagination: null,
      ids: pageIds, publisherCounter: page.total ? `total=${page.total}` : '', componentCounters: [`rows=${postings.length}`, `uniqueIds=${local.size}`, `repeated=${repeatedIds}`, `withoutPath=${localPathless.size}`, ...(board.partition ? [`partition=${board.scope}`] : [])] });
    if (postings.length === 0) { termination = 'EMPTY_PAGE'; break; }
    // The announced total counts ROWS (a path-less row included): once that many
    // rows are read the board is exhausted, whether or not every row was a
    // usable posting. Completeness below is judged on unique usable ids.
    if (total && rawCount >= total) { termination = local.size >= total ? 'PUBLISHER_TOTAL_REACHED' : 'PUBLISHER_TOTAL_ROWS_READ'; break; }
    // A short page ends the board unless the publisher still announces more:
    // then the next offset is read, so a shortened page in the middle of the
    // board does not pass for its end.
    if (postings.length < 20 && !total) { termination = 'SHORT_PAGE'; break; }
  }
  /**
   * Second sweep (2026-09-10). An unstable sort can serve the same posting on two
   * consecutive pages while another posting slides between two page boundaries and
   * is never served (Levi's: 1 314 rows announced and read, 7 repeated, 1 306 unique).
   * When every announced row was read but repeated ids left announced postings
   * unseen, the board is re-read on a grid shifted by half a page: a posting that
   * fell between two boundaries of the first grid sits inside a page of the second.
   * The board is proven only when every announced row is then accounted for — as a
   * unique posting or as a rejected path-less row; the repetition stays named.
   */
  if (total > 0 && repeatedIds > 0 && local.size + localPathless.size < total && termination !== 'PAGE_BUDGET_EXHAUSTED' && !totalChanged) {
    for (let offset = 10, sweepPages = 0; offset < total && local.size + localPathless.size < total && sweepPages < 250; offset += 20, sweepPages += 1) {
      const page = await readPage(shared, board, offset);
      const postings = page.jobPostings ?? [];
      pages += 1;
      const pageIds: string[] = [];
      let freshInSweep = 0;
      for (const job of postings) {
        // Path-less rows were already counted (and rejected) by the first sweep; they carry no id to reconcile.
        if (!job.externalPath) continue;
        const externalId = job.externalPath.split('/').filter(Boolean).pop() ?? job.externalPath;
        pageIds.push(externalId);
        if (take(job, externalId)) freshInSweep += 1;
      }
      shared.pageEvidence.push({ url: `${shared.endpoint}#offset=${offset}&sweep=2${suffix}`, checkedAt: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(page)).digest('hex'), offset, pagination: null,
        ids: pageIds, publisherCounter: '', componentCounters: [`sweep=2`, `rows=${postings.length}`, `uniqueIds=${local.size}`, `freshInSweep=${freshInSweep}`] });
      if (postings.length === 0) break;
    }
    if (local.size + localPathless.size >= total) { termination = 'SECOND_SWEEP_RECONCILED'; shared.issues.add('RECONCILED_BY_SECOND_SWEEP'); }
  }
  if (repeatedIds) shared.issues.add('REPEATED_IDS_ACROSS_PAGES');
  if (localPathless.size) shared.issues.add('ROWS_WITHOUT_EXTERNAL_PATH');
  // Proven when every announced row is accounted for exactly once — as a unique
  // posting, or as a REJECTED path-less row with its raw witness (Nordstrom,
  // 2026-09-09: 1 312 rows read of 1 312 announced, 3 of them path-less, 1 309
  // postings — the historical −3). A repetition across pages only passes when the
  // second sweep has reconciled every announced row.
  const complete = total > 0 && local.size + localPathless.size === total && (repeatedIds === 0 || termination === 'SECOND_SWEEP_RECONCILED') && termination !== 'PAGE_BUDGET_EXHAUSTED' && !totalChanged;
  return { scope: board.scope, total, uniqueIds: local.size, pages, rawCount, repeatedIds, withoutPath: localPathless.size, overlap, fresh, termination, complete };
}

export async function fetchWorkdayJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const tenant = String(config.tenant ?? '');
  const site = String(config.site ?? '');
  const origin = String(config.origin ?? '');
  if (!tenant || !site || !origin) throw new Error('Workday tenant/site/origin missing');
  const endpoint = `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
  const shared: Shared = { endpoint, origin, site, prefixRule: locationPrefixRule(config), out: [], seen: new Set(), pageEvidence: [], issues: new Set(), rejectedRows: [], pathlessRows: new Set() };
  const { out, seen, pageEvidence, issues, rejectedRows } = shared;

  /**
   * Partition by a facet (2026-09-10, Tapestry). Workday's `total` is CAPPED at
   * 2 000 on that tenant: pages are still served at offsets 2 000, 2 080 and 2 100
   * while the three values of the facet "Brand" enumerate 2 085 distinct postings
   * with no overlap. Read per facet value, each board stays under the cap, the
   * source total is the sum of the boards, and every posting carries the tenant's
   * own attribution as its employer. Opt-in per Source (`partitionFacet`): the
   * facet must exist on the tenant; when it does not, the whole site is read as
   * before and the absence is named.
   */
  const partitionFacet = typeof config.partitionFacet === 'string' && config.partitionFacet.trim() ? config.partitionFacet.trim() : undefined;
  let publisherTotal = 0;
  let boards: Board[] = [{ appliedFacets: {}, scope: 'jobs' }];
  if (partitionFacet) {
    const first = await readPage(shared, boards[0]!, 0);
    publisherTotal = first.total ?? 0;
    const facet = first.facets?.find((f) => f.facetParameter === partitionFacet);
    const values = (facet?.values ?? []).filter((v): v is Required<WorkdayFacetValue> => Boolean(v.id && v.descriptor));
    pageEvidence.push({ url: `${endpoint}#facets`, checkedAt: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(first)).digest('hex'), offset: 0, pagination: null,
      ids: [], publisherCounter: publisherTotal ? `total=${publisherTotal}` : '', componentCounters: values.map((v) => `${partitionFacet}=${v.descriptor}:${v.count ?? ''}`) });
    // The site itself is read last: a posting that carries no value of the facet belongs to no partition
    // (Tapestry: 6 postings, career-fair and corporate rows without a brand) and keeps the detail-based attribution.
    if (values.length) boards = [...values.map((v): Board => ({ appliedFacets: { [partitionFacet]: [v.id] }, scope: `${partitionFacet}=${v.descriptor}`, partition: { parameter: partitionFacet, value: v.descriptor, id: v.id } })), { appliedFacets: {}, scope: 'jobs:unpartitioned', remainder: true }];
    else issues.add('PARTITION_FACET_ABSENT');
  }
  const results: BoardResult[] = [];
  for (const board of boards) results.push(await enumerateBoard(shared, board));
  const partitioned = Boolean(boards[0]?.partition);
  const partitions = results.filter((r) => r.scope !== 'jobs:unpartitioned');
  const remainder = partitioned ? results.find((r) => r.scope === 'jobs:unpartitioned') : undefined;
  const unpartitioned = remainder?.fresh ?? 0;
  const total = partitions.reduce((sum, r) => sum + r.total, 0) + unpartitioned;
  const pagesRead = results.reduce((sum, r) => sum + r.pages, 0) + (partitionFacet ? 1 : 0);
  const rawCount = results.reduce((sum, r) => sum + r.rawCount, 0);
  const overlap = partitions.reduce((sum, r) => sum + r.overlap, 0);
  const capped = partitioned && publisherTotal > 0 && total > publisherTotal;
  if (partitioned) {
    if (capped) issues.add('PUBLISHER_TOTAL_CAPPED');
    if (overlap) issues.add('PARTITION_OVERLAP');
    if (unpartitioned) issues.add(`UNPARTITIONED_POSTINGS=${unpartitioned}`);
  }
  /**
   * Under a capped site total, postings without a facet value beyond the cap are unobservable: not provable.
   *
   * Tempting shortcut, examined and REJECTED on 2026-09-11: "the residual sweep reported complete, so we saw
   * everything". It proves nothing. The residual is reachable ONLY through the capped site listing, so its
   * `complete: true` says the rows it was SERVED were fully read — never that no further unbranded posting
   * exists beyond the cap. The fixture of `workday.partition.test.ts` is exactly that case: the site serves
   * 2 000 of 2 085 rows, 87 branded postings stay invisible, and each partition still reports complete.
   *
   * So Tapestry stays NOT PROVEN, and that is the honest answer: 5 postings of its board are unreachable. It is
   * reported as an open dossier rather than forced to PROVEN.
   */
  if (capped && unpartitioned) issues.add('UNPARTITIONED_UNDER_CAP');
  const failing = partitions.find((r) => !r.complete) ?? (remainder && !remainder.complete ? remainder : undefined);
  const complete = !failing && overlap === 0 && !(capped && unpartitioned > 0);
  const termination = partitioned ? (failing ? failing.termination : overlap ? 'PARTITION_OVERLAP' : capped && unpartitioned ? 'UNPARTITIONED_UNDER_CAP' : 'PARTITIONS_RECONCILED') : results[0]!.termination;
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');
  const boardScopes: Scope[] = results.map((r) => ({ scope: r.scope, declaredTotal: r.scope === 'jobs:unpartitioned' ? r.fresh : r.total || -1, uniqueIds: r.scope === 'jobs:unpartitioned' ? r.fresh : r.uniqueIds, pages: r.pages, complete: r.complete }));
  const enumeration: AdapterResult['enumeration'] = { method: partitioned ? 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION_PARTITIONED' : 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION', endpoint, pages: pagesRead, rawCount, termination, issues: [...issues],
    scopes: partitioned ? [{ scope: 'jobs', declaredTotal: total || -1, uniqueIds: seen.size, pages: pagesRead, complete }, ...boardScopes] : boardScopes, pageEvidence };

  // F-04: `total` is the tenant's own announced count — the truncation signal.
  const declaredTotal = total || undefined;
  const truncated = partitions.some((r) => r.termination === 'PAGE_BUDGET_EXHAUSTED' || (r.total > 0 && r.rawCount < r.total));
  if (config.withDescriptions === false) return { jobs: out.map(job => ({ ...job, publicationHold: 'WORKDAY_LISTING_WITHOUT_EMPLOYER_DETAIL' })), declaredTotal, complete, truncated, enumeration, rejectedRows };
  return {
    jobs: await attachWorkdayDescriptions(
      out,
      `${origin}/wday/cxs/${tenant}/${site}`,
      Number(config.detailConcurrency ?? 4),
    ),
    declaredTotal, complete, truncated, enumeration, rejectedRows,
  };
}

type WorkdayDetail = {
  jobPostingInfo?: {
    jobDescription?: string;
    location?: string;
    /** English label in en-US ("Taiwan Region", "United States of America"); the boundary maps it to ISO. */
    country?: { descriptor?: string };
    startDate?: string;
    /** Fin de publication ("2026-09-12") — validThrough, jamais lu avant l2. */
    endDate?: string;
    /** "Full time" / "Part time" / "Variable" — jamais lu avant l2 (14 385 offres sans temps). */
    timeType?: string;
    /** "Hybrid", "Remote", "On-site" quand le tenant le publie. */
    remoteType?: string;
    /** On group tenants, the alt text IS the brand ("Panerai", "Cartier"). */
    logoImage?: { alt?: string };
  };
  /** Legal entity, code-prefixed: "C170 Officine Panerai". */
  hiringOrganization?: { name?: string };
};

/**
 * The Maison this posting belongs to, on a GROUP tenant (audit A-01, D11).
 *
 * Verified live on richemont/broadbean_external: jobPostingInfo.logoImage.alt
 * = "Panerai", hiringOrganization.name = "C170 Officine Panerai". Without this,
 * every offer of the feed inherits the catalogue line's label and 1 300+
 * Richemont offers all read "Cartier".
 */
/**
 * The logo alt text names the brand, sometimes with the word "logo" glued to it
 * ("Cartier Logo", "Richemont Logo", "Logo Pierre Fabre", "Jaeger LeCoultre logo"
 * — 516 postings on 2026-09-09 whose new spellings the identity gate refused).
 * The word is the image's, not the employer's.
 */
export function brandFromLogoAlt(alt: string | undefined): string | undefined {
  // The alt may be a file-name-like token: "Off_The_Rax_LOGO300x300" (KnitWell, 2026-09-10) — underscores separate words and the
  // image word may carry its dimensions. Only the word "logo" (with optional WxH) is removed; every other word is the brand.
  const name = alt?.replace(/_+/g, ' ').replace(/(^|\s)logo(?:\s*\d+\s*x\s*\d+)?(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
  return name && !/^logo$/i.test(name) ? name : undefined;
}

export function brandFromWorkdayDetail(detail: WorkdayDetail): string | undefined {
  const alt = brandFromLogoAlt(detail.jobPostingInfo?.logoImage?.alt);
  if (alt) return alt;
  const legal = detail.hiringOrganization?.name?.trim();
  if (!legal) return undefined;
  // Strip the leading entity code ("C170 Officine Panerai" -> "Officine Panerai").
  return legal.replace(/^[A-Z]{0,2}\d+\s+/, '').trim() || undefined;
}

/**
 * Workday's listing states the date RELATIVELY ("Posted Today", "Posted 3 Days
 * Ago") — F-05. "30+ Days Ago" is a floor, not a date: left undefined rather
 * than invented; the detail's `startDate` (a real ISO date) overrides when the
 * descriptions pass fetches it, and firstSeenAt covers the rest honestly.
 */
export function postedAtFromWorkday(postedOn?: string): Date | undefined {
  if (!postedOn) return undefined;
  const text = postedOn.toLowerCase();
  const day = 86_400_000;
  if (/\btoday\b/.test(text)) return new Date();
  if (/\byesterday\b/.test(text)) return new Date(Date.now() - day);
  const match = text.match(/(\d+)\+?\s+days?\s+ago/);
  if (!match) return undefined;
  if (text.includes('+')) return undefined; // "30+" = at least, not equals
  return new Date(Date.now() - Number(match[1]) * day);
}


/**
 * The listing endpoint returns no description; the detail one does, at
 * {cxsBase}{externalPath}. The path must be the FULL externalPath from the
 * listing — a shortened one 404s with "not found: Job_Posting_Anchor_ID".
 */
export async function attachWorkdayDescriptions(
  jobs: NormalizedJob[],
  cxsBase: string,
  concurrency = 4,
): Promise<NormalizedJob[]> {
  const limit = pLimit(concurrency);

  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const path = (job.raw as { externalPath?: string } | undefined)?.externalPath;
        if (!path) return { ...job, publicationHold: 'WORKDAY_DETAIL_PATH_MISSING' };
        try {
          // Même locale que la liste : sans cet en-tête, le détail arrive
          // traduit par machine (voir EN_US).
          const detail = await fetchJson<WorkdayDetail>(`${cxsBase}${path}`, { headers: { ...EN_US } });
          const info = detail.jobPostingInfo;
          if (!info) return { ...job, raw: { ...(job.raw as Record<string, unknown>), detail }, publicationHold: 'WORKDAY_DETAIL_SCHEMA_INVALID' };
          // A posting read on a partition board already carries the tenant's own attribution (facet value):
          // the detail supplies text, dates and country, never a second employer claim.
          // …the same holds for a banner read from the tenant's store code (listing.locationsText.prefix).
          const partitioned = job.employerEvidence?.path.startsWith('listing.') ? job.employerEvidence : undefined;
          const employer = partitioned ? job.company : brandFromWorkdayDetail(detail);
          /**
           * An absent EMPLOYER does not invalidate the FACTS the same detail carries.
           *
           * This branch used to return the listing untouched, so a detail without an employer also dropped its
           * date, country, location and description — two concerns wrongly coupled: WHO hires, and WHAT the
           * posting says. Measured on uniqlo-hkm-headquarters (2026-09-10): two postings kept
           * `jobPostingInfo.startDate` in their archived raw while `postedAt`, `countryCode`, `city` and
           * `description` were all null, purely because their detail carried no employer label.
           * The hold is what protects the identity — it is kept, unchanged, and the posting stays unpublished
           * until an employer is proven. But the descriptive fields are now applied: they come from the same
           * archived document and are not a claim about the employer.
           */
          if (!employer) return {
            ...job,
            raw: { ...(job.raw as Record<string, unknown>), detail },
            publicationHold: 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL',
            description: htmlToPlainText(info.jobDescription) || job.description,
            country: info.country?.descriptor ?? job.country,
            location: info.location || job.location,
            postedAt: info.startDate ? new Date(info.startDate) : job.postedAt,
            validThrough: info.endDate ? new Date(info.endDate) : job.validThrough,
            workingTime: info.timeType || job.workingTime,
            remote: info.remoteType || job.remote,
          };
          return {
            ...job,
            publicationHold: job.publicationHold?.startsWith('WORKDAY_') ? undefined : job.publicationHold,
            // Keep the exact detail that supplied the employer, dates and country.
            // Preserve listing keys for replay and subsequent detail refreshes.
            raw: { ...(job.raw as Record<string, unknown>), detail },
            description: htmlToPlainText(info.jobDescription) || job.description,
            country: info.country?.descriptor ?? job.country,
            location: info.location ?? job.location,
            // F-05: the detail's startDate is a REAL date; the listing only
            // had "Posted N Days Ago".
            postedAt: info.startDate ? new Date(info.startDate) : job.postedAt,
            validThrough: info.endDate ? new Date(info.endDate) : job.validThrough,
            // `||` : Workday rend "" quand le tenant ne remplit pas le champ (2/100 chez Tapestry).
            workingTime: info.timeType || job.workingTime,
            remote: info.remoteType || job.remote,
            // Group tenants: credit the offer to its Maison, not the feed label.
            company: employer,
            // The evidence label is the one the identity gate matches: the brand read from
            // the alt, without the image's word "logo" (bounded lot L3, 2026-09-10: 136
            // postings refused as "HOKA Logo", "Richemont Logo", "Logo Pierre Fabre" while
            // `company` already carried the cleaned brand).
            employerEvidence: partitioned ? partitioned : brandFromLogoAlt(info.logoImage?.alt)
              ? { rawName: brandFromLogoAlt(info.logoImage?.alt)!, path: 'detail.jobPostingInfo.logoImage.alt', rule: /(^|\s)logo(\s|$)/i.test(info.logoImage!.alt!) ? 'LOGO_ALT_WORD_REMOVED' : 'LOGO_ALT' }
              : detail.hiringOrganization?.name?.trim()
                ? { rawName: detail.hiringOrganization.name, path: 'detail.hiringOrganization.name', rule: /^[A-Z]{0,2}\d+\s+/.test(detail.hiringOrganization.name.trim()) ? 'LEADING_ENTITY_CODE_REMOVED' : 'HIRING_ORGANIZATION_LABEL' }
                : job.employerEvidence,
          };
        } catch (error) {
          // A failed detail is not evidence that the listing belongs to the
          // GROUP printed in the catalogue. Keep the listing and the exact
          // diagnostic as a publication hold; it cannot attest absence.
          return { ...job, publicationHold: 'WORKDAY_DETAIL_FETCH_FAILED', raw: {
            ...(job.raw as Record<string, unknown>), detailFailure: error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: String(error) },
          } };
        }
      }),
    ),
  );
}

import type { PrismaClient, AtsType } from '@prisma/client';
import pLimit from 'p-limit';
import { plainHttpSources, type JobSource as SourceDef } from '../connectors/registry.js';
import { loadSourceCatalog, isApiSource, tierFor, sourceKeyFor } from '../connectors/sourceCatalog.js';
import { fetchSitemapUrls, fetchJobFromPage } from '../connectors/generic/jsonLdSitemap.js';
import { classifySector } from '../normalize/sector.js';
import { resolveCompany } from '../normalize/company.js';
import { normalizeContract, normalizeWorkingTime, isWorkingTimeValue, extractContract, extractSalaryBand } from '../normalize/contract.js';
import { isFranceJob } from '../lib/france.js';
import { htmlToPlainText } from '../lib/html.js';
import { coerceAmount, briefError } from '../lib/normalize.js';
import { normalizeSourceConfig } from '../connectors/sourceConfig.js';
import { isRotatingSource, nextPageFor, advanceCursor } from './sourceCursor.js';
import { upsertDeduplicated } from '../dedup/upsert.js';
import type { CandidateJob } from '../dedup/match.js';
import type { NormalizedJob } from '../types.js';
import { PIPELINE_VERSION } from './version.js';
import { runGeocode } from './geocodeJobs.js';
import { purgeStaleForSource } from './purge.js';
import { fetchAtsJobs } from '../ats/index.js';
import type { CatalogSource } from '../connectors/sourceCatalog.js';

/**
 * INGEST — picks up new and updated offers.
 *
 * Runs often and stays light: it reads sitemaps and feeds, then writes through
 * the deduplicating upsert so a duplicate never reaches the database, not even
 * for a second. Sector filtering happens BEFORE any write — on one Welcome to the
 * Jungle shard only 4.2% of French offers were in our vertical, so admitting
 * everything would drown the base in noise.
 */

/**
 * One HTTP request per offer at ~260ms measured means 500 offers take 2.2 min for
 * a single source, and eight sources 17 minutes — with no output until the very
 * end, so the container just looks hung. Hence real parallelism plus progress
 * logging: a silent pipeline is indistinguishable from a broken one.
 */
// Six, not twelve: every worker hits the same host, and twelve in parallel is
// what kept Courir's rate limiter tripped for a whole run (245 of 395 pages).
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 6);

/**
 * No cap by default: a ceiling silently truncates the market, and which offers
 * survive depends on sitemap order rather than on anything meaningful. Set
 * INGEST_MAX_PER_SOURCE only to bound an exceptional run.
 */
const MAX_JOBS_PER_SOURCE = Number(process.env.INGEST_MAX_PER_SOURCE ?? 0);

export type IngestStats = {
  source: string;
  fetched: number;
  inSector: number;
  france: number;
  created: number;
  merged: number;
  updated: number;
  errors: number;
};

function toCandidate(
  job: NormalizedJob,
  source: SourceDef,
  companyName: string,
  atsType: AtsType,
): CandidateJob & { companyId: string } {
  // Several ATS file "Full-time" / "Plein Temps" under contract, which is a
  // working time, not a contract type. Moved rather than dropped: the UI was
  // printing the source's raw English next to French contract labels.
  const misfiled = isWorkingTimeValue(job.contract);

  // Clean the description to plain text ONCE, at ingest, for every source: some
  // ship raw HTML (Greenhouse), some HTML-escaped HTML (Teamtailor). Done first
  // so the contract/salary extraction below reads clean text too, and so the
  // database holds only clean text and the web renders it directly.
  const description = htmlToPlainText(job.description);

  /**
   * The contract, from wherever the posting states it.
   *
   * Sources often leave the field empty while the title says "CDI 18H -
   * Vendeur" or the text opens with "CDI à pourvoir". Falling back to title
   * then description recovers most of them; the description is capped because
   * a long posting can name other contract types in passing ("après un stage
   * réussi…"), and the opening lines are where the real one is announced.
   */
  let contract = misfiled ? 'UNKNOWN' : normalizeContract(job.contract);
  if (contract === 'UNKNOWN') contract = extractContract(job.title, description);

  const workingTime = normalizeWorkingTime(misfiled ? job.contract : job.workingTime);

  // Coerce the structured salary at the boundary: a schema.org feed (Teamtailor)
  // hands minValue/maxValue over as strings ("75000"), and written through to an
  // Int? column that crashed job.create and lost the offer. A non-number becomes
  // undefined, which then lets the text extraction below recover a band.
  const salaryMin = coerceAmount(job.salaryMin);
  const salaryMax = coerceAmount(job.salaryMax);

  // Salary from prose when the structured field is empty: Galeries Lafayette
  // writes the band in the text, and a fiche without it reads half-finished.
  const salaryFromText =
    salaryMin === undefined && salaryMax === undefined ? extractSalaryBand(description) : null;

  return {
    ...job,
    description,
    salaryMin,
    salaryMax,
    // "UNKNOWN" is the normalizer's non-answer, not a value — stored as such
    // it is truthy, and the UI printed "Contrat : UNKNOWN" on every offer.
    contract: contract === 'UNKNOWN' ? undefined : contract,
    workingTime: workingTime === 'UNKNOWN' ? undefined : workingTime,
    ...(salaryFromText
      ? {
          salaryMin: salaryFromText.min,
          salaryMax: salaryFromText.max,
          salaryCurrency: 'EUR',
          salaryPeriod: salaryFromText.period,
        }
      : {}),
    // The resolved display name, not the raw source string: group ATS feeds
    // label every posting "<lead brand> +N", and that counter would otherwise
    // become the stored company name a candidate reads. resolveCompany strips it
    // and maps known brands to their canonical spelling, so the Company row, the
    // dedup key and the card all agree on one name.
    ...(() => {
      const identity = resolveCompany(companyName);
      return { company: identity.displayName, companyId: identity.companyId };
    })(),
    sourceKey: source.key,
    sourceTier: source.tier,
    atsType,
  };
}

async function ingestSitemapSource(
  prisma: PrismaClient,
  source: SourceDef,
  deadlineMs?: number,
): Promise<IngestStats> {
  const stats: IngestStats = {
    source: source.key,
    fetched: 0,
    inSector: 0,
    france: 0,
    created: 0,
    merged: 0,
    updated: 0,
    errors: 0,
  };

  // Sitemaps repeat themselves (shards overlap, alternates duplicate); a URL
  // fetched twice is wasted time and a guaranteed write race with itself.
  const all = [...new Set(await fetchSitemapUrls(source.entryUrl))];
  // Keep only real job pages: sitemaps mix in listings, utility routes and
  // editorial pages that carry no JobPosting and would burn the whole run.
  const jobUrls = source.jobUrlPattern ? all.filter((url) => source.jobUrlPattern!.test(url)) : all;

  /**
   * On a generalist board, classify from the URL before downloading anything.
   *
   * Welcome to the Jungle exposes 59,466 French jobs and only ~4% are in our
   * vertical. At ~260ms a page that is four hours of fetching to discard
   * nineteen pages in twenty — while the employer slug sits right there in the
   * URL and answers the question for free.
   */
  const inScopeUrls = source.employerSlugPattern
    ? jobUrls.filter((url) => {
        const slug = url.match(source.employerSlugPattern!)?.[1];
        return slug ? classifySector({ company: slug.replace(/-/g, ' ') }).inScope : false;
      })
    : jobUrls;

  const urls = MAX_JOBS_PER_SOURCE > 0 ? inScopeUrls.slice(0, MAX_JOBS_PER_SOURCE) : inScopeUrls;
  console.log(
    `[ingest] ${source.key}: ${urls.length} job URLs (of ${jobUrls.length} jobs / ${all.length} sitemap entries)`,
  );

  // A declared crawl-delay forces serial fetching; otherwise run in parallel.
  const limit = pLimit(source.crawlDelaySeconds ? 1 : CONCURRENCY);
  const delayMs = (source.crawlDelaySeconds ?? 0) * 1000;

  // Write as results arrive instead of buffering the whole source: a crash
  // partway through then keeps everything already ingested.
  let stoppedAtDeadline = false;
  await Promise.all(
    urls.map((url) =>
      limit(async () => {
        // Past the soft deadline, stop starting new fetches: Decathlon's
        // crawl-delay of 10s makes its 1225 pages a multi-hour sweep, so a run
        // covers what it can and the next continues. Everything already written
        // stays; only the unfetched tail is deferred.
        if (deadlineMs && Date.now() >= deadlineMs) {
          stoppedAtDeadline = true;
          return;
        }
        let job;
        try {
          job = await fetchJobFromPage(url);
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        } catch {
          stats.errors++;
          return;
        }
        if (!job) return;
        stats.fetched++;

        // The employer name comes from the posting when present; the registry
        // name is the fallback for feeds that omit it.
        const rawCompany =
          (job.raw as { hiringOrganization?: { name?: string } } | undefined)?.hiringOrganization
            ?.name ?? source.company;

        /**
         * Same rule as the API path: nothing is discarded, the web filters.
         *
         * The sector check stays a DISCARD only for generalist boards (flow
         * JOBBOARD, e.g. a WTTJ shard where 96% of offers are other
         * industries); an employer source is in the vertical by construction.
         * France is always just a stored flag.
         */
        const inSector = classifySector({ company: rawCompany, title: job.title }).inScope;
        if (source.flow === 'JOBBOARD' && !inSector) return;
        if (inSector) stats.inSector++;

        if (isFranceJob(job.country, job.location)) stats.france++;

        try {
          // A sitemap/JSON-LD source genuinely is GENERIC_JSONLD.
          const result = await upsertDeduplicated(
            prisma,
            toCandidate(job, source, rawCompany, 'GENERIC_JSONLD'),
          );
          if (result.outcome === 'CREATED') stats.created++;
          else if (result.outcome === 'MERGED') stats.merged++;
          else stats.updated++;
        } catch (error) {
          stats.errors++;
          if (stats.errors <= 3) console.error(`[ingest] ${source.key} write failed: ${briefError(error)}`);
        }
      }),
    ),
  );

  console.log(
    `[ingest] ${source.key}: ${stats.france} FR / ${stats.inSector} in-sector / ${stats.fetched} fetched -> ` +
      `${stats.created} created, ${stats.merged} merged, ${stats.errors} errors` +
      // A graceful stop is progress, not an error: say so plainly so a healthy
      // "continue next run" never reads as a failure in the logs.
      (stoppedAtDeadline ? ` (stopped at time budget, ${urls.length - stats.fetched - stats.errors} deferred to next run)` : ''),
  );
  return stats;
}

/**
 * Runs every plain-HTTP source. Browser-gated sources (FashionJobs, LVMH) are
 * handled by their own connectors, not here.
 */
/**
 * Catalogue rows that the sitemap connector can read: the ones with a job URL
 * pattern and no API. API-backed rows go through the ATS pipeline instead — one
 * request per employer rather than one per offer.
 */
function catalogSitemapSources(): SourceDef[] {
  return loadSourceCatalog()
    .filter((source) => !isApiSource(source) && source.jobUrlPattern)
    .map((source) => ({
      key: sourceKeyFor(source),
      company: source.maison.split('(')[0].trim(),
      flow: 'EMPLOYER' as const,
      tier: tierFor(source),
      kind: 'SITEMAP_JSONLD' as const,
      entryUrl: source.entryUrl,
      robotsVerdict: source.robotsVerdict,
      verifiedTotal: source.jobCount,
      verifiedOn: '2026-09-01',
      // The catalogue records a URL shape like ".../j/{slug}-{hex24}"; keep the
      // literal path segment before the first placeholder as the filter.
      jobUrlPattern: new RegExp(
        source.jobUrlPattern
          .replace(/^https?:\/\/[^/]+/, '')
          .split('{')[0]
          .replace(/[.*+?^$()|[\]\\]/g, '\\$&') || '/',
      ),
    }));
}

/** Catalogue `kind` -> the dispatcher's AtsType. */
export const KIND_TO_ATS: Record<string, string> = {
  successfactors: 'SUCCESSFACTORS',
  avature: 'AVATURE',
  eightfold: 'EIGHTFOLD',
  wttj: 'WTTJ',
  workday: 'WORKDAY',
  magnet: 'MAGNET',
  teamtailor: 'TEAMTAILOR',
  'smartrecruiters-whitelabel': 'SMARTRECRUITERS',
  workable: 'WORKABLE',
  talentview: 'TALENTVIEW',
  phenom: 'PHENOM',
  recruitee: 'RECRUITEE',
  lvmh_algolia: 'LVMH_ALGOLIA',
  ashby: 'ASHBY',
  lever: 'LEVER',
  pinpoint: 'PINPOINT',
  greenhouse: 'GREENHOUSE',
  gestmax: 'GENERIC_JSONLD',
  radancy: 'GENERIC_JSONLD',
  digitalrecruiters: 'DIGITALRECRUITERS',
  talentsoft: 'TALENTSOFT',
  personio: 'PERSONIO',
  eightfold_kering: 'EIGHTFOLD',
  wordpress: 'WORDPRESS',
  fashionjobs: 'FASHIONJOBS',
  'generic-listing': 'GENERIC_JSONLD',
};

/**
 * One API-backed catalogue feed: one listing call, then the write-time dedup.
 *
 * This path was MISSING: runIngest only ever consumed sitemap sources, so the
 * nineteen adapters — LVMH's 1200, Parfums Chanel's 1086, Kering's 1008 —
 * were tested, validated, and then called by nothing. The catalogue said
 * 20,378 offers; the pipeline could reach a fraction of them.
 */
async function ingestApiSource(
  prisma: PrismaClient,
  source: CatalogSource,
  deadlineMs?: number,
): Promise<IngestStats> {
  const stats: IngestStats = {
    source: sourceKeyFor(source),
    fetched: 0, inSector: 0, france: 0, created: 0, merged: 0, updated: 0, errors: 0,
  };

  const type = KIND_TO_ATS[source.kind];
  if (!type) {
    console.error(`[ingest] ${source.maison}: no adapter for kind "${source.kind}"`);
    stats.errors = 1;
    return stats;
  }

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(source.entryUrl || '{}');
  } catch {
    // Legacy rows keep a plain URL there; adapters that need one read origin.
    config = { origin: source.entryUrl };
  }

  // Resolve config-key synonyms before the adapter reads it: a discovery batch
  // may have written `careers_url` where the Teamtailor adapter expects
  // `origin`, and the unrecognised key fetched nothing — the live "origin
  // missing" failures. validateSources already did this; now the ingest agrees.
  // The deadline rides along so a slow crawler (FashionJobs) stops gracefully.
  config = { ...normalizeSourceConfig(config), deadlineMs };

  // A rotating source resumes partway through its listing so it re-sees every
  // offer within the lifecycle window instead of only ever the newest pages.
  const rotating = isRotatingSource(stats.source);
  const progress: { reachedEnd?: boolean } = {};
  let startPage = 1;
  if (rotating) {
    startPage = await nextPageFor(prisma, stats.source);
    config = { ...config, startPage, progress };
  }

  const jobs = await fetchAtsJobs(type as never, config);

  // Move the cursor forward for next run — after a successful fetch only, so a
  // failed crawl retries the same window rather than skipping it.
  if (rotating) {
    const next = await advanceCursor(prisma, stats.source, startPage, progress.reachedEnd === true);
    console.log(`[ingest] ${stats.source}: rotating crawl page ${startPage} → next run resumes at ${next}`);
  }
  stats.fetched = jobs.length;

  const sourceDef: SourceDef = {
    key: stats.source,
    company: source.maison.split('(')[0].trim(),
    flow: 'EMPLOYER',
    tier: tierFor(source),
    kind: 'SITEMAP_JSONLD',
    entryUrl: source.entryUrl,
    robotsVerdict: source.robotsVerdict,
    verifiedTotal: source.jobCount,
    verifiedOn: '2026-09-02',
  };

  for (const job of jobs) {
    // Group feeds carry the Maison per offer (LVMH: Sephora, Dior…); a
    // single-house feed falls back to the catalogue label.
    const employer = job.company || sourceDef.company;

    /**
     * NO sector filter and NO France filter here — keep everything, filter on
     * the web.
     *
     * A catalogue feed IS in the vertical by construction, and re-classifying
     * each offer against the reference list silently dropped Maisons the list
     * does not name — Cheval Blanc's 117 offers would have gone to the bin for
     * not being a CSV row. France likewise becomes a stored flag the site
     * filters on, not a reason to discard: an offer thrown away here cannot be
     * un-thrown when the product wants an international view.
     */
    stats.inSector++;
    if (isFranceJob(job.country, job.location)) stats.france++;

    try {
      // The catalogue feed carries its real vendor ATS (WORKDAY, GREENHOUSE…).
      const result = await upsertDeduplicated(
        prisma,
        toCandidate(job, sourceDef, employer, type as AtsType),
      );
      if (result.outcome === 'CREATED') stats.created++;
      else if (result.outcome === 'MERGED') stats.merged++;
      else stats.updated++;
    } catch (error) {
      stats.errors++;
      // briefError, not the raw message: a Prisma failure prints the whole
      // job.create payload (~90 lines), which flooded the log stream past its
      // rate cap and dropped other errors we then never saw.
      if (stats.errors <= 3) console.error(`[ingest] ${stats.source} write failed: ${briefError(error)}`);
    }
  }

  console.log(
    `[ingest] ${stats.source}: ${stats.france} FR / ${stats.inSector} in-sector / ${stats.fetched} fetched -> ` +
      `${stats.created} created, ${stats.merged} merged, ${stats.errors} errors`,
  );
  return stats;
}

/**
 * Did this source produce enough to justify purging its older-generation rows?
 *
 * A source that wrote nothing (returned an empty array, or every write failed)
 * must NOT trigger a purge: that is exactly the silent-zero failure mode, and
 * purging on it would delete the source's whole footprint. Only a source that
 * actually wrote offers this run has re-stamped them at the current version, so
 * only then is it safe to remove what it no longer lists.
 */
function producedOutput(stats: IngestStats): boolean {
  return stats.created + stats.merged + stats.updated > 0;
}

export type IngestOptions = {
  /**
   * Run a single source by its key (decision D6): each source becomes a short,
   * independent run, so one broken feed never takes the others down and a run
   * always finishes before the platform kills it. Absent = run every source.
   */
  only?: string;
  /**
   * A soft wall-clock deadline (epoch ms) for a slow crawl. The giants —
   * FashionJobs behind Cloudflare, Decathlon at crawl-delay 10s — cannot finish
   * inside the orchestrator's hard timeout AND cannot be sped up without
   * breaking robots.txt. So they stop THEMSELVES a little before it, keeping
   * every page already fetched (the listing is date-sorted and the database
   * accumulates across runs) — a graceful "continue next run" instead of the
   * hard timeout that discards the in-flight work.
   */
  deadlineMs?: number;
};

export async function runIngest(
  prisma: PrismaClient,
  options: IngestOptions = {},
): Promise<IngestStats[]> {
  const all = [...plainHttpSources(), ...catalogSitemapSources()].filter(
    (source) => source.kind === 'SITEMAP_JSONLD',
  );

  // The catalogue and the hand-written registry overlap; keep one entry per key.
  const byKey = new Map(all.map((source) => [source.key, source]));

  /**
   * No sector filter on the SOURCE any more.
   *
   * Filtering employers up front was losing real houses: Goyard (leather goods)
   * and Natalys (childrenswear) were both dropped because the reference list did
   * not hold their name. A false positive is visible and fixable; a missing
   * Maison is invisible. Offers are still classified individually at write time.
   */
  const sources = [...byKey.values()]
    .filter((source) => !options.only || source.key === options.only)
    // Cheapest sources first: a run cut short should still have written the
    // offers that cost least to obtain.
    .sort((a, b) => (a.crawlDelaySeconds ?? 0) - (b.crawlDelaySeconds ?? 0));

  // Only when there are any: the per-source orchestrator calls this with a
  // single source in one list and none in the other, so an unconditional line
  // printed "0 sitemap sources:" on every call — half the log stream was noise.
  if (sources.length > 0) {
    console.log(`[ingest] ${sources.length} sitemap sources: ${sources.map((s) => s.key).join(', ')}`);
  }
  const results: IngestStats[] = [];

  /**
   * Geocode incrementally, not only at the very end of the run.
   *
   * The map plots nothing without coordinates, and geocoding used to run
   * after ALL sources — on a multi-hour run that was killed by a redeploy,
   * it never ran at all, so production showed OSM tiles with zero markers.
   * A pass after each source keeps the map filling as offers land; the
   * GeoCache makes repeat passes nearly free.
   */
  const geocodeQuietly = async () => {
    try {
      await runGeocode(prisma);
    } catch (error) {
      console.error('[ingest] geocode pass failed:', error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Purge this source's older-generation rows — but only after it produced.
   *
   * A source that wrote nothing this run must not purge: that would delete its
   * whole footprint on the exact failure (silent zero) the purge must survive.
   * Runs per source, right after its success, so a later source that breaks
   * cannot undo it and can never empty the base.
   */
  const purgeQuietly = async (stats: IngestStats) => {
    if (!producedOutput(stats)) return;
    try {
      const purged = await purgeStaleForSource(prisma, stats.source, PIPELINE_VERSION);
      if (purged.jobsDeleted > 0 || purged.sourcesDetached > 0) {
        console.log(
          `[ingest] ${stats.source}: generation purge removed ${purged.jobsDeleted} stale jobs, ` +
            `detached ${purged.sourcesDetached} stale sources`,
        );
      }
    } catch (error) {
      console.error(`[ingest] ${stats.source} purge failed: ${briefError(error)}`);
    }
  };

  /**
   * API-backed catalogue feeds run FIRST — they are the bulk of the market and
   * the cheapest to obtain (one request per employer, not one per offer).
   *
   * Ordering matters: a full run of the heavy sitemap sources (L'Oréal 1725
   * pages, Decathlon 1240, Kering 1408, all fetched one page at a time) can
   * exceed the cron's time budget and be killed by the platform BEFORE the API
   * phase is ever reached — which is exactly why production held only a handful
   * of employers. Doing the API feeds first means the hundreds of Maisons they
   * expose are ingested even if the slow sitemap tail is cut short.
   *
   * Sequential on purpose: several portals serve many Maisons from one WAF, and
   * hammering one with parallel calls is what got the validation pass rate-limited.
   */
  const apiSources = loadSourceCatalog()
    .filter((source) => KIND_TO_ATS[source.kind])
    .filter((source) => !options.only || sourceKeyFor(source) === options.only);
  if (apiSources.length > 0) {
    console.log(`[ingest] ${apiSources.length} API feeds: ${apiSources.map((s) => sourceKeyFor(s)).join(', ')}`);
  }

  for (const source of apiSources) {
    try {
      const stats = await ingestApiSource(prisma, source, options.deadlineMs);
      results.push(stats);
      await purgeQuietly(stats);
      await geocodeQuietly();
    } catch (error) {
      results.push({
        source: sourceKeyFor(source),
        fetched: 0, inSector: 0, france: 0, created: 0, merged: 0, updated: 0, errors: 1,
      });
      console.error(`[ingest] ${sourceKeyFor(source)} failed: ${briefError(error)}`);
    }
  }

  // Sitemap sources LAST: heaviest and slowest, so if the run is cut short here
  // the API feeds above have already produced.
  for (const source of sources) {
    try {
      const stats = await ingestSitemapSource(prisma, source, options.deadlineMs);
      results.push(stats);
      await purgeQuietly(stats);
      await geocodeQuietly();
    } catch (error) {
      results.push({
        source: source.key,
        fetched: 0,
        inSector: 0,
        france: 0,
        created: 0,
        merged: 0,
        updated: 0,
        errors: 1,
      });
      console.error(
        `[ingest] ${source.key} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return results;
}

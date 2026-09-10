import { log } from '../../observability/logger.js';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { fetchText } from '../../lib/http.js';
import { fetchSitemapUrlsDetailed, extractJobPostings, normalizeJobPosting } from '../../connectors/generic/jsonLdSitemap.js';
import { fetchRssJobs } from '../../connectors/generic/rssFeed.js';
import { collapseWhitespace, briefError } from '../../lib/normalize.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * The publisher's own count of listed postings, read on a listing page: a data
 * attribute (`data-result-count="135"` — Beiersdorf) or a visible counter
 * ("54 open positions" — Luxexperience). `marker`, when configured, is a LITERAL
 * prefix immediately followed by the number (data, never a regex — audit R-02).
 * Returns undefined when no counter is printed: nothing is invented.
 */
export function parseListingCount(html: string, marker?: unknown): number | undefined {
  const literal = typeof marker === 'string' && marker.trim() ? marker.trim() : null;
  if (literal) {
    const i = html.indexOf(literal);
    const m = i >= 0 ? /^\s*"?\s*(\d[\d\s.,]*)/.exec(html.slice(i + literal.length, i + literal.length + 40)) : null;
    return m ? Number(m[1].replace(/[\s.,]/g, '')) : undefined;
  }
  const attr = /data-(?:result-count|total-count|total|count|results)="(\d+)"/i.exec(html);
  if (attr) return Number(attr[1]);
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const visible = /(\d{1,3}(?:[\s.,]\d{3})*|\d+)\s*(?:open positions?|open roles?|job openings?|positions?|jobs?|vacancies|vacatures?|offres?(?: d'emploi)?|postes?|stellen(?:angebote)?|résultats?|results?)\b/i.exec(text);
  return visible ? Number(visible[1].replace(/[\s.,]/g, '')) : undefined;
}

function flattenJsonLd(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === 'object' && '@graph' in (value as any)) return flattenJsonLd((value as any)['@graph']);
  return value && typeof value === 'object' ? [value] : [];
}

/**
 * Exported so the identity rule can be tested without fetching a live board.
 *
 * A thin wrapper over the shared JSON-LD reader. This file used to carry its
 * own copy of the parser, and the two drifted: the shared one learned to
 * decode numeric entities and to retry JSON containing raw control characters
 * (Michael Page embeds literal newlines in every description), while this copy
 * silently parsed nothing on those pages. One parser, one set of lessons.
 */
export function parseJobPostings(html: string, pageUrl: string): NormalizedJob[] {
  return extractJobPostings(html)
    .map((node) => normalizeJobPosting(node, pageUrl))
    .filter((job): job is NormalizedJob => job !== null)
    .map((job) => ({
      ...job,
      // Stable, compact identity for the (source, externalId) unique key.
      externalId: createHash('sha1').update(pageUrl).digest('hex'),
    }));
}

/** Signatures des pages de challenge (Cloudflare, Akamai, AWS WAF) servies à la place d'une liste. */
const CHALLENGE_PAGE = /just a moment|cf-chl|cf_chl|challenge-platform|_Incapsula_|aws-waf|awswaf|Access Denied|Attention Required/i;

export async function fetchGenericJsonLdJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  /**
   * An RSS/Atom careers feed, when the site publishes one — the cheapest generic
   * path (no page crawl at all). Many small brands and TalentSoft/WordPress sites
   * expose a feed of openings; parsing it needs no per-vendor code.
   */
  if (config.feedUrl) {
    return { jobs: await fetchRssJobs(config), complete: false };
  }

  /**
   * A sitemap of job URLs, when the board publishes one.
   *
   * Preferred over link-crawling a start page: it is the site's own list, so it
   * neither misses offers that no page links to nor wanders into unrelated
   * routes. Courir publishes 397 offers this way, each page carrying a complete
   * JobPosting — which is how it is read without touching
   * api.smartrecruiters.com, whose robots.txt permits only LinkedInBot.
   *
   * Sitemaps do go stale (one vendor's listed 65 job URLs, all dead), so a page
   * that no longer parses is skipped rather than failing the run.
   */
  /**
   * A server-rendered, paginated listing whose cards link to detail pages.
   *
   * Michael Page's shape: /jobs?page=N (0-based) serves 20 links per page and
   * the detail pages carry a complete JobPosting. No sitemap of offers exists
   * there, so the listing IS the enumeration. Pages are read until one repeats
   * or comes back short — a pager that answers every page number with page 1
   * is a documented trap (Radancy), so repetition is the stop signal, not the
   * page count.
   */
  const listingPagedUrl = String(config.listingUrl ?? '');
  const linkPattern = String(config.linkPattern ?? '');
  // A soft wall-clock budget, honoured by both phases below: a big listing
  // (Michael Page ~3800 offers) can overrun the run's timeout, so it stops
  // gracefully with what it has rather than being cut mid-flight.
  const deadlineMs = Number(config.deadlineMs) || 0;
  const pastDeadline = () => deadlineMs > 0 && Date.now() >= deadlineMs;
  if (listingPagedUrl && linkPattern) {
    const pageParam = String(config.pageParam ?? 'page');
    // The pattern comes from a CSV column — data, not code. Escaped so a
    // crafted catalogue value can never become an arbitrary regex (audit R-02);
    // every existing pattern is a literal path fragment anyway.
    // Several literal fragments may be given, separated by "|" (Beiersdorf lists
    // English postings under career/jobs/ and German-only ones under
    // karriere/jobs/ — 109 + 26 of the 135 the board announces). Each fragment
    // is escaped; the separator never becomes regex syntax from the fragments.
    const escaped = linkPattern.split('|').map((f) => f.trim()).filter(Boolean).map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const linkRe = new RegExp(`href="([^"]*(?:${escaped})[^"]*)"`, 'g');
    const seen = new Set<string>();
    const origin = new URL(listingPagedUrl).origin;

    let reachedEnd = false;
    let termination = 'PAGE_BUDGET_EXHAUSTED', pagesRead = 0, rawLinks = 0;
    /**
     * Enumeration proof for a paginated listing (2026-09-10). Three real boards
     * defeated "a repeated page is a broken pager": Beiersdorf answers every page
     * past the 14th with the last five links, Globus serves the same single page
     * whatever the page number, Luxexperience repeats its 6th page. What proves the
     * board is the PUBLISHER'S OWN COUNT when the page carries one
     * (`data-result-count="135"`, "54 open positions"; `config.countPattern` may
     * name another marker): every announced link seen = complete. Without a count,
     * a byte-identical second page is an unpaginated listing read in full; a
     * repeated page with new links still missing stays a broken pager.
     */
    let publisherCount: number | undefined;
    let previousPageSha = '';
    for (let page = 0; page < Number(config.maxPages ?? 400); page++) {
      if (pastDeadline()) { termination = 'DEADLINE'; break; }
      const sep = listingPagedUrl.includes('?') ? '&' : '?';
      // The end of a paginated listing is signalled one of two ways, and both
      // mean "stop here with what we have", not "fail the source": Michael Page
      // 404s the page after the last (…/jobs?page=191), others just return a page
      // with no offer links. A 404 thrown here used to propagate and discard
      // every offer already collected — the live "michael-page-france failed".
      // A non-404 error (an exhausted-retry blip) also stops the sweep rather
      // than losing the whole source; the pages already collected still ingest.
      let html: string;
      try {
        /**
         * Deux formes de pagination : en QUERY (`/jobs?page=N`, Michael Page,
         * 0-based) ou en CHEMIN (`/jobs/page/N`, Pandora sur TalentHub, 1-based).
         * Un `{page}` dans l'URL de listing désigne la seconde ; sans lui, on
         * ajoute le paramètre comme avant. Mesuré le 2026-09-05 : Pandora
         * rendait 10 offres — la page 1 seule — quand elle en a ~1 800 sur 180
         * pages. `pageStart` (défaut 0) porte l'origine de la numérotation.
         */
        const pageNumber = page + Number(config.pageStart ?? 0);
        const pageUrl = listingPagedUrl.includes('{page}')
          ? listingPagedUrl.replace('{page}', String(pageNumber))
          : `${listingPagedUrl}${sep}${pageParam}=${pageNumber}`;
        html = await fetchText(pageUrl, {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
        });
      } catch (error) {
        const is404 = error instanceof Error && / 404 /.test(` ${error.message} `);
        if (is404 && page > 0) reachedEnd = true;
        termination = is404 && page > 0 ? 'HTTP_404_AFTER_LAST_PAGE' : 'LISTING_FETCH_FAILED';
        if (!is404) {
          await log.error('adapter.listing_failed', `[generic-listing] ${listingPagedUrl} stopped at page ${page}: ${briefError(error)}`, { error });
        }
        break;
      }
      pagesRead++;
      const pageSha = createHash('sha256').update(html).digest('hex');
      if (publisherCount === undefined) publisherCount = parseListingCount(html, config.countPattern);
      const pageLinks = [...html.matchAll(linkRe)]
        .map((m) => new URL(m[1], origin).toString().split('#')[0]);
      rawLinks += pageLinks.length;
      const links = pageLinks.filter(u => !seen.has(u));
      // A byte-identical page. Once the publisher's count is met it is the clamped
      // end of the board; on the SECOND page of a listing that never paginated it
      // is an unpaginated listing read in full (Globus); anywhere else it is a
      // pager stuck on a page while announced links are still missing.
      if (page > 0 && pageSha === previousPageSha) {
        const countMet = publisherCount !== undefined && seen.size >= publisherCount;
        if (countMet) { reachedEnd = true; termination = 'PUBLISHER_COUNT_REACHED'; }
        else if (page === 1 && publisherCount === undefined) { reachedEnd = true; termination = 'IDENTICAL_PAGE'; }
        else { reachedEnd = false; termination = 'REPEATED_PAGE'; }
        break;
      }
      previousPageSha = pageSha;
      /**
       * Une page de liste sans lien est la fin de la liste — SAUF si c'est une
       * page de challenge servie au milieu du balayage. Mesuré le 2026-09-06
       * sur Michael Page : 1 450 offres au lieu de ~2 900, la page ~72 était un
       * challenge Cloudflare, prise pour la fin, et la moitié du board manquait
       * en silence. Un challenge en cours de liste est une panne nommée.
       */
      if (links.length === 0 && seen.size > 0 && CHALLENGE_PAGE.test(html)) {
        throw new Error(
          `generic-listing ${listingPagedUrl}: page ${page} est une page de challenge (${seen.size} liens avant) — liste tronquée par un bot-wall`,
        );
      }
      if (links.length === 0) {
        // A repeated nonempty page is a broken pager, not proof of the end —
        // unless every link the publisher announces has already been seen
        // (Beiersdorf clamps page 15+ to its last five links after all 135;
        // Luxexperience repeats its 6th page after its 54).
        const countMet = publisherCount !== undefined && seen.size >= publisherCount;
        reachedEnd = pageLinks.length === 0 || countMet;
        termination = pageLinks.length === 0 ? 'EMPTY_PAGE' : countMet ? 'PUBLISHER_COUNT_REACHED' : 'REPEATED_PAGE';
        break;
      }
      for (const u of links) seen.add(u);
    }

    // F-06: a paginated listing that yields ZERO offer links is a broken
    // linkPattern or a moved listing — not an employer with no openings. The
    // silent [] passed for health until the refresh emptied the source 48h on.
    if (seen.size === 0 && !pastDeadline()) {
      throw new Error(`generic-listing ${listingPagedUrl}: no offer link matched "${linkPattern}" — pattern or listing broken`);
    }

    const limit = pLimit(Number(config.concurrency ?? 4));
    let detailFailures = 0;
    const pages = await Promise.all(
      [...seen].map((url) =>
        limit(async () => {
          // Stop starting new detail fetches past the budget; what was already
          // fetched stays, the rest is picked up next run.
          if (pastDeadline()) { detailFailures++; return []; }
          try {
            const parsed = parseJobPostings(
              await fetchText(url, {
                headers: {
                  'user-agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
              }),
              url,
            );
            if (parsed.length === 0) detailFailures++;
            return parsed;
          } catch {
            detailFailures++;
            return [];
          }
        }),
      ),
    );
    const jobs = pages.flat();
    /**
     * Zéro silencieux, deuxième forme (mesurée le 2026-09-06 sur Michael Page,
     * un run sur deux) : la liste rend ses liens, mais AUCUNE page de détail ne
     * rend d'offre — soit elles échouent (403), soit elles répondent une page de
     * challenge sans JobPosting. Chaque échec avalé en [] donnait « 0 fetched,
     * 0 errors » : la source passait BROKEN sans qu'une ligne dise pourquoi. Un
     * échec total est une panne à nommer, pas un employeur sans poste.
     */
    if (seen.size > 0 && jobs.length === 0 && !pastDeadline()) {
      throw new Error(
        `generic-listing ${listingPagedUrl}: ${seen.size} lien${seen.size > 1 ? 's' : ''} d'offre, ` +
          `0 offre lue, ${detailFailures} échec${detailFailures > 1 ? 's' : ''} de détail — ` +
          `pages de détail bloquées ou sans JobPosting`,
      );
    }
    // Below the publisher's own count, the listing is not proven even when its
    // pager ended cleanly: the links the board announces and never lists are a
    // named gap (Beiersdorf with the English-only pattern: 109 of 135).
    const belowCount = publisherCount !== undefined && seen.size < publisherCount;
    const complete = reachedEnd && detailFailures === 0 && !belowCount;
    const issues = complete ? [] : [termination === 'REPEATED_PAGE' ? 'BROKEN_PAGER_REPEATS_LAST_PAGE' : termination, ...(belowCount ? [`LINKS_BELOW_PUBLISHER_COUNT=${seen.size}/${publisherCount}`] : []), ...(detailFailures ? [`DETAIL_FAILURES=${detailFailures}`] : []), 'ENUMERATION_NOT_PROVEN'].filter((v, i, a) => a.indexOf(v) === i);
    return { jobs, declaredTotal: publisherCount ?? seen.size, complete, truncated: !reachedEnd || detailFailures > 0 || belowCount,
      enumeration: { method: 'PAGINATED_LISTING_WITH_DETAIL_READ', endpoint: listingPagedUrl, pages: pagesRead, rawCount: rawLinks, termination, issues,
        scopes: [
          ...(publisherCount !== undefined ? [{ scope: 'publisherCount', declaredTotal: publisherCount, uniqueIds: seen.size, pages: pagesRead, complete: seen.size >= publisherCount }] : []),
          { scope: 'listedLinks', declaredTotal: publisherCount ?? seen.size, uniqueIds: seen.size, pages: pagesRead, complete: reachedEnd && !belowCount },
          { scope: 'postingsParsed', declaredTotal: seen.size, uniqueIds: jobs.length, pages: pagesRead, complete }] } };
  }

  const sitemapUrl = String(config.sitemapUrl ?? '');
  if (sitemapUrl) {
    const sitemap = await fetchSitemapUrlsDetailed(sitemapUrl);
    const urls = [...new Set(sitemap.urls)];
    // F-06: an empty sitemap on a catalogued source is the sitemap moving or
    // dying, not zero openings — say so instead of a quiet [].
    if (urls.length === 0) {
      throw new Error(`generic sitemap ${sitemapUrl}: 0 URLs — sitemap moved or empty`);
    }
    const limit = pLimit(Number(config.concurrency ?? 4));
    /**
     * Completeness of a sitemap read is the sum of three facts, each counted:
     * every shard of the index was read; every listed URL was fetched; every
     * fetched page carried a JobPosting. A listed page that answers without a
     * JobPosting (expired, moved) is retained as a rejected row, not lost and
     * not counted as an offer; a fetch failure blocks the proof.
     */
    const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
    let fetchFailures = 0;
    const pages = await Promise.all(
      urls.map((url) =>
        limit(async () => {
          try {
            // A browser UA is required here: several boards serve the sitemap to
            // anything but 403 the job pages without one.
            const parsed = parseJobPostings(
              await fetchText(url, {
                headers: {
                  'user-agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
              }),
              url,
            );
            if (parsed.length === 0) rejectedRows.push({ reason: 'LISTED_PAGE_WITHOUT_JOBPOSTING', raw: { url } });
            return parsed;
          } catch (error) {
            fetchFailures++;
            rejectedRows.push({ reason: 'LISTED_PAGE_FETCH_FAILED', raw: { url, error: String(error).slice(0, 200) } });
            return [];
          }
        }),
      ),
    );

    const seen = new Set<string>();
    const jobs = pages.flat().filter((job) => {
      if (seen.has(job.externalId)) return false;
      seen.add(job.externalId);
      return true;
    });
    const complete = sitemap.failedShards.length === 0 && fetchFailures === 0;
    const issues = [...(sitemap.failedShards.length ? [`UNREACHABLE_SHARDS=${sitemap.failedShards.length}`] : []), ...(fetchFailures ? [`PAGE_FETCH_FAILURES=${fetchFailures}`] : []), ...(complete ? [] : ['ENUMERATION_NOT_PROVEN'])];
    return { jobs, declaredTotal: urls.length, complete, truncated: !complete, rejectedRows,
      enumeration: { method: sitemap.isIndex ? 'SITEMAP_INDEX_WITH_DETAIL_READ' : 'SITEMAP_URLSET_WITH_DETAIL_READ', endpoint: sitemapUrl, pages: sitemap.shards.length, rawCount: sitemap.urls.length, termination: complete ? 'ALL_LISTED_PAGES_READ' : 'LISTED_PAGES_MISSING', issues,
        scopes: [{ scope: 'shards', declaredTotal: sitemap.shards.length, uniqueIds: sitemap.shards.length - sitemap.failedShards.length, pages: sitemap.shards.length, complete: sitemap.failedShards.length === 0 },
                 { scope: 'listedUrls', declaredTotal: urls.length, uniqueIds: urls.length - fetchFailures, pages: sitemap.shards.length, complete: fetchFailures === 0 },
                 { scope: 'postingsParsed', declaredTotal: urls.length, uniqueIds: jobs.length, pages: sitemap.shards.length, complete }] } };
  }

  const startUrl = String(config.startUrl ?? '');
  if (!startUrl) throw new Error('Generic JSON-LD startUrl or sitemapUrl required');
  const html = await fetchText(startUrl);
  const direct = parseJobPostings(html, startUrl);
  const $ = cheerio.load(html);
  const origin = new URL(startUrl).origin;
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, startUrl);
      if (url.origin !== origin) return;
      if (/job|jobs|career|carriere|carrière|recrutement|vacanc/i.test(url.pathname)) links.add(url.toString());
    } catch { /* ignore */ }
  });
  const limit = pLimit(3);
  const pages = await Promise.all([...links].slice(0, 150).map((url) => limit(async () => {
    try { return parseJobPostings(await fetchText(url), url); } catch { return []; }
  })));
  const byKey = new Map<string, NormalizedJob>();
  for (const job of [...direct, ...pages.flat()]) byKey.set(`${job.externalId}|${job.url}`, job);
  // A start-page link crawl reads what ONE page links to (capped at 150): it
  // can never prove a board's extent. The evidence says so instead of staying silent.
  return { jobs: [...byKey.values()], complete: false, truncated: links.size > 150,
    enumeration: { method: 'START_PAGE_LINK_CRAWL_NO_ENUMERATION_PROOF', endpoint: startUrl, pages: 1, rawCount: links.size, termination: links.size > 150 ? 'LINK_CAP_150' : 'LINKS_EXHAUSTED', issues: ['NO_PUBLISHER_LISTING_OR_SITEMAP', 'ENUMERATION_NOT_PROVEN'] } };
}

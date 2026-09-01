import { fetchRenderedHtml } from '../../lib/browser.js';
import { extractJobPostings, normalizeJobPosting } from '../generic/jsonLdSitemap.js';
import type { NormalizedJob } from '../../types.js';

/**
 * FashionJobs offers, read through its company pages.
 *
 * Two things I got wrong earlier and that are worth recording:
 *
 * 1. Its offer pages are NOT robots-disallowed. Only the search URLs are:
 *    `Disallow: /s/?keyword=*`, `/s/?soc=*`, `/s/ajax/` and so on. The offer
 *    path `/emploi/{company}/{slug},{id}.html` carries no restriction, and the
 *    company pages `/recrutement/{slug}.html` that link to them are explicitly
 *    allowed. Reaching offers through company pages therefore stays entirely
 *    inside what the site permits, without touching a single `/s/` URL.
 *
 * 2. Those offer pages DO carry full JSON-LD. Verified 2026-09-01 on a Dior
 *    posting: title, datePosted, employmentType, jobLocation, hiringOrganization,
 *    validThrough and a 4868-character description.
 *
 * The whole domain sits behind Cloudflare, so every request goes through the
 * browser transport — plain fetch gets 403 on every path, robots.txt included.
 */

const BASE = 'https://fr.fashionjobs.com';

/**
 * Offer links on a company page.
 *
 * Matches href with either quote style and both absolute and relative forms:
 * the rendered DOM does not always use the double-quoted relative shape the
 * source HTML has, and a stricter pattern silently returns zero links.
 */
const OFFER_LINK = /href=["'](?:https?:\/\/fr\.fashionjobs\.com)?(\/emploi\/[^"']+\.html)["']/gi;

export function parseOfferLinks(html: string): string[] {
  const links = [...html.matchAll(OFFER_LINK)].map((match) => `${BASE}${match[1]}`);
  return [...new Set(links)];
}

/** Offer URLs listed on one company page (`/recrutement/{slug}.html`). */
export async function fetchCompanyOfferUrls(companySlug: string): Promise<string[]> {
  const html = await fetchRenderedHtml(`${BASE}/recrutement/${encodeURIComponent(companySlug)}.html`);
  return parseOfferLinks(html);
}

/** Reads one offer page. Returns null when the posting has no JobPosting block. */
export async function fetchOffer(offerUrl: string): Promise<NormalizedJob | null> {
  const html = await fetchRenderedHtml(offerUrl);
  const [posting] = extractJobPostings(html);
  return posting ? normalizeJobPosting(posting, offerUrl) : null;
}

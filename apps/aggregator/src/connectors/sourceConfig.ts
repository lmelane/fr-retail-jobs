/**
 * Source-config key normalization.
 *
 * The catalogue was assembled from eight independent discovery batches, and each
 * agent wrote its own config shape: one Teamtailor row says `origin`, another
 * says `careers_url`; a sitemap is `sitemap`, `sitemap_url` or `sitemapUrl`. An
 * adapter reads the ONE canonical key it expects, and a key it does not
 * recognise fetches nothing and returns [] — indistinguishable from an employer
 * with no openings. Live, that surfaced as "Teamtailor origin missing" on
 * Showroomprive/Soeur, whose config carried `careers_url` but not `origin`.
 *
 * validateSources already resolved these synonyms, but only in its own pass;
 * the live ingest read the raw config and failed. This is the shared resolver so
 * both agree, and no working source is lost to a wording difference.
 */

/** Config key aliases, so one agent's wording does not lose a working source. */
export const CONFIG_ALIASES: Record<string, string[]> = {
  slug: ['slug', 'org_slug', 'organization', 'organisation', 'company_slug', 'board_token'],
  origin: ['origin', 'careers_url', 'career_site', 'board_url', 'public_careers_url', 'domain', 'host'],
  account: ['account', 'account_slug', 'company', 'subdomain', 'enseigne'],
  tenant: ['tenant'],
  site: ['site'],
  siteKey: ['siteKey', 'site_key'],
  listingUrl: ['listingUrl', 'listing_url', 'jobs_url', 'jobs_html'],
  sitemapUrl: ['sitemapUrl', 'sitemap', 'sitemap_url'],
};

/**
 * Fills in the canonical key an adapter expects from whatever synonym the agent
 * wrote. Non-destructive: the original keys stay, so an adapter reading either
 * still wins, and a config that already has the canonical key is untouched.
 */
export function normalizeSourceConfig(config: Record<string, unknown>): Record<string, unknown> {
  const filled = { ...config };
  for (const [canonical, synonyms] of Object.entries(CONFIG_ALIASES)) {
    if (filled[canonical] !== undefined && filled[canonical] !== '') continue;
    const hit = synonyms.find((key) => config[key] !== undefined && config[key] !== '');
    if (hit) filled[canonical] = config[hit];
  }
  return filled;
}

/**
 * Verified public job sources for the Catwalks vertical.
 *
 * Every entry here was confirmed with a real HTTP request on the date noted, and
 * every domain's robots.txt was read before inclusion. Nothing is listed on the
 * strength of a guess or a vendor's documentation.
 *
 * Rule of thumb applied throughout: prefer the EMPLOYER's own careers domain over
 * a vendor API. api.smartrecruiters.com reserves /v1/companies/ for LinkedInBot
 * and sends `User-agent: * / Disallow: /`, while the employer domain it redirects
 * to (jobs.courir.com) publishes `Allow: /` and a job sitemap. Same jobs, clean
 * route, and the apply URL is the employer's own.
 */

export type SourceKind =
  /** XML sitemap of job URLs; each page carries schema.org JobPosting JSON-LD. */
  | 'SITEMAP_JSONLD'
  /** Single XML feed already containing every job and its description. */
  | 'XML_FEED'
  /** Employer-specific public JSON API. */
  | 'PUBLIC_API'
  /** Reachable only by executing page JS (Cloudflare, or a client-side listing). */
  | 'BROWSER_REQUIRED';

export type JobSource = {
  key: string;
  /** Employer or group as displayed. */
  company: string;
  kind: SourceKind;
  /** The URL that enumerates jobs. */
  entryUrl: string;
  robotsVerdict: string;
  /** Total jobs seen at verification time, all countries. */
  verifiedTotal?: number;
  /** Of which France — the number that actually matters here. */
  verifiedFrance?: number;
  /** ISO date of the last live verification. */
  verifiedOn: string;
  /** Seconds to wait between requests when the host asks for it. */
  crawlDelaySeconds?: number;
  notes?: string;
};

export const JOB_SOURCES: readonly JobSource[] = [
  {
    key: 'richemont',
    company: 'Richemont (Cartier, Van Cleef & Arpels, …)',
    kind: 'XML_FEED',
    entryUrl: 'https://careers.richemont.com/fr/offres-demploi/xml/?rss=true',
    robotsVerdict: 'User-agent: * unrestricted; named bots throttled (crawl-delay 1-2s)',
    verifiedTotal: 1342,
    verifiedFrance: 228,
    verifiedOn: '2026-09-01',
    crawlDelaySeconds: 2,
    notes:
      'Best ratio: one 6.5MB request returns every job WITH full descriptions. Root is <source>, ' +
      'entries are <job> (NOT RSS <item>). Caveat: `company` is "Richemont" on all 1342 rows, so the ' +
      'Maison (Cartier/VCA) must be inferred elsewhere. Job DETAIL pages are Cloudflare-403, but the ' +
      'feed already carries descriptions so that does not block us.',
  },
  {
    key: 'decathlon',
    company: 'Decathlon',
    kind: 'SITEMAP_JSONLD',
    entryUrl: 'https://joinus.decathlon.fr/sitemap.xml',
    robotsVerdict: 'User-agent: * / Allow: / / Crawl-delay: 10',
    verifiedTotal: 1240,
    verifiedOn: '2026-09-01',
    crawlDelaySeconds: 10,
    notes:
      'Highest French volume found. DigitalRecruiters /fr/annonce/{id}-{slug}. Honour crawl-delay 10.',
  },
  {
    key: 'sephora',
    company: 'Sephora',
    kind: 'XML_FEED',
    entryUrl: 'https://jobs.sephora.com/sitemap.xml',
    robotsVerdict: 'User-agent: *; only /applybutton/, /talentcommunity/, /services/, /preapply/ … disallowed. Jobs allowed.',
    verifiedTotal: 1711,
    verifiedFrance: 155,
    verifiedOn: '2026-09-01',
    notes:
      'Despite the filename this is a Google Jobs RSS feed (<item> + xmlns:g), not a sitemap. ' +
      'Fields: title, link, g:id, g:employer, g:location ("THIAIS, FR"), g:expiration_date. ' +
      'Detail pages use Microdata, not JSON-LD.',
  },
  {
    key: 'courir',
    company: 'Groupe Courir',
    kind: 'SITEMAP_JSONLD',
    entryUrl: 'https://jobs.courir.com/job-sitemap.xml',
    robotsVerdict: 'User-agent: * / Allow: /  (job-sitemap.xml declared)',
    verifiedTotal: 397,
    verifiedOn: '2026-09-01',
    notes:
      'Reference implementation for the generic JSON-LD connector: 397 URLs, 5/5 parsed, ' +
      'addressCountry "fr" reliable. Preferred over the SmartRecruiters API for the same jobs.',
  },
  {
    key: 'lacoste',
    company: 'Lacoste',
    kind: 'SITEMAP_JSONLD',
    entryUrl: 'https://careers.lacoste.com/sitemap.xml',
    robotsVerdict: 'User-agent: * / Allow: / / Crawl-delay: 10',
    verifiedTotal: 479,
    verifiedFrance: 98,
    verifiedOn: '2026-09-01',
    crawlDelaySeconds: 10,
    notes: 'DigitalRecruiters, same shape as Decathlon — one parser covers both.',
  },
  {
    key: 'loreal',
    company: "L'Oréal",
    kind: 'SITEMAP_JSONLD',
    entryUrl: 'https://careers.loreal.com/fr_FR/jobs/sitemap.xml',
    robotsVerdict: 'Allow: /jobs; Disallow: /jobs/*qtvc= only',
    verifiedTotal: 1562,
    verifiedOn: '2026-09-01',
    notes: 'Avature. JSON-LD is thin (title + datePosted); detail pages need HTML parsing.',
  },
  {
    key: 'kering',
    company: 'Kering (Gucci, Saint Laurent, Balenciaga, …)',
    kind: 'SITEMAP_JSONLD',
    entryUrl: 'https://www.kering.com/fr/sitemap.xml',
    robotsVerdict:
      'Allow: /. The only Disallow entries (/*?*page=, /*?*search_career=) target the search ' +
      "engine's query strings, NOT the offers: every job has its own clean URL in the sitemap.",
    verifiedTotal: 1428,
    verifiedOn: '2026-09-01',
    notes:
      'Verified: sitemap returns 1428 job URLs directly, no pagination involved. A detail page ' +
      '(Saint Laurent, Paris) yields full JSON-LD: title, datePosted, employmentType, ' +
      'hiringOrganization, jobLocation with addressCountry "FR". The generic connector reads it as-is. ' +
      'Still filter on datePosted — the sitemap retains closed postings that keep returning HTTP 200.',
  },
  {
    key: 'galeries-lafayette',
    company: 'Galeries Lafayette',
    kind: 'SITEMAP_JSONLD',
    entryUrl: 'https://carrieres.groupegalerieslafayette.com/sitemap.xml',
    robotsVerdict: 'User-Agent: *; only /app/, /messages/, /jobs/internal/ … disallowed. Public /jobs/ allowed.',
    verifiedTotal: 145,
    verifiedOn: '2026-09-01',
    notes:
      'Teamtailor. Richest JSON-LD of the set (includes baseSalary EUR/YEAR). ' +
      'Do NOT use careers.smartrecruiters.com/GaleriesLafayette — dormant, newest posting ~18 months old.',
  },
  {
    key: 'hermes',
    company: 'Hermès',
    kind: 'PUBLIC_API',
    entryUrl: 'https://talents.hermes.com/',
    robotsVerdict: 'No robots.txt served (302); nothing declared',
    verifiedTotal: 640,
    verifiedOn: '2026-09-01',
    notes:
      'Oracle Recruiting Cloud, recruitingCEJobRequisitions endpoint. ~74% France. ' +
      'Undocumented and tenant-specific — re-verify before relying on it.',
  },
  {
    key: 'puig',
    company: 'Puig',
    kind: 'SITEMAP_JSONLD',
    entryUrl: 'https://jobs.puig.com/job-sitemap.xml',
    robotsVerdict: 'Disallow limited to /applybutton/, /talentcommunity/, /services/, /preapply/ …; /job/ allowed',
    verifiedTotal: 210,
    verifiedFrance: 51,
    verifiedOn: '2026-09-01',
    notes: 'Phenom, exposes Microdata rather than JSON-LD — the parser must handle itemprop.',
  },
  {
    key: 'lvmh',
    company: 'LVMH (76 Maisons: Dior, Louis Vuitton, Sephora, Bon Marché, …)',
    kind: 'BROWSER_REQUIRED',
    entryUrl: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
    robotsVerdict: 'Allow: /; Disallow: /*espace-candidat and /*candidate-portal — the APPLICATION portal, never crawled',
    verifiedOn: '2026-09-01',
    notes:
      'Offer detail works unauthenticated: /proxyApi/v1/jobhub/offer?reference={REF}&lang=fr. ' +
      'criteria?lang=fr returns 76 maisons and is a free sector-classification reference. ' +
      'BLOCKER: no public list route — the client bundle exposes only getCriteria/getOffer, and ' +
      'enumeration runs through Algolia with runtime-injected keys. Needs a browser, like FashionJobs.',
  },
  {
    key: 'fashionjobs',
    company: 'FashionJobs (employer directory, 668 companies)',
    kind: 'BROWSER_REQUIRED',
    entryUrl: 'https://fr.fashionjobs.com/societesrecrutent/',
    robotsVerdict: 'Allows /societesrecrutent/; only /societesRecrutent/ajax/ disallowed',
    verifiedTotal: 668,
    verifiedOn: '2026-09-01',
    notes: 'Cloudflare: every curl gets 403, Chromium gets 200. Used for employer discovery, not offers.',
  },
] as const;

/** Sources reachable over plain HTTP, i.e. everything but the browser-gated ones. */
export function plainHttpSources(): readonly JobSource[] {
  return JOB_SOURCES.filter((source) => source.kind !== 'BROWSER_REQUIRED');
}

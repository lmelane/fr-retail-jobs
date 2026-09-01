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

/**
 * Which of the two parallel flows a source belongs to.
 *
 * They are independent and of equal rank. A jobboard is NOT an upstream directory
 * feeding employer discovery — it is a source of offers in its own right. Scoping
 * the pipeline to one board's roster would cap it at that board's employers, while
 * the target scope is the SECTOR.
 *
 * Crucially, flow B is not merely a duplicate of flow A. A jobboard or a search
 * firm often holds offers that exist NOWHERE else: exclusive mandates, employers
 * with no public ATS, confidential searches. For those, flow B IS the canonical
 * source — there is no employer-side posting to prefer over it. Treating flow B as
 * "just republished flow A" would silently drop real, exclusive jobs.
 */
export type SourceFlow =
  /** A: the sector's brands, read from their own ATS / careers pages. */
  | 'EMPLOYER'
  /** B: jobboards, aggregators and search firms, read for their offers directly. */
  | 'JOBBOARD';

/** Ranking used to pick the canonical apply URL when postings are merged. */
export type SourceTier =
  | 'EMPLOYER_DIRECT'
  | 'GROUP_OFFICIAL'
  | 'ATS_OFFICIAL'
  | 'SPECIALIST_JOBBOARD'
  | 'AGGREGATOR';

export type JobSource = {
  key: string;
  /** Employer or group as displayed; the board's name for a jobboard. */
  company: string;
  flow: SourceFlow;
  tier: SourceTier;
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
  /**
   * Which sitemap URLs are actual job pages.
   *
   * Most sitemaps mix listings, utility routes and editorial pages with the
   * offers. Kering's holds 2587 entries whose first is the listing page itself,
   * and L'Oréal's leads with /jobs/AgentCreate — so a naive "take the first 250"
   * spends the whole budget on pages that carry no JobPosting at all.
   */
  jobUrlPattern?: RegExp;
  notes?: string;
};

export const JOB_SOURCES: readonly JobSource[] = [
  {
    key: 'richemont',
    flow: 'EMPLOYER',
    tier: 'GROUP_OFFICIAL',
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
    flow: 'EMPLOYER',
    tier: 'EMPLOYER_DIRECT',
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
    flow: 'EMPLOYER',
    tier: 'EMPLOYER_DIRECT',
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
    jobUrlPattern: /\/j\//,
    flow: 'EMPLOYER',
    tier: 'EMPLOYER_DIRECT',
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
    // Only the French locale: /ja/, /en/ etc. are the same jobs in another language.
    jobUrlPattern: /\/fr\/annonce\//,
    flow: 'EMPLOYER',
    tier: 'EMPLOYER_DIRECT',
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
    jobUrlPattern: /\/jobs\/JobDetail/,
    flow: 'EMPLOYER',
    tier: 'EMPLOYER_DIRECT',
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
    // Excludes the listing page and the continent index pages above it.
    jobUrlPattern: /\/offres-d-emploi\/[^/]+\/[^/]+/,
    flow: 'EMPLOYER',
    tier: 'GROUP_OFFICIAL',
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
    jobUrlPattern: /\/jobs\/\d/,
    flow: 'EMPLOYER',
    tier: 'EMPLOYER_DIRECT',
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
    flow: 'EMPLOYER',
    tier: 'EMPLOYER_DIRECT',
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
    jobUrlPattern: /\/job\//,
    flow: 'EMPLOYER',
    tier: 'EMPLOYER_DIRECT',
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
    flow: 'EMPLOYER',
    tier: 'GROUP_OFFICIAL',
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
    flow: 'JOBBOARD',
    tier: 'SPECIALIST_JOBBOARD',
    company: 'FashionJobs',
    kind: 'BROWSER_REQUIRED',
    entryUrl: 'https://fr.fashionjobs.com/societesrecrutent/',
    robotsVerdict: 'Allows /societesrecrutent/; only /societesRecrutent/ajax/ disallowed',
    verifiedTotal: 668,
    verifiedOn: '2026-09-01',
    notes:
      'A source of OFFERS in its own right, not an upstream directory. The company page also ' +
      'yields 668 employers, useful as a discovery signal — but the scope is never capped to it. ' +
      'Cloudflare: every curl gets 403, Chromium gets 200.',
  },
  {
    key: 'wttj',
    jobUrlPattern: /\/fr\/companies\/[^/]+\/jobs\//,
    flow: 'JOBBOARD',
    tier: 'SPECIALIST_JOBBOARD',
    company: 'Welcome to the Jungle',
    // Its entry URL is a GZIPPED sitemap INDEX pointing at 9 shards, so the
    // generic reader finds zero job URLs. Needs index expansion + gunzip before
    // it can be ingested; left out of the run rather than silently yielding 0.
    kind: 'BROWSER_REQUIRED',
    entryUrl: 'https://www.welcometothejungle.com/sitemaps/index.xml.gz',
    robotsVerdict:
      'Disallow: /me/*, /settings/*, /users/*, */jobs?query=*, and /*? — job detail paths carry ' +
      'no query string, so they are allowed. Sitemap self-declared.',
    verifiedTotal: 88222,
    verifiedFrance: 59947,
    verifiedOn: '2026-09-01',
    notes:
      'Highest volume of any source: 9 gzipped sitemap shards, 59,947 French job URLs, and every ' +
      'detail page carries full JobPosting JSON-LD (datePosted, employmentType, hiringOrganization, ' +
      'jobLocation, industry). Sector filtering is mandatory — it covers every industry, not just ours.',
  },
  {
    key: 'apec',
    flow: 'JOBBOARD',
    tier: 'SPECIALIST_JOBBOARD',
    company: 'APEC (cadres)',
    kind: 'PUBLIC_API',
    entryUrl: 'https://www.apec.fr/cms/webservices/rechercheOffre',
    robotsVerdict: 'User-agent: * with NO Disallow line at all — nothing is forbidden. Sitemap declared.',
    verifiedOn: '2026-09-01',
    notes:
      'POST, no auth, clean JSON (intitule, nomCommercial, lieuTexte, salaireTexte, datePublication, ' +
      'numeroOffre). Strong for cadre-level roles. Undocumented, so version defensively.',
  },
  {
    key: 'france-travail',
    flow: 'JOBBOARD',
    tier: 'AGGREGATOR',
    company: 'France Travail (API officielle)',
    kind: 'PUBLIC_API',
    entryUrl: 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search',
    robotsVerdict: 'Governed by API terms, not robots: an authorised API client, not a crawler.',
    verifiedOn: '2026-09-01',
    notes:
      'The only officially sanctioned source of the set. Free self-serve registration on ' +
      'francetravail.io, OAuth2 client_credentials, scope api_offresdemploiv2. Endpoint confirmed ' +
      'live (401 + WWW-Authenticate: Bearer without a token). Needs credentials before use.',
  },
] as const;

/**
 * Sources deliberately NOT used, with the reason. Recorded so the question does
 * not get re-litigated from memory in six months — each verdict was verified.
 */
export const EXCLUDED_SOURCES = [
  {
    key: 'linkedin',
    reason:
      'robots.txt sends `User-agent: * / Disallow: /` and its header states in plain words: ' +
      '"The use of robots or other automated means to access LinkedIn without the express ' +
      'permission of LinkedIn is strictly prohibited." Access requires their written permission ' +
      '(whitelist-crawl@linkedin.com). Verified 2026-09-01.',
  },
  {
    key: 'google-jobs',
    reason:
      'No public API exists — Cloud Talent Solution is deprecated and never served aggregated ' +
      'results anyway. The only programmatic access is paid third-party scrapers. Moot in practice: ' +
      'Google for Jobs does not hold data of its own, it indexes the schema.org JobPosting JSON-LD ' +
      'that employers publish — the exact source our generic connector already reads, one hop earlier ' +
      'and for free. Verified 2026-09-01.',
  },
  {
    key: 'indeed',
    reason:
      'robots.txt disallows every French job path (/emplois/FR/, /emploi/, /viewjob?, /voir-emploi?). ' +
      'An official Indeed connector is the sanctioned route if that data is ever needed.',
  },
  {
    key: 'monster-fr',
    reason:
      'DataDome-walled: robots.txt itself is unreadable, so the legal posture cannot be established. ' +
      'Off-limits by default rather than by assumption.',
  },
] as const;

/** Sources for flow A: the sector's brands, read from their own systems. */
export function employerSources(): readonly JobSource[] {
  return JOB_SOURCES.filter((source) => source.flow === 'EMPLOYER');
}

/** Sources for flow B: jobboards, read for their offers directly. */
export function jobboardSources(): readonly JobSource[] {
  return JOB_SOURCES.filter((source) => source.flow === 'JOBBOARD');
}

/** Sources reachable over plain HTTP, i.e. everything but the browser-gated ones. */
export function plainHttpSources(): readonly JobSource[] {
  return JOB_SOURCES.filter((source) => source.kind !== 'BROWSER_REQUIRED');
}

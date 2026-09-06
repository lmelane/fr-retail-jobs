import pLimit from 'p-limit';
import { fetchJson, fetchText } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * SAP SuccessFactors (RMK) career sites.
 *
 * Widely used across the sector: Puig, Sephora, Goyard, Douglas, The Body Shop,
 * Petit Bateau. It has no JSON API, but its search page is SERVER-rendered —
 * which is why a JSON-LD parser found nothing on Puig and reported zero offers.
 *
 * Verified 2026-09-01 on jobs.puig.com: the search page returns 25 job links per
 * page with `startrow=` pagination, so the whole board is reachable over plain
 * HTTP without a browser.
 *
 * Detail pages carry the posting as MICRODATA, not JSON-LD — schema.org/JobPosting
 * on a div with itemprop="description" inside. Verified by capturing every XHR on
 * a Puig job page: nothing but analytics, so the content is server-rendered and a
 * JSON-LD-only parser silently finds nothing.
 */

const PAGE_SIZE = 25;
/** Guard against a mis-parsed listing paginating forever. */
const MAX_PAGES = Number(process.env.SF_MAX_PAGES ?? 60);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT };

/**
 * Job links look like /job/{City}-{Title}/{id}/ — the city and title are already
 * in the path, which is enough to build the listing without a detail fetch.
 */
/**
 * Lien d'offre SuccessFactors : `/job/{slug}/{id}/`, éventuellement préfixé
 * d'UN segment de site.
 *
 * Mesuré le 2026-09-04 : jobs.sephora.com sert ses offres sous
 * `/France/job/SARAN-CDD-.../1367267555/`. Le motif ancré sur `/job/` n'en
 * voyait aucune — 48 liens bien présents dans la page, 0 offre remontée. Tout
 * tenant SAP qui segmente par pays ou par marque est dans ce cas.
 *
 * Un seul segment optionnel, et jamais `job` lui-même : on reste ancré sur la
 * forme réelle plutôt que d'accepter n'importe quelle profondeur, ce qui
 * ramasserait des liens qui ne sont pas des offres.
 */
const JOB_LINK = /href="((?:\/(?!job\/)[^"/]+)?\/job\/([^"/]+)\/(\d+)\/?)"/g;

export type SuccessFactorsJob = {
  url: string;
  externalId: string;
  /** Raw "City-Job-Title" segment, still URL-encoded. */
  slug: string;
};

export function parseListing(html: string, origin: string): SuccessFactorsJob[] {
  const seen = new Map<string, SuccessFactorsJob>();
  for (const match of html.matchAll(JOB_LINK)) {
    const [, path, slug, id] = match;
    if (!seen.has(id)) {
      seen.set(id, { url: `${origin}${path}`, externalId: id, slug });
    }
  }
  return [...seen.values()];
}

/** "PARIS-Social-Media-Coordinator" -> { city: "PARIS", title: "Social Media Coordinator" } */
export function splitSlug(slug: string): { city?: string; title: string } {
  const decoded = decodeURIComponent(slug).replace(/-/g, ' ').trim();
  const parts = decoded.split(' ');
  // The leading token(s) are the city; SuccessFactors writes it in caps when it
  // is a single word, which is the only reliable separator available here.
  const cityWords: string[] = [];
  for (const part of parts) {
    if (part === part.toUpperCase() && /[A-ZÀ-Ý]/.test(part)) cityWords.push(part);
    else break;
  }
  const title = parts.slice(cityWords.length).join(' ').trim();
  return {
    city: cityWords.length ? cityWords.join(' ') : undefined,
    title: title || decoded,
  };
}

// ---------------------------------------------------------------------------
// SAP Recruiting Marketing v2 ("rmk-jobs-search") — the JSON path.
// ---------------------------------------------------------------------------

/**
 * SAP's newer career-site generation renders the listing CLIENT-side: the
 * `/search/` page holds no `/job/…/id/` link at all, and the offers come from
 * `POST {origin}/services/recruiting/v1/jobs` with a JSON body, 10 per page,
 * one locale per call. Measured 2026-09-06: jobs.douglas.group (147 offers
 * over 5 locales, HTML path read 0), careers.breitling.com (41 en_GB + 5 fr_FR
 * + 4 de_DE, HTML path read 0). The detail page is still server-rendered with
 * the same microdata as the older sites (itemprop="title"/"description"), so
 * descriptions reuse `attachSuccessFactorsDescriptions`; only the address
 * microdata is gone, which is why the listing's `jobLocationShort` is kept.
 */
const RMK_PAGE_SIZE = 10;
const RMK_MAX_PAGES = Number(process.env.SF_RMK_MAX_PAGES ?? 300);
/** Locales read first, so a posting published in several keeps a candidate-readable one. */
const RMK_PREFERRED_LOCALES = ['fr_FR', 'en_GB', 'en_US'];

export type RmkV2Item = {
  id?: string | number;
  unifiedStandardTitle?: string;
  urlTitle?: string;
  unifiedUrlTitle?: string;
  /** "default" on Douglas → `/default/job/…`; absent on Breitling → `/job/…`. */
  brandUrl?: string;
  jobLocationShort?: string[];
  /** Locale-formatted: "10.07.26" (de_DE), "23/06/2026" (en_GB). */
  unifiedStandardStart?: string;
  supportedLocales?: string[];
};

type RmkV2Response = { totalJobs?: number; jobSearchResult?: Array<{ response?: RmkV2Item }> };

/** The locales a tenant exposes, read from the language switcher links of `/search/`. Pure. */
export function parseRmkLocales(html: string, preferred = RMK_PREFERRED_LOCALES): string[] {
  const found = new Set<string>();
  // The switcher links are HTML-escaped (`&amp;locale=`); the fixture caught a `[?&]` that missed them all.
  for (const match of html.matchAll(/(?:[?&]|&amp;)locale=([a-z]{2}_[A-Z]{2})/g)) found.add(match[1]);
  const locales = found.size ? [...found] : ['en_US'];
  return [...preferred.filter((l) => locales.includes(l)), ...locales.filter((l) => !preferred.includes(l))];
}

/** RMK writes ISO-3 country codes in short locations ("CHE", "CAN"); the pipeline reads ISO-2 or names. */
const ISO3_TO_ISO2: Record<string, string> = {
  FRA: 'FR', CHE: 'CH', DEU: 'DE', AUT: 'AT', ITA: 'IT', ESP: 'ES', PRT: 'PT', BEL: 'BE', NLD: 'NL', LUX: 'LU',
  GBR: 'GB', IRL: 'IE', USA: 'US', CAN: 'CA', MEX: 'MX', BRA: 'BR', JPN: 'JP', CHN: 'CN', HKG: 'HK', SGP: 'SG',
  ARE: 'AE', SAU: 'SA', QAT: 'QA', AUS: 'AU', KOR: 'KR', IND: 'IN', POL: 'PL', CZE: 'CZ', SWE: 'SE', DNK: 'DK',
  NOR: 'NO', FIN: 'FI', GRC: 'GR', TUR: 'TR', BGR: 'BG', ROU: 'RO', HUN: 'HU', MCO: 'MC', TWN: 'TW', THA: 'TH',
};

/**
 * "La Chaux-de-Fonds, NE, CHE, 2301<br/>" → city + ISO-2 country + postcode;
 * "Hamburg, Deutschland " → city + country name. Pure.
 */
export function parseRmkLocation(raw: string): { location?: string; city?: string; country?: string; postalCode?: string } {
  const parts = raw
    .replace(/<[^>]*>/g, ' ')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  const out: { location?: string; city?: string; country?: string; postalCode?: string } = {
    location: parts.join(', '),
    city: parts[0],
  };
  for (const part of parts.slice(1)) {
    if (/^[A-Z]{3}$/.test(part)) out.country = ISO3_TO_ISO2[part] ?? part;
    else if (/^[A-Z]{2}$/.test(part) && !out.country) out.country = part;
    else if (/^\d{4,5}$/.test(part)) out.postalCode = part;
  }
  // "Hamburg, Deutschland": no code anywhere, the last token is the country's name.
  if (!out.country && parts.length > 1 && !/\d/.test(parts[parts.length - 1])) out.country = parts[parts.length - 1];
  return out;
}

/** "10.07.26", "05.12.25", "23/06/2026" — day first in every locale seen. Pure. */
export function parseRmkDate(raw?: string): Date | undefined {
  if (!raw) return undefined;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(raw.trim());
  if (!m) {
    const iso = Date.parse(raw);
    return Number.isNaN(iso) ? undefined : new Date(iso);
  }
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const date = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** `{origin}[/brand]/job/{urlTitle}/{id}-{locale}` — verified 200 on Douglas (`/default/job/…`) and Breitling (`/job/…`). */
export function rmkJobUrl(origin: string, item: RmkV2Item, locale: string): string | undefined {
  const slug = (item.urlTitle ?? item.unifiedUrlTitle ?? '').replace(/&amp;/g, '&');
  if (!slug || item.id === undefined || item.id === '') return undefined;
  const brand = item.brandUrl ? `/${item.brandUrl}` : '';
  return `${origin}${brand}/job/${slug}/${item.id}-${locale}`;
}

/** One listing entry → one posting. Pure; returns null when the entry cannot be linked. */
export function normalizeRmkItem(item: RmkV2Item, locale: string, origin: string): NormalizedJob | null {
  const url = rmkJobUrl(origin, item, locale);
  const title = item.unifiedStandardTitle?.replace(/\s+/g, ' ').trim();
  if (!url || !title) return null;
  // City/country come from the first location; a multi-site posting (Breitling's
  // talent pool lists three) keeps every site in the readable label.
  const places = (item.jobLocationShort ?? []).map(parseRmkLocation).filter((p) => p.location);
  const primary = places[0] ?? {};
  const location = places.length > 1 ? places.map((p) => p.location).join(' / ') : primary.location;
  return {
    externalId: String(item.id),
    title,
    ...primary,
    location,
    language: locale.slice(0, 2),
    url,
    postedAt: parseRmkDate(item.unifiedStandardStart),
    raw: { ...item, locale, source: 'successfactors-rmk-v2' },
  };
}

/**
 * The switcher on `/search/` does not always list every locale: Breitling's
 * search page shows only `en_GB` while its home page lists de_DE, fr_FR,
 * ja_JP, zh_CN too — and fr_FR/de_DE hold postings en_GB does not (5 and 4,
 * measured). Both pages are read; the union is the tenant's locale set.
 */
async function discoverRmkLocales(origin: string, searchHtml: string): Promise<string[]> {
  let homeHtml = '';
  try {
    homeHtml = await fetchText(`${origin}/`, { headers: HEADERS });
  } catch {
    // The search page alone still names at least one locale.
  }
  return parseRmkLocales(`${searchHtml}\n${homeHtml}`);
}

/**
 * The endpoint's ORDER IS NOT STABLE: two identical sweeps of Douglas' 126
 * de_DE rows returned 106 then 110 distinct ids — pages overlap and skip
 * (measured with every `sortBy` tried; "date" is the least bad, 121/126; no
 * page-size field is honoured, 10 is fixed). So a locale is swept again until
 * the union of ids reaches `totalJobs`, or a sweep adds nothing.
 */
const RMK_SORT = 'date';
const RMK_MAX_SWEEPS = Number(process.env.SF_RMK_MAX_SWEEPS ?? 8);

async function postRmkPage(origin: string, locale: string, page: number): Promise<RmkV2Response> {
  return fetchJson<RmkV2Response>(`${origin}/services/recruiting/v1/jobs`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({
      locale,
      pageNumber: page,
      sortBy: RMK_SORT,
      keywords: '',
      location: '',
      facetFilters: {},
      brand: '',
      skills: [],
      categoryId: 0,
      alertId: '',
      rcmCandidateId: '',
    }),
  });
}

/**
 * Every locale, every page, swept until complete; one posting per requisition
 * id, kept in the first (preferred) locale it appears in. `declaredTotal` sums
 * the locales' `totalJobs`, i.e. counts a posting once per locale.
 */
export async function fetchRmkV2Jobs(origin: string, locales: string[]): Promise<{ jobs: NormalizedJob[]; declaredTotal: number }> {
  const byId = new Map<string, NormalizedJob>();
  let declaredTotal = 0;

  for (const locale of locales) {
    const perLocale = new Set<string>();
    let total = 0;
    for (let sweep = 0; sweep < RMK_MAX_SWEEPS; sweep++) {
      const before = perLocale.size;
      for (let page = 0; page < RMK_MAX_PAGES; page++) {
        const result = await postRmkPage(origin, locale, page);
        const items = (result.jobSearchResult ?? []).map((r) => r.response).filter((r): r is RmkV2Item => !!r);
        if (sweep === 0 && page === 0) {
          total = Number(result.totalJobs ?? 0);
          declaredTotal += total;
        }
        if (items.length === 0) break;
        for (const item of items) {
          const job = normalizeRmkItem(item, locale, origin);
          if (!job) continue;
          perLocale.add(job.externalId);
          if (!byId.has(job.externalId)) byId.set(job.externalId, job);
        }
        if (items.length < RMK_PAGE_SIZE) break;
      }
      // Complete, or this sweep found nothing new: stop for this locale.
      if (perLocale.size >= total || perLocale.size === before) break;
    }
  }
  return { jobs: [...byId.values()], declaredTotal };
}

/**
 * Reads a whole SuccessFactors board.
 * `config.origin` is the careers host, e.g. "https://jobs.puig.com".
 * `config.rmk: true` goes straight to the RMK v2 JSON path; otherwise that
 * path is tried only when the HTML search page renders no offer link.
 */
export async function fetchSuccessFactorsJobs(
  config: Record<string, unknown>,
): Promise<NormalizedJob[]> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('SuccessFactors origin missing');

  const finish = (list: NormalizedJob[]) =>
    config.withDescriptions === false ? list : attachSuccessFactorsDescriptions(list, Number(config.detailConcurrency ?? 4));

  const jobs: NormalizedJob[] = [];
  const seenIds = new Set<string>();

  if (config.rmk === true) {
    const html = await fetchText(`${origin}/search/`, { headers: HEADERS });
    return finish((await fetchRmkV2Jobs(origin, await discoverRmkLocales(origin, html))).jobs);
  }

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${origin}/search/?createNewAlert=false&q=&locationsearch=&startrow=${page * PAGE_SIZE}`;
    const html = await fetchText(url, { headers: HEADERS });
    const listing = parseListing(html, origin);

    // An empty page, or one that repeats what we already have, is the end.
    const fresh = listing.filter((job) => !seenIds.has(job.externalId));
    if (fresh.length === 0) {
      // A first page with NO link is not an empty board: on RMK v2 tenants the
      // list is fetched client-side. Try the JSON path before concluding.
      if (page === 0) {
        try {
          const rmk = await fetchRmkV2Jobs(origin, await discoverRmkLocales(origin, html));
          if (rmk.jobs.length > 0) return finish(rmk.jobs);
        } catch {
          // Not an RMK v2 tenant (404/401 on the endpoint): the HTML verdict stands.
        }
      }
      break;
    }

    for (const job of fresh) {
      seenIds.add(job.externalId);
      const { city, title } = splitSlug(job.slug);
      jobs.push({
        externalId: job.externalId,
        title,
        location: city,
        // The listing does not carry a country; France detection falls back to
        // the city, which is what the location normaliser already handles.
        url: job.url,
        raw: { slug: job.slug, source: 'successfactors' },
      });
    }
  }

  return finish(jobs);
}

/**
 * Microdata, not JSON-LD: the text sits in itemprop="description".
 *
 * The block contains nested divs, so a lazy match up to the first </div> stops
 * after ~13 characters. The end is found by walking div depth instead.
 */
export function parseMicrodataDescription(html: string): string | undefined {
  const start = html.search(/itemprop="description"[^>]*>/i);
  if (start === -1) return undefined;

  const openTag = html.slice(start).match(/itemprop="description"[^>]*>/i)?.[0] ?? '';
  let cursor = start + openTag.length;
  let depth = 1;

  while (depth > 0 && cursor < html.length) {
    const next = html.slice(cursor).match(/<(\/?)div\b/i);
    if (!next || next.index === undefined) break;
    depth += next[1] ? -1 : 1;
    cursor += next.index + next[0].length;
  }

  const match = [undefined, html.slice(start + openTag.length, cursor)] as const;
  const text = match[1]
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|#39);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

export type SuccessFactorsDetail = {
  title?: string;
  location?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  postedAt?: Date;
  validThrough?: Date;
  description?: string;
};

/**
 * The detail page states the EXACT title and address in microdata — unlike the
 * URL slug, whose city/title order varies per tenant. Clarins writes
 * {City}-{Title}-{Postcode} slugs, so the caps heuristic swallowed the title
 * into the "city" and left UK/DE postcodes inside titles (issue #6). The page
 * itself never lies:
 *   <span itemprop="title">Beauty Coach (7.3hrs/wk)</span>
 *   <meta itemprop="streetAddress" content="Liverpool, GB, L1 8BJ">
 */
export function parseMicrodataDetail(html: string): SuccessFactorsDetail {
  const detail: SuccessFactorsDetail = {};

  // Not every tenant page carries itemprop="title" (the Clarins FR pages do
  // not); og:title holds the same exact string there.
  const title =
    /itemprop="title"[^>]*>([^<]+)</i.exec(html)?.[1]?.trim() ||
    /property="og:title"\s+content="([^"]+)"/i.exec(html)?.[1]?.trim() ||
    /og:title"\s*content="([^"]+)"/i.exec(html)?.[1]?.trim();
  if (title) detail.title = title.replace(/\s+/g, ' ');

  const meta = (name: string) =>
    new RegExp(`<meta itemprop="${name}" content="([^"]*)"`, 'i').exec(html)?.[1]?.trim();

  const address = meta('streetAddress');
  if (address) {
    detail.location = address;
    // "Liverpool, GB, L1 8BJ" — city, ISO-2 country, then an optional postcode.
    const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts[0]) detail.city = parts[0];
    if (parts[1] && /^[A-Z]{2}$/.test(parts[1])) detail.country = parts[1];
    if (parts[2]) detail.postalCode = parts[2];
  } else {
    /**
     * Not every tenant emits `streetAddress`. Coty, Burberry, Prada and
     * EssilorLuxottica publish the SAME address as separate schema.org fields
     * — measured 2026-09-04: Coty 127 offers / 0 locations, Burberry 133 / 0,
     * Prada 54 / 0, EssilorLuxottica 1505 / 8, while every detail page carried
     * addressLocality="Granollers" addressRegion="B" addressCountry="ES".
     *
     * The slug fallback cannot rescue these: `splitSlug` only accepts a city
     * written in CAPS, and these tenants write "Granollers". So without this
     * branch the offers reach a candidate with no city at all — unfilterable,
     * unmappable, unsortable.
     */
    const city = meta('addressLocality');
    const region = meta('addressRegion');
    const country = meta('addressCountry');
    if (city) detail.city = city;
    if (country && /^[A-Z]{2}$/.test(country)) detail.country = country;
    const postal = meta('postalCode');
    if (postal) detail.postalCode = postal;
    // Region is kept only when it is a real name, not a one-letter province
    // code ("B" for Barcelona), which would read as noise to a candidate.
    const composed = [city, region && region.length > 2 ? region : undefined, country]
      .filter(Boolean)
      .join(', ');
    if (composed) detail.location = composed;
  }

  /**
   * TROISIÈME format, mesuré le 2026-09-05 sur jobs.adidas-group.com : ni
   * streetAddress, ni addressLocality — le lieu est dans des <span
   * data-careersite-propertyid="city|state|country">. 1 056 offres, 0 lieu
   * sans cette branche. Les trois formats sont ceux des trois générations de
   * Career Site Builder SAP ; on les lit tous, dans l'ordre du plus précis
   * au moins précis.
   */
  if (!detail.city) {
    const prop = (name: string) =>
      new RegExp(`data-careersite-propertyid="${name}"[^>]*>\\s*([^<]{1,80}?)\\s*<`, 'i').exec(html)?.[1]?.trim();
    const city = prop('city');
    const country = prop('country');
    if (city) detail.city = city;
    if (country && /^[A-Z]{2}$/.test(country)) detail.country = country;
    const composed = [city, country].filter(Boolean).join(', ');
    if (composed && !detail.location) detail.location = composed;
  }

  const posted = meta('datePosted');
  if (posted && !Number.isNaN(Date.parse(posted))) detail.postedAt = new Date(posted);
  const valid = meta('validThrough');
  if (valid && !Number.isNaN(Date.parse(valid))) detail.validThrough = new Date(valid);

  detail.description = parseMicrodataDescription(html);
  return detail;
}

/**
 * Fills in each posting's exact fields from its detail page. The slug-derived
 * title/location survive only as a fallback when the detail fetch fails.
 */
export async function attachSuccessFactorsDescriptions(
  jobs: NormalizedJob[],
  concurrency = 8,
): Promise<NormalizedJob[]> {
  const limit = pLimit(concurrency);

  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const html = await fetchText(job.url, { headers: HEADERS });
          const detail = parseMicrodataDetail(html);
          return {
            ...job,
            title: detail.title ?? job.title,
            location: detail.location ?? job.location,
            city: detail.city ?? job.city,
            country: detail.country ?? job.country,
            postalCode: detail.postalCode ?? job.postalCode,
            postedAt: detail.postedAt ?? job.postedAt,
            validThrough: detail.validThrough ?? job.validThrough,
            description: detail.description ?? job.description,
          };
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
}

import pLimit from 'p-limit';
import * as cheerio from 'cheerio';
import { fetchJson, fetchText } from '../../lib/http.js';
import { readPostingEvidence } from '../../lib/postingEvidence.js';
import { htmlToPlainText } from '../../lib/html.js';
import { microdataDescriptionHtml } from '../../connectors/generic/jsonLdSitemap.js';
import { assertSourceRunning } from '../../lib/sourceBudget.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * SAP SuccessFactors (RMK) career sites.
 *
 * Widely used across the sector: Puig, Sephora, Goyard, Douglas, The Body Shop,
 * Petit Bateau. Classic search pages are SERVER-rendered; newer RMK sites use
 * the JSON protocol below.
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

/** Guard against a mis-parsed listing paginating forever. */
const MAX_PAGES = Number(process.env.SF_MAX_PAGES ?? 10000);

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
      /**
       * Le lien est un chemin ABSOLU : il se résout sur l'hôte, pas sur
       * l'origine configurée. Mesuré le 2026-09-06 sur Sephora France : origin
       * `https://jobs.sephora.com/France` + lien `/France/job/…` concaténés
       * donnaient `/France/France/job/…`, que le site sert en HTTP 200 comme
       * page générique « Careers at Sephora » — sans microdata. 24 offres à
       * 0 % de description, 0 % de date, 0 % de pays.
       */
      seen.set(id, { url: new URL(path, origin).toString(), externalId: id, slug });
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
  /** Standard RMK contract field — null on all 130 Douglas items (l2, 2026-09-06), read when a tenant fills it. */
  unifiedStandardEmploymentType?: string[] | string;
  /** Douglas: ["Full Time"] — the working time, never read before l2. */
  custFullTimePartTime?: string[] | string;
  /** Douglas: ["Hybrid"]. */
  custOnsiteRemote?: string[] | string;
};

/** First non-empty value of an RMK field, which may be a string or a list. */
function firstRmk(value?: string[] | string | null): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const text = first?.trim();
  return text || undefined;
}

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

/** Reviewed RMK locale formats, observed on Douglas/Breitling. Unknown locales
 * stay unresolved instead of silently applying a European or US convention.
 */
const RMK_DATE_FORMATS: Record<string, { order: 'DMY' | 'MDY'; separator: string }> = {
  en_US: { order: 'MDY', separator: '/' },
  en_GB: { order: 'DMY', separator: '/' },
  de_DE: { order: 'DMY', separator: '.' },
  fr_FR: { order: 'DMY', separator: '/' },
  es_ES: { order: 'DMY', separator: '/' },
  pl_PL: { order: 'DMY', separator: '.' },
};

function calendarDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date : undefined;
}

/** Pure, locale-aware parser: Date.UTC must never roll an invalid month into
 * another year. No clock, default locale, or permissive Date.parse fallback.
 */
export function parseRmkDate(raw?: string, locale?: string): Date | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (iso) {
    if (!calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return undefined;
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? new Date(millis) : undefined;
  }
  const format = locale ? RMK_DATE_FORMATS[locale] : undefined;
  const m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(value);
  if (!m || !format || m[2] !== format.separator) return undefined;
  const year = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
  const month = Number(format.order === 'MDY' ? m[1] : m[3]);
  const day = Number(format.order === 'MDY' ? m[3] : m[1]);
  return calendarDate(year, month, day);
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
    contract: firstRmk(item.unifiedStandardEmploymentType),
    workingTime: firstRmk(item.custFullTimePartTime),
    remote: firstRmk(item.custOnsiteRemote),
    url,
    postedAt: parseRmkDate(item.unifiedStandardStart, locale),
    raw: { ...item, locale, source: 'successfactors-rmk-v2', rmkDateEvidence: {
      field: 'unifiedStandardStart', rawValue: item.unifiedStandardStart ?? null, locale,
      parserVersion: 'rmk-locale-calendar-v1',
      parsedValue: parseRmkDate(item.unifiedStandardStart, locale)?.toISOString() ?? null,
    } },
  };
}

/**
 * The switcher on `/search/` does not always list every locale: Breitling's
 * search page shows only `en_GB` while its home page lists de_DE, fr_FR,
 * ja_JP, zh_CN too — and fr_FR/de_DE hold postings en_GB does not (5 and 4,
 * measured). Both pages are read; the union is the tenant's locale set.
 */
async function discoverRmkLocales(origin: string, searchHtml: string): Promise<{ locales: string[]; issues: string[] }> {
  let homeHtml = '';
  const issues: string[] = [];
  try { homeHtml = await fetchText(`${origin}/`, { headers: HEADERS }); }
  catch (error) { assertSourceRunning(); issues.push(`LOCALE_DISCOVERY_HOME_FAILED:${String(error).slice(0,300)}`); }
  const combined = `${searchHtml}\n${homeHtml}`;
  if (!/(?:[?&]|&amp;)locale=[a-z]{2}_[A-Z]{2}/.test(combined)) issues.push('NO_PUBLISHED_LOCALE_SET_DEFAULT_PROBE_ONLY');
  return { locales: parseRmkLocales(combined), issues };
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
 * id, kept in the first (preferred) locale it appears in. Completion is checked
 * per locale; translated postings are deduplicated in the union.
 */
export async function fetchRmkV2Jobs(origin: string, locales: string[]): Promise<AdapterResult> {
  const byId = new Map<string, NormalizedJob>();
  const scopes: NonNullable<NonNullable<AdapterResult['enumeration']>['scopes']> = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const issues = new Set<string>();
  let pages = 0, rawCount = 0;
  for (const locale of locales) {
    const perLocale = new Set<string>();
    let total: number | undefined, scopePages = 0;
    let changed = false;
    for (let sweep = 0; sweep < RMK_MAX_SWEEPS; sweep++) {
      const before = perLocale.size;
      for (let page = 0; page < RMK_MAX_PAGES; page++) {
        const result = await postRmkPage(origin, locale, page);
        if (!Number.isSafeInteger(result.totalJobs) || result.totalJobs! < 0 || (result.jobSearchResult == null ? result.totalJobs !== 0 : !Array.isArray(result.jobSearchResult))) throw new Error('SAP_RMK_INVALID_LIST_RESPONSE');
        // Observed native SAP empty locale response: { totalJobs: 0 }.
        const records = result.jobSearchResult ?? [];
        if (total === undefined) total = result.totalJobs;
        else if (total !== result.totalJobs) { changed = true; issues.add(`SOURCE_TOTAL_CHANGED:${locale}`); }
        pages++; scopePages++; rawCount += records.length;
        for (const row of records) {
          const job = row.response ? normalizeRmkItem(row.response, locale, origin) : null;
          if (!job) { rejectedRows.push({ reason: `INVALID_RMK_ROW:${locale}`, raw: row }); continue; }
          perLocale.add(job.externalId);
          if (!byId.has(job.externalId)) byId.set(job.externalId, job);
        }
        if (records.length < RMK_PAGE_SIZE || perLocale.size >= total!) break;
      }
      if (perLocale.size >= total! || perLocale.size === before) break;
    }
    const complete = total !== undefined && perLocale.size === total && !changed;
    if (!complete) issues.add(`LOCALE_ENUMERATION_UNPROVEN:${locale}`);
    scopes.push({ scope: locale, declaredTotal: total ?? 0, uniqueIds: perLocale.size, pages: scopePages, complete });
  }
  const complete = scopes.length > 0 && scopes.every(s => s.complete) && rejectedRows.length === 0;
  // Counts per language overlap. Never compare their sum with the union of jobs.
  return { jobs: [...byId.values()], complete, truncated: !complete, rejectedRows,
    enumeration: { method: 'OBSERVED_RMK_PER_LOCALE_TOTALS', endpoint: `${origin}/services/recruiting/v1/jobs`,
      pages, rawCount, termination: complete ? 'ALL_LOCALE_TOTALS_REACHED' : 'INCOMPLETE_LOCALE_ENUMERATION', scopes, issues: [...issues] } };
}

/** Counts are read from the publisher's pagination component, never whole-page digits. */
export function parseSuccessFactorsPagination(html: string): { start: number; end: number; total: number } | null {
  const $ = cheerio.load(html, { scriptingEnabled: false });
  const values: Array<{ start: number; end: number; total: number }> = [];
  $('.paginationLabel').each((_, node) => {
    const parts = $(node).find('b').map((_, b) => $(b).text().trim()).get();
    const range = parts[0]?.match(/^(\d+)\s*[–—-]\s*(\d+)$/);
    const total = parts[1]?.replace(/[.,\s\u00a0\u202f]/g, '');
    if (range && total && /^\d+$/.test(total)) values.push({ start: Number(range[1]), end: Number(range[2]), total: Number(total) });
  });
  if (!values.length) {
    const label = $('#tile-search-results-label').text().trim();
    const numbers = label.match(/\d[\d.,\u00a0\u202f]*/g)?.map(x => Number(x.replace(/[.,\u00a0\u202f]/g, '')));
    if (numbers?.length === 3) values.push({ start: numbers[0], end: numbers[1], total: numbers[2] });
  }
  const valid = values.filter(v => Object.values(v).every(Number.isSafeInteger) && v.start >= 0 && v.end >= v.start && v.total >= v.end);
  if (!valid.length || new Set(valid.map(v => JSON.stringify(v))).size !== 1) return null;
  return valid[0];
}

/** One implementation serves both the dispatcher and legacy array consumers. */
export async function fetchSuccessFactorsResult(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('SuccessFactors origin missing');
  if (!Number.isSafeInteger(MAX_PAGES) || MAX_PAGES < 1 || MAX_PAGES > 10000) throw new Error('Invalid SAP page budget');
  const finish = async (result: AdapterResult): Promise<AdapterResult> => ({ ...result,
    jobs: config.withDescriptions === false ? result.jobs : await attachSuccessFactorsDescriptions(result.jobs, Number(config.detailConcurrency ?? 4)) });
  const rmk = async (html: string): Promise<AdapterResult> => {
    const discovery = await discoverRmkLocales(origin, html);
    const result = await fetchRmkV2Jobs(origin, discovery.locales);
    return finish({ ...result, complete: result.complete && discovery.issues.length === 0,
      truncated: result.truncated || discovery.issues.length > 0,
      enumeration: { ...result.enumeration!, issues: [...(result.enumeration?.issues ?? []), ...discovery.issues] } });
  };
  const jobs: NormalizedJob[] = [];
  const seenIds = new Set<string>();
  const firstUrl = `${origin}/search/?createNewAlert=false&q=&locationsearch=&startrow=0`;
  const firstHtml = await fetchText(firstUrl, { headers: HEADERS });
  if (config.rmk === true || /rmk-jobs-search/.test(firstHtml)) {
    return rmk(firstHtml);
  }
  let offset = 0, pages = 0, rawCount = 0, declaredTotal: number | undefined;
  let termination = 'PAGE_BUDGET_EXHAUSTED';
  const issues = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const html = page === 0 ? firstHtml : await fetchText(`${origin}/search/?createNewAlert=false&q=&locationsearch=&startrow=${offset}`, { headers: HEADERS });
    pages++;
    const pagination = parseSuccessFactorsPagination(html);
    if (pagination) {
      if (declaredTotal === undefined) declaredTotal = pagination.total;
      else if (declaredTotal !== pagination.total) issues.add('SOURCE_TOTAL_CHANGED');
    }
    const listing = parseListing(html, origin);
    rawCount += listing.length;
    const fresh = listing.filter(job => !seenIds.has(job.externalId));
    for (const job of fresh) {
      seenIds.add(job.externalId);
      const { city, title } = splitSlug(job.slug);
      jobs.push({ externalId: job.externalId, title, location: city, url: job.url, raw: { slug: job.slug, source: 'successfactors' } });
    }
    if (pagination && seenIds.size === pagination.total) { termination = 'PUBLISHER_TOTAL_REACHED'; break; }
    if (fresh.length === 0) {
      if (page === 0 && !pagination) {
        // Endpoint failures remain failures, never a silently empty HTML board.
        return rmk(html);
      }
      termination = listing.length ? 'REPEATED_PAGE' : 'EMPTY_PAGE'; break;
    }
    const next = pagination ? pagination.end : offset + listing.length;
    if (next <= offset) { termination = 'NON_ADVANCING_OFFSET'; break; }
    offset = next;
  }
  const complete = declaredTotal !== undefined && jobs.length === declaredTotal && issues.size === 0;
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');
  return finish({ jobs, declaredTotal, complete, truncated: !complete,
    enumeration: { method: 'PUBLISHER_HTML_PAGINATION', endpoint: firstUrl, pages, rawCount, termination, issues: [...issues] } });
}

export async function fetchSuccessFactorsJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  return (await fetchSuccessFactorsResult(config)).jobs;
}

/**
 * Microdata, not JSON-LD: the text sits in itemprop="description".
 *
 * Le bloc est converti par `htmlToPlainText`, qui garde paragraphes, listes
 * et titres. L'ancienne version remplaçait chaque balise par une espace puis
 * écrasait tout blanc : une page adidas à 33 <p> devenait un pavé de 3 000
 * caractères sans un seul saut de ligne. Mesuré en base le 2026-09-06 :
 * adidas 831 pavés sur 1 053 offres, Crocs 495/495, Avolta 217/243 — et
 * L'Oréal Professionnel 1 356/1 782, dont le détail Avature passe ici aussi.
 */
export function parseMicrodataDescription(html: string): string | undefined {
  return htmlToPlainText(microdataDescriptionHtml(html));
}

export type SuccessFactorsDetail = {
  company?: string;
  employerEvidence?: NormalizedJob['employerEvidence'];
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
/** Some RMK templates expose publication in a visible date token, not microdata.
 * Only the observed explicit English month form is decoded; never parse an
 * ambiguous numeric date or the page's current year as a posting date.
 */
export function parseSuccessFactorsVisibleDate(html: string): Date | undefined {
  const $ = cheerio.load(html);
  const value = $('[data-careersite-propertyid="date"]').first().text().trim();
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})$/.exec(value);
  if (!match) return undefined;
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[1]);
  const date = new Date(Date.UTC(Number(match[3]),month,Number(match[2])));
  return date.getUTCMonth()===month && date.getUTCDate()===Number(match[2]) ? date : undefined;
}

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

  const $ = cheerio.load(html, { scriptingEnabled: false });
  const employerNames = [...new Set($('[itemprop="hiringOrganization"]').map((_, node) => $(node).attr('content')?.trim() || $(node).find('[itemprop="name"]').first().text().trim()).get().filter(Boolean))];
  if (employerNames.length === 1) {
    detail.company = employerNames[0];
    detail.employerEvidence = { rawName: employerNames[0], path: 'microdata.hiringOrganization', rule: 'EXPLICIT_JOBPOSTING_EMPLOYER' };
  }

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
  else detail.postedAt = parseSuccessFactorsVisibleDate(html);
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
            company: detail.company ?? job.company,
            employerEvidence: detail.employerEvidence ?? job.employerEvidence,
            title: detail.title ?? job.title,
            location: detail.location ?? job.location,
            city: detail.city ?? job.city,
            country: detail.country ?? job.country,
            postalCode: detail.postalCode ?? job.postalCode,
            postedAt: detail.postedAt ?? job.postedAt,
            validThrough: detail.validThrough ?? job.validThrough,
            description: detail.description ?? job.description,
            raw: { ...(job.raw as object), postingEvidence: {
              ...readPostingEvidence(html, job.url).evidence,
              microdataEmployer: detail.employerEvidence ?? null,
              visibleDateRaw: cheerio.load(html)('[data-careersite-propertyid="date"]').first().text().trim() || null,
            } },
          };
        } catch (error) {
          assertSourceRunning();
          return { ...job, raw: { ...(job.raw as object), detailReadError: String(error).slice(0, 1000) } };
        }
      }),
    ),
  );
}

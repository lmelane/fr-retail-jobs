import * as cheerio from 'cheerio';
import type { AtsType } from '@prisma/client';
import { fetchText } from '../lib/http.js';
import { canonicalCompanyKey } from '../lib/normalize.js';
import { isSearchConfigured, searchWeb } from '../discovery/serper.js';
import { probeAtsBySlug } from '../discovery/atsProbe.js';
import type { AtsDetection } from '../types.js';

const ATS_HOSTS = [
  'greenhouse.io', 'lever.co', 'smartrecruiters.com', 'recruitee.com', 'personio.de',
  'personio.com', 'myworkdayjobs.com', 'teamtailor.com', 'workable.com', 'successfactors.com',
  'welcometothejungle.com',
];

/**
 * Widget/white-label ATS that a brand embeds on ITS OWN careers domain — the
 * backend host (app.digitalrecruiters.com, …) appears in the page's scripts/XHR,
 * but the adapter needs the BRAND's careers hostname, not the widget host. So a
 * match here maps to the AtsType with config derived from the current page.
 * Each listed backend has a real adapter (verified against src/ats/adapters).
 */
const WIDGET_BACKENDS: ReadonlyArray<{
  re: RegExp;
  type: AtsType;
  config: (pageUrl: URL) => Record<string, unknown>;
}> = [
  {
    re: /digitalrecruiters\.com/i,
    type: 'DIGITALRECRUITERS',
    config: (u) => ({ domainName: u.hostname }),
  },
  {
    // A Teamtailor career site embeds its jobs.json on the brand's own host.
    re: /teamtailor\.com|career-microsite/i,
    type: 'TEAMTAILOR',
    config: (u) => ({ origin: u.origin }),
  },
  {
    re: /talent-soft\.com|talentsoft\.com/i,
    type: 'TALENTSOFT',
    config: (u) => ({ origin: u.origin }),
  },
  // Flatchr and Factorial are common FR/EU widgets with no dedicated adapter yet:
  // recognise them so the brand's careers page enters the review queue as a
  // generic crawl instead of being dropped. The generic JSON-LD crawler reads the
  // page as-is; a human can wire a proper adapter later.
  {
    re: /flatchr\.io|api\.flatchr/i,
    type: 'GENERIC_JSONLD',
    config: (u) => ({ startUrl: u.toString() }),
  },
  {
    re: /factorial(hr)?\.(com|fr|es)|\.factorial\./i,
    type: 'GENERIC_JSONLD',
    config: (u) => ({ startUrl: u.toString() }),
  },
];

/** Detect a widget/white-label ATS embedded on a brand's careers page. */
function detectWidgetBackend(html: string, pageUrl: URL): AtsDetection | null {
  for (const backend of WIDGET_BACKENDS) {
    if (backend.re.test(html)) {
      return {
        type: backend.type,
        careersUrl: pageUrl.toString(),
        config: backend.config(pageUrl),
        confidence: 0.85,
        note: `${backend.type} widget detected on ${pageUrl.hostname}`,
      };
    }
  }
  return null;
}

function detectionFromUrl(rawUrl: string): AtsDetection | null {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host.endsWith('greenhouse.io')) {
    const board = url.searchParams.get('for') ?? (parts[0] === 'embed' ? undefined : parts[0]);
    if (board) return { type: 'GREENHOUSE', careersUrl: url.toString(), config: { board }, confidence: 1 };
  }
  if (host === 'jobs.lever.co' || host.endsWith('.lever.co')) {
    const site = parts[0];
    if (site) return { type: 'LEVER', careersUrl: url.toString(), config: { site }, confidence: 1 };
  }
  if (host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') {
    const company = parts[0];
    if (company) return { type: 'SMARTRECRUITERS', careersUrl: url.toString(), config: { company }, confidence: 1 };
  }
  if (host.endsWith('.recruitee.com')) {
    const subdomain = host.split('.')[0];
    return { type: 'RECRUITEE', careersUrl: url.toString(), config: { subdomain }, confidence: 1 };
  }
  if (/\.jobs\.personio\.(de|com)$/.test(host)) {
    const subdomain = host.split('.')[0];
    return { type: 'PERSONIO', careersUrl: url.toString(), config: { subdomain, host }, confidence: 1 };
  }
  if (host.endsWith('.myworkdayjobs.com')) {
    const tenant = host.split('.')[0];
    const site = parts[0];
    if (tenant && site) return { type: 'WORKDAY', careersUrl: url.toString(), config: { tenant, site, origin: url.origin }, confidence: 1 };
  }
  // Welcome to the Jungle (and its Welcomekit embed): the org slug is the segment
  // after /companies/ — welcometothejungle.com/fr/companies/<slug>[/jobs].
  if (host.endsWith('welcometothejungle.com')) {
    const i = parts.indexOf('companies');
    const slug = i >= 0 ? parts[i + 1] : undefined;
    if (slug) return { type: 'WTTJ', careersUrl: url.toString(), config: { slug }, confidence: 1 };
  }
  return null;
}

/**
 * Anchor text/href that marks a link to a careers/jobs page, FR + EN. Kept
 * broad on purpose — a missed keyword (e.g. "rejoindre", "offres", "talents")
 * means a whole brand's ATS is never discovered. Measured on Ba&sh: the link was
 * "nous rejoindre" -> talents.ba-sh.com/fr-FR/offres, matched by none of the
 * original keywords.
 */
const CAREERS_LINK_RE =
  /career|carri[eè]re|recrut|rejoin|rejoign|talent|jobs?\b|emploi|offres?\b|vacanc|opening|hiring|work-with-us|work with us|join-us|join us|travailler|nous-rejoindre/i;

/** The registrable domain (eTLD+1, approx): "talents.ba-sh.com" -> "ba-sh.com". */
function registrableDomain(hostname: string): string {
  const parts = hostname.replace(/^www\./, '').split('.');
  // Handle common two-part public suffixes (co.uk, com.br…) by keeping 3 labels.
  const twoPartTld = /\.(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/i.test(hostname);
  return parts.slice(twoPartTld ? -3 : -2).join('.');
}

/**
 * Careers-page links on a homepage, most-likely first.
 *
 * Crucially this accepts a careers SUBDOMAIN on the same registrable domain
 * (talents.ba-sh.com, careers.brand.com, jobs.brand.com) — where most brands
 * actually host recruiting — not only same-hostname paths. It stays within the
 * brand's own domain, so it will not wander onto a random external link.
 */
function findCareersLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const baseDomain = registrableDomain(new URL(baseUrl).hostname);
  const scored: { url: string; score: number }[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const anchorText = $(el).text() || '';
    if (!CAREERS_LINK_RE.test(anchorText + ' ' + href)) return;
    try {
      const abs = new URL(href, baseUrl);
      if (registrableDomain(abs.hostname) !== baseDomain) return; // stay on the brand
      const clean = abs.toString();
      if (seen.has(clean)) return;
      seen.add(clean);
      // Prefer a careers subdomain (talents./careers./jobs.) and a careers-y
      // path. A strong anchor text ("nous rejoindre", "careers") also counts.
      let score = 0;
      if (/^(talents?|careers?|jobs|recrut|emploi|hr|rh)\./i.test(abs.hostname)) score += 4;
      if (/\b(career|carriere|carrière|join-us|join us|nous-rejoindre|nous rejoindre|work-with-us|recrut|hiring)\b/i.test(abs.pathname.replace(/[-_/]/g, ' '))) score += 3;
      if (/\b(jobs?|emplois?|offres?|vacanc|opening|positions?)\b/i.test(abs.pathname.replace(/[-_/]/g, ' '))) score += 2;
      const t = anchorText.replace(/[-_]/g, ' ');
      if (/\b(carriere|carrière|career|careers|recrut|rejoindre|rejoins|join us|work with us|nos offres|emploi|talent)\b/i.test(t)) score += 2;
      // A loose keyword match ALONE (score 0) is a false positive
      // ("flash-price-drops" matching "drop") — drop it.
      if (score > 0) scored.push({ url: clean, score });
    } catch { /* ignore */ }
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map((s) => s.url);
}

/**
 * Careers URLs on a careers SUBDOMAIN found by scanning the raw HTML, not just
 * <a href>. Modern sites put the "nous rejoindre" URL in a JS payload, a button
 * data-attribute or a <link> — cheerio's anchor scan misses it, but the URL is
 * right there in the markup (carriere.faguo-store.com, talents.brand.com…).
 */
function careersSubdomainUrlsInHtml(html: string, baseUrl: string): string[] {
  let baseDomain = '';
  try {
    baseDomain = registrableDomain(new URL(baseUrl).hostname);
  } catch {
    return [];
  }
  const found = new Set<string>();
  for (const raw of html.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>]*)?/gi) ?? []) {
    try {
      const u = new URL(raw);
      if (registrableDomain(u.hostname) !== baseDomain) continue; // stay on the brand
      // Only a careers-looking subdomain, so this stays targeted.
      if (/^(talents?|careers?|carriere|carrieres|jobs|recrut|emploi|hr|rh)\./i.test(u.hostname)) {
        found.add(`${u.origin}/`);
      }
    } catch { /* ignore */ }
  }
  return [...found].slice(0, 3);
}

/**
 * Detect the ATS behind a page. `depth` bounds the careers-link follow: a
 * company HOMEPAGE rarely embeds its ATS, but links to a /careers page that
 * does — so when the given page yields nothing, follow up to a couple of its
 * careers links once (depth 1) and inspect those. Without this, a homepage-only
 * roster (the 14k world list) detects almost nothing.
 */
/** Every ATS link referenced anywhere in a page's HTML. */
function atsLinksInHtml(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const candidates = new Set<string>();
  $('a[href], iframe[src], script[src]').each((_, el) => {
    const raw = $(el).attr('href') ?? $(el).attr('src');
    if (!raw) return;
    try {
      const absolute = new URL(raw, baseUrl).toString();
      if (ATS_HOSTS.some((host) => new URL(absolute).hostname.includes(host))) candidates.add(absolute);
    } catch { /* ignore */ }
  });
  for (const embedded of html.match(/https?:\/\/[^\s\"'<>]+/g) ?? []) {
    try {
      if (ATS_HOSTS.some((host) => new URL(embedded).hostname.includes(host))) candidates.add(embedded);
    } catch { /* ignore */ }
  }
  return [...candidates];
}

/**
 * Detect the ATS from a page's HTML (pure — no I/O). Shared by the plain-fetch
 * and the browser paths so the detection logic lives in one place.
 */
export function detectFromHtml(html: string, rawUrl: string): AtsDetection | null {
  // 1. A known ATS linked from the page — highest confidence, exact config.
  for (const candidate of atsLinksInHtml(html, rawUrl)) {
    const detected = detectionFromUrl(candidate);
    if (detected) return { ...detected, careersUrl: rawUrl, confidence: 0.95, note: `ATS link discovered on ${rawUrl}` };
  }

  // 2. A widget/white-label ATS embedded on the brand's own careers domain
  //    (DigitalRecruiters, Teamtailor, TalentSoft…) — real adapter, config from
  //    the current page's host.
  try {
    const widget = detectWidgetBackend(html, new URL(rawUrl));
    if (widget) return widget;
  } catch {
    /* bad URL — skip */
  }

  // 2. A real careers page on a custom/white-label ATS we don't have a dedicated
  // adapter for (talents.ba-sh.com, careers.brand.com…). Recognise it so a human
  // can review and wire it, rather than dropping the whole brand. Signals, any of:
  //   - JobPosting structured data anywhere (not only the exact ld+json tag: some
  //     ATS inline it in a JS payload),
  //   - the host is a talents/careers/jobs subdomain,
  //   - multiple job-offer links on the page.
  let host = '';
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    /* keep host empty */
  }
  const isCareersHost = /^(talents?|careers?|jobs|recrut|emploi|hr|rh)\./i.test(host);
  const hasJobPosting = /"@type"\s*:\s*"JobPosting"|JobPosting/.test(html);
  const offerLinkCount = (html.match(/\/(offre|offres|job|jobs|career|careers|emploi|vacancy|position)s?\//gi) ?? []).length;
  if (hasJobPosting || isCareersHost || offerLinkCount >= 3) {
    return {
      type: 'GENERIC_JSONLD',
      careersUrl: rawUrl,
      config: { startUrl: rawUrl },
      confidence: hasJobPosting ? 0.6 : 0.45,
      note: hasJobPosting
        ? 'JobPosting data present; generic career crawler (verify adapter).'
        : 'Careers page detected (host/links); generic crawler — needs a human check.',
    };
  }
  return null;
}

/**
 * Careers-page links found in HTML: anchor-based links first (ranked), then any
 * careers-subdomain URLs found by scanning the raw markup (which cheerio's
 * anchor scan misses). Deduped, anchor hits first.
 */
export function careersLinksInHtml(html: string, baseUrl: string): string[] {
  const anchors = findCareersLinks(cheerio.load(html), baseUrl);
  const raw = careersSubdomainUrlsInHtml(html, baseUrl);
  return [...new Set([...anchors, ...raw])].slice(0, 4);
}

/**
 * Detect the ATS behind a page, fetching with `fetcher` (plain fetch by default;
 * pass the browser transport for JS-rendered sites). `depth` bounds the
 * careers-link follow: a company HOMEPAGE rarely embeds its ATS but links to a
 * /careers page that does, so when the given page yields nothing we follow up to
 * a couple of its careers links once. Without this, a homepage-only roster (the
 * 14k world list) detects almost nothing.
 */
export async function inspectCareerPage(
  rawUrl: string,
  depth = 1,
  fetcher: (url: string) => Promise<string> = fetchText,
): Promise<AtsDetection | null> {
  const direct = detectionFromUrl(rawUrl);
  if (direct) return direct;
  try {
    const html = await fetcher(rawUrl);
    const onThisPage = detectFromHtml(html, rawUrl);
    // A real ATS on this page wins immediately; a generic fallback is held back
    // so a careers-link hop can still find a real ATS first.
    if (onThisPage && onThisPage.type !== 'GENERIC_JSONLD') return onThisPage;

    if (depth > 0) {
      for (const careersUrl of careersLinksInHtml(html, rawUrl)) {
        const detected = await inspectCareerPage(careersUrl, depth - 1, fetcher);
        if (detected) return detected;
      }
      // Homepage linked no careers page: many brands host one at a predictable
      // URL that simply is not linked from the homepage (careers.brand.com,
      // brand.com/careers…). Probe a few, cheaply — bounded and deduped.
      for (const guess of guessCareerUrls(rawUrl)) {
        const detected = await inspectCareerPage(guess, 0, fetcher);
        if (detected) return detected;
      }
    }
    return onThisPage; // generic fallback, if any
  } catch {
    return null;
  }
}

/** Predictable careers URLs for a brand domain, most-likely first. */
function guessCareerUrls(rawUrl: string): string[] {
  try {
    const u = new URL(rawUrl);
    const root = registrableDomain(u.hostname);
    const subs = ['careers', 'career', 'jobs', 'talents', 'talent', 'recrutement', 'emploi'];
    const paths = ['careers', 'carrieres', 'carrière', 'jobs', 'recrutement', 'nous-rejoindre', 'join-us'];
    const urls = [
      ...subs.map((s) => `https://${s}.${root}/`),
      ...paths.map((p) => `https://www.${root}/${p}`),
      ...paths.map((p) => `https://www.${root}/fr/${p}`),
    ];
    return [...new Set(urls)].slice(0, 8);
  } catch {
    return [];
  }
}

function scoreResult(companyName: string, result: { title?: string; link?: string; snippet?: string }): number {
  if (!result.link) return -999;
  let score = 0;
  const text = `${result.title ?? ''} ${result.snippet ?? ''}`.toUpperCase();
  const companyTokens = canonicalCompanyKey(companyName).split(' ').filter((x) => x.length >= 3);
  score += companyTokens.filter((t) => text.includes(t)).length * 2;
  if (/CAREER|CARRIÈRE|CARRIERE|RECRUT|JOBS|EMPLOI/.test(text)) score += 4;
  try {
    const host = new URL(result.link).hostname.toLowerCase();
    if (ATS_HOSTS.some((ats) => host.includes(ats))) score += 6;
    if (/linkedin|indeed|glassdoor|fashionjobs|welcometothejungle/.test(host)) score -= 8;
  } catch { score -= 10; }
  return score;
}

export async function discoverAts(
  companyName: string,
  fashionjobsSlug?: string,
): Promise<AtsDetection | null> {
  // Free path first: direct ATS slug probes cost nothing and resolve many companies.
  const probed = await probeAtsBySlug(companyName, fashionjobsSlug);
  if (probed) return probed;

  // Paid search is the fallback only, so a missing key degrades coverage rather
  // than blocking discovery entirely.
  if (!isSearchConfigured()) return null;

  const results = await searchWeb(`\"${companyName}\" careers recrutement jobs`);
  const ranked = results
    .filter((r) => r.link)
    .map((r) => ({ ...r, score: scoreResult(companyName, r) }))
    .sort((a, b) => b.score - a.score);

  for (const result of ranked.slice(0, 5)) {
    const detected = await inspectCareerPage(result.link!);
    if (detected) return detected;
  }
  return null;
}

export { detectionFromUrl };

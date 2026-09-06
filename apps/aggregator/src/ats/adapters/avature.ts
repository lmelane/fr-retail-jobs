import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { fetchSitemapUrls } from '../../connectors/generic/jsonLdSitemap.js';
import { parseMicrodataDescription } from './successfactors.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Avature career sites (L'Oréal, and the group's Maisons).
 *
 * The only vendor in the catalogue with no usable API. Verified 2026-09-01 by
 * capturing every XHR on careers.loreal.com with no keyword filter and a scroll
 * to trigger pagination: the only requests are cookie consent and a Cloudflare
 * challenge. The listing is server-rendered, and /SearchJobs/json returns HTML.
 *
 * Worse, its JSON-LD is near-empty — @context, @type, title, datePosted, and
 * `jobLocation: null`. That is why L'Oréal reported "0 France" through the
 * generic connector: nothing to filter on. So the location is read from the page
 * itself, which does carry it in a meta description of the form
 * "… | {City}, {Region} | …".
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT };

/** Only JobDetail URLs are offers; the sitemap also lists utility routes. */
const JOB_URL = /\/jobs\/JobDetail\//;

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&(?:lt|gt|nbsp);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const found = html.match(pattern)?.[1];
    if (found) {
      const value = decode(found);
      if (value) return value;
    }
  }
  return undefined;
}

export function parseAvatureJob(html: string, url: string): NormalizedJob | null {
  const title = firstMatch(html, [
    /<meta property="og:title" content="([^"]+)"/i,
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /<title>([^<|]+)/i,
  ]);
  if (!title) return null;

  // Avature exposes the city in structured fields on the page rather than in
  // its JSON-LD, which stays empty.
  const location = firstMatch(html, [
    /"jobLocation"\s*:\s*"([^"]+)"/i,
    /data-location="([^"]+)"/i,
    /class="[^"]*job-?location[^"]*"[^>]*>\s*([^<]{2,60})</i,
    /<meta name="description" content="[^"|]*\|\s*([^"|]{2,60})\s*\|/i,
  ]);

  const posted = firstMatch(html, [/"datePosted"\s*:\s*"([^"]+)"/i]);
  const postedAt = posted ? new Date(posted) : undefined;

  const description = firstMatch(html, [
    /<meta property="og:description" content="([^"]+)"/i,
    /<meta name="description" content="([^"]+)"/i,
  ]);

  return {
    externalId: url.match(/\/(\d+)\/?$/)?.[1] ?? url,
    title,
    location,
    // The pages carry no country field; France detection falls back to the city.
    description,
    url,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: { source: 'avature', url },
  };
}

/**
 * Libellés de BOUTON, jamais un intitulé de poste.
 *
 * Chaque carte Avature porte DEUX liens vers la même offre — le titre, puis un
 * bouton d'action — et le motif de carte attrape le premier texte qui suit un
 * lien JobDetail. Mesuré le 2026-09-05 sur careers.loreal.com : 20 des 40
 * cartes de la première page ressortaient « Apply Now », et 189 offres actives
 * en base portaient ce titre. Un candidat voyait 189 annonces identiques, sans
 * savoir de quel poste il s'agissait.
 */
const BUTTON_LABEL =
  /^(apply now|apply|postuler|postuler maintenant|bewerben|jetzt bewerben|solicitar|candidatarsi|view (job|details)|voir l'offre|en savoir plus|read more|learn more|details?)$/i;

/**
 * Le titre lisible d'une carte : le texte du lien s'il en est un, sinon le slug
 * de l'URL — qui porte TOUJOURS l'intitulé réel
 * (`/JobDetail/Regional-Activation-Manager-m-f-d-.../253399`). Repli honnête :
 * un titre reconstruit reste exact, là où « Apply Now » ne dit rien.
 */
export function titleFromCard(raw: string, url: string): string | undefined {
  const text = raw.trim();
  if (text && !BUTTON_LABEL.test(text)) return text;

  const slug = url.match(/\/JobDetail\/([^/]+)\/\d+\/?$/)?.[1];
  if (!slug) return undefined;
  const rebuilt = decodeURIComponent(slug).replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();
  return rebuilt.length >= 3 ? rebuilt : undefined;
}

/** One result card on the SearchJobs listing. */
const LISTING_CARD =
  /href="([^"]*\/jobs\/JobDetail\/[^"]+)"[\s\S]{0,120}?>([^<]{3,120})<[\s\S]{0,600}?/g;

/**
 * Parses the SearchJobs listing, which is where Avature actually puts the city.
 *
 * The detail page does NOT carry it — no JSON-LD location, no meta, no data
 * attribute — but each listing card renders "title … city … Publié {date}".
 * Reading the listing is therefore both the only way to get a location and far
 * cheaper than one request per offer.
 */
export function parseAvatureListing(html: string): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(LISTING_CARD)) {
    const url = decode(match[1]);
    const title = titleFromCard(decode(match[2]), url);
    if (!title || seen.has(url)) continue;
    seen.add(url);

    // The block after the title holds " | city | Publié dd-Mmm-yyyy".
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 900);
    const cells = tail
      .replace(/<[^>]+>/g, '|')
      .split('|')
      .map((cell) => decode(cell))
      .filter(Boolean);

    /**
     * Le marqueur de date, dans la langue du board.
     *
     * Le code ne connaissait que « Publié » : sur careers.loreal.com, servi en
     * anglais, la carte écrit « Posted 01-Oct-2026 » — donc l'index restait à
     * -1 et la ville, pourtant présente juste avant (« Copenhagen »), était
     * perdue. Mesuré le 2026-09-05 : 20 cartes sur 20 sans lieu.
     */
    const publishedAt = cells.findIndex((cell) => /^(publi|posted|veröffentlicht|publicado|pubblicato)/i.test(cell));
    // The city is the cell immediately before "Publié …".
    const location = publishedAt > 0 ? cells[publishedAt - 1] : undefined;
    const posted = cells[publishedAt]?.match(/(\d{1,2}-\w{3}-\d{4})/)?.[1];
    const postedAt = posted ? new Date(posted.replace(/-/g, ' ')) : undefined;

    jobs.push({
      externalId: url.match(/\/(\d+)\/?$/)?.[1] ?? url,
      title,
      location,
      description: cells.slice(publishedAt + 1).join(' ').slice(0, 4000) || undefined,
      url,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
      raw: { source: 'avature' },
    });
  }

  return jobs;
}

/* ------------------------------------------------------------------------ */
/* Mode « portail » — tenants habillés comme Ralph Lauren                     */
/* ------------------------------------------------------------------------ */

/**
 * Mesuré le 2026-09-06 sur careers.ralphlauren.com (portail Avature 47,
 * `ralphlauren.avature.net`, derrière AWS WAF — levé par le transport commun) :
 * ce gabarit n'a ni `/jobs/JobDetail/{slug}/{id}`, ni microdata, ni JSON-LD,
 * ni date de publication. Il a :
 *
 * - PLUSIEURS listes par portail (`SearchJobsCorporate` 209, `SearchJobsRetail`
 *   876, `SearchJobsNorthCarolinaCampus`), chacune avec sa route de détail
 *   (`JobDetailCorporate?jobId=`, `JobDetailRetail?jobId=`…) ;
 * - **6 cartes par page quoi qu'on demande** (`jobRecordsPerPage` est ignoré,
 *   « 1-6 of 209 results ») : l'offset avance du nombre de cartes lues ;
 * - un endpoint JSON `…Data/` (carte géographique) qui PLAFONNE à 500 ids —
 *   la liste paginée fait foi, jamais lui ;
 * - un détail en blocs `article--details` : le premier porte les champs
 *   (Ref #, State/Region, Department, Location = PAYS, City), les suivants des
 *   sections titrées `<h2>` (COMPANY DESCRIPTION, POSITION OVERVIEW, ESSENTIAL
 *   DUTIES…) — c'est le texte de l'offre.
 *
 * Config : `{ origin, lists: ['en_US/CareersCorporate/SearchJobsCorporate', …] }`
 * (`lists` = chemins de liste relatifs à `origin`).
 */

const PORTAL_CARD = /<article class="article article--result[\s\S]*?<\/article>/g;
const PORTAL_CARD_FIELD = {
  link: /href="([^"]*JobDetail[A-Za-z]*\?jobId=(\d+))"[^>]*>\s*([^<]{1,200}?)\s*<\/a>/,
  location: /list-item-location">([^<]*)</,
  reference: /list-item-ref">([^<]*)</,
  department: /list-item-department">([^<]*)</,
  excerpt: /<p class="article__content"[^>]*>([\s\S]*?)<\/p>/,
};
/** « 1-6 of 209 results » : le total annoncé par la liste. */
const PORTAL_TOTAL = /of\s+(\d+)\s+results/;
const PORTAL_DETAIL_BLOCK = /<article class="article article--details[\s\S]*?<\/article>/g;
const PORTAL_DETAIL_TITLE = /<h2[^>]*>\s*([^<]+?)\s*<\/h2>/;
/** Blocs de la page qui ne sont pas l'offre : partage social, alertes. */
const PORTAL_DETAIL_NOISE = /^(share this job|job notifications|partager|alertes?)/i;
/** 300 pages × 6 cartes = 1 800 offres par liste : couvre Retail (876). */
const PORTAL_MAX_PAGES = 300;

function portalField(html: string, label: string): string | undefined {
  const pattern = new RegExp(
    `field__label"\\s*>\\s*${label}\\s*</div>\\s*<div class="article__content__view__field__value">\\s*([^<]{1,120}?)\\s*</div>`,
  );
  return decode(html.match(pattern)?.[1] ?? '') || undefined;
}

/** Les cartes d'une page de liste « portail », plus le total qu'elle annonce. */
export function parseAvaturePortalListing(html: string): { jobs: NormalizedJob[]; declaredTotal?: number } {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (const card of html.match(PORTAL_CARD) ?? []) {
    const link = card.match(PORTAL_CARD_FIELD.link);
    if (!link) continue;
    const [, href, externalId, rawTitle] = link;
    const title = titleFromCard(decode(rawTitle), href);
    if (!title || seen.has(externalId)) continue;
    seen.add(externalId);
    jobs.push({
      externalId,
      title,
      location: decode(card.match(PORTAL_CARD_FIELD.location)?.[1] ?? '') || undefined,
      url: decode(href),
      description: htmlToPlainText(card.match(PORTAL_CARD_FIELD.excerpt)?.[1]) || undefined,
      raw: {
        source: 'avature-portal',
        reference: decode(card.match(PORTAL_CARD_FIELD.reference)?.[1] ?? '') || undefined,
        department: decode(card.match(PORTAL_CARD_FIELD.department)?.[1] ?? '') || undefined,
      },
    });
  }
  const total = Number(html.match(PORTAL_TOTAL)?.[1]);
  return { jobs, declaredTotal: Number.isFinite(total) ? total : undefined };
}

export type AvaturePortalDetail = {
  description?: string;
  city?: string;
  country?: string;
  region?: string;
  reference?: string;
};

/** Champs et texte d'une page de détail « portail ». Vide si la page n'a pas ce gabarit. */
export function parseAvaturePortalDetail(html: string): AvaturePortalDetail {
  const sections: string[] = [];
  for (const block of html.match(PORTAL_DETAIL_BLOCK) ?? []) {
    const title = decode(block.match(PORTAL_DETAIL_TITLE)?.[1] ?? '');
    // Sans titre, c'est le bloc de champs (Ref, City…) — lu à part, pas du texte.
    if (!title || PORTAL_DETAIL_NOISE.test(title)) continue;
    const body = htmlToPlainText(block.replace(PORTAL_DETAIL_TITLE, ''))?.trim();
    if (body) sections.push(`${title}\n${body}`);
  }
  return {
    description: sections.join('\n\n') || undefined,
    city: portalField(html, 'City'),
    country: portalField(html, 'Location'),
    region: portalField(html, 'State/Region'),
    reference: portalField(html, 'Ref #'),
  };
}

async function fetchAvaturePortalJobs(origin: string, lists: string[], config: Record<string, unknown>): Promise<AdapterResult> {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  let truncated = false;

  for (const list of lists) {
    const base = `${origin}/${list.replace(/^\/|\/$/g, '')}/`;
    let listTotal: number | undefined;
    for (let offset = 0, page = 0; page < PORTAL_MAX_PAGES; page += 1) {
      const html = await fetchText(`${base}?jobOffset=${offset}&listFilterMode=1`, { headers: HEADERS });
      const parsed = parseAvaturePortalListing(html);
      listTotal ??= parsed.declaredTotal;
      const fresh = parsed.jobs.filter((job) => !seen.has(job.externalId));
      for (const job of fresh) {
        seen.add(job.externalId);
        jobs.push(job);
      }
      // Une page sans nouveauté termine la liste : le portail rend la dernière
      // page en boucle plutôt qu'une page vide.
      if (fresh.length === 0) break;
      offset += parsed.jobs.length;
      if (page === PORTAL_MAX_PAGES - 1) truncated = true;
    }
    if (listTotal !== undefined) declaredTotal += listTotal;
  }

  const result: AdapterResult = { jobs, truncated, ...(declaredTotal > 0 ? { declaredTotal } : {}) };
  if (config.withDescriptions === false) return result;

  const detailLimit = pLimit(Number(config.detailConcurrency ?? 4));
  const withDetails = await Promise.all(
    jobs.map((job) =>
      detailLimit(async () => {
        try {
          const detail = parseAvaturePortalDetail(await fetchText(job.url, { headers: HEADERS }));
          return {
            ...job,
            description: detail.description ?? job.description,
            city: detail.city ?? job.city,
            country: detail.country ?? job.country,
            region: detail.region ?? job.region,
          };
        } catch {
          // Un détail injoignable ne doit pas faire perdre l'offre de liste.
          return job;
        }
      }),
    ),
  );
  return { ...result, jobs: withDetails };
}

/**
 * Reads a whole Avature board.
 *
 * Prefers the listing, which carries the location; falls back to per-offer pages
 * from the sitemap only when no listing URL is configured. The « portal » mode
 * (`lists`) is opt-in, for tenants dressed like Ralph Lauren.
 */
export async function fetchAvatureJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const lists = Array.isArray(config.lists) ? config.lists.map(String).filter(Boolean) : [];
  if (lists.length > 0) {
    const origin = String(config.origin ?? '').replace(/\/$/, '');
    if (!origin) throw new Error('Avature portal mode requires origin');
    return fetchAvaturePortalJobs(origin, lists, config);
  }

  const listingUrl = String(config.listingUrl ?? '');

  if (listingUrl) {
    const jobs: NormalizedJob[] = [];
    const seen = new Set<string>();
    const pageSize = Number(config.pageSize ?? 20);
    const maxPages = Number(config.maxPages ?? 120);

    // Avature announces no total; the truncation signal here is exhausting the
    // page cap while every page still yielded fresh offers (F-04).
    let truncated = false;
    for (let page = 0; page < maxPages; page++) {
      const separator = listingUrl.includes('?') ? '&' : '?';
      const html = await fetchText(`${listingUrl}${separator}jobOffset=${page * pageSize}`, {
        headers: HEADERS,
      });

      const batch = parseAvatureListing(html);
      const fresh = batch.filter((job) => !seen.has(job.externalId));
      for (const job of fresh) {
        seen.add(job.externalId);
        jobs.push(job);
      }
      if (fresh.length === 0) break;
      if (page === maxPages - 1) truncated = true;
    }

    if (config.withDescriptions === false) return { jobs, truncated };

    /**
     * The listing snippet is ~290 characters — an excerpt, not the posting. The
     * full text lives on the detail page as MICRODATA (itemprop="description"),
     * the same shape SuccessFactors uses, since its JSON-LD is empty.
     */
    const detailLimit = pLimit(Number(config.detailConcurrency ?? 4));
    const withDescriptions = await Promise.all(
      jobs.map((job) =>
        detailLimit(async () => {
          try {
            const html = await fetchText(job.url, { headers: HEADERS });
            const full = parseMicrodataDescription(html);
            return full && full.length > (job.description?.length ?? 0)
              ? { ...job, description: full }
              : job;
          } catch {
            // A failed detail fetch must not lose the listing entry.
            return job;
          }
        }),
      ),
    );
    return { jobs: withDescriptions, truncated };
  }

  const sitemapUrl = String(config.sitemapUrl ?? '');
  if (!sitemapUrl) throw new Error('Avature listingUrl or sitemapUrl required');

  const urls = (await fetchSitemapUrls(sitemapUrl)).filter((url) => JOB_URL.test(url));
  const limit = pLimit(Number(config.concurrency ?? 4));

  const jobs = await Promise.all(
    urls.map((url) =>
      limit(async () => {
        try {
          return parseAvatureJob(await fetchText(url, { headers: HEADERS }), url);
        } catch {
          // One unreachable page must not lose the rest of the board.
          return null;
        }
      }),
    ),
  );

  // Sitemap path: the sitemap IS the full enumeration — its length is the
  // declared total, and a page that failed to parse is the truncation.
  const parsed = jobs.filter((job): job is NormalizedJob => job !== null);
  return { jobs: parsed, declaredTotal: urls.length };
}

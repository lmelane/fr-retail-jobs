import pLimit from 'p-limit';
import * as cheerio from 'cheerio';
import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { fetchSitemapUrls } from '../../connectors/generic/jsonLdSitemap.js';
import { parseMicrodataDescription } from './successfactors.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';

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
  CRAWLER_IDENTITY;

const HEADERS = { 'user-agent': USER_AGENT };

/** Public Avature job metadata, bound to the actual detail ID. Only literal
 * strings are read; no script is evaluated. A group portal's page-wide brand
 * (e.g. "OA") is deliberately distinct from its per-job `jobBrand`.
 */
export function avatureJobData(script: string, externalId: string): { jobBrand: string; jobCountry?: string } | null {
  const matches: Array<{ jobBrand: string; jobCountry?: string }> = [];
  for (const block of script.matchAll(/\bdataLayer\.push\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    const fields: Record<string, string> = {};
    let invalid = false;
    for (const field of block[1].matchAll(/(?:^|,)\s*(pageCategory|jobIDATS|jobBrand|jobCountry)\s*:\s*("(?:\\.|[^"\\])*")\s*(?=,|$)/g)) {
      try {
        if (field[1] in fields) invalid = true;
        fields[field[1]] = JSON.parse(field[2]);
      } catch { invalid = true; }
    }
    const brand = fields.jobBrand ? cheerio.load(fields.jobBrand, { scriptingEnabled: false }, false).text().trim() : '';
    // Observed publisher placeholders describe an unassigned/multi-brand role,
    // not an employer named "N/A" or "Multi Brand". Preserve the raw witness.
    if (!invalid && fields.pageCategory === 'job detail page' && fields.jobIDATS === externalId && brand && !/^(?:N\/A|Multi Brand)$/i.test(brand)) {
      matches.push({ jobBrand: brand, ...(fields.jobCountry?.trim() ? { jobCountry: fields.jobCountry.trim() } : {}) });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function applyAvatureJobData(job: NormalizedJob, script: string): NormalizedJob {
  const data = avatureJobData(script, job.externalId);
  return { ...job, ...(data ? { company: data.jobBrand, country: job.country ?? data.jobCountry, employerEvidence: {
    rawName: data.jobBrand, path: 'dataLayer.jobBrand', rule: 'EXPLICIT_JOB_BRAND',
  } } : {}), raw: { ...(job.raw as Record<string, unknown>), avatureJobData: script } };
}

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
    // Les champs LUS entrent dans le raw (19/09/2026) : `{source, url}` ne permettait aucun
    // rejeu, et l'offre était refusée READER_UNQUALIFIED. Voir `parseAvaturePortalListing`.
    raw: {
      source: 'avature',
      externalId: url.match(/\/(\d+)\/?$/)?.[1] ?? url,
      title, location, description, url,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt.toISOString() : undefined,
    },
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
  /href="([^"]*\/jobs\/JobDetail\/[^"]+)"[\s\S]{0,120}?>([^<]{3,120})</g;

/**
 * « Posted 15-Jul-2026 », « Publié 01-Oct-2026 »… cherché DANS une cellule,
 * pas seulement en tête : certaines cartes rendent la ville et la date dans le
 * même nœud texte (« Dongguan Posted 16-Jun-2026 »).
 */
const DATE_MARKER = /(publi\S*|posted|veröffentlicht|publicado|pubblicato)\s+(\d{1,2}-\w{3}-\d{4})/i;

/** Les cellules qui suivent l'extrait ne sont pas l'offre : partage social, boutons. */
const CARD_NOISE = /^(share( this job)?:?|partager|teilen|compartir|condividi)$/i;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * « 15-Jul-2026 » → minuit UTC ce jour-là. `new Date('15 Jul 2026')` lisait
 * la date en heure locale, donc la veille une fois en UTC (14 juillet à
 * 22:00Z sur un poste en Europe/Paris). Pur.
 */
export function parseCardDate(raw: string): Date | undefined {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!m) return undefined;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return undefined;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

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

    /**
     * Le bloc utile commence APRÈS la fermeture du lien-titre.
     *
     * La capture s'arrêtait sur le `<` de `</a>` : la suite commençait donc
     * par « /a> », que le découpage par balises ne voyait pas comme une
     * balise, et qui finissait en tête de l'extrait. Mesuré en base le
     * 2026-09-06 : 63 offres L'Oréal Professionnel dont la description
     * commence par « /a> Dongguan Posted 16-Jun-2026 … ».
     */
    const afterTitle = match.index + match[0].length;
    const closingLink = html.indexOf('</a>', afterTitle - 1);
    const from = closingLink !== -1 && closingLink < afterTitle + 200 ? closingLink + '</a>'.length : afterTitle;
    const tail = html.slice(from, from + 1200);
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
    const dateIndex = cells.findIndex((cell) => DATE_MARKER.test(cell));
    let location: string | undefined;
    let postedAt: Date | undefined;
    let excerptCells = cells;
    if (dateIndex >= 0) {
      const cell = cells[dateIndex];
      const marker = cell.match(DATE_MARKER)!;
      // La ville est le texte qui précède le marqueur : dans la même cellule
      // (« Dongguan Posted … ») ou dans la cellule d'avant (<span>Prague</span>).
      const before = cell.slice(0, marker.index).trim();
      location = before || (dateIndex > 0 ? cells[dateIndex - 1] : undefined);
      postedAt = parseCardDate(marker[2]);
      const after = cell.slice((marker.index ?? 0) + marker[0].length).trim();
      excerptCells = [after, ...cells.slice(dateIndex + 1)];
    }

    // L'extrait s'arrête au premier bouton ou bloc de partage : « Share this
    // job: Share Apply Now » n'est pas le texte de l'offre.
    const excerpt: string[] = [];
    for (const cell of excerptCells) {
      if (!cell) continue;
      if (CARD_NOISE.test(cell) || BUTTON_LABEL.test(cell)) break;
      excerpt.push(cell);
    }

    jobs.push({
      externalId: url.match(/\/(\d+)\/?$/)?.[1] ?? url,
      title,
      location,
      description: excerpt.join(' ').slice(0, 4000) || undefined,
      url,
      postedAt,
      // Idem : sans ces champs, le rejeu n'a rien à relire (voir `parseAvaturePortalListing`).
      raw: {
        source: 'avature',
        externalId: url.match(/\/(\d+)\/?$/)?.[1] ?? url,
        title, location, url,
        description: excerpt.join(' ').slice(0, 4000) || undefined,
        postedAt: postedAt?.toISOString(),
      },
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
      /*
       * LA CARTE ENTIÈRE ENTRE DANS LE RAW (19/09/2026).
       *
       * `raw` ne portait que `{source, reference, department}` : ni intitulé, ni lieu, ni lien.
       * Le rejeu (`publication/recovery.ts`) n'avait donc RIEN à relire, et rendait
       * READER_UNQUALIFIED. Mesuré : L'Oréal 1 701 offres et Ralph Lauren 1 131, capturées,
       * conservées, et republiables par aucun chemin — l'adaptateur lisait la page puis la jetait.
       *
       * On conserve les champs LUS, pas la page : le HTML complet vit déjà dans `RawBlob`
       * (177 937 captures), le dupliquer ici doublerait le stockage sans rien prouver de plus.
       */
      raw: {
        source: 'avature-portal',
        externalId,
        title,
        url: decode(href),
        location: decode(card.match(PORTAL_CARD_FIELD.location)?.[1] ?? '') || undefined,
        description: htmlToPlainText(card.match(PORTAL_CARD_FIELD.excerpt)?.[1]) || undefined,
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
  /**
   * LE LIBELLÉ DU CHAMP « Location », TEL QUE LA PAGE L'ÉCRIT — pas un pays.
   *
   * Ce champ s'appelait `country` et alimentait directement le pays déclaré de
   * l'offre. C'était un DÉFAUT DE CONTRAT entre l'adaptateur et le
   * normaliseur : un lieu libre (« Indianapolis, IN ») était présenté comme un
   * pays que la source aurait déclaré.
   *
   * Conséquence mesurée le 14/09/2026 : 176 offres `l-oreal-professionnel`
   * portaient un code d'État américain dans le champ pays — Indianapolis lu
   * comme l'Inde, Richmond comme le Vatican — et AUCUNE n'était signalée.
   *
   * Un adaptateur conserve la NATURE de ce qu'il a lu. L'interprétation
   * appartient au résolveur commun, qui dispose du contexte et des gardes.
   */
  rawLocation?: string;
  region?: string;
  reference?: string;
  /** JSON-LD `datePosted` of the page — L'Oréal publishes it on every fiche (1 771 offers stored without a date, audit a4). */
  postedAt?: Date;
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
    rawLocation: portalField(html, 'Location'),
    region: portalField(html, 'State/Region'),
    reference: portalField(html, 'Ref #'),
    postedAt: postedAtFromJsonLd(html),
  };
}

/**
 * The JSON-LD `datePosted` of a detail page, whatever the template (l2).
 * L'Oréal's listing mode read it (`parseAvatureJob`) but its merge dropped it:
 * 1 771 offers carried our first-seen date instead — verified live 2026-09-06
 * on three undated fiches, all publishing "2026-08-24" / "2026-01-01".
 */
export function postedAtFromJsonLd(html: string): Date | undefined {
  const posted = html.match(/"datePosted"\s*:\s*"([^"]+)"/i)?.[1];
  return posted && !Number.isNaN(Date.parse(posted)) ? new Date(posted) : undefined;
}

async function fetchAvaturePortalJobs(origin: string, lists: string[], config: Record<string, unknown>): Promise<AdapterResult> {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  let truncated = false;

  for (const list of lists) {
    const base = `${origin}/${list.replace(/^\/|\/$/g, '')}/`;
    let listTotal: number | undefined;
    // `config.maxPages` borne une lecture partielle (mesure locale, hôte qui
    // rate-limite) ; sans elle, la borne haute du plus gros portail connu.
    const maxPages = Math.min(PORTAL_MAX_PAGES, Number(config.maxPages) || PORTAL_MAX_PAGES);
    for (let offset = 0, page = 0; page < maxPages; page += 1) {
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
      if (page === maxPages - 1) truncated = true;
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
            // Le libellé « Location » enrichit le LIEU, jamais le pays déclaré :
            // c'est au résolveur d'en extraire un pays, avec ses gardes.
            location: detail.rawLocation ?? job.location,
            region: detail.region ?? job.region,
            postedAt: detail.postedAt ?? job.postedAt,
            // Les champs du détail, conservés comme ceux de la carte : sans eux le rejeu
            // reconstruirait une offre amputée de sa description et de sa ville.
            raw: { ...(job.raw as Record<string, unknown>), avaturePortalDetail: detail },
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

    // L'Oréal's 999+ badge is a lower bound, never an exact declaredTotal.
    // Only the explicit end-of-list marker proves completion.
    let truncated = false;
    let complete = false;
    let paginationUrl = listingUrl;
    for (let page = 0; page < maxPages; page++) {
      // jobOffset REMPLACÉ, jamais ajouté : la config L'Oréal porte déjà
      // `?jobOffset=0`, et `…jobOffset=0&jobOffset=1160` répond 406 — 1 716 offres
      // BROKEN au run global du 2026-09-06 13:11.
      const pageUrl = new URL(paginationUrl);
      pageUrl.searchParams.set('jobOffset', String(page * pageSize));
      // L'Oréal returned 406 at offset 240 on 2026-09-08; the same URL and
      // headers returned a genuine listing the next morning. Retry within the
      // common host gate and source budget, without assuming this is a WAF or
      // treating a persistent rejection as an empty page. Other HTTP clients
      // retain the default terminal-406 policy.
      const html = await fetchText(pageUrl.toString(), {
        headers: HEADERS,
      }, new URL(listingUrl).hostname === 'careers.loreal.com'
        ? { additionalTransientStatuses: [406] } : {});

      if (page === 0 && new URL(listingUrl).hostname === 'careers.loreal.com') {
        // Use the same public fragment endpoint as the site's Load More button.
        // Discover it from the fetched page; never guess a tenant route.
        const observed = html.match(/var\s+searchJobsAJAXPage\s*=\s*["']([^"']+)["']/)?.[1];
        if (observed) {
          const candidate = new URL(observed, listingUrl);
          const expectedPath = new URL(listingUrl).pathname.replace(/SearchJobs\/?$/, 'SearchJobsAJAX');
          if (candidate.origin === new URL(listingUrl).origin &&
              candidate.pathname.replace(/\/$/, '') === expectedPath && !candidate.search && !candidate.hash && !candidate.username && !candidate.password) {
            paginationUrl = candidate.toString().replace(/\/$/, '') + '/';
          }
        }
      }
      const batch = parseAvatureListing(html);
      const fresh = batch.filter((job) => !seen.has(job.externalId));
      for (const job of fresh) {
        seen.add(job.externalId);
        jobs.push(job);
      }
      if (fresh.length === 0) {
        complete = batch.length === 0 && /<article\b[^>]*class=["'][^"']*\barticle--result--nojobs\b/i.test(html);
        // A repeated page or unrecognised HTML is not proof of an empty board.
        truncated ||= !complete;
        break;
      }
      if (fresh.length !== batch.length) truncated = true;
      if (page === maxPages - 1) truncated = true;
    }

    if (config.withDescriptions === false) return { jobs, truncated, complete: complete && !truncated };

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
            // The card dates most offers; the fiche dates the rest (l2).
            const postedAt = job.postedAt ?? postedAtFromJsonLd(html);
            /*
             * LE TEXTE DE LA FICHE ENTRE DANS LE RAW (19/09/2026, second tour).
             *
             * Le premier correctif n'avait traité que le mode « portail ». Mesuré sur le test de
             * L'Oréal : 1 693 offres, verdict CONTENT_MISSING — le rejeu lisait enfin le RAW
             * (progrès réel sur READER_UNQUALIFIED) mais n'y trouvait que l'extrait de carte,
             * ~290 caractères, jamais la description complète lue ici.
             *
             * Les deux modes d'Avature servent les deux plus gros tenants — `listingUrl` pour
             * L'Oréal, `lists` pour Ralph Lauren : corriger l'un sans l'autre ne débloque rien.
             */
            const description = full && full.length > (job.description?.length ?? 0) ? full : job.description;
            const enriched: NormalizedJob = {
              ...job, description, postedAt,
              raw: {
                ...(job.raw as Record<string, unknown>),
                description,
                postedAt: postedAt?.toISOString(),
              },
            };
            if (config.employerFromDataLayer !== true) return enriched;
            const $ = cheerio.load(html, { scriptingEnabled: false });
            const script = $('script').map((_, node) => $(node).html() ?? '').get()
              .filter(value => /\bdataLayer\.push\s*\(/.test(value)).join('\n');
            return applyAvatureJobData(enriched, script);
          } catch {
            // A failed detail fetch must not lose the listing entry.
            return job;
          }
        }),
      ),
    );
    return { jobs: withDescriptions, truncated, complete: complete && !truncated };
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

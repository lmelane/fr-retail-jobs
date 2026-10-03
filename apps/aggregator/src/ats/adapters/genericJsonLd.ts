import { sourceDeadlineReached } from '../../lib/sourceBudget.js';
import { detailRetryAllowed, waitBeforeDetailRetry } from '../../lib/detailRetry.js';
import { log } from '../../observability/logger.js';
import * as cheerio from 'cheerio';
import { parse as parseDomain } from 'tldts';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { isKnownPosting } from '../../lib/incrementalReading.js';
import { fetchText } from '../../lib/http.js';
import { fetchSitemapUrlsDetailed, extractJobPostings, normalizeJobPosting } from '../../connectors/generic/jsonLdSitemap.js';
import { fetchRssJobs } from '../../connectors/generic/rssFeed.js';
import { briefError } from '../../lib/normalize.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';
import { captureObservedAt } from '../../capture/context.js';
import { fetchCaudalieJobs } from './caudalie.js';
import { fetchMarcOPoloJobs, MARC_O_POLO_READER } from './marcOPolo.js';
import { fetchWordpressPostTypeJobs, WORDPRESS_POST_TYPE_READER } from './wordpressPostType.js';
import { joinSpontaneousApplicationCards, joinUnreachableSpontaneousCard, SPONTANEOUS_APPLICATION_CARD } from './joinSpontaneousCard.js';

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
  return extractJobPostings(html).map(node => normalizeGenericPosting(node, pageUrl))
    .filter((job): job is NormalizedJob => job !== null);
}

/** URL identity is shared by live collection and retained native JSON-LD. */
export function normalizeGenericPosting(node: Record<string, unknown>, pageUrl: string): NormalizedJob | null {
  const job = normalizeJobPosting(node, pageUrl);
  // The page URL is the identity (sha1) and may differ from the posting's declared `url`: it is retained beside the
  // native node (lot F3b) so the retained-publication reader recomputes the same identity offline.
  return job ? { ...job, externalId: createHash('sha1').update(pageUrl).digest('hex'), raw: { ...node, catwalksPageUrl: pageUrl } } : null;
}

/** Signatures des pages de challenge (Cloudflare, Akamai, AWS WAF) servies à la place d'une liste. */
const CHALLENGE_PAGE = /just a moment|cf-chl|cf_chl|challenge-platform|_Incapsula_|aws-waf|awswaf|Access Denied|Attention Required/i;

/**
 * D-522 §6 — LE ZÉRO NATIF D'UNE PAGE CARRIÈRES (03/10/2026, Sioux et Ghost).
 *
 * Une Maison sans ATS publie ses offres sur sa page carrières et, quand elle n'en a aucune, l'écrit sur cette même page
 * (« Derzeit haben wir keine offenen Stellen. », « Although we do not have current openings »). Le lecteur générique ne
 * savait pas en faire une preuve : la page lue en mode `startUrl` rendait toujours `complete: false`, et la validation
 * refusait `EMPTY_FEED_NOT_NATIVELY_PROVEN` — une Maison sans offre restait en pause comme une source en panne.
 *
 * La preuve est STRICTE, et jamais déduite d'un silence :
 *   · la phrase est relue par un humain et configurée telle quelle (`emptyListingText`, littéral de 16 caractères au
 *     moins — une donnée, jamais une expression) ; une phrase devinée ou générique ne prouve rien ;
 *   · elle figure dans le TEXTE VISIBLE de la page (scripts, styles, gabarits, `noscript` et commentaires retirés) : un
 *     message « aucune offre » gardé dans le code d'une application ne dit rien de ce que la page affiche ;
 *   · la page et toutes les pages liées lues ne portent AUCUNE offre : ni JobPosting lisible, ni même le mot
 *     `JobPosting` (un JSON-LD cassé ou des microdonnées) ; une offre trouvée contredit la phrase et rien n'est prouvé ;
 *   · la page ne charge aucun portail d'éditeur d'ATS (widget, iframe, script) qui pourrait afficher des offres absentes
 *     du HTML servi, et la phrase n'est pas dans un élément masqué ;
 *   · toutes les pages liées ont été lues : un échec de lecture n'est jamais un zéro.
 *   · la page de départ ne charge aucun script ni aucune iframe d'un hôte hors de la Maison (même domaine enregistrable)
 *     et hors d'une liste FERMÉE d'hôtes neutres (`NEUTRAL_EMBED_HOSTS` : CDN de bibliothèques, Shopify, mesure,
 *     paiement) : un fournisseur inconnu peut afficher des offres en JavaScript (revue adverse du 03/10/2026).
 * Limites assumées, nommées :
 *   · une offre publiée en HTML simple À CÔTÉ de la phrase conservée (sans lien d'offre, sans données structurées) ne
 *     se distingue pas d'un texte de page ;
 *   · un appel de données écrit dans un script EN LIGNE (`fetch`, XHR) vers une adresse calculée ou de la Maison n'est
 *     pas analysé : un thème qui chargerait ses offres ainsi depuis sa propre origine, phrase conservée, passerait.
 *   La phrase est relue en contexte, et une Maison qui publie retire en pratique sa phrase d'absence.
 * Elle ne vaut qu'en mode page carrières (`startUrl`) : une liste paginée, un plan du site ou un flux ont leur propre
 * preuve, et une phrase n'y remplacerait pas leur parcours.
 *
 * La phrase disparaît le jour où la Maison publie : la page redevient une lecture non prouvée, nommée
 * `DECLARED_EMPTY_TEXT_ABSENT`, et le RUN la classe ; rien n'est fermé sur une page changée. Une preuve de zéro ne ferme
 * pas non plus un stock significatif d'un coup (garde de masse, `refreshPlan.ts`, R-143 §2).
 */
export const DECLARED_EMPTY_TERMINATION = 'PUBLISHER_DECLARES_NO_OPENING';
const EMPTY_LISTING_TEXT_MIN_LENGTH = 16;
// `\s` couvre l'espace insécable (U+00A0) en JavaScript.
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Le texte qu'un visiteur lit sur la page : sans scripts, styles, gabarits, `noscript`, commentaires, ni éléments masqués. */
export function visiblePageText(html: string): string {
  const $ = cheerio.load(html);
  $('script,style,template,noscript,svg,iframe,object,[hidden],[aria-hidden="true"]').remove();
  $('[style]').filter((_, el) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr('style') ?? '')).remove();
  return collapse($.root().text());
}

/**
 * Un portail d'offres embarqué (widget, iframe ou script d'un éditeur d'ATS) peut afficher des offres que le HTML servi
 * ne porte pas : une page qui en charge un ne prouve jamais un zéro, quelle que soit sa phrase.
 */
/** Hôtes neutres admis pour un script ou une iframe de la page de départ : bibliothèques, boutique, mesure, paiement. */
const NEUTRAL_EMBED_HOSTS: ReadonlySet<string> = new Set(['cdn.shopify.com', 'shop.app', 'ajax.googleapis.com', 'cdnjs.cloudflare.com',
  'www.googletagmanager.com', 'www.google-analytics.com', 'connect.facebook.net', 'x.klarnacdn.net', 'js.klarna.com', 'static.klaviyo.com',
  'www.youtube.com', 'player.vimeo.com', 'www.google.com', 'www.gstatic.com', 'fonts.googleapis.com']);

/** Un script ou une iframe chargé depuis un hôte qui n'est ni la Maison ni un hôte neutre de la liste fermée. */
function loadsUnknownEmbed(html: string, pageUrl: string): boolean {
  const page = new URL(pageUrl);
  const own = parseDomain(page.hostname, { allowPrivateDomains: true }).domain;
  const $ = cheerio.load(html);
  return $('script[src],iframe[src],frame[src],embed[src]').toArray().some(element => {
    let source: URL;
    try { source = new URL($(element).attr('src')!, page); } catch { return true; }
    if (!['https:', 'http:'].includes(source.protocol)) return source.protocol !== 'data:' && source.protocol !== 'about:';
    return parseDomain(source.hostname, { allowPrivateDomains: true }).domain !== own && !NEUTRAL_EMBED_HOSTS.has(source.hostname);
  });
}

const ATS_EMBED = /(?<![a-z0-9-])(?:greenhouse\.io|lever\.co|ashbyhq\.com|teamtailor|recruitee\.com|personio\.(?:de|com)|workable\.com|smartrecruiters\.com|join\.com|zohorecruit|bamboohr\.com|jobylon|softgarden|talent-?soft|myworkdayjobs|successfactors|icims\.com|taleo\.net|jobvite|breezy\.hr|homerun\.co|welcometothejungle|flatchr|digitalrecruiters|eightfold\.ai|phenompeople|avature\.net)/i;

/** La phrase relue, ou null quand la source n'en déclare pas ; toute autre valeur est une configuration refusée. */
function emptyListingText(config: Record<string, unknown>): string | null {
  if (config.emptyListingText === undefined) return null;
  const text = typeof config.emptyListingText === 'string' ? collapse(config.emptyListingText) : '';
  if (text.length < EMPTY_LISTING_TEXT_MIN_LENGTH) throw new Error(`generic emptyListingText must be a reviewed literal of at least ${EMPTY_LISTING_TEXT_MIN_LENGTH} characters`);
  if (config.feedUrl || config.listingUrl || config.sitemapUrl || config.reader || !config.startUrl) {
    throw new Error('generic emptyListingText applies only to a careers page read by startUrl');
  }
  return text;
}

/** Une page qui porte une offre, même illisible : un JobPosting extrait, ou le type nommé ailleurs (JSON cassé, microdonnées). */
const pageCarriesPosting = (html: string) => extractJobPostings(html).length > 0 || /JobPosting/.test(html);

/** La page affiche la phrase relue et ne porte aucune offre. Partagée avec la validation, qui la rejoue sur les octets archivés. */
export function startPageDeclaresNoOpening(html: string, text: string, pageUrl: string): boolean {
  return !pageCarriesPosting(html) && !ATS_EMBED.test(html) && !loadsUnknownEmbed(html, pageUrl) && visiblePageText(html).includes(collapse(text));
}

/** Le lecteur lit au plus la page de départ et 150 pages liées. */
const MAX_DECLARED_EMPTY_PAGES = 151;

/** La relecture de la validation sur les réponses archivées d'une collecte de page carrières (`sourceValidation.ts`). */
export function archivedStartPageDeclaresNoOpening(config: Record<string, unknown>,
  pages: ReadonlyArray<{ url: string; status: number | null; complete: boolean; body: string | null }>): boolean {
  let text: string | null;
  try { text = emptyListingText(config); } catch { return false; }
  // Une réponse par ADRESSE, la dernière tentative (les reprises du transport archivent chaque tentative), dans l'ordre
  // des réponses archivées.
  const last = new Map(pages.map(page => [page.url, page]));
  if (!text || !last.size || last.size > MAX_DECLARED_EMPTY_PAGES) return false;
  const finals = [...last.values()];
  if (finals.some(page => page.status !== 200 || !page.complete || page.body === null)) return false;
  const start = last.get(String(config.startUrl));
  return !!start && startPageDeclaresNoOpening(start.body!, text, String(config.startUrl)) && finals.every(page => !pageCarriesPosting(page.body!));
}

export async function fetchGenericJsonLdJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const declaredEmptyText = emptyListingText(config);
  if (config.reader === 'caudalie-ajax') return fetchCaudalieJobs(config);
  // Marc O'Polo (D-485) : la liste entière vient de l'API que le site déclare, témoin : la page publiée (`marcOPolo.ts`).
  if (config.reader === MARC_O_POLO_READER) return fetchMarcOPoloJobs(config);
  // Un type de billet WordPress public, lu par l'API REST du site contre son total (Kastner & Öhler, D-522 §6).
  if (config.reader === WORDPRESS_POST_TYPE_READER) return fetchWordpressPostTypeJobs(config);
  /**
   * An RSS/Atom careers feed, when the site publishes one — the cheapest generic
   * path (no page crawl at all). Many small brands and TalentSoft/WordPress sites
   * expose a feed of openings; parsing it needs no per-vendor code.
   */
  if (config.feedUrl) {
    // D-520 : un flux ne dit ni combien d'offres il porte ni s'il les porte toutes — la limite de la famille, nommée.
    const jobs = await fetchRssJobs(config);
    return { jobs, complete: false, enumeration: { method: 'PUBLISHER_FEED_NO_ENUMERATION_PROOF', endpoint: String(config.feedUrl), pages: 1,
      rawCount: jobs.length, termination: 'FEED_READ', issues: ['PUBLISHER_FEED_WITHOUT_TOTAL', 'ENUMERATION_NOT_PROVEN'] } };
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
    /** Les liens listés et comptés par l'éditeur qui ne sont pas des offres : jamais lus comme des fiches. */
    const cards = new Set<string>();
    /** Cards counted from the page state on a last page the publisher never serves (`joinUnreachableSpontaneousCard`). */
    const unreadCards = new Set<string>();
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
      if (sourceDeadlineReached()) { termination = 'DEADLINE'; break; }
      const sep = listingPagedUrl.includes('?') ? '&' : '?';
      // The end of a paginated listing is signalled one of two ways, and both
      // mean "stop here with what we have", not "fail the source": Michael Page
      // 404s the page after the last (…/jobs?page=191), others just return a page
      // with no offer links. A 404 thrown here used to propagate and discard
      // every offer already collected — the live "michael-page-france failed".
      // A non-404 error (an exhausted-retry blip) also stops the sweep rather
      // than losing the whole source; the pages already collected still ingest.
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
      let html: string;
      try {
        html = await fetchText(pageUrl, {
          headers: {
            'user-agent':
              CRAWLER_IDENTITY,
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
      // La carte de candidature spontanée que l'éditeur compte dans son total (join.com, 30/09/2026) : un lien listé et
      // compté, jamais lu comme une fiche (`joinSpontaneousCard.ts`).
      for (const card of joinSpontaneousApplicationCards(html, pageUrl, pageLinks)) cards.add(card);
      // La carte seule sur une dernière page que join.com ne sert pas (01/10/2026) : comptée, jamais lue ni visitée.
      const unreadCard = joinUnreachableSpontaneousCard(html, pageUrl, pageLinks);
      if (unreadCard) { cards.add(unreadCard); unreadCards.add(unreadCard); seen.add(unreadCard); }
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
    if (seen.size === 0 && !sourceDeadlineReached()) {
      throw new Error(`generic-listing ${listingPagedUrl}: no offer link matched "${linkPattern}" — pattern or listing broken`);
    }

    const limit = pLimit(Number(config.concurrency ?? 4));
    let detailFailures = 0;
    const readDetail = async (url: string) => parseJobPostings(await fetchText(url, { headers: { 'user-agent': CRAWLER_IDENTITY } }), url);
    const offerLinks = [...seen].filter(url => !cards.has(url));
    // D-517 : en lecture incrémentale, la page n'est lue que pour un lien jamais vu (l'identité est le sha1 de l'adresse).
    const listed = offerLinks.filter(url => !isKnownPosting(createHash('sha1').update(url).digest('hex')));
    const failed: number[] = [];
    const pages = await Promise.all(
      listed.map((url, index) =>
        limit(async () => {
          // Stop starting new detail fetches past the budget; what was already
          // fetched stays, the rest is picked up next run.
          if (sourceDeadlineReached()) { detailFailures++; return []; }
          try {
            const parsed = await readDetail(url);
            if (parsed.length === 0) failed.push(index);
            return parsed;
          } catch {
            failed.push(index);
            return [];
          }
        }),
      ),
    );
    /**
     * Une seule relecture, différée, des fiches en échec (29/09/2026, Pandora) : l'éditeur répond 403 à tout pendant
     * une cinquantaine de secondes, deux fois par passage, et les trois essais du transport (0,5 s puis 1 s) tombent
     * tous dans la fenêtre — 3 à 4 offres perdues chaque jour sur 935. Bornée à quelques échecs : un site en panne ou
     * une porte refusée n'allonge pas le RUN. Le rejeu hors réseau sert les réponses d'une même adresse dans l'ordre.
     */
    // Tout en échec est une panne entière, nommée plus bas : la relire ne ferait que retarder le RUN. Bornes et délai
    // partagés avec Talentsoft (`lib/detailRetry.ts`, 30/09/2026).
    if (detailRetryAllowed(failed.length, listed.length)) {
      await waitBeforeDetailRetry(config);
      for (const index of failed.sort((a, b) => a - b)) {
        if (sourceDeadlineReached()) { detailFailures++; continue; }
        try {
          const parsed = await readDetail(listed[index]);
          if (parsed.length === 0) detailFailures++;
          pages[index] = parsed;
        } catch { detailFailures++; }
      }
    } else detailFailures += failed.length;
    const jobs = pages.flat();
    /**
     * Zéro silencieux, deuxième forme (mesurée le 2026-09-06 sur Michael Page,
     * un run sur deux) : la liste rend ses liens, mais AUCUNE page de détail ne
     * rend d'offre — soit elles échouent (403), soit elles répondent une page de
     * challenge sans JobPosting. Chaque échec avalé en [] donnait « 0 fetched,
     * 0 errors » : la source passait BROKEN sans qu'une ligne dise pourquoi. Un
     * échec total est une panne à nommer, pas un employeur sans poste.
     */
    // Une lecture incrémentale dont tous les liens étaient connus n'a lu aucune page : rien à signaler.
    if (seen.size > 0 && jobs.length === 0 && !sourceDeadlineReached() && !(offerLinks.length > 0 && listed.length === 0)) {
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
    /*
     * Le total de l'éditeur compte ses cartes (join.com : 5 = 4 offres + la carte) : le lien compté réconcilie le
     * parcours, et le total d'OFFRES déclaré en retire la carte — sans quoi 4 offres lues sur 5 « déclarées » passeraient
     * sous le seuil de couverture de l'attestation. La carte reste une ligne nommée, jamais une offre ni un échec.
     */
    const nonPosting = [...cards].filter(url => seen.has(url));
    return { jobs, declaredTotal: (publisherCount ?? seen.size) - nonPosting.length, complete, truncated: !reachedEnd || detailFailures > 0 || belowCount,
      ...(nonPosting.length ? { rejectedRows: nonPosting.map(url => ({ reason: SPONTANEOUS_APPLICATION_CARD, raw: { url, ...(unreadCards.has(url) ? { unreadLastPage: true } : {}) } })) } : {}),
      enumeration: { method: 'PAGINATED_LISTING_WITH_DETAIL_READ', endpoint: listingPagedUrl, pages: pagesRead, rawCount: rawLinks, termination, issues,
        scopes: [
          ...(publisherCount !== undefined ? [{ scope: 'publisherCount', declaredTotal: publisherCount, uniqueIds: seen.size, pages: pagesRead, complete: seen.size >= publisherCount }] : []),
          { scope: 'listedLinks', declaredTotal: publisherCount ?? seen.size, uniqueIds: seen.size, pages: pagesRead, complete: reachedEnd && !belowCount },
          ...(nonPosting.length ? [{ scope: 'publisherNonPostingCards', declaredTotal: nonPosting.length, uniqueIds: nonPosting.length, pages: pagesRead, complete: true }] : []),
          { scope: 'postingsParsed', declaredTotal: listed.length, uniqueIds: jobs.length, pages: pagesRead, complete }] } };
  }

  const sitemapUrl = String(config.sitemapUrl ?? '');
  if (sitemapUrl) {
    const sitemap = await fetchSitemapUrlsDetailed(sitemapUrl);
    const listedUrls = [...new Set(sitemap.urls)];
    // A public sitemap may include navigation/search pages alongside postings
    // (Radancy). Reuse the reviewed literal job-path fragments already used by
    // paginated listings; never fetch unrelated navigation to discover it has
    // no JobPosting. Keep the excluded count in the enumeration evidence.
    const fragments = linkPattern.split('|').map(value => value.trim()).filter(Boolean);
    const urls = fragments.length ? listedUrls.filter(url => fragments.some(fragment => new URL(url).pathname.includes(fragment))) : listedUrls;
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
            // The job page is read under the crawler identity, like every request of a collection:
            // the reviewed access scope refuses any other agent.
            const parsed = parseJobPostings(
              await fetchText(url, {
                headers: {
                  'user-agent':
                    CRAWLER_IDENTITY,
                },
              }),
              url,
            );
            if (parsed.length === 0) rejectedRows.push({ reason: 'LISTED_PAGE_WITHOUT_JOBPOSTING', raw: { url } });
            return parsed;
          } catch (error) {
            fetchFailures++;
            rejectedRows.push({ reason: 'LISTED_PAGE_FETCH_FAILED', raw: { url, error: error instanceof Error ? error.name : 'UnknownError' } });
            return [];
          }
        }),
      ),
    );

    const detailPostings = new Map(urls.map((url, index) => [url, pages[index]]));
    const jobs = pages.flatMap((postings, index) => postings.filter(job => {
      const pageUrl = urls[index];
      const node = job.raw as Record<string, unknown>;
      // A sitemap can list both a board and its detail pages. Only discard a
      // preview when its explicit native URL leads to a successfully parsed
      // detail in this SAME capture. A missing/failed detail keeps the preview
      // and its evidence; title similarity alone never merges publications.
      if (typeof node.url !== 'string' || node.url === pageUrl) return true;
      const detail = detailPostings.get(node.url)?.find(candidate =>
        candidate.url === node.url && candidate.title === job.title && !candidate.publicationHold && candidate.description?.trim());
      if (!detail) return true;
      rejectedRows.push({ reason: 'LISTED_POSTING_PREVIEW', raw: { url: pageUrl, posting: node, detailUrl: node.url, detailExternalId: detail.externalId } });
      return false;
    }));
    // Do not silently keep the first of several postings sharing one page ID.
    // Qualification reports DUPLICATE_PUBLICATION_IDS for an ambiguous board.
    const complete = sitemap.failedShards.length === 0 && fetchFailures === 0;
    const issues = [...(sitemap.failedShards.length ? [`UNREACHABLE_SHARDS=${sitemap.failedShards.length}`] : []), ...(fetchFailures ? [`PAGE_FETCH_FAILURES=${fetchFailures}`] : []), ...(complete ? [] : ['ENUMERATION_NOT_PROVEN'])];
    // Parallel detail requests settle in a different order offline. Keep the
    // evidence order tied to its source URL, not response timing.
    rejectedRows.sort((a, b) => String((a.raw as { url: string }).url).localeCompare(String((b.raw as { url: string }).url), 'en'));
    return { jobs, declaredTotal: urls.length, complete, truncated: !complete, rejectedRows,
      enumeration: { method: sitemap.isIndex ? 'SITEMAP_INDEX_WITH_DETAIL_READ' : 'SITEMAP_URLSET_WITH_DETAIL_READ', endpoint: sitemapUrl, pages: sitemap.shards.length, rawCount: sitemap.urls.length, termination: complete ? 'ALL_LISTED_PAGES_READ' : 'LISTED_PAGES_MISSING', issues,
        scopes: [...(fragments.length ? [{ scope: 'sitemapUrlsOutsideJobPath', declaredTotal: listedUrls.length - urls.length, uniqueIds: listedUrls.length - urls.length, pages: sitemap.shards.length, complete: true }] : []),
                 { scope: 'shards', declaredTotal: sitemap.shards.length, uniqueIds: sitemap.shards.length - sitemap.failedShards.length, pages: sitemap.shards.length, complete: sitemap.failedShards.length === 0 },
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
  /**
   * D-522 §6 (03/10/2026) — UNE ANCRE DE LA PAGE DE DÉPART EST LA PAGE DE DÉPART. Lumentee lie ses propres ancres
   * (`#roles`, `#main`, `#culture`, `#`) : chacune était relue comme une page, et son offre publiée cinq fois sous cinq
   * identités (l'empreinte de l'adresse). La page de départ, déjà lue, ne l'est plus une seconde fois, sous aucune ancre.
   * Le fragment d'un lien vers UNE AUTRE page est gardé tel quel : il fait partie de l'identité des offres déjà publiées
   * (Attaquer : `/pages/careers/garment-technician#role`), et le retirer les republierait sous une autre identité sans
   * pouvoir fermer les anciennes (liste indémontrable).
   */
  const start = new URL(startUrl); start.hash = '';
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, startUrl);
      if (url.origin !== origin) return;
      const page = new URL(url.href); page.hash = '';
      if (page.href === start.href) return;
      if (/job|jobs|career|carriere|carrière|recrutement|vacanc/i.test(url.pathname)) links.add(url.toString());
    } catch { /* ignore */ }
  });
  const limit = pLimit(3);
  let linkFailures = 0, linkedPagesCarryingPosting = 0;
  const pages = await Promise.all([...links].slice(0, 150).map((url) => limit(async () => {
    try {
      const linked = await fetchText(url);
      if (pageCarriesPosting(linked)) linkedPagesCarryingPosting++;
      return parseJobPostings(linked, url);
    } catch { linkFailures++; return []; }
  })));
  const byKey = new Map<string, NormalizedJob>();
  for (const job of [...direct, ...pages.flat()]) byKey.set(`${job.externalId}|${job.url}`, job);
  // D-522 §6 : la page affiche la phrase relue, et ni elle ni aucune page liée, toutes lues, ne porte d'offre.
  if (declaredEmptyText) {
    const declared = visiblePageText(html).includes(declaredEmptyText);
    if (declared && startPageDeclaresNoOpening(html, declaredEmptyText, startUrl) && linkedPagesCarryingPosting === 0 && linkFailures === 0 && links.size <= 150 && byKey.size === 0) {
      return { jobs: [], declaredTotal: 0, complete: true, truncated: false,
        enumeration: { method: 'START_PAGE_PUBLISHER_DECLARES_NO_OPENING', endpoint: startUrl, pages: 1 + links.size, rawCount: links.size,
          termination: DECLARED_EMPTY_TERMINATION, issues: [],
          scopes: [{ scope: 'publisherDeclaredNoOpening', declaredTotal: 0, uniqueIds: 0, pages: 1 + links.size, complete: true }],
          pageEvidence: [{ url: startUrl, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(html).digest('hex'),
            offset: 0, pagination: null, ids: [], canonicalIds: [], publisherCounter: declaredEmptyText, componentCounters: [] }] } };
    }
    return { jobs: [...byKey.values()], complete: false, truncated: links.size > 150,
      enumeration: { method: 'START_PAGE_LINK_CRAWL_NO_ENUMERATION_PROOF', endpoint: startUrl, pages: 1, rawCount: links.size, termination: links.size > 150 ? 'LINK_CAP_150' : 'LINKS_EXHAUSTED',
        issues: [declared ? 'DECLARED_EMPTY_CONTRADICTED' : 'DECLARED_EMPTY_TEXT_ABSENT', ...(linkFailures ? [`LINKED_PAGE_FETCH_FAILURES=${linkFailures}`] : []),
          'NO_PUBLISHER_LISTING_OR_SITEMAP', 'ENUMERATION_NOT_PROVEN'] } };
  }
  // A start-page link crawl reads what ONE page links to (capped at 150): it
  // can never prove a board's extent. The evidence says so instead of staying silent.
  return { jobs: [...byKey.values()], complete: false, truncated: links.size > 150,
    enumeration: { method: 'START_PAGE_LINK_CRAWL_NO_ENUMERATION_PROOF', endpoint: startUrl, pages: 1, rawCount: links.size, termination: links.size > 150 ? 'LINK_CAP_150' : 'LINKS_EXHAUSTED', issues: ['NO_PUBLISHER_LISTING_OR_SITEMAP', 'ENUMERATION_NOT_PROVEN'] } };
}

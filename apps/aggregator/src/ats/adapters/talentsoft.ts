import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * TalentSoft (Cegid) careers sites — the ATS behind Balmain, Longchamp, Groupe
 * Printemps, Lagardère Travel Retail, Chantelle, Darjeeling and others. Hosted
 * at `<tenant>.talent-soft.com`.
 *
 * Access, verified 2026-09-02 against five boards (Longchamp, Balmain, Printemps,
 * Chantelle, Lagardère — 20 offers each):
 *  - Every board exposes a real RSS feed at /handlers/offerRss.ashx?LCID=1036
 *    (LCID 1036 = French), returning <item>s with a full description — no
 *    per-offer fetch, no JS rendering, no key.
 *  - Each <item> carries: <link> (…detailoffre.aspx?idOffre=<id>), a <title>
 *    ("<ref> - <role> H/F"), one or more <category> (the contract type then the
 *    city), and an HTML <description> opening with "<b>Contrat :</b> …".
 *
 * The RSS feed is hard-capped at 20 items — no pagination parameter lifts it
 * (PageSize, page, nb… all still return 20, tested). Reading only it silently
 * hid most of a big board (Printemps: 20 served, 112 held) — audit F-04.
 *
 * COMPLETE READ (F-04, plan A→Z): the HTML listing
 * /offre-de-emploi/liste-toutes-offres.aspx?page=N&LCID=1036 paginates
 * 10 cards a page and announces its total in the <title>
 * ("… (112 offres, page 1)", verified live on printemps-career 2026-09-03).
 * Each card carries the offer link (…emploi-<slug>_<id>.aspx), the title, a
 * date and a location. The detail page has no JSON-LD/microdata but a clean
 * "Description du poste" section (~1.5k chars, verified) — extracted by
 * markup, with the RSS still merged on top for the 20 newest (it has the
 * cleaner contract + pubDate).
 */

/** LCID 1036 is TalentSoft's code for French; the feed is the same shape in any locale. */
const FRENCH_LCID = 1036;

/**
 * A category that names a CONTRACT, in the vocabulary these tenants publish. Anchored so that a city containing
 * the letters (e.g. "Cdiville") is not mistaken for one, and kept to what was actually observed in the feeds.
 */
const CONTRACT_CATEGORY = /^(cdi|cdd|stage|alternance|apprentissage|int[ée]rim|freelance|vie|v\.i\.e\.?|temps (plein|partiel)|contrat pro\w*|professionnalisation)\b/i;
/** A category that names a JOB FAMILY: Talentsoft writes it with slashes ("Commerce / Vente / Relations Clients"). */
const JOB_FAMILY_CATEGORY = /\s\/\s/;

export type RssItem = {
  link?: string;
  title?: string;
  description?: string;
  category?: string | string[];
  pubDate?: string;
};

/**
 * The numeric offer id. Three shapes are served, all measured:
 *  - `…detailoffre.aspx?idOffre=<n>` (Longchamp, Balmain, Printemps…);
 *  - `…/offre-de-emploi/emploi-<slug>_<n>.aspx` (the listing cards);
 *  - a link OFF the board, e.g. Lagardère's RSS points to
 *    `lagardere.com/nous-rejoindre/postuler/offre-2026-10266-502`, which
 *    redirects to the group's home page. Its reference "2026-10266" is the
 *    board id 10266 with the year prefixed (verified card by card on the
 *    listing: `_10266.aspx` ↔ "Réf. 2026-10266"). Falling back to the whole
 *    link made 20 RSS items look like 20 extra postings with dead URLs.
 */
export function externalIdFromLink(link: string, title?: string): string {
  try {
    const url = new URL(link);
    const param = url.searchParams.get('idOffre');
    if (param) return param;
    const path = /_(\d+)\.aspx$/i.exec(url.pathname);
    if (path) return path[1];
  } catch { /* fall through to the reference */ }
  const reference = /\b\d{4}-(\d{3,})\b/.exec(`${title ?? ''} ${link}`);
  return reference ? reference[1] : link;
}

export function talentsoftItemToJob(item: RssItem): NormalizedJob | null {
  const link = item.link?.trim();
  const title = item.title?.trim();
  if (!link || !title) return null;

  /**
   * The feed lists several <category> tags, and their ORDER is not a contract.
   *
   * The code assumed "first = contract, rest = location". Measured on production raw (2026-09-10), Lagardère
   * publishes `["Commerce / Vente / Relations Clients", "Stage", "Malakoff"]`: the first tag is the JOB FAMILY,
   * so the contract slid into the location and 102 postings across five talentsoft sources ended up with a
   * location like "Stage, Malakoff" or "CDI, Nice" — and two cities canonicalised to "Cdi" and "Apprentissage".
   * Each value is therefore sorted by WHAT IT IS, the same rule the HTML card path already follows: a contract
   * word is a contract, whatever its position; anything left describes the place.
   */
  const categories = item.category === undefined
    ? []
    : (Array.isArray(item.category) ? item.category : [item.category]).map((c) => String(c).trim()).filter(Boolean);
  const contract = categories.find((c) => CONTRACT_CATEGORY.test(c));
  const places = categories.filter((c) => c !== contract && !JOB_FAMILY_CATEGORY.test(c));

  return {
    externalId: externalIdFromLink(link, title),
    title,
    location: places.join(', ') || undefined,
    contract: contract || undefined,
    description: item.description ? htmlToPlainText(item.description) : undefined,
    url: link,
    postedAt: item.pubDate ? new Date(item.pubDate) : undefined,
    raw: item as Record<string, unknown>,
  };
}

/**
 * Une carte du listing : lien, titre, puis la liste (réf / date / lieu).
 *
 * DEUX gabarits, et c'est le cœur du bug Lagardère (2026-09-08) : le motif
 * n'acceptait que `ts-offer-card__title-link`, et le site sert désormais
 * `ts-offer-list-item__title-link` — **0 occurrence de l'ancien** dans la page
 * réellement servie, contre 70 du nouveau. Le listing entier devenait
 * invisible et seules les 20 offres du flux RSS subsistaient, sur 109
 * annoncées. Le fetch réussissait pourtant (96 Ko, HTTP 200, 12 cartes par
 * page) : ni pagination bloquée, ni anti-bot.
 *
 * `ts-offer-(?:card|list-item)__title-link` couvre les deux — d'autres tenants
 * TalentSoft servent encore l'ancien. L'ordre des attributs n'est pas garanti
 * non plus (`class` avant ou après `href`) : on accepte les deux sens plutôt
 * que de re-casser au prochain changement de thème.
 */
const CARD_RE =
  /<a\b(?=[^>]*class="ts-offer-(?:card|list-item)__title-link)[^>]*\shref="(\/offre-de-emploi\/[^"]*_(\d+)\.aspx)"[^>]*>\s*([^<]+?)\s*<\/a>/g;

/** Cards of one listing page — each card's body runs until the next card. */
export function listingCards(html: string, origin: string): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  const matches = [...html.matchAll(CARD_RE)];
  for (const [i, match] of matches.entries()) {
    const [, path, id, title] = match;
    const start = match.index ?? 0;
    const end = matches[i + 1]?.index ?? Math.min(html.length, start + 4000);
    const after = html.slice(start, end);
    /**
     * Les métadonnées d'une carte, dans les DEUX gabarits.
     *
     * L'ancien les listait en `<li>` ; l'actuel écrit une seule ligne
     * « Réf. : 2026-10345 | 08/09/2026 | Malakoff » dans un `<ul>`. Ne lire que
     * les `<li>` laissait 109 des 129 offres sans lieu ni date (mesuré le
     * 2026-09-08 : seules les 20 du flux RSS étaient localisées). On collecte
     * les deux formes, puis on trie par ce que chaque valeur EST — une date se
     * reconnaît, une référence aussi, le reste est le lieu.
     */
    const cells = [
      ...[...after.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1]),
      ...[...after.matchAll(/<ul[^>]*class="ts-offer-list-item__description[^"]*"[^>]*>([^<]+)</g)]
        .flatMap((m) => m[1].split('|')),
    ]
      .map((cell) => htmlToPlainText(cell)?.trim() ?? '')
      .filter(Boolean);

    const date = cells.find((v) => /^\d{2}\/\d{2}\/\d{4}$/.test(v));
    // Same sorting rule as the RSS path: a contract word is a contract wherever it sits, and never the place.
    const place = cells
      .filter((v) => !/^r[ée]f\b/i.test(v) && !/^\d{2}\/\d{2}\/\d{4}$/.test(v) && !CONTRACT_CATEGORY.test(v))
      .pop();
    const postedAt = date
      ? new Date(`${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}T00:00:00Z`)
      : undefined;
    jobs.push({
      externalId: id,
      // Le HTML servi porte des entités (« A&#233;roport de Nice ») : un
      // candidat ne doit jamais lire du code source dans un intitulé.
      title: htmlToPlainText(title)?.trim() ?? title.trim(),
      location: place || undefined,
      url: `${origin}${path}`,
      postedAt,
      raw: { path },
    });
  }
  return jobs;
}

/** "Description du poste" section text of a detail page; empty when absent. */
export function talentsoftDetailDescription(html: string): string {
  const match = html.match(/Description du poste<\/h2>([\s\S]*?)<h2/);
  return match ? (htmlToPlainText(match[1]) ?? '') : '';
}

export async function fetchTalentsoftJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('TalentSoft origin missing');

  // 1. RSS — clean contract/pubDate/description for the 20 newest.
  const xml = await fetchText(`${origin}/handlers/offerRss.ashx?LCID=${FRENCH_LCID}`);
  const parser = new XMLParser({ ignoreAttributes: false, textNodeName: '#text' });
  const data = parser.parse(xml);
  const items = data?.rss?.channel?.item ?? [];
  const list: RssItem[] = Array.isArray(items) ? items : [items];
  const byId = new Map<string, NormalizedJob>();
  for (const item of list) {
    const job = talentsoftItemToJob(item);
    if (job && !byId.has(job.externalId)) byId.set(job.externalId, job);
  }

  // 2. The FULL listing, page by page, until the announced total is covered.
  let declaredTotal: number | undefined;
  /**
   * Le balayage s'est-il arrêté AVANT d'avoir couvert le board ?
   *
   * `truncated` était calculé nulle part et jamais renvoyé (le commentaire le
   * promettait pourtant) : une page en échec ou un gabarit non reconnu sortait
   * de la boucle en silence, et le run passait pour complet. Depuis D51 ce
   * drapeau décide du DROIT D'ATTESTER — un run tronqué ne ferme plus rien.
   */
  let truncated = false;
  const fromListing: NormalizedJob[] = [];
  const seenListing = new Set<string>();
  const issues = new Set<string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const maxPages = Number(config.maxPages ?? 100);
  let pages = 0, rawCount = 0, termination = 'PAGE_BUDGET_EXHAUSTED';
  const listingEndpoint = `${origin}/offre-de-emploi/liste-toutes-offres.aspx?LCID=${FRENCH_LCID}`;
  for (let page = 1; page <= maxPages; page++) {
    const url = `${origin}/offre-de-emploi/liste-toutes-offres.aspx?page=${page}&LCID=${FRENCH_LCID}`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      // Les offres du RSS partent quand même, mais le board n'a pas été vu.
      truncated = true; termination = 'LISTING_FETCH_FAILED'; issues.add('LISTING_FETCH_FAILED');
      break;
    }
    pages++;
    const announced = html.match(/\((\d+)\s+offres?/i);
    if (announced) {
      if (declaredTotal === undefined) declaredTotal = Number(announced[1]);
      else if (declaredTotal !== Number(announced[1])) issues.add('SOURCE_TOTAL_CHANGED');
    }
    const all = listingCards(html, origin);
    rawCount += all.length;
    const cards = all.filter((job) => !seenListing.has(job.externalId));
    pageEvidence.push({ url, checkedAt: new Date().toISOString(), sha256: createHash('sha256').update(html).digest('hex'), offset: (page - 1) * 10,
      pagination: declaredTotal === undefined ? null : { start: (page - 1) * 10, end: (page - 1) * 10 + all.length, total: declaredTotal },
      ids: all.map((j) => j.externalId), publisherCounter: announced ? announced[0] : '', componentCounters: [`listingIds=${seenListing.size + cards.length}`] });
    // The board serves its first page again past the last one (page 12 of 11
    // answers "page 1"): a page without a new card is the end, not an error.
    if (cards.length === 0) { termination = all.length ? 'REPEATED_PAGE' : 'EMPTY_PAGE'; break; }
    for (const job of cards) {
      seenListing.add(job.externalId);
      fromListing.push(job);
    }
    if (declaredTotal !== undefined && seenListing.size >= declaredTotal) { termination = 'ANNOUNCED_TOTAL_REACHED'; break; }
  }
  if (termination === 'PAGE_BUDGET_EXHAUSTED') truncated = true;

  /**
   * Le juge final : la source ANNONCE un total, on compare à ce qu'on a vu.
   * C'est ce qui attrape un gabarit qui change en silence — le cas Lagardère,
   * où le listing rendait 0 carte et où seul le RSS (20 sur 109) subsistait.
   */
  if (declaredTotal !== undefined && seenListing.size < declaredTotal) truncated = true;

  // 3. Merge: the listing enumerates, the RSS enriches its overlap — the
  // board URL is kept (an RSS link may leave the board and redirect
  // elsewhere, as on Lagardère). An RSS item that matches no listing card is
  // added only when its link is ON the board; otherwise it is retained as a
  // rejected row for diagnosis, never counted as a posting.
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const originHost = new URL(origin).hostname;
  const jobs: NormalizedJob[] = fromListing.map((job) => {
    const rss = byId.get(job.externalId);
    return rss ? { ...job, ...rss, url: job.url, location: rss.location ?? job.location, raw: { ...(job.raw as object), rss: rss.raw } } : job;
  });
  for (const [id, job] of byId) {
    if (seenListing.has(id)) continue;
    let onBoard = false;
    try { onBoard = new URL(job.url).hostname === originHost; } catch { /* off board */ }
    if (onBoard && fromListing.length === 0) jobs.push(job);                       // listing unreadable: the RSS still carries the board
    else if (onBoard) { jobs.push(job); issues.add('RSS_ITEM_ABSENT_FROM_LISTING'); }
    else rejectedRows.push({ reason: 'RSS_ITEM_LINK_OFF_BOARD_AND_ABSENT_FROM_LISTING', raw: job.raw });
  }
  const complete = declaredTotal !== undefined && seenListing.size === declaredTotal && !truncated && issues.size === 0;
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');

  // 4. Descriptions for the listing-only offers, from their detail pages.
  if (config.withDescriptions !== false) {
    const limit = pLimit(Number(config.detailConcurrency ?? 4));
    await Promise.all(
      jobs.map((job, index) =>
        limit(async () => {
          if (job.description) return;
          try {
            const description = talentsoftDetailDescription(await fetchText(job.url));
            if (description) jobs[index] = { ...jobs[index], description };
          } catch {
            // A failed detail fetch must not lose the listing entry.
          }
        }),
      ),
    );
  }

  return { jobs, declaredTotal, truncated, complete, rejectedRows,
    enumeration: { method: 'ANNOUNCED_TOTAL_HTML_PAGINATION_WITH_RSS_ENRICHMENT', endpoint: listingEndpoint, pages, rawCount, termination, issues: [...issues],
      scopes: [{ scope: 'listing', declaredTotal: declaredTotal ?? -1, uniqueIds: seenListing.size, pages, complete }, { scope: 'rss', declaredTotal: byId.size, uniqueIds: byId.size, pages: 1, complete: true }],
      pageEvidence } };
}

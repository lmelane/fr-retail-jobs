import { XMLParser } from 'fast-xml-parser';
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

export type RssItem = {
  link?: string;
  title?: string;
  description?: string;
  category?: string | string[];
  pubDate?: string;
};

/** The numeric offer id lives in the detail link as `idOffre=<n>`. */
function externalIdFromLink(link: string): string {
  return new URL(link).searchParams.get('idOffre') ?? link;
}

export function talentsoftItemToJob(item: RssItem): NormalizedJob | null {
  const link = item.link?.trim();
  const title = item.title?.trim();
  if (!link || !title) return null;

  // The feed lists the contract type and the city as separate <category> tags;
  // the first is the contract (CDI/CDD/Stage…), the rest describe the location.
  const categories = item.category === undefined
    ? []
    : (Array.isArray(item.category) ? item.category : [item.category]).map((c) => String(c).trim()).filter(Boolean);
  const [contract, ...places] = categories;

  return {
    externalId: externalIdFromLink(link),
    title,
    location: places.join(', ') || undefined,
    contract: contract || undefined,
    description: item.description ? htmlToPlainText(item.description) : undefined,
    url: link,
    postedAt: item.pubDate ? new Date(item.pubDate) : undefined,
    raw: item as Record<string, unknown>,
  };
}

/** One listing card: link, title, and the content list (ref / date / place). */
const CARD_RE =
  /class="ts-offer-card__title-link[^"]*"\s+href="(\/offre-de-emploi\/[^"]*_(\d+)\.aspx)"[^>]*>\s*([^<]+?)\s*<\/a>/g;

/** Cards of one listing page — each card's body runs until the next card. */
export function listingCards(html: string, origin: string): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  const matches = [...html.matchAll(CARD_RE)];
  for (const [i, match] of matches.entries()) {
    const [, path, id, title] = match;
    const start = match.index ?? 0;
    const end = matches[i + 1]?.index ?? Math.min(html.length, start + 4000);
    const after = html.slice(start, end);
    const lis = [...after.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1].trim());
    const date = lis.find((v) => /^\d{2}\/\d{2}\/\d{4}$/.test(v));
    const place = lis.filter((v) => !/^Réf/i.test(v) && !/^\d{2}\/\d{2}\/\d{4}$/.test(v)).pop();
    const postedAt = date
      ? new Date(`${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}T00:00:00Z`)
      : undefined;
    jobs.push({
      externalId: id,
      title: title.trim(),
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
  const fromListing: NormalizedJob[] = [];
  const seenListing = new Set<string>();
  for (let page = 1; page <= Number(config.maxPages ?? 100); page++) {
    let html: string;
    try {
      html = await fetchText(
        `${origin}/offre-de-emploi/liste-toutes-offres.aspx?page=${page}&LCID=${FRENCH_LCID}`,
      );
    } catch {
      break; // the RSS offers below still ship; `truncated` says the rest
    }
    if (declaredTotal === undefined) {
      const announced = html.match(/\((\d+)\s+offres?/i);
      if (announced) declaredTotal = Number(announced[1]);
    }
    const cards = listingCards(html, origin).filter((job) => !seenListing.has(job.externalId));
    if (cards.length === 0) break;
    for (const job of cards) {
      seenListing.add(job.externalId);
      fromListing.push(job);
    }
    if (declaredTotal !== undefined && seenListing.size >= declaredTotal) break;
  }

  // 3. Merge: the listing enumerates, the RSS enriches its overlap — and
  // still carries the board alone if the listing markup ever changes.
  const jobs: NormalizedJob[] = fromListing.map((job) => {
    const rss = byId.get(job.externalId);
    return rss ? { ...job, ...rss, location: rss.location ?? job.location } : job;
  });
  for (const [id, job] of byId) if (!seenListing.has(id)) jobs.push(job);

  // 4. Descriptions for the listing-only offers, from their detail pages.
  if (config.withDescriptions !== false) {
    const limit = pLimit(Number(config.detailConcurrency ?? 6));
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

  return { jobs, declaredTotal };
}

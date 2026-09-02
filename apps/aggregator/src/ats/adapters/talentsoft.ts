import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { NormalizedJob } from '../../types.js';

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
 * KNOWN LIMIT: the feed is hard-capped at 20 items — no pagination parameter
 * lifts it (PageSize, page, nb… all still return 20, tested). A board with more
 * than 20 openings (Lagardère ~109, Printemps ~111) is therefore read only to
 * its 20 most recent. The full listing (/offre-de-emploi/liste-toutes-offres
 * .aspx?all=1) has them all, but the detail pages carry NEITHER JSON-LD nor
 * microdata, so the complete read would mean fragile per-offer HTML scraping.
 * The 20 the RSS gives are clean and structured; widening this is a follow-up,
 * not a blocker — 20 real offers per Maison beats zero.
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

export async function fetchTalentsoftJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('TalentSoft origin missing');

  const xml = await fetchText(`${origin}/handlers/offerRss.ashx?LCID=${FRENCH_LCID}`);
  const parser = new XMLParser({ ignoreAttributes: false, textNodeName: '#text' });
  const data = parser.parse(xml);

  const items = data?.rss?.channel?.item ?? [];
  const list: RssItem[] = Array.isArray(items) ? items : [items];

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const job = talentsoftItemToJob(item);
    if (!job || seen.has(job.externalId)) continue;
    seen.add(job.externalId);
    jobs.push(job);
  }
  return jobs;
}

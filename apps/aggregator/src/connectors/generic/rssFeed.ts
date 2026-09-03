import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Generic RSS/Atom careers-feed connector — a code-free ingestion path for the
 * long tail (the dev's "generic adapter" multiplier).
 *
 * Many small career sites (and TalentSoft/Cegid, WordPress job plugins…) publish
 * a standard RSS 2.0 or Atom feed of their openings. Parsing it needs no ATS
 * adapter: `<item>`/`<entry>` -> title, link, description, date. This covers a
 * large share of the ~12k brands that use no recognised ATS, without writing
 * per-vendor code.
 *
 * A feed carries less than a full JobPosting page (often no structured location
 * or salary), so a `<category>`/`<location>` hint is used when present; the rest
 * stays undefined, which the site renders as "not published" rather than wrong.
 */

/** Reads the text content of the first matching tag inside a block. */
function tag(block: string, name: string): string | undefined {
  // Handles <name>…</name> and <ns:name>…</ns:name>, CDATA included.
  const re = new RegExp(`<(?:[a-z0-9]+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${name}>`, 'i');
  const m = block.match(re);
  if (!m) return undefined;
  return decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() || undefined;
}

/** An Atom <link href="…"> (Atom puts the URL in an attribute, not the body). */
function atomLink(block: string): string | undefined {
  const m = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return m ? decode(m[1]) : undefined;
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Parse an RSS 2.0 or Atom feed into normalized jobs. Pure — no I/O. */
export function parseFeed(xml: string): NormalizedJob[] {
  // RSS uses <item>, Atom uses <entry>.
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];
  const jobs: NormalizedJob[] = [];
  for (const block of blocks) {
    const title = tag(block, 'title');
    const link = tag(block, 'link') ?? atomLink(block);
    if (!title || !link) continue; // an offer a candidate cannot open is useless

    const descriptionHtml = tag(block, 'description') ?? tag(block, 'summary') ?? tag(block, 'content');
    const location = tag(block, 'location') ?? tag(block, 'city') ?? tag(block, 'region');
    const postedAt = parseDate(tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated'));
    const externalId = tag(block, 'guid') ?? tag(block, 'id') ?? link;

    jobs.push({
      externalId,
      title,
      url: link,
      location,
      description: descriptionHtml ? htmlToPlainText(descriptionHtml) : undefined,
      postedAt,
      raw: { feedItem: block.slice(0, 2000) },
    });
  }
  return jobs;
}

/** Fetch and parse an RSS/Atom careers feed. */
export async function fetchRssJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const feedUrl = String(config.feedUrl ?? config.origin ?? '');
  if (!feedUrl) throw new Error('RSS feedUrl missing');
  const xml = await fetchText(feedUrl);
  return parseFeed(xml);
}

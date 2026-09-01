import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Teamtailor career sites.
 *
 * The widest vendor in the catalogue — 13 sources including Galeries Lafayette,
 * Etam, Undiz, Orchestra and Normal.
 *
 * Its pages are client-rendered, so a JSON-LD parser finds nothing on the
 * listing, but every Teamtailor site publishes a JSON Feed at /jobs.json whose
 * items embed a full schema.org JobPosting under `_jobposting` — description,
 * location, country and salary in one request per page. No detail fetch needed.
 *
 * Verified 2026-09-01 on carrieres.groupegalerieslafayette.com: 100 items per
 * page with 3.1k-character descriptions, and a `next_url` for the rest.
 */

const PAGE_SIZE = 100;
/** Guard against a feed that keeps handing back a next_url. */
const MAX_PAGES = Number(process.env.TEAMTAILOR_MAX_PAGES ?? 40);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

type JobPostingNode = {
  title?: string;
  description?: string;
  identifier?: { value?: string } | string;
  datePosted?: string;
  employmentType?: string;
  jobLocation?: Array<{
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      postalCode?: string;
      addressCountry?: string;
    };
  }>;
};

type FeedItem = {
  id?: string;
  title?: string;
  url?: string;
  date_published?: string;
  content_html?: string;
  _jobposting?: JobPostingNode;
};

type Feed = { items?: FeedItem[]; next_url?: string };

function stripHtml(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|#39);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

function toNormalized(item: FeedItem): NormalizedJob | null {
  const posting = item._jobposting;
  const title = item.title ?? posting?.title;
  if (!title) return null;

  const address = posting?.jobLocation?.[0]?.address;
  const posted = item.date_published ?? posting?.datePosted;
  const postedAt = posted ? new Date(posted) : undefined;

  return {
    externalId: String(item.id ?? item.url ?? title),
    title,
    location:
      [address?.addressLocality, address?.addressRegion, address?.postalCode]
        .filter(Boolean)
        .join(', ') || undefined,
    country: address?.addressCountry,
    contract: posting?.employmentType,
    // The feed carries the whole posting; content_html is the same text.
    description: stripHtml(posting?.description ?? item.content_html),
    url: item.url ?? '',
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: item,
  };
}

/**
 * Reads a whole Teamtailor board.
 * `config.origin` is the careers host, e.g. "https://jobs.normal.fr".
 */
export async function fetchTeamtailorJobs(
  config: Record<string, unknown>,
): Promise<NormalizedJob[]> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Teamtailor origin missing');

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let url: string | undefined = `${origin}/jobs.json?per_page=${PAGE_SIZE}`;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const feed: Feed = await fetchJson<Feed>(url, { headers: HEADERS });
    const items = feed.items ?? [];
    let fresh = 0;

    for (const item of items) {
      const job = toNormalized(item);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    // Follow the feed's own cursor; stop when it stops advancing.
    url = fresh > 0 ? feed.next_url : undefined;
  }

  return jobs;
}

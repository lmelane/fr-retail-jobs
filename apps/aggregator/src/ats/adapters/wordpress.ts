import { fetchWithRetry } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';
import { publisherInstant } from '../../lib/publisherInstant.js';

/**
 * WordPress REST — recruitment sites that publish offers as ordinary posts.
 *
 * Luxe Talent (fashion/luxury recruitment agency) files every vacancy under a
 * "job-offers" category, and the STANDARD WordPress API serves them: no custom
 * plugin, no scraping, robots.txt disallowing only /wp-admin/. Verified
 * 2026-09-02: /wp-json/wp/v2/posts?categories=14 answers with
 * x-wp-total: 478.
 *
 * One vendor quirk: the payload starts with a UTF-8 BOM, which JSON.parse
 * rejects. Strip it before parsing — a lesson that cost a debugging round.
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 40;

const USER_AGENT =
  CRAWLER_IDENTITY;

type WpPost = {
  id?: number;
  link?: string;
  date?: string;
  date_gmt?: string | null;
  title?: { rendered?: string };
  content?: { rendered?: string };
};


/**
 * Reads a category of posts as job offers.
 * `config.origin` e.g. "https://www.luxetalent.net"; `config.categoryId` the
 * category holding the vacancies.
 */
export async function fetchWordpressJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  const categoryId = Number(config.categoryId ?? 0);
  if (!origin || !categoryId) throw new Error('WordPress origin and categoryId required');

  const jobs: NormalizedJob[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchWithRetry(
      `${origin}/wp-json/wp/v2/posts?categories=${categoryId}&per_page=${PAGE_SIZE}&page=${page}`,
      { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } },
    );

    // The BOM: WordPress can prepend U+FEFF, and JSON.parse throws on it.
    const text = (await response.text()).replace(/^﻿/, '');
    const posts = JSON.parse(text) as WpPost[];
    if (!Array.isArray(posts) || posts.length === 0) break;

    for (const post of posts) {
      const job = parseWordpressPost(post);
      if (job) jobs.push(job);
    }

    const totalPages = Number(response.headers.get('x-wp-totalpages'));
    if (Number.isFinite(totalPages) && page >= totalPages) break;
  }

  return jobs;
}

export function parseWordpressPost(post: WpPost): NormalizedJob | null {
  const title = htmlToPlainText(post.title?.rendered);
  if (!title || !post.link) return null;
  // WordPress documents date as site-local and date_gmt as GMT, even though
  // the latter omits a timezone suffix. The worker's timezone is irrelevant.
  const gmt = post.date_gmt;
  const postedAt = publisherInstant(typeof gmt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(gmt) ? `${gmt}Z` : gmt);

  return {
    externalId: String(post.id ?? post.link),
    title,
    description: htmlToPlainText(post.content?.rendered),
    url: post.link,
    postedAt,
    raw: post,
  };
}

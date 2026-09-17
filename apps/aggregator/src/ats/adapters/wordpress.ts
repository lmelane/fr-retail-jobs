import { createHash } from 'node:crypto';
import { fetchWithRetry } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
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
 * L'identifiant CANONIQUE d'un billet : `post.id`, la clé primaire que l'API WordPress sert dans sa réponse et
 * le chemin d'identité de `NormalizedJob.externalId`.
 *
 * Le repli de `parseWordpressPost` — `post.link` — est une URL, jamais un identifiant canonique : un billet
 * sans `id` est donc ANONYME. Il a été vu sans pouvoir être nommé, et interdit toute attestation d'absence.
 */
export function wordpressCanonicalId(post: WpPost): string | null {
  return Number.isSafeInteger(post?.id) && (post.id as number) > 0 ? String(post.id) : null;
}

/**
 * Reads a category of posts as job offers.
 * `config.origin` e.g. "https://www.luxetalent.net"; `config.categoryId` the
 * category holding the vacancies.
 */
export async function fetchWordpressJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  const categoryId = Number(config.categoryId ?? 0);
  if (!origin || !categoryId) throw new Error('WordPress origin and categoryId required');

  const jobs: NormalizedJob[] = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const endpoint = `${origin}/wp-json/wp/v2/posts?categories=${categoryId}`;
  let anonymousRows = 0;
  let declaredTotal: number | undefined;
  let pages = 0, rawCount = 0, termination = 'PAGE_BUDGET_EXHAUSTED';

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${origin}/wp-json/wp/v2/posts?categories=${categoryId}&per_page=${PAGE_SIZE}&page=${page}`;
    const response = await fetchWithRetry(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });

    // The BOM: WordPress can prepend U+FEFF, and JSON.parse throws on it.
    const text = (await response.text()).replace(/^﻿/, '');
    const posts = JSON.parse(text) as WpPost[];
    if (!Array.isArray(posts) || posts.length === 0) { termination = 'EMPTY_PAGE'; break; }
    pages++; rawCount += posts.length;

    const pageIds: string[] = [];
    for (const post of posts) {
      /**
       * L'IDENTIFIANT ENTRE DANS LA PREUVE AVANT LA VALIDATION DU TITRE : un billet doté d'un `id` a été
       * OBSERVÉ, titre ou pas. L'écarter d'abord le sortirait de `canonicalIds`, et une JobSource historique
       * portant ce même identifiant paraîtrait ABSENTE au refresh suivant.
       */
      const canonicalId = wordpressCanonicalId(post);
      if (canonicalId) { if (!pageIds.includes(canonicalId)) pageIds.push(canonicalId); }
      else anonymousRows++;
      const job = parseWordpressPost(post);
      if (!job) { rejectedRows.push({ reason: 'MISSING_TITLE_OR_LINK', raw: post, ...(canonicalId ? { canonicalId } : {}) }); continue; }
      /**
       * UN BILLET SANS `id` NE DEVIENT PAS UNE OFFRE : `parseWordpressPost` se rabattrait sur `post.link`,
       * publiant une offre dont l'identifiant vient d'une URL et ne figure dans aucun `canonicalIds`.
       */
      if (!canonicalId) { rejectedRows.push({ reason: 'POST_WITHOUT_NATIVE_ID', raw: post }); continue; }
      jobs.push(job);
    }

    const total = Number(response.headers.get('x-wp-total'));
    if (Number.isFinite(total) && total >= 0) declaredTotal = total;
    const totalPages = Number(response.headers.get('x-wp-totalpages'));
    pageEvidence.push({ url, checkedAt: new Date().toISOString(),
      sha256: createHash('sha256').update(text).digest('hex'),
      offset: (page - 1) * PAGE_SIZE,
      pagination: declaredTotal === undefined ? null
        : { start: (page - 1) * PAGE_SIZE, end: (page - 1) * PAGE_SIZE + posts.length, total: declaredTotal },
      ids: pageIds, canonicalIds: pageIds,
      publisherCounter: Number.isFinite(total) ? String(total) : '',
      componentCounters: [`page=${page}`, `totalPages=${Number.isFinite(totalPages) ? totalPages : ''}`, `rows=${posts.length}`] });

    if (Number.isFinite(totalPages) && page >= totalPages) { termination = 'DECLARED_PAGE_COUNT_REACHED'; break; }
  }

  return { jobs, declaredTotal, rejectedRows,
    /**
     * LE CONTRAT DES IDENTIFIANTS CANONIQUES. L'API sert `id` sur chaque billet et borne son parcours par
     * l'en-tête `x-wp-totalpages` : chaque page porte donc sa propre preuve, et aucune n'est muette.
     */
    enumeration: { method: 'WP_REST_CATEGORY_PAGINATION', endpoint, pages, rawCount, termination,
      documentation: 'https://developer.wordpress.org/rest-api/reference/posts/',
      // Un billet sans `id` a été vu sans pouvoir être nommé.
      canonicalAbsenceProofUsable: anonymousRows === 0,
      pageEvidence } };
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

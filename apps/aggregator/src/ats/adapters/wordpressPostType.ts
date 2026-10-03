import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { fetchText, fetchWithRetry } from '../../lib/http.js';
import { isKnownPosting } from '../../lib/incrementalReading.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';
import { captureObservedAt } from '../../capture/context.js';
import { extractJobPostings, normalizeJobPosting } from '../../connectors/generic/jsonLdSitemap.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { parseWordpressPost, wordpressCanonicalId } from './wordpress.js';

/**
 * UN TYPE DE BILLET WORDPRESS PUBLIC QUI PORTE LES OFFRES, lu par l'API REST du site (D-522 §6, 03/10/2026).
 *
 * Kastner & Öhler : la source partait d'UNE fiche d'offre et en suivait les liens (12 offres, aucune fin démontrable), et
 * le JSON-LD des fiches ne porte qu'une accroche d'une ligne en description (0 % de descriptions au RUN du 02/10). Le site
 * déclare ses types de billets (`/wp-json/wp/v2/types`) ; les offres sont `jobangebot`, servies par
 * `/wp-json/wp/v2/jobangebot` avec le texte entier de chacune et le total de l'éditeur (`x-wp-total: 12`,
 * `x-wp-totalpages: 1`, relus le 03/10). Le robots.txt n'interdit pas `/wp-json/`.
 *
 * La liste et le texte viennent de l'API ; le lieu, le contrat et l'employeur, du JSON-LD JobPosting de la fiche (lien du
 * billet), comme avant : la seule chose qui change pour une offre est son texte, et son identité devient l'`id` natif du
 * billet. Une fiche illisible garde l'offre et son texte, sans lieu ; elle ne touche pas à la preuve de la liste, qui ne
 * repose que sur l'API. La liste est prouvée quand toutes les pages annoncées sont lues et que les identifiants distincts
 * atteignent exactement le total annoncé.
 */
export const WORDPRESS_POST_TYPE_READER = 'wordpress-post-type';
const RAW_SOURCE = 'wordpress-post-type-v1';
const PAGE_SIZE = 100;
const MAX_PAGES = 40;
const HEADERS = { 'user-agent': CRAWLER_IDENTITY, accept: 'application/json' };

/** Les réglages du lecteur, validés : un site en https et le nom d'un type de billet, jamais un chemin. */
export function wordpressPostTypeSettings(config: Record<string, unknown>): { origin: string; postType: string } {
  const start = new URL(String(config.startUrl ?? ''));
  if (start.protocol !== 'https:' || start.username || start.password) throw new Error('wordpress-post-type: startUrl https attendu');
  const postType = String(config.postType ?? '');
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(postType)) throw new Error('wordpress-post-type: postType invalide');
  return { origin: start.origin, postType };
}

type WpPost = Parameters<typeof parseWordpressPost>[0];
type RetainedRaw = { source: typeof RAW_SOURCE; post: WpPost; detail: Record<string, unknown> | null };

/** Le JobPosting de la fiche qui est CETTE offre : son `url` est le lien du billet, ou la page n'en porte qu'un sans `url`. */
function postingOf(html: string, link: string): Record<string, unknown> | null {
  const nodes = extractJobPostings(html);
  return nodes.find((node) => node.url === link) ?? (nodes.length === 1 && nodes[0]!.url === undefined ? nodes[0]! : null);
}

/**
 * L'offre reconstruite de son RAW : la même fonction pour la collecte et le rejeu des publications conservées
 * (`publication/recovery.ts`). `null` pour un RAW qui n'est pas de ce lecteur, ou un billet sans identifiant natif.
 */
export function readWordpressPostTypeRaw(raw: unknown): NormalizedJob | null {
  const retained = raw as Partial<RetainedRaw> | null;
  if (!retained || retained.source !== RAW_SOURCE || !retained.post || typeof retained.post !== 'object') return null;
  const job = parseWordpressPost(retained.post);
  if (!job || !wordpressCanonicalId(retained.post)) return null;
  const detail = retained.detail && typeof retained.detail === 'object' ? normalizeJobPosting(retained.detail, job.url!) : null;
  const fromDetail = detail ? {
    ...(detail.company ? { company: detail.company, employerEvidence: detail.employerEvidence } : {}),
    ...(detail.publicationHold && !job.publicationHold ? { publicationHold: detail.publicationHold } : {}),
    location: detail.location, city: detail.city, region: detail.region, postalCode: detail.postalCode, country: detail.country,
    contract: detail.contract, validThrough: detail.validThrough,
  } : {};
  return { ...job, ...fromDetail, raw: retained };
}

export async function fetchWordpressPostTypeJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const { origin, postType } = wordpressPostTypeSettings(config);
  const endpoint = `${origin}/wp-json/wp/v2/${postType}`;
  const posts: WpPost[] = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const observed = new Set<string>();
  let anonymousRows = 0, declaredTotal: number | undefined, totalChanged = false;
  let pages = 0, rawCount = 0, termination = 'PAGE_BUDGET_EXHAUSTED';

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${endpoint}?per_page=${PAGE_SIZE}&page=${page}`;
    const response = await fetchWithRetry(url, { headers: HEADERS });
    const text = (await response.text()).replace(/^﻿/, '');
    const rows = JSON.parse(text) as WpPost[];
    if (!Array.isArray(rows)) throw new Error(`wordpress-post-type ${endpoint}: réponse sans liste de billets`);
    pages++; rawCount += rows.length;
    const total = Number(response.headers.get('x-wp-total') ?? NaN);
    const totalPages = Number(response.headers.get('x-wp-totalpages') ?? NaN);
    if (Number.isSafeInteger(total) && total >= 0) {
      if (declaredTotal === undefined) declaredTotal = total;
      else if (declaredTotal !== total) totalChanged = true;
    }
    const pageIds: string[] = [];
    for (const post of rows) {
      // L'identifiant entre dans la preuve avant la validation du titre (`wordpress.ts`).
      const canonicalId = wordpressCanonicalId(post);
      if (!canonicalId) { anonymousRows++; rejectedRows.push({ reason: 'POST_WITHOUT_NATIVE_ID', raw: post }); continue; }
      if (observed.has(canonicalId)) continue;
      observed.add(canonicalId); pageIds.push(canonicalId);
      if (!parseWordpressPost(post)) { rejectedRows.push({ reason: 'MISSING_TITLE_OR_LINK', raw: post, canonicalId }); continue; }
      posts.push(post);
    }
    pageEvidence.push({ url, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(text).digest('hex'),
      offset: (page - 1) * PAGE_SIZE,
      pagination: declaredTotal === undefined ? null : { start: (page - 1) * PAGE_SIZE, end: (page - 1) * PAGE_SIZE + rows.length, total: declaredTotal },
      ids: pageIds, canonicalIds: pageIds, publisherCounter: Number.isSafeInteger(total) ? `x-wp-total=${total}` : '',
      componentCounters: [`page=${page}`, `totalPages=${Number.isSafeInteger(totalPages) ? totalPages : ''}`, `rows=${rows.length}`] });
    if (rows.length === 0) { termination = 'EMPTY_PAGE'; break; }
    if (Number.isSafeInteger(totalPages) && page >= totalPages) { termination = 'DECLARED_PAGE_COUNT_REACHED'; break; }
  }

  // La fiche de chaque offre neuve (D-517 : une offre connue n'est pas relue) : le lieu, le contrat, l'employeur.
  const limit = pLimit(Number(config.concurrency ?? 4));
  let detailsRead = 0;
  const toRead = posts.filter((post) => !isKnownPosting(String(post.id)));
  const jobs = await Promise.all(posts.map((post) => limit(async () => {
    let detail: Record<string, unknown> | null = null;
    if (toRead.includes(post)) {
      try { detail = postingOf(await fetchText(String(post.link), { headers: { 'user-agent': CRAWLER_IDENTITY } }), String(post.link)); }
      catch { detail = null; }
      if (detail) detailsRead++;
    }
    return readWordpressPostTypeRaw({ source: RAW_SOURCE, post, detail } satisfies RetainedRaw)!;
  })));

  const complete = termination === 'DECLARED_PAGE_COUNT_REACHED' && declaredTotal !== undefined && !totalChanged &&
    anonymousRows === 0 && observed.size === declaredTotal;
  const issues = [...(totalChanged ? ['SOURCE_TOTAL_CHANGED'] : []), ...(complete ? [] : ['ENUMERATION_NOT_PROVEN'])];
  return { jobs, declaredTotal, complete, truncated: !complete, ...(rejectedRows.length ? { rejectedRows } : {}),
    enumeration: { method: 'WP_REST_POST_TYPE_PAGINATION', endpoint, pages, rawCount, termination, issues,
      documentation: 'https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/',
      canonicalAbsenceProofUsable: anonymousRows === 0,
      scopes: [{ scope: postType, declaredTotal: declaredTotal ?? -1, uniqueIds: observed.size, pages, complete },
        { scope: 'detailJsonLd', declaredTotal: toRead.length, uniqueIds: detailsRead, pages, complete: detailsRead === toRead.length }],
      pageEvidence } };
}

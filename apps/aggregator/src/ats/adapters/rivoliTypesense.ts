import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { DEFAULT_DETAIL_CONCURRENCY, fetchJson, fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Rivoli Group (Dubaï, horlogerie/luxe) — la page Vacancies est vide côté
 * serveur ; Vue interroge un Typesense auto-hébergé avec une clé de RECHERCHE
 * publique, lue en clair dans le HTML (`var TYPESENSE_API_KEY = …`).
 *
 * Deux particularités mesurées le 2026-09-06 :
 * - l'index porte 52 documents pour 47 offres : la version arabe (`/ar/…`,
 *   43 docs) et la version anglaise (9 docs) d'une même offre sont deux
 *   documents ; on fusionne par slug en préférant l'anglais ;
 * - 38 offres n'ont PAS de document anglais alors que leur page anglaise
 *   existe (200) : on y lit titre + description. Six pages n'existent qu'en
 *   arabe (404 en anglais) et restent en arabe.
 */

const PER_PAGE = 250;
const MAX_PAGES = 20;
const PREFERRED_LOCALE = 'en_AE';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type VacancyDoc = {
  id: string;
  title: string;
  url: string;
  page_locale: string;
  job_location?: string[];
  department?: string;
  public_date_time_stamp?: number | string;
  page_index_content?: string;
};

type SearchResult = { found: number; hits: Array<{ document: VacancyDoc }> };

/** Le segment après /vacancies/, casse conservée (l'URL anglaise y est sensible). */
export function vacancySlug(url: string): string {
  return url.split('/vacancies/')[1]?.replace(/\/$/, '') ?? url;
}

/** Un document par offre : l'anglais quand il existe, sinon l'autre langue. Pure. */
export function mergeVacancyLocales(docs: VacancyDoc[], preferred = PREFERRED_LOCALE): VacancyDoc[] {
  const bySlug = new Map<string, VacancyDoc>();
  for (const doc of docs) {
    const key = vacancySlug(doc.url).toLowerCase();
    const current = bySlug.get(key);
    if (!current || (current.page_locale !== preferred && doc.page_locale === preferred)) bySlug.set(key, doc);
  }
  return [...bySlug.values()];
}

/** La page anglaise d'une offre -> titre + description. Pure. */
export function parseVacancyPage(html: string): { title?: string; description?: string } {
  const $ = cheerio.load(html);
  const title = $('main h1').first().text().trim();
  const body = $('.vacancies--detail .default-text-block').first().html();
  return { title: title || undefined, description: htmlToPlainText(body ?? '') || undefined };
}

export function docToJob(doc: VacancyDoc, override: { title?: string; description?: string; url?: string } = {}): NormalizedJob {
  const stamp = Number(doc.public_date_time_stamp);
  const postedAt = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp * 1000) : undefined;
  return {
    externalId: vacancySlug(doc.url).toLowerCase(),
    title: override.title ?? doc.title,
    location: (doc.job_location ?? []).join(', ') || undefined,
    department: doc.department || undefined,
    description: override.description ?? htmlToPlainText(doc.page_index_content ?? '') ?? undefined,
    url: override.url ?? doc.url,
    postedAt,
    raw: doc,
  };
}

/**
 * `config.typesenseOrigin` ex. "https://typesense.rivoligroup.com" ;
 * `config.apiKey` la clé de recherche publique de la page ;
 * `config.collection` (défaut "vacancy") ; `config.origin` le site public.
 */
export async function fetchRivoliTypesenseJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const typesenseOrigin = String(config.typesenseOrigin ?? '').replace(/\/$/, '');
  const apiKey = String(config.apiKey ?? '');
  const collection = String(config.collection ?? 'vacancy');
  const origin = String(config.origin ?? 'https://www.rivoligroup.com').replace(/\/$/, '');
  if (!typesenseOrigin || !apiKey) throw new Error('Rivoli Typesense typesenseOrigin and apiKey required');

  const docs: VacancyDoc[] = [];
  let found = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await fetchJson<SearchResult>(
      `${typesenseOrigin}/collections/${collection}/documents/search?q=*&query_by=title&per_page=${PER_PAGE}&page=${page}`,
      { headers: { 'x-typesense-api-key': apiKey } },
    );
    found = result.found;
    docs.push(...result.hits.map((hit) => hit.document));
    if (result.hits.length === 0 || docs.length >= found) break;
  }

  const merged = mergeVacancyLocales(docs);
  const limit = pLimit(Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY));
  const jobs = await Promise.all(
    merged.map((doc) =>
      limit(async () => {
        if (doc.page_locale === PREFERRED_LOCALE) return docToJob(doc);
        const englishUrl = `${origin}/careers/vacancies/${vacancySlug(doc.url)}`;
        try {
          const page = parseVacancyPage(await fetchText(englishUrl, { headers: { 'user-agent': USER_AGENT } }));
          return docToJob(doc, { ...page, url: englishUrl });
        } catch {
          // Pas de page anglaise (404 mesuré sur 6 offres) : l'offre reste dans sa langue.
          return docToJob(doc);
        }
      }),
    ),
  );

  return { jobs, declaredTotal: merged.length, truncated: docs.length < found };
}

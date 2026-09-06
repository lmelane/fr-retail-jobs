import { fetchJson, fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * ASOS — `careers.asos.com` (redirige vers www.asoscareers.com), un index
 * Algolia interrogé côté client. Même famille que `lvmhAlgolia.ts` : appId +
 * clé de recherche publique, statiques dans le HTML de la page d'accueil
 * (`const AG_ID = "…"; const AG_KEY = "…"; const AG_INDEX = {"default":"…"}`).
 *
 * Mesuré le 2026-09-06 : nbHits 64, exhaustiveNbHits true, une seule page à
 * hitsPerPage 100. Chaque hit porte le texte complet (description +
 * qualifications, en HTML), la ville, la date, une URL de page ASOS et une
 * URL de candidature SmartRecruiters.
 *
 * Pièges mesurés :
 *  - `location` vaut « Nationwide » sur les 64 hits : c'est une étiquette de
 *    site, pas un lieu. La ville est dans `town_city` (London, Barnsley,
 *    Watford). Le pays n'est pas dans le flux : il reste undefined.
 *  - `opening_date_timestamp` (secondes) manque sur la moitié des hits ;
 *    `opening_date` (jj/mm/aaaa) est présent sur tous et sert de repli.
 *  - `jd_url` est RELATIF (`/job-search/…`) : à résoudre sur le site public.
 */

const DEFAULT_APP_ID = 'RVMOB42DFH';
const DEFAULT_INDEX = 'production__asoscare2201__sort-rank';
/** Clé de recherche publique lue dans la page le 2026-09-06 ; relue si refusée. */
const DEFAULT_KEY = '2b53aa632c86586c5c2ad89bc0791a7b';
const DEFAULT_SITE = 'https://www.asoscareers.com';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

type AsosHit = {
  objectID?: string | number;
  ats_requisition_id?: string;
  title?: string;
  town_city?: string;
  location?: string;
  jd_url?: string;
  apply_url?: string;
  opening_date?: string;
  opening_date_timestamp?: number;
  contract_type?: string;
  department?: string;
  team?: string;
  category?: string;
  work_level?: string;
  description?: string;
  qualifications?: string;
};

type AlgoliaResponse = {
  hits?: AsosHit[];
  nbHits?: number;
  nbPages?: number;
  page?: number;
  message?: string;
  status?: number;
};

/** « 04/09/2026 » → Date UTC ; undefined si la forme n'est pas jj/mm/aaaa. */
function parseDayMonthYear(value: string | undefined): Date | undefined {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

/** Un hit Algolia → NormalizedJob. Exporté pour être testé sans réseau. */
export function parseAsosHit(hit: AsosHit, site = DEFAULT_SITE): NormalizedJob | null {
  if (!hit.title || hit.objectID === undefined) return null;

  const description = [hit.description, hit.qualifications]
    .map((part) => htmlToPlainText(part))
    .filter(Boolean)
    .join('\n\n');

  const url = hit.jd_url ? new URL(hit.jd_url, site).toString() : hit.apply_url;
  if (!url) return null;

  return {
    externalId: String(hit.objectID),
    title: hit.title.trim(),
    location: hit.town_city,
    city: hit.town_city,
    contract: hit.contract_type,
    department: hit.department,
    description: description || undefined,
    url,
    postedAt: hit.opening_date_timestamp
      ? new Date(hit.opening_date_timestamp * 1000)
      : parseDayMonthYear(hit.opening_date),
    raw: hit,
  };
}

/** Relit `AG_KEY` dans la page d'accueil quand la clé épinglée est refusée. */
async function extractKeyFromSite(site: string): Promise<string | undefined> {
  const html = await fetchText(site);
  return html.match(/AG_KEY\s*=\s*"([0-9a-f]{32})"/)?.[1];
}

export async function fetchAsosJobs(config: Record<string, unknown> = {}): Promise<AdapterResult> {
  const appId = String(config.appId ?? DEFAULT_APP_ID);
  const index = String(config.indexName ?? DEFAULT_INDEX);
  const site = String(config.siteOrigin ?? DEFAULT_SITE).replace(/\/$/, '');
  let key = String(config.apiKey ?? DEFAULT_KEY);

  const query = (page: number) =>
    fetchJson<AlgoliaResponse>(`https://${appId}-dsn.algolia.net/1/indexes/${index}/query`, {
      method: 'POST',
      headers: {
        'x-algolia-application-id': appId,
        'x-algolia-api-key': key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: '', hitsPerPage: PAGE_SIZE, page }),
    });

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let response = await query(page);

    // Clé tournée : on la relit une fois dans la page, puis on échoue FORT —
    // un résultat vide se lirait « ASOS ne recrute pas », ce qui est faux.
    if (response.status === 403 && page === 0) {
      const fresh = await extractKeyFromSite(site);
      if (!fresh) throw new Error('ASOS Algolia key rejected and no AG_KEY found on the site');
      key = fresh;
      response = await query(page);
    }
    if (response.status === 403 || response.message) {
      throw new Error(`ASOS Algolia refused the query: ${response.message ?? 'status 403'}`);
    }

    const hits = response.hits ?? [];
    for (const hit of hits) {
      const job = parseAsosHit(hit, site);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
    }

    if (response.nbHits !== undefined) declaredTotal = response.nbHits;
    // Arrêt Algolia : la page lue était la dernière annoncée, ou incomplète.
    if (response.nbPages !== undefined && page + 1 >= response.nbPages) break;
    if (hits.length < PAGE_SIZE) break;
  }

  return { jobs, declaredTotal, truncated: declaredTotal !== undefined && jobs.length < declaredTotal };
}

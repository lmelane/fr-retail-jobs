import { fetchWithRetry, fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { employmentTermsFrom } from '../../normalize/employment.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Jibe (iCIMS Attract) — portails « habillés » devant iCIMS, ex. careers.ulta.com.
 *
 * Mesuré le 2026-09-06 sur Ulta :
 *
 * 1. Les sous-portails iCIMS (`fdcnmcareers-ulta.icims.com`…) ne sont PLUS des
 *    listings publics : `/jobs/search?in_iframe=1` répond 150 octets de
 *    `window.top.location.href = 'https://careers.ulta.com/careers/jobs'`.
 *    L'adaptateur iCIMS y lit 0 offre. Le listing public est le portail Jibe.
 *
 * 2. Jibe expose `GET /api/jobs?page=N&limit=100` (JSON, 9 959 offres
 *    annoncées par `totalCount`), MAIS répond `jobs: []` sans le cookie de
 *    session (`jasession`/`jrasession`) que la page de recherche pose. D'où
 *    un premier GET sur la page, puis le cookie rejoué sur chaque appel.
 *    `limit=100` passe ; `limit=500` rend HTTP 422.
 *
 * Chaque entrée porte la description complète (HTML), ville/état/pays,
 * coordonnées, date de publication et l'URL publique : une requête par page
 * de 100 suffit, sans visiter les 9 959 pages détail (550 Ko chacune).
 */

const PAGE_SIZE = 100;
/** 200 pages × 100 = 20 000 offres : au-delà du plus gros portail connu (Ulta ~10 000). */
const MAX_PAGES = 200;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type JibeJob = {
  slug?: string;
  req_id?: string;
  language?: string;
  title?: string;
  description?: string;
  qualifications?: string;
  responsibilities?: string;
  full_location?: string;
  location_name?: string;
  city?: string;
  state?: string;
  country?: string;
  country_code?: string;
  postal_code?: string;
  latitude?: number | string;
  longitude?: number | string;
  department?: string;
  category?: string | string[];
  hiring_organization?: string;
  posted_date?: string;
  posting_expiry_date?: string;
  apply_url?: string;
  meta_data?: { canonical_url?: string };
  /** Tenant-configured tags: Ulta puts « Part Time » in tags1 and « Regular » in tags2 (9 959 offers without a contract, audit a1 I10). */
  tags1?: string[];
  tags2?: string[];
  tags3?: string[];
  tags4?: string[];
  tags5?: string[];
  tags6?: string[];
  tags7?: string[];
  tags8?: string[];
  tags9?: string[];
};

/** Every `tagsN` value of a Phenom-family entry, whatever the tenant filed there. */
function tagValues(data: Record<string, unknown>): unknown[] {
  return Object.entries(data)
    .filter(([key]) => /^tags\d+$/.test(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
}

export type JibePage = { jobs?: Array<{ data?: JibeJob }>; totalCount?: number };

function asDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Les offres d'une page `/api/jobs`. Exporté pour être testé sans réseau. */
export function parseJibePage(page: JibePage, origin: string): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  for (const entry of page.jobs ?? []) {
    const job = entry?.data;
    if (!job) continue;
    const externalId = String(job.req_id ?? job.slug ?? '').trim();
    const title = String(job.title ?? '').trim();
    // Sans identifiant ni titre, l'offre n'est ni stable ni lisible.
    if (!externalId || !title) continue;

    /**
     * L'URL publique est celle du portail Jibe (`/careers/jobs/{slug}`), pas
     * `apply_url` : celle-ci pointe sur `…icims.com/jobs/{id}/login`, une page
     * de connexion iCIMS, pas l'offre.
     */
    const slug = job.slug ?? externalId;
    const lang = job.language ? `?lang=${encodeURIComponent(job.language)}` : '';
    const url = job.meta_data?.canonical_url || `${origin}/careers/jobs/${encodeURIComponent(slug)}${lang}`;

    const department = job.department || (Array.isArray(job.category) ? job.category[0] : job.category) || undefined;
    // Only the tags that NAME a contract or a working time; a date or a banner stays out.
    const terms = employmentTermsFrom(tagValues(job as Record<string, unknown>));

    jobs.push({
      externalId,
      title,
      location: job.full_location || job.location_name || undefined,
      city: job.city || undefined,
      region: job.state || undefined,
      postalCode: job.postal_code || undefined,
      country: job.country_code || job.country || undefined,
      latitude: asNumber(job.latitude),
      longitude: asNumber(job.longitude),
      description: htmlToPlainText(job.description) || undefined,
      department: department || undefined,
      company: job.hiring_organization || undefined,
      contract: terms,
      workingTime: terms,
      url,
      postedAt: asDate(job.posted_date),
      validThrough: asDate(job.posting_expiry_date),
      raw: job,
    });
  }
  return jobs;
}

/** Le cookie de session posé par la page de recherche, rejoué sur l'API. */
async function openSession(origin: string, searchPath: string): Promise<string> {
  const response = await fetchWithRetry(`${origin}${searchPath}`, { headers: { 'user-agent': BROWSER_UA } });
  // Le corps ne sert à rien ; le lire vide la connexion proprement.
  await response.text();
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

export async function fetchJibeJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Jibe origin missing');
  const searchPath = String(config.searchPath ?? '/careers/jobs');
  const pageSize = Number(config.pageSize ?? PAGE_SIZE);

  const cookie = await openSession(origin, searchPath);
  const headers: Record<string, string> = {
    'user-agent': BROWSER_UA,
    accept: 'application/json, text/plain, */*',
    referer: `${origin}${searchPath}`,
    ...(cookie ? { cookie } : {}),
  };

  const out: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${origin}/api/jobs?page=${page}&limit=${pageSize}&sortBy=relevance&descending=false&internal=false`;
    const data = await fetchJson<JibePage>(url, { headers });
    if (typeof data.totalCount === 'number') declaredTotal = data.totalCount;

    const batch = parseJibePage(data, origin);
    const fresh = batch.filter((job) => !seen.has(job.externalId));
    for (const job of fresh) {
      seen.add(job.externalId);
      out.push(job);
    }
    // Une page sans offre NOUVELLE termine la lecture (page vide en fin de
    // liste, ou un pager qui rejoue la dernière page).
    if (fresh.length === 0) break;
    if (declaredTotal !== undefined && out.length >= declaredTotal) break;
  }

  // F-06 : une première page vide sur un portail qui annonce des offres est
  // le cookie de session qui n'a pas pris, pas un employeur sans poste.
  if (out.length === 0 && (declaredTotal ?? 0) > 0) {
    throw new Error(`jibe ${origin}: totalCount=${declaredTotal} but 0 job returned — session cookie missing?`);
  }

  return {
    jobs: out,
    declaredTotal,
    truncated: declaredTotal !== undefined && out.length < declaredTotal,
  };
}

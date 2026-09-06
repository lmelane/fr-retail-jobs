import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Volcanic — sites carrière hébergés (`careers.<marque>`, empreinte
 * `Volcanic.prod-eu-2` dans la télémétrie), ex. careers.fenwick.co.uk.
 *
 * Mesuré le 2026-09-06 sur Fenwick : les pages détail ne portent AUCUN JSON-LD
 * (0 bloc sur 708 Ko), donc le générique y lit 0 offre. Mais la plateforme
 * expose `GET /api/v1/jobs.json?page=N` — JSON public, sans clé — avec
 * `total_count`, `page_count`, `current_page` et, par offre : id, titre, lieu,
 * type de contrat, description HTML complète, slug de la page publique.
 * 20 offres par page, pagination 1-indexée, arrêt à `page_count`.
 */

/** 500 pages × 20 = 10 000 offres, bien au-delà d'un site carrière Volcanic. */
const MAX_PAGES = 500;

export type VolcanicJob = {
  id?: number | string;
  job_reference?: string;
  job_title?: string;
  title?: string;
  job_type?: string;
  disciplines?: Array<{ name?: string }>;
  description?: string;
  clean_description?: string;
  job_location?: string;
  salary_low?: number | string | null;
  salary_high?: number | string | null;
  cached_slug?: string;
  start_date?: string | null;
  end_date?: string | null;
};

export type VolcanicPage = {
  jobs?: VolcanicJob[];
  total_count?: number;
  page_count?: number;
  current_page?: number;
};

function asDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Les offres d'une page `/api/v1/jobs.json`. Exporté pour être testé sans réseau. */
export function parseVolcanicPage(page: VolcanicPage, origin: string): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  for (const job of page.jobs ?? []) {
    const externalId = String(job.id ?? '').trim();
    const title = String(job.job_title ?? job.title ?? '').trim();
    if (!externalId || !title) continue;
    if (!job.cached_slug) continue; // sans slug, pas de page publique à proposer au candidat

    const description = htmlToPlainText(job.description) || job.clean_description?.trim() || undefined;

    jobs.push({
      externalId,
      title,
      location: job.job_location?.trim() || undefined,
      contract: job.job_type || undefined,
      department: job.disciplines?.[0]?.name || undefined,
      salaryMin: asNumber(job.salary_low),
      salaryMax: asNumber(job.salary_high),
      description,
      url: `${origin}/job/${job.cached_slug}`,
      postedAt: asDate(job.start_date),
      validThrough: asDate(job.end_date),
      raw: job,
    });
  }
  return jobs;
}

export async function fetchVolcanicJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Volcanic origin missing');

  const out: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await fetchJson<VolcanicPage>(`${origin}/api/v1/jobs.json?page=${page}`);
    if (typeof data.total_count === 'number') declaredTotal = data.total_count;

    const fresh = parseVolcanicPage(data, origin).filter((job) => !seen.has(job.externalId));
    for (const job of fresh) {
      seen.add(job.externalId);
      out.push(job);
    }
    if (fresh.length === 0) break;
    if (typeof data.page_count === 'number' && page >= data.page_count) break;
  }

  return {
    jobs: out,
    declaredTotal,
    truncated: declaredTotal !== undefined && out.length < declaredTotal,
  };
}

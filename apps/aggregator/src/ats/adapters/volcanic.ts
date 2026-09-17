import { createHash } from 'node:crypto';
import { fetchJson, fetchText } from '../../lib/http.js';
import pLimit from 'p-limit';
import { enrichPostingEvidence } from '../../lib/postingEvidence.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Volcanic — sites carrière hébergés (`careers.<marque>`, empreinte
 * `Volcanic.prod-eu-2` dans la télémétrie), ex. careers.fenwick.co.uk.
 *
 * La plateforme expose `GET /api/v1/jobs.json?page=N` — JSON public, sans clé — avec
 * `total_count`, `page_count`, `current_page` et, par offre : id, titre, lieu,
 * type de contrat, description HTML complète, slug de la page publique.
 * 20 offres par page, pagination 1-indexée, arrêt à `page_count`.
 * Les pages Fenwick portent aussi un JobPosting : leur attribut HTML non cité
 * type=application/ld+json doit être lu par le parseur HTML commun.
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

function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * L'identifiant CANONIQUE d'une ligne Volcanic : `job.id`, le même chemin d'identité que
 * `NormalizedJob.externalId` ci-dessous. Null quand la ligne ne porte aucun `id` exploitable — elle a alors
 * été vue sans pouvoir être nommée, et aucun identifiant historique ne peut être déclaré absent.
 */
export function volcanicCanonicalId(job: VolcanicJob): string | null {
  const id = String(job.id ?? '').trim();
  return id || null;
}

/**
 * Les lignes d'une page, TRIÉES : celles qui deviennent des offres, et celles qui ont été vues puis écartées.
 *
 * Une ligne écartée (sans titre, sans slug) doit rester une DISPOSITION nommée : le contrat des identifiants
 * canoniques est bidirectionnel, et un identifiant observé sans offre ni disposition le rompt.
 */
export function sortVolcanicPage(page: VolcanicPage, origin: string): {
  jobs: NormalizedJob[];
  rejectedRows: NonNullable<AdapterResult['rejectedRows']>;
  canonicalIds: string[];
  anonymousRows: number;
} {
  const jobs: NormalizedJob[] = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const canonicalIds: string[] = [];
  let anonymousRows = 0;
  for (const job of page.jobs ?? []) {
    /**
     * L'IDENTIFIANT ENTRE DANS LA PREUVE AVANT LES VALIDATIONS : une ligne dotée d'un `id` a été OBSERVÉE,
     * quoi qu'il advienne de son titre ou de son slug. La valider d'abord la sortirait de `canonicalIds`, et
     * une JobSource historique portant ce même identifiant paraîtrait ABSENTE.
     */
    const canonicalId = volcanicCanonicalId(job);
    if (canonicalId) canonicalIds.push(canonicalId); else anonymousRows++;
    const externalId = canonicalId ?? '';
    const title = String(job.job_title ?? job.title ?? '').trim();
    if (!externalId || !title || !job.cached_slug) {
      // sans slug, pas de page publique à proposer au candidat ; sans titre ni id, rien à publier.
      rejectedRows.push({ reason: 'MISSING_ID_TITLE_OR_SLUG', raw: job, ...(canonicalId ? { canonicalId } : {}) });
      continue;
    }

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
      // The list's start/end fields have no qualified publication semantics.
      // Read dates from the actual detail JobPosting and preserve the list RAW.
      raw: job,
    });
  }
  return { jobs, rejectedRows, canonicalIds, anonymousRows };
}

/** Les offres d'une page `/api/v1/jobs.json`. Exporté pour être testé sans réseau. */
export function parseVolcanicPage(page: VolcanicPage, origin: string): NormalizedJob[] {
  return sortVolcanicPage(page, origin).jobs;
}

export async function fetchVolcanicJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Volcanic origin missing');

  const out: NormalizedJob[] = [];
  const seen = new Set<string>();
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  let declaredTotal: number | undefined;
  let anonymousRows = 0;
  let pages = 0, rawCount = 0, termination = 'PAGE_BUDGET_EXHAUSTED';

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${origin}/api/v1/jobs.json?page=${page}`;
    const data = await fetchJson<VolcanicPage>(url);
    if (typeof data.total_count === 'number') declaredTotal = data.total_count;
    pages++;
    const rows = data.jobs ?? [];
    rawCount += rows.length;

    const sorted = sortVolcanicPage(data, origin);
    anonymousRows += sorted.anonymousRows;
    rejectedRows.push(...sorted.rejectedRows);
    /**
     * `canonicalIds` déclare ce que CETTE page a réellement servi : `job.id`, le même chemin d'identité que
     * `externalId`. Une ligne déjà vue sur une page précédente reste dans la preuve de la page qui la sert —
     * le contrat compare des ensembles, et retirer un identifiant dupliqué ferait mentir la page.
     */
    pageEvidence.push({ url, checkedAt: new Date().toISOString(),
      sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      offset: out.length,
      pagination: declaredTotal === undefined ? null
        : { start: out.length, end: out.length + sorted.jobs.length, total: declaredTotal },
      ids: sorted.canonicalIds, canonicalIds: sorted.canonicalIds,
      publisherCounter: String(data.total_count ?? ''),
      componentCounters: [`page=${data.current_page ?? page}`, `pageCount=${data.page_count ?? ''}`, `rows=${rows.length}`] });

    const fresh = sorted.jobs.filter((job) => !seen.has(job.externalId));
    for (const job of fresh) {
      seen.add(job.externalId);
      out.push(job);
    }
    if (fresh.length === 0) { termination = rows.length ? 'REPEATED_PAGE' : 'EMPTY_PAGE'; break; }
    if (typeof data.page_count === 'number' && page >= data.page_count) { termination = 'PAGE_COUNT_REACHED'; break; }
  }

  const limit = pLimit(Math.max(1, Math.min(4, Number(config.detailConcurrency) || 2)));
  const jobs = await Promise.all(out.map(job => limit(async () => {
    try { return enrichPostingEvidence(job, await fetchText(job.url)); }
    catch (error) { return { ...job, raw: { ...(job.raw as object), detailReadError: String(error) } }; }
  })));
  return {
    jobs,
    declaredTotal,
    rejectedRows,
    truncated: declaredTotal !== undefined && out.length < declaredTotal,
    enumeration: { method: 'DECLARED_TOTAL_JSON_PAGINATION', endpoint: `${origin}/api/v1/jobs.json`,
      pages, rawCount, termination,
      // Une ligne sans `id` a été vue sans pouvoir être nommée : aucun identifiant historique ne peut être
      // déclaré absent pour ce cycle.
      canonicalAbsenceProofUsable: anonymousRows === 0,
      pageEvidence },
  };
}

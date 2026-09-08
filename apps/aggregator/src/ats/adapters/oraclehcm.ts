import pLimit from 'p-limit';
import { fetchJson, DEFAULT_DETAIL_CONCURRENCY } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Oracle HCM Recruiting Cloud (« Candidate Experience ») — portails
 * `{tenant}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/…/sites/{site}/`.
 *
 * Mesuré le 2026-09-06 sur Bloomingdale's (ebwh.fa.us2, site CX_1002 : 762
 * offres) et Tiffany & Co. (eljs.fa.us2, site CX : 419 offres) :
 *
 * - le portail est une coquille JavaScript ; les offres viennent d'une API
 *   REST publique, sans jeton ni cookie, qui répond 200 à un `fetch` nu ;
 * - la liste annonce son total (`TotalJobsCount`) et se pagine par
 *   `limit`/`offset` (200 max par page) ;
 * - la liste ne porte NI description NI date fiable (`PostedDate` au jour, sans
 *   heure) : le texte complet vit dans un second endpoint « détails », une
 *   requête par offre (~11 Ko), qui porte aussi le lieu structuré (ville, pays,
 *   coordonnées) ;
 * - les domaines de marque (`www.tiffanycareers.com`) sont souvent des vitrines
 *   Akamai qui refusent tout robot (403 même à Chromium) — l'hôte Oracle, lui,
 *   est ouvert : c'est TOUJOURS lui qu'il faut configurer en `origin`.
 *
 * Config : `{ origin: 'https://eljs.fa.us2.oraclecloud.com', siteNumber: 'CX', lang?: 'en' }`.
 */

const PAGE_SIZE = 200;
/** 50 pages × 200 = 10 000 offres : au-delà, un tenant serait suspect. */
const MAX_PAGES = 50;

type ListRequisition = {
  Id: string;
  Title: string;
  PostedDate?: string | null;
  PrimaryLocation?: string | null;
  PrimaryLocationCountry?: string | null;
  JobSchedule?: string | null;
  ContractType?: string | null;
  WorkerType?: string | null;
  Language?: string | null;
  ShortDescriptionStr?: string | null;
};

type ListResponse = {
  items?: Array<{ TotalJobsCount?: number; requisitionList?: ListRequisition[] }>;
};

type WorkLocation = {
  TownOrCity?: string | null;
  PostalCode?: string | null;
  Country?: string | null;
  Region1?: string | null;
  Latitude?: string | number | null;
  Longitude?: string | number | null;
};

export type OracleDetail = {
  Id?: string;
  Title?: string;
  ExternalPostedStartDate?: string | null;
  PrimaryLocation?: string | null;
  PrimaryLocationCountry?: string | null;
  ExternalDescriptionStr?: string | null;
  ExternalQualificationsStr?: string | null;
  ExternalResponsibilitiesStr?: string | null;
  ContractType?: string | null;
  JobSchedule?: string | null;
  WorkerType?: string | null;
  ContentLocale?: string | null;
  workLocation?: WorkLocation[] | null;
};

type DetailResponse = { items?: OracleDetail[] };

function listUrl(origin: string, site: string, offset: number): string {
  const finder = `findReqs;siteNumber=${site},limit=${PAGE_SIZE},offset=${offset}`;
  return `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations,flexFieldsFacet.values&finder=${finder}`;
}

function detailUrl(origin: string, site: string, id: string): string {
  const finder = `ById;siteNumber=${site},Id="${encodeURIComponent(id)}"`;
  return `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&expand=all&finder=${finder}`;
}

/** Read one actual requisition; also used by reviewed, evidence-based repairs. */
export async function fetchOracleRequisitionDetail(origin: string, site: string, id: string): Promise<OracleDetail | undefined> {
  const body = await fetchJson<DetailResponse>(detailUrl(origin, site, id));
  const detail = body.items?.[0];
  if (detail && String(detail.Id) !== id) throw new Error(`Oracle detail ID mismatch: expected ${id}`);
  return detail;
}

/** L'URL publique de l'offre sur le portail candidat, vérifiée 200 (Tiffany, 2026-09-06). */
export function jobPageUrl(origin: string, site: string, id: string, lang = 'en'): string {
  return `${origin}/hcmUI/CandidateExperience/${lang}/sites/${site}/job/${encodeURIComponent(id)}`;
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Une ligne de la liste → offre normalisée (sans description : elle est dans le détail). */
export function normalizeListRequisition(
  req: ListRequisition,
  origin: string,
  site: string,
  lang = 'en',
): NormalizedJob {
  return {
    externalId: String(req.Id),
    title: String(req.Title ?? '').trim(),
    location: req.PrimaryLocation?.trim() || undefined,
    country: req.PrimaryLocationCountry?.trim() || undefined,
    contract: req.ContractType ?? req.WorkerType ?? undefined,
    workingTime: req.JobSchedule ?? undefined,
    url: jobPageUrl(origin, site, String(req.Id), lang),
    postedAt: parseDate(req.PostedDate),
    description: htmlToPlainText(req.ShortDescriptionStr) || undefined,
    raw: { source: 'oraclehcm', site, list: req },
  };
}

/**
 * Fusionne le détail dans l'offre de liste. Le détail est la source la plus
 * riche (texte complet, date à l'heure, ville/pays structurés) ; la liste ne
 * sert que de repli quand un champ du détail est vide.
 */
export function mergeDetail(job: NormalizedJob, detail: OracleDetail): NormalizedJob {
  const parts = [detail.ExternalDescriptionStr, detail.ExternalResponsibilitiesStr, detail.ExternalQualificationsStr]
    .map((part) => htmlToPlainText(part))
    .filter((part): part is string => Boolean(part));
  const description = parts.join('\n\n') || job.description;

  const place = detail.workLocation?.[0];
  const latitude = place?.Latitude != null ? Number(place.Latitude) : undefined;
  const longitude = place?.Longitude != null ? Number(place.Longitude) : undefined;

  return {
    ...job,
    title: detail.Title?.trim() || job.title,
    location: detail.PrimaryLocation?.trim() || job.location,
    country: detail.PrimaryLocationCountry?.trim() || place?.Country?.trim() || job.country,
    city: place?.TownOrCity?.trim() || undefined,
    postalCode: place?.PostalCode?.trim() || undefined,
    region: place?.Region1?.trim() || undefined,
    latitude: Number.isFinite(latitude) ? latitude : undefined,
    longitude: Number.isFinite(longitude) ? longitude : undefined,
    contract: detail.ContractType ?? detail.WorkerType ?? job.contract,
    workingTime: detail.JobSchedule ?? job.workingTime,
    language: detail.ContentLocale?.slice(0, 2).toLowerCase() || undefined,
    postedAt: parseDate(detail.ExternalPostedStartDate) ?? job.postedAt,
    description,
    raw: { ...(job.raw as Record<string, unknown>), detail },
  };
}

export async function fetchOracleHcmJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  const site = String(config.siteNumber ?? config.site ?? '');
  const lang = String(config.lang ?? 'en');
  if (!origin || !site) throw new Error('Oracle HCM origin and siteNumber are required');

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const body = await fetchJson<ListResponse>(listUrl(origin, site, offset));
    const item = body.items?.[0];
    const batch = item?.requisitionList ?? [];
    if (typeof item?.TotalJobsCount === 'number') declaredTotal = item.TotalJobsCount;

    const fresh = batch.filter((req) => req?.Id && !seen.has(String(req.Id)));
    for (const req of fresh) {
      seen.add(String(req.Id));
      jobs.push(normalizeListRequisition(req, origin, site, lang));
    }

    // Fin de liste : page vide, ou total annoncé atteint. Une page sans
    // nouveauté termine aussi — un tenant qui bouclerait sur la même page ne
    // doit pas coûter 50 requêtes.
    if (fresh.length === 0) break;
    if (declaredTotal !== undefined && offset + PAGE_SIZE >= declaredTotal) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  if (config.withDescriptions === false) return { jobs, declaredTotal, truncated };

  const limit = pLimit(Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY));
  const enriched = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const detail = await fetchOracleRequisitionDetail(origin, site, job.externalId);
          return detail ? mergeDetail(job, detail) : job;
        } catch {
          // Un détail injoignable ne doit pas faire perdre l'offre de liste.
          return job;
        }
      }),
    ),
  );

  return { jobs: enriched, declaredTotal, truncated };
}

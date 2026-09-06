import pLimit from 'p-limit';
import { DEFAULT_DETAIL_CONCURRENCY, fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Talent Funnel — l'ATS derrière `jobs.drmartens.com` (et tout portail Next.js
 * qui appelle `ats-api.talent-funnel.com`). Capturé au réseau et rejoué le
 * 2026-09-06.
 *
 * Pièges mesurés :
 *
 * 1. L'API exige un en-tête `tenant: <uuid>` — sans lui, 403 quels que soient
 *    Origin/Referer/User-Agent. L'uuid est en clair dans le `__NEXT_DATA__`
 *    de la page (`"tenant":"a3e88308-…"`) et dans chaque vacancy.
 *
 * 2. La recherche `POST /js/search/vacancy` rend la liste complète en un appel
 *    (`limit` accepté jusqu'à 5000 ; `start` est un offset, vérifié
 *    start=100/limit=50 → 43 sur 143) MAIS la `description` y est vide sur
 *    142 des 143 offres, même avec `excludeContent:false`. Le texte complet
 *    vit dans `GET /js/vacancy/{id}` (positionProfile.description, ~5 Ko) :
 *    un appel par offre, limité à 4 en parallèle.
 *
 * 3. `company.name` est l'entité régionale (« Dr. Martens US », « Dr. Martens
 *    FR », « Dr Martens »…, 15 variantes) : on ne la propage pas comme nom
 *    d'employeur, elle resterait 15 sociétés fantômes. Elle reste dans `raw`.
 *
 * 4. `validTo` vaut `9999-12-31` quand il n'y a pas d'échéance : ignoré.
 */

const DEFAULT_API = 'https://ats-api.talent-funnel.com';
const PAGE_SIZE = 500;
const MAX_PAGES = 40;
const NO_EXPIRY = '9999-12-31';

const LIST_FIELDS = [
  'id',
  'category',
  'company',
  'description',
  'hoursType',
  'jobTitle',
  'location',
  'remuneration',
  'applicationUrl',
  'validFrom',
  'validTo',
];

type Location = {
  city?: string;
  country?: string;
  postCode?: string;
  geoLocation?: { coordinates?: Array<[number, number]> | [number, number] };
  formattedAddress?: string;
};

type Remuneration = {
  currency?: string;
  interval?: string;
  type?: string;
  ranges?: Array<{ type?: string; value?: number; min?: number; max?: number }>;
};

type Vacancy = {
  id?: string;
  vacancyId?: string;
  jobTitle?: string;
  category?: string;
  company?: { name?: string };
  location?: Location;
  description?: string;
  hoursType?: string;
  remuneration?: Remuneration;
  applicationUrl?: string;
  validFrom?: string;
  validTo?: string;
};

type SearchResponse = { results?: Vacancy[]; totalResults?: number; start?: number; limit?: number };

type VacancyDetail = {
  validFrom?: string;
  positionProfile?: {
    title?: string;
    description?: string;
    seniority?: string;
    contractType?: string;
    hoursType?: string;
    remoteWorking?: boolean;
    language?: string;
    location?: Location;
    remuneration?: Remuneration;
  };
};

/** `[[lon, lat]]` (mesuré) ou `[lon, lat]` : GeoJSON met la longitude d'abord. */
function coordinates(location: Location | undefined): { latitude?: number; longitude?: number } {
  const raw = location?.geoLocation?.coordinates;
  const pair = Array.isArray(raw?.[0]) ? (raw as Array<[number, number]>)[0] : (raw as [number, number] | undefined);
  if (!pair || typeof pair[0] !== 'number' || typeof pair[1] !== 'number') return {};
  return { longitude: pair[0], latitude: pair[1] };
}

/** `HOURLY` → HOUR, `YEARLY` → YEAR, `MONTHLY` → MONTH ; autre valeur laissée telle quelle. */
function salaryPeriod(interval: string | undefined): string | undefined {
  return interval?.replace(/LY$/, '');
}

function salary(remuneration: Remuneration | undefined): Partial<NormalizedJob> {
  const range = remuneration?.ranges?.[0];
  if (!range) return {};
  const min = typeof range.min === 'number' ? range.min : range.value;
  const max = typeof range.max === 'number' ? range.max : range.value;
  // « Dependent on experience » arrive avec value 0 : ce n'est pas un salaire.
  if (!min && !max) return {};
  return {
    salaryMin: min || undefined,
    salaryMax: max || undefined,
    // La devise n'est présente que sur certaines offres (GBP) : jamais devinée.
    salaryCurrency: remuneration?.currency,
    salaryPeriod: salaryPeriod(remuneration?.interval),
  };
}

function isoDate(value: string | undefined): Date | undefined {
  if (!value || value === NO_EXPIRY) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Une vacancy de la recherche (+ son détail éventuel) → NormalizedJob. */
export function parseTalentFunnelVacancy(
  vacancy: Vacancy,
  origin: string,
  detail?: VacancyDetail,
): NormalizedJob | null {
  const id = vacancy.id ?? vacancy.vacancyId;
  if (!id || !vacancy.jobTitle) return null;

  const profile = detail?.positionProfile;
  const location = profile?.location ?? vacancy.location;
  const description = htmlToPlainText(profile?.description) || htmlToPlainText(vacancy.description);

  return {
    externalId: id,
    title: vacancy.jobTitle.trim(),
    location: [location?.city, location?.country].filter(Boolean).join(', ') || undefined,
    city: location?.city,
    postalCode: location?.postCode,
    country: location?.country,
    ...coordinates(location),
    contract: profile?.contractType,
    workingTime: profile?.hoursType ?? vacancy.hoursType,
    department: vacancy.category,
    language: profile?.language?.slice(0, 2),
    description: description || undefined,
    ...salary(profile?.remuneration ?? vacancy.remuneration),
    url: `${origin}/job/${id}`,
    postedAt: isoDate(detail?.validFrom ?? vacancy.validFrom),
    validThrough: isoDate(vacancy.validTo),
    raw: { vacancy, detail },
  };
}

export async function fetchTalentFunnelJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const tenant = String(config.tenant ?? '');
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!tenant || !origin) throw new Error('Talent Funnel tenant and origin are required');
  const api = String(config.api ?? DEFAULT_API).replace(/\/$/, '');
  const withDescriptions = config.withDescriptions !== false;
  const headers = { tenant, 'content-type': 'application/json' };

  const vacancies: Vacancy[] = [];
  let declaredTotal: number | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetchJson<SearchResponse>(`${api}/js/search/vacancy`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        limit: PAGE_SIZE,
        start: page * PAGE_SIZE,
        sort: [{ order: 'DESC', field: 'createdDateTime' }],
        fields: LIST_FIELDS,
      }),
    });
    const batch = response.results ?? [];
    vacancies.push(...batch);
    if (response.totalResults !== undefined) declaredTotal = response.totalResults;
    if (batch.length < PAGE_SIZE) break;
    if (declaredTotal !== undefined && vacancies.length >= declaredTotal) break;
  }

  const limit = pLimit(Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY));
  const seen = new Set<string>();
  const jobs = (
    await Promise.all(
      vacancies.map((vacancy) =>
        limit(async () => {
          const id = vacancy.id ?? vacancy.vacancyId;
          if (!id || seen.has(id)) return null;
          seen.add(id);
          let detail: VacancyDetail | undefined;
          if (withDescriptions) {
            try {
              detail = await fetchJson<VacancyDetail>(`${api}/js/vacancy/${encodeURIComponent(id)}`, { headers });
            } catch {
              // Un détail injoignable ne perd pas l'offre : la liste porte déjà
              // titre, lieu, date et URL.
            }
          }
          return parseTalentFunnelVacancy(vacancy, origin, detail);
        }),
      ),
    )
  ).filter((job): job is NormalizedJob => job !== null);

  return { jobs, declaredTotal, truncated: declaredTotal !== undefined && jobs.length < declaredTotal };
}

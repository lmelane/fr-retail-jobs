import pLimit from 'p-limit';
import { fetchJson, fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Welcome to the Jungle — its own search API, not a generic jobboard scrape.
 *
 * WTTJ runs a public Algolia index behind its site. Credentials are the standard
 * client-side search pair, captured from the site's own requests and usable as
 * the site uses them: the key is referer-restricted, so the Referer header is
 * required (without it Algolia answers "Method not allowed with this referer").
 * The app id is case-sensitive and uppercase — lowercase yields a 403 that reads
 * like a bad key.
 *
 * Verified 2026-09-01: filtering on organization.slug "lacoste" returns
 * nbHits 31 with 43 fields per hit, including salary bands, remote policy and
 * experience level that the JSON-LD path never exposes.
 *
 * This replaces fetching 1294 individual pages with one query per employer.
 */

const APP_ID = 'CSEKHVMS53';
/**
 * Public, client-side search key — the one the website itself ships.
 *
 * WTTJ rotates it on deploy, so this is a starting point, not a constant. When
 * it is refused, refreshSearchKey() reads the current one out of any company
 * page, where it appears as ALGOLIA_API_KEY_CLIENT in the embedded config.
 *
 * This matters more than it looks: a rotated key makes Algolia answer 403, and
 * a caller that reads that as `nbHits: null` sees "this Maison has no
 * openings". That silent failure produced false NONE verdicts across three
 * discovery batches before anyone noticed the key had changed.
 */
let searchKey = '4bd8f6215d0cc52b26430765769e65a0';
const INDEX = 'wttj_jobs_production_fr';

/** Any company page carries the current credentials in its inlined config. */
const KEY_SOURCE = 'https://www.welcometothejungle.com/fr/companies/lacoste/jobs';

/** Algolia caps a single page; 100 is its maximum hitsPerPage. */
const PAGE_SIZE = 100;

function headers() {
  return {
    'x-algolia-application-id': APP_ID,
    'x-algolia-api-key': searchKey,
    'content-type': 'application/json',
    // The key is referer-restricted; this is not spoofing a browser, it is the
    // scope the key was issued for.
    referer: 'https://www.welcometothejungle.com/',
    origin: 'https://www.welcometothejungle.com',
  };
}

/**
 * Re-reads the current search key from a WTTJ page.
 *
 * Called only after a refusal, so the normal path costs no extra request.
 * Returns false when no key can be found, which the caller must treat as a
 * failure rather than as an empty result.
 */
async function refreshSearchKey(): Promise<boolean> {
  try {
    const html = await fetchText(KEY_SOURCE, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    const found = html.match(/"ALGOLIA_API_KEY_CLIENT"\s*:\s*"([0-9a-f]{32})"/)?.[1];
    if (!found || found === searchKey) return false;
    searchKey = found;
    return true;
  } catch {
    return false;
  }
}

type WttjOffice = { city?: string; country?: string; zip_code?: string };

type WttjHit = {
  slug?: string;
  reference?: string;
  name?: string;
  contract_type?: string;
  published_at?: string;
  offices?: WttjOffice[];
  organization?: { slug?: string; name?: string };
  salary_minimum?: number;
  salary_maximum?: number;
  salary_currency?: string;
  salary_period?: string;
  remote?: string;
  experience_level_minimum?: number;
  description?: string;
  profile?: string | null;
  /** ~400–550 caractères de résumé : le seul texte que l'index porte encore. */
  summary?: string;
};

type WttjResponse = { nbHits?: number; hits?: WttjHit[]; message?: string; status?: number };

/** Ce qu'Algolia rend à toute requête : un refus se lit dans `message`/`status`, jamais dans un tableau vide. */
type AlgoliaRefusable = { message?: string; status?: number };

/**
 * Une requête sur l'index WTTJ, avec la seule clé que ce module connaît.
 *
 * Partagée entre l'adaptateur par société (`fetchWttjJobs`) et l'adaptateur
 * sectoriel (`wttjSector.ts`) : la clé publique tourne, et la rafraîchir doit
 * se faire à UN endroit, sinon les deux adaptateurs se contredisent au même
 * run. Un refus après rafraîchissement est une erreur nommée — jamais un
 * résultat vide, qui se lirait « cette Maison ne recrute pas ».
 */
export async function wttjSearch<T extends AlgoliaRefusable>(body: Record<string, unknown>): Promise<T> {
  const ask = () =>
    fetchJson<T>(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });

  let response = await ask();
  if (response.status === 403 || response.message) {
    if (await refreshSearchKey()) response = await ask();
    if (response.status === 403 || response.message) {
      throw new Error(
        `WTTJ refused the query (${response.message ?? 'status 403'}). The public search ` +
          'key has rotated and could not be refreshed from the site — re-extract ' +
          'ALGOLIA_API_KEY_CLIENT rather than recording this employer as having no jobs.',
      );
    }
  }
  return response;
}

/**
 * L'offre complète, par l'API publique du site.
 *
 * Mesuré le 2026-09-06 : l'index Algolia ne porte PLUS `description` (absent
 * de tous les hits, `profile` à null) — seulement `summary`, un résumé de
 * 400 à 550 caractères. Hermès 609 offres et Diptyque 26 à 0 % de
 * description en base. Le texte vit sur
 * `api.welcometothejungle.com/api/v1/organizations/{org}/jobs/{slug}`, sans
 * clé ni en-tête particulier (vérifié sans user-agent) : `job.description`
 * en HTML (4 741 caractères, 67 <br>, 15 <li> sur un polisseur Hermès),
 * `job.profile` et `job.recruitment_process` quand l'employeur les remplit.
 */
const JOB_API = 'https://api.welcometothejungle.com/api/v1/organizations';

type WttjApiJob = { description?: string | null; profile?: string | null; recruitment_process?: string | null };

/** Le texte de l'offre tel que l'API le donne : description, puis profil, puis processus. Pur. */
export function descriptionFromApi(job: WttjApiJob | undefined): string | undefined {
  return (
    [htmlToPlainText(job?.description), htmlToPlainText(job?.profile), htmlToPlainText(job?.recruitment_process)]
      .filter(Boolean)
      .join('\n\n') || undefined
  );
}

async function attachWttjDescriptions(
  jobs: NormalizedJob[],
  organizationSlug: string,
  concurrency: number,
): Promise<NormalizedJob[]> {
  const limit = pLimit(concurrency);
  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const hit = job.raw as WttjHit;
        if (!hit.slug) return job;
        try {
          const response = await fetchJson<{ job?: WttjApiJob }>(
            `${JOB_API}/${hit.organization?.slug ?? organizationSlug}/jobs/${hit.slug}`,
          );
          const full = descriptionFromApi(response.job);
          return full && full.length > (job.description?.length ?? 0) ? { ...job, description: full } : job;
        } catch {
          // Un détail injoignable ne doit pas faire perdre l'offre : le résumé reste.
          return job;
        }
      }),
    ),
  );
}

function toNormalized(hit: WttjHit, organizationSlug: string): NormalizedJob | null {
  if (!hit.name) return null;

  const office = hit.offices?.[0];
  const postedAt = hit.published_at ? new Date(hit.published_at) : undefined;
  // Le résumé n'est là qu'en repli : l'offre complète vient de l'API, après.
  const description =
    [htmlToPlainText(hit.description), htmlToPlainText(hit.profile)].filter(Boolean).join('\n\n') ||
    htmlToPlainText(hit.summary) ||
    '';

  return {
    externalId: String(hit.reference ?? hit.slug ?? hit.name),
    title: hit.name,
    location: [office?.city, office?.zip_code].filter(Boolean).join(', ') || undefined,
    country: office?.country,
    contract: hit.contract_type,
    city: office?.city,
    postalCode: office?.zip_code,
    // WTTJ publishes what most sources never do.
    remote: hit.remote,
    experienceYears: hit.experience_level_minimum,
    salaryMin: hit.salary_minimum,
    salaryMax: hit.salary_maximum,
    salaryCurrency: hit.salary_currency,
    salaryPeriod: hit.salary_period,
    description: description || undefined,
    // The employer as WTTJ names it — without it, a group slug's offers all
    // inherit the catalogue label (audit A-01).
    company: hit.organization?.name,
    url: `https://www.welcometothejungle.com/fr/companies/${organizationSlug}/jobs/${hit.slug ?? ''}`,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: hit,
  };
}

/**
 * Every WTTJ posting for one employer. `config.slug` is the organization slug as
 * it appears in the URL (/fr/companies/{slug}/jobs).
 */
export async function fetchWttjJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const slug = String(config.slug ?? config.organization ?? '');
  if (!slug) throw new Error('WTTJ organization slug missing');

  const jobs: NormalizedJob[] = [];
  let declaredTotal: number | undefined;

  for (let page = 0; ; page++) {
    // A rotated key is refreshed once and a persistent refusal throws (see
    // wttjSearch): an empty array here is indistinguishable from "this
    // employer is not hiring".
    const response = await wttjSearch<WttjResponse>({
      // The slug must be QUOTED: unquoted, Algolia silently returns nbHits 0
      // for every organization, which reads as "no jobs" rather than as a
      // malformed filter.
      query: '',
      filters: `organization.slug:"${slug}"`,
      hitsPerPage: PAGE_SIZE,
      page,
    });

    const hits = response.hits ?? [];
    for (const hit of hits) {
      const job = toNormalized(hit, slug);
      if (job) jobs.push(job);
    }

    if (response.nbHits !== undefined) declaredTotal = response.nbHits;
    // A short page is the last one; nbHits also bounds the loop.
    if (hits.length < PAGE_SIZE) break;
    if (response.nbHits !== undefined && jobs.length >= response.nbHits) break;
  }

  if (config.withDescriptions === false) return { jobs, declaredTotal };
  // Un hit qui porte encore `description` (ancienne forme de l'index) suffit ;
  // un résumé, quelle que soit sa longueur, n'est pas l'offre.
  const complete = jobs.every((job) => typeof (job.raw as WttjHit).description === 'string');
  if (complete) return { jobs, declaredTotal };
  return {
    jobs: await attachWttjDescriptions(jobs, slug, Number(config.detailConcurrency ?? 4)),
    declaredTotal,
  };
}

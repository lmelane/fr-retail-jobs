import { fetchJson } from '../../lib/http.js';
import { countryFromLocation, normalizeCountry } from '../../normalize/country.js';
import { subdivisionCountryOf } from '../../normalize/geography.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { publisherInstant } from '../../lib/publisherInstant.js';

type GreenhouseOffice = { id?: number; name?: string; location?: string | null };
type GreenhouseJob = {
  id: number; title: string; absolute_url: string; location?: { name?: string }; content?: string; first_published?: string; updated_at?: string;
  /** Present with `?content=true`: the hiring office(s); `location` is a free address ("London, England, United Kingdom", "Förrlibuckstrasse 190, 8005 Zürich, Switzerland") or null. */
  offices?: GreenhouseOffice[];
};
type GreenhouseResponse = { jobs: GreenhouseJob[]; meta?: { total?: number } };

/**
 * The country of a Greenhouse posting. `location.name` is a bare city ("Zurich", "Shanghai": 0 % of On's 309 postings carried
 * a country on 2026-09-10) — the office address, when the board fills it, ends with the country. Read from the FIRST office
 * whose address yields a recognised country; nothing is inferred from a city name alone here. A posting the chain leaves without
 * country may still receive one, on proof, from `geo/paysParPreuve.ts` (D-520, offres sans pays).
 */
export function greenhouseCountry(job: Pick<GreenhouseJob, 'offices' | 'location'>): string | undefined {
  for (const office of job.offices ?? []) {
    const country = countryFromLocation(office.location ?? undefined);
    if (country) return country;
  }
  return countryFromLocation(job.location?.name) ?? officeNamedCountry(job.offices);
}

/**
 * D-520, offres sans pays (02/10/2026) — LE NOM DU BUREAU, QUAND IL EST UN PAYS. Greenhouse range une offre sous ses bureaux,
 * et beaucoup de tableaux nomment un bureau par son pays, sans adresse : On (« United States », « China », « Japan » :
 * 157 offres sans pays), Molton Brown (« United Kingdom », « Ireland » : 26). C'est un champ natif, déclaré par l'employeur.
 * Lu en dernier (l'adresse d'un bureau, puis le lieu de l'offre passent avant) et seulement quand le nom ENTIER est un nom de
 * pays : jamais un code (« UK », « US » : deux ou trois lettres ne désignent pas un pays avec certitude), jamais un nom qui est aussi un État ou une province (« Georgia »),
 * jamais un nom composé (« HQ Shanghai », « Remote (United States) »). Des bureaux qui nomment plusieurs pays n'en donnent
 * aucun. Le pays passe ensuite par la confrontation aux lieux déclarés (`declaredPlaceCountry.ts`) : un bureau « China »
 * pour un lieu « Hong Kong » rend Hong Kong (D-442 §2).
 */
function officeNamedCountry(offices: GreenhouseOffice[] | undefined): string | undefined {
  const named = new Set<string>();
  for (const office of offices ?? []) {
    const name = office.name?.trim();
    if (!name || /^[A-Za-z]{2,3}$/.test(name) || subdivisionCountryOf(name)) continue;
    const country = normalizeCountry(name);
    if (country) named.add(country);
  }
  const [only] = named;
  return named.size === 1 ? only : undefined;
}

export async function fetchGreenhouseJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const board = String(config.board ?? '');
  if (!board) throw new Error('Greenhouse board missing');
  const data = await fetchJson<GreenhouseResponse>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
  if (!Array.isArray(data?.jobs)) throw new Error('Greenhouse jobs array missing');
  const total = data.meta?.total;
  if (total !== undefined && (!Number.isSafeInteger(total) || total < 0)) throw new Error('Greenhouse invalid native total');
  return { jobs: data.jobs.map(parseGreenhouseJob), complete: total === undefined || total === data.jobs.length,
    ...(total !== undefined ? { declaredTotal: total } : {}) };
}

export function parseGreenhouseJob(job: GreenhouseJob): NormalizedJob {
  return {
    externalId: String(job.id),
    title: job.title,
    location: job.location?.name,
    country: greenhouseCountry(job),
    description: job.content,
    url: job.absolute_url,
    // An edit does not establish when the job was published.
    postedAt: publisherInstant(job.first_published),
    raw: job,
  };
}

import { fetchJson } from '../../lib/http.js';
import { countryFromLocation } from '../../normalize/country.js';
import type { NormalizedJob } from '../../types.js';
import { publisherInstant } from '../../lib/publisherInstant.js';

type GreenhouseOffice = { id?: number; name?: string; location?: string | null };
type GreenhouseJob = {
  id: number; title: string; absolute_url: string; location?: { name?: string }; content?: string; first_published?: string; updated_at?: string;
  /** Present with `?content=true`: the hiring office(s); `location` is a free address ("London, England, United Kingdom", "Förrlibuckstrasse 190, 8005 Zürich, Switzerland") or null. */
  offices?: GreenhouseOffice[];
};
type GreenhouseResponse = { jobs: GreenhouseJob[] };

/**
 * The country of a Greenhouse posting. `location.name` is a bare city ("Zurich", "Shanghai": 0 % of On's 309 postings carried
 * a country on 2026-09-10) — the office address, when the board fills it, ends with the country. Read from the FIRST office
 * whose address yields a recognised country; nothing is inferred from a city name alone (D53: no city→country table).
 */
export function greenhouseCountry(job: Pick<GreenhouseJob, 'offices' | 'location'>): string | undefined {
  for (const office of job.offices ?? []) {
    const country = countryFromLocation(office.location ?? undefined);
    if (country) return country;
  }
  return countryFromLocation(job.location?.name);
}

export async function fetchGreenhouseJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const board = String(config.board ?? '');
  if (!board) throw new Error('Greenhouse board missing');
  const data = await fetchJson<GreenhouseResponse>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
  return data.jobs.map(parseGreenhouseJob);
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

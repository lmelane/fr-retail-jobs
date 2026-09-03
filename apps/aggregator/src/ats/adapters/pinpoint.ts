import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Pinpoint career sites (L'Occitane Group and others).
 *
 * The simplest vendor in the set: GET {origin}/jobs returns the entire board in
 * one response, descriptions and salary bands included. No pagination, no token,
 * no detail fetch.
 *
 * Verified 2026-09-01 on joinus.loccitane.com: 92 jobs carrying title, city,
 * state, zip, country_id, description and minimum/maximum_salary.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

type PinpointJob = {
  id?: string;
  title?: string;
  city?: string;
  state?: string;
  zip?: string;
  country_id?: string;
  department?: string;
  description?: string;
  type?: string;
  status?: string;
  original_open_date?: string;
  minimum_salary?: number;
  maximum_salary?: number;
  board_code?: string;
};

type PinpointResponse = { jobs?: PinpointJob[] };


/**
 * Reads a whole Pinpoint board.
 * `config.origin` e.g. "https://joinus.loccitane.com".
 */
export async function fetchPinpointJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Pinpoint origin missing');

  const response = await fetchJson<PinpointResponse>(`${origin}/jobs`, { headers: HEADERS });

  return (response.jobs ?? [])
    // Closed postings stay in the payload with a non-open status.
    .filter((job) => job.title && (!job.status || /open|publish|live/i.test(job.status)))
    .map((job) => {
      const posted = job.original_open_date ? new Date(job.original_open_date) : undefined;

      return {
        externalId: String(job.id ?? job.board_code ?? job.title),
        title: String(job.title),
        location: [job.city, job.state, job.zip].filter(Boolean).join(', ') || undefined,
        city: job.city,
        region: job.state,
        postalCode: job.zip,
        department: job.department,
        salaryMin: job.minimum_salary,
        salaryMax: job.maximum_salary,
        // country_id is an ISO-2 code; isFrance handles both that and the name.
        country: job.country_id,
        contract: job.type,
        description: htmlToPlainText(job.description),
        url: `${origin}/jobs/${job.id ?? ''}`,
        postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : undefined,
        raw: job,
      } satisfies NormalizedJob;
    });
}

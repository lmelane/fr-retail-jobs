import { fetchJson } from '../../lib/http.js';
import type { AdapterResult } from '../../types.js';

type Offer = { id: number; title: string; careers_url?: string; location?: string; city?: string; country?: string; employment_type?: string; description?: string; created_at?: string };
type Response = { offers?: Offer[] };

export async function fetchRecruiteeJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const subdomain = String(config.subdomain ?? '');
  if (!subdomain) throw new Error('Recruitee subdomain missing');
  const endpoint = `https://${subdomain}.recruitee.com/api/offers/`;
  const data = await fetchJson<Response>(endpoint);
  if (!Array.isArray(data.offers)) throw new Error('RECRUITEE_INVALID_FEED: offers array missing');
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const valid = data.offers.filter(job => {
    if (!job || !Number.isSafeInteger(job.id) || job.id <= 0 || typeof job.title !== 'string' || !job.title.trim()) {
      rejectedRows.push({ reason: 'MISSING_OR_INVALID_ID_OR_TITLE', raw: job }); return false;
    }
    return true;
  });
  const jobs = valid.map((job) => ({
    externalId: String(job.id),
    title: job.title,
    location: job.location ?? [job.city, job.country].filter(Boolean).join(', '),
    country: job.country,
    contract: job.employment_type,
    description: job.description,
    url: job.careers_url ?? `https://${subdomain}.recruitee.com/o/${job.id}`,
    postedAt: job.created_at ? new Date(job.created_at) : undefined,
    raw: job,
  }));
  return {
    jobs, rejectedRows,
    complete: rejectedRows.length === 0 && new Set(jobs.map(job=>job.externalId)).size === jobs.length,
    enumeration: { method: 'DOCUMENTED_COMPLETE_PUBLIC_FEED', endpoint, pages: 1,
      rawCount: data.offers.length, termination: 'FULL_RESPONSE',
      documentation: 'https://docs.recruitee.com/reference/offers' },
  };
}


import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

type Offer = { id: number; title: string; careers_url?: string; location?: string; city?: string; country?: string; employment_type?: string; description?: string; created_at?: string };
type Response = { offers?: Offer[] };

export async function fetchRecruiteeJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const subdomain = String(config.subdomain ?? '');
  if (!subdomain) throw new Error('Recruitee subdomain missing');
  const data = await fetchJson<Response>(`https://${subdomain}.recruitee.com/api/offers/`);
  return (data.offers ?? []).map((job) => ({
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
}

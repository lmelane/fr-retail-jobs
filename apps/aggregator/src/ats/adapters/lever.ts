import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

type LeverJob = { id: string; text: string; hostedUrl: string; createdAt?: number; descriptionPlain?: string; categories?: { location?: string; commitment?: string } };

export async function fetchLeverJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const site = String(config.site ?? '');
  if (!site) throw new Error('Lever site missing');
  const jobs = await fetchJson<LeverJob[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`);
  return jobs.map((job) => ({
    externalId: job.id,
    title: job.text,
    location: job.categories?.location,
    contract: job.categories?.commitment,
    description: job.descriptionPlain,
    url: job.hostedUrl,
    postedAt: job.createdAt ? new Date(job.createdAt) : undefined,
    raw: job,
  }));
}

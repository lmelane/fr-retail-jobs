import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

type GreenhouseResponse = { jobs: Array<{ id: number; title: string; absolute_url: string; location?: { name?: string }; content?: string; updated_at?: string }> };

export async function fetchGreenhouseJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const board = String(config.board ?? '');
  if (!board) throw new Error('Greenhouse board missing');
  const data = await fetchJson<GreenhouseResponse>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
  return data.jobs.map((job) => ({
    externalId: String(job.id),
    title: job.title,
    location: job.location?.name,
    description: job.content,
    url: job.absolute_url,
    postedAt: job.updated_at ? new Date(job.updated_at) : undefined,
    raw: job,
  }));
}

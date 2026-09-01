import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

type WorkdayPosting = { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] };
type WorkdayPage = { total?: number; jobPostings?: WorkdayPosting[] };

export async function fetchWorkdayJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const tenant = String(config.tenant ?? '');
  const site = String(config.site ?? '');
  const origin = String(config.origin ?? '');
  if (!tenant || !site || !origin) throw new Error('Workday tenant/site/origin missing');
  const endpoint = `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
  const out: NormalizedJob[] = [];
  for (let offset = 0; offset < 5000; offset += 20) {
    const page = await fetchJson<WorkdayPage>(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
    });
    const postings = page.jobPostings ?? [];
    for (const job of postings) {
      const externalId = job.externalPath.split('/').filter(Boolean).pop() ?? job.externalPath;
      out.push({
        externalId,
        title: job.title,
        location: job.locationsText,
        url: new URL(job.externalPath, `${origin}/${site}/`).toString(),
        raw: job,
      });
    }
    if (!postings.length || out.length >= (page.total ?? 0)) break;
  }
  return out;
}

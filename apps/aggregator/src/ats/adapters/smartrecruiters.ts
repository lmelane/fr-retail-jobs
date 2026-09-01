import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

type Posting = { id: string; name: string; ref?: string; releasedDate?: string; location?: { city?: string; region?: string; country?: string }; typeOfEmployment?: { label?: string } };
type Page = { content: Posting[]; totalFound?: number };

export async function fetchSmartRecruitersJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const company = String(config.company ?? '');
  if (!company) throw new Error('SmartRecruiters company missing');
  const out: NormalizedJob[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await fetchJson<Page>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100&offset=${offset}`);
    for (const job of page.content ?? []) {
      const location = [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(', ');
      out.push({
        externalId: job.id,
        title: job.name,
        location,
        country: job.location?.country,
        contract: job.typeOfEmployment?.label,
        url: `https://jobs.smartrecruiters.com/${company}/${job.id}`,
        postedAt: job.releasedDate ? new Date(job.releasedDate) : undefined,
        raw: job,
      });
    }
    if (!page.content?.length || out.length >= (page.totalFound ?? 0)) break;
  }
  return out;
}

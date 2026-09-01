import pLimit from 'p-limit';
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
  /**
   * Workday reports `total` ONLY on the first page — every later page returns
   * total: 0. Comparing against it each time stops the loop at 40 of 1088, so
   * the count is captured once and the loop otherwise ends on a short page.
   */
  let total = 0;

  for (let offset = 0; offset < 5000; offset += 20) {
    const page = await fetchJson<WorkdayPage>(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
    });
    const postings = page.jobPostings ?? [];
    if (page.total) total = page.total;
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
    if (postings.length < 20) break;
    if (total && out.length >= total) break;
  }

  if (config.withDescriptions === false) return out;
  return attachWorkdayDescriptions(
    out,
    `${origin}/wday/cxs/${tenant}/${site}`,
    Number(config.detailConcurrency ?? 6),
  );
}

type WorkdayDetail = {
  jobPostingInfo?: {
    jobDescription?: string;
    location?: string;
    country?: { descriptor?: string };
    startDate?: string;
  };
};

function stripHtml(value?: string): string {
  return (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The listing endpoint returns no description; the detail one does, at
 * {cxsBase}{externalPath}. The path must be the FULL externalPath from the
 * listing — a shortened one 404s with "not found: Job_Posting_Anchor_ID".
 */
export async function attachWorkdayDescriptions(
  jobs: NormalizedJob[],
  cxsBase: string,
  concurrency = 6,
): Promise<NormalizedJob[]> {
  const limit = pLimit(concurrency);

  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const path = (job.raw as { externalPath?: string } | undefined)?.externalPath;
        if (!path) return job;
        try {
          const detail = await fetchJson<WorkdayDetail>(`${cxsBase}${path}`);
          const info = detail.jobPostingInfo;
          if (!info) return job;
          return {
            ...job,
            description: stripHtml(info.jobDescription) || job.description,
            country: info.country?.descriptor ?? job.country,
            location: info.location ?? job.location,
          };
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
}

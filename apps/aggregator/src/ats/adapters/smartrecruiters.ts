import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

type Posting = { id: string; name: string; ref?: string; releasedDate?: string; location?: { city?: string; region?: string; country?: string }; typeOfEmployment?: { label?: string } };
type Page = { content: Posting[]; totalFound?: number };

type PostingDetail = {
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>;
  };
};

/** Strips the HTML SmartRecruiters returns inside each section. */
function stripHtml(value?: string): string {
  return (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The listing endpoint carries no description; /postings/{id} does, split across
 * named sections. They are concatenated in the order a candidate reads them.
 */
async function fetchDescription(company: string, id: string): Promise<string | undefined> {
  try {
    const detail = await fetchJson<PostingDetail>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`,
    );
    const sections = detail.jobAd?.sections ?? {};
    const text = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map((key) => stripHtml(sections[key]?.text))
      .filter(Boolean)
      .join('\n\n');
    return text || undefined;
  } catch {
    // A failed detail fetch must not lose the listing entry.
    return undefined;
  }
}

export async function fetchSmartRecruitersJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const company = String(config.company ?? '');
  if (!company) throw new Error('SmartRecruiters company missing');
  const out: NormalizedJob[] = [];
  let declaredTotal: number | undefined;
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
    if (page.totalFound !== undefined) declaredTotal = page.totalFound;
    if (!page.content?.length || out.length >= (page.totalFound ?? 0)) break;
  }

  if (config.withDescriptions === false) return { jobs: out, declaredTotal };

  const limit = pLimit(Number(config.detailConcurrency ?? 4));
  const jobs = await Promise.all(
    out.map((job) =>
      limit(async () => ({ ...job, description: await fetchDescription(company, job.externalId) })),
    ),
  );
  return { jobs, declaredTotal };
}

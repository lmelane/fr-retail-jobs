import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

export type SmartRecruitersPosting = {
  id: string;
  name: string;
  ref?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
  /**
   * `id` is the contract, `label` the working time — measured 2026-09-06 on
   * H&M (1 622) and Primark (824): ids permanent / part-time / contract, labels
   * Full-time / Part-time / Contract. Only the label was read, and it filed as a
   * working time: 3 553 contracts lost (audit a4 §4.10).
   */
  typeOfEmployment?: { id?: string; label?: string };
  /** Declared language ("hu", "en-GB") — ignored before l2, so a Hungarian H&M posting was detected as `pt`. */
  language?: { code?: string };
  department?: { label?: string };
};
type Page = { content: SmartRecruitersPosting[]; totalFound?: number };

/** SmartRecruiters' contract ids, in words the contract normalizer knows. */
const CONTRACT_BY_ID: Record<string, string> = {
  permanent: 'Permanent',
  contract: 'Fixed-term contract',
  temporary: 'Temporary',
  intern: 'Internship',
  internship: 'Internship',
  apprenticeship: 'Apprenticeship',
  freelance: 'Freelance',
};

/** One listing entry → one posting (no description: /postings/{id} carries it). Exported for tests. */
export function parseSmartRecruitersPosting(job: SmartRecruitersPosting, company: string): NormalizedJob {
  const location = [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(', ');
  const type = job.typeOfEmployment;
  const id = type?.id?.trim().toLowerCase();
  return {
    externalId: job.id,
    title: job.name,
    location,
    country: job.location?.country,
    // An unmapped id ("part-time") falls back to the label, which the boundary
    // then files as a working time rather than a contract.
    contract: (id && CONTRACT_BY_ID[id]) || type?.label || undefined,
    workingTime: type?.label || type?.id || undefined,
    language: job.language?.code?.trim().toLowerCase().split(/[-_]/)[0] || undefined,
    url: `https://jobs.smartrecruiters.com/${company}/${job.id}`,
    postedAt: job.releasedDate ? new Date(job.releasedDate) : undefined,
    raw: job,
  };
}

type PostingDetail = {
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>;
  };
};


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
      .map((key) => htmlToPlainText(sections[key]?.text))
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
  // Pas de plafond à 1 000 : l'API sert les offsets au-delà (vérifié : H&M
  // offset=1600 → 200, totalFound 1 622) ; le plafond laissait 622 offres H&M
  // jamais lues (lot 2, 2026-09-06). 20 000 = garde-fou contre une boucle.
  for (let offset = 0; offset < 20_000; offset += 100) {
    const page = await fetchJson<Page>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100&offset=${offset}`);
    for (const job of page.content ?? []) out.push(parseSmartRecruitersPosting(job, company));
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

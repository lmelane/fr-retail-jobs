import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Workable public job board widget API.
 *
 * `details=true` returns the description alongside the listing, so one request
 * covers an employer's whole board. Workable rate-limits aggressively (429), so
 * callers should keep concurrency low on this one.
 */

type WorkableJob = {
  shortcode?: string;
  title?: string;
  city?: string;
  state?: string;
  country?: string;
  employment_type?: string;
  published_on?: string;
  url?: string;
  application_url?: string;
  description?: string;
  requirements?: string;
};

type WorkableResponse = { jobs?: WorkableJob[] };

/** The widget returns HTML fields; the pipeline stores plain text. */
function stripHtml(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

export async function fetchWorkableJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const account = String(config.account ?? config.slug ?? '');
  if (!account) throw new Error('Workable account handle missing');

  const data = await fetchJson<WorkableResponse>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`,
  );

  return (data.jobs ?? [])
    .filter((job) => job.title && job.shortcode)
    .map((job) => {
      const postedAt = job.published_on ? new Date(job.published_on) : undefined;
      const description = [stripHtml(job.description), stripHtml(job.requirements)]
        .filter(Boolean)
        .join('\n\n');

      return {
        externalId: String(job.shortcode),
        title: String(job.title),
        location: [job.city, job.state].filter(Boolean).join(', ') || undefined,
        country: job.country,
        contract: job.employment_type,
        description: description || undefined,
        url: job.url ?? job.application_url ?? `https://apply.workable.com/${account}/j/${job.shortcode}/`,
        postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
        raw: job,
      } satisfies NormalizedJob;
    });
}

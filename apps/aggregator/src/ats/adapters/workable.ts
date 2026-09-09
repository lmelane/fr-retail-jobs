import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { sourceDelay, assertSourceRunning } from '../../lib/sourceBudget.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

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


export async function fetchWorkableJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const account = String(config.account ?? config.slug ?? '');
  if (!account) throw new Error('Workable account handle missing');

  const data = await fetchJson<WorkableResponse>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`,
  );

  if (!Array.isArray(data.jobs)) throw new Error('WORKABLE_INVALID_WIDGET: jobs array missing');
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const jobs: NormalizedJob[] = data.jobs.filter(job => {
    if (!job || typeof job.title !== 'string' || !job.title.trim() || typeof job.shortcode !== 'string' || !job.shortcode) {
      rejectedRows.push({ reason: 'MISSING_OR_INVALID_ID_OR_TITLE', raw: job }); return false;
    }
    return true;
  }).map((job) => {
      const postedAt = job.published_on ? new Date(job.published_on) : undefined;
      const description = [htmlToPlainText(job.description), htmlToPlainText(job.requirements)]
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

  // Independent, unfiltered listing used by Workable's own career board.
  // Measured on APM Monaco: 11 cursor pages / 102 IDs, exactly the widget IDs.
  const endpoint = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(account)}/jobs`;
  const listed = new Map<string, any>();
  const cursors = new Set<string>();
  let token: string | undefined;
  let declaredTotal: number | undefined;
  let pages = 0;
  let terminal = 'PAGE_LIMIT';
  let stableTotal = true;
  try {
    for (; pages < 10000;) {
      // Workable documents 10 requests / 10 seconds. Keep pagination sequential.
      await sourceDelay(1100);
      const page: any = await fetchJson(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) }),
      });
      pages++;
      if (!Array.isArray(page.results) || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('WORKABLE_INVALID_LISTING');
      if (declaredTotal !== undefined && declaredTotal !== page.total) stableTotal = false;
      declaredTotal = page.total;
      for (const row of page.results) {
        if (!row || typeof row.shortcode !== 'string' || !row.shortcode || typeof row.title !== 'string' || !row.title.trim()) {
          rejectedRows.push({ reason: 'INVALID_LISTING_ROW', raw: row }); continue;
        }
        if (listed.has(row.shortcode)) stableTotal = false;
        listed.set(row.shortcode, row);
      }
      if (!page.nextPage) { terminal = 'CURSOR_EXHAUSTED'; break; }
      if (typeof page.nextPage !== 'string' || cursors.has(page.nextPage)) { terminal = 'REPEATED_OR_INVALID_CURSOR'; break; }
      cursors.add(page.nextPage); token = page.nextPage;
    }
  } catch (error) {
    assertSourceRunning();
    terminal = `LISTING_VERIFICATION_FAILED: ${String(error).slice(0, 500)}`;
  }
  const widgetIds = new Set(jobs.map(job=>job.externalId));
  // A listing absent from the detail widget must stay visible, with the missing
  // enrichment explicitly retained. Never replace the raw publication date.
  for (const row of listed.values()) if (!widgetIds.has(row.shortcode)) {
    const location = row.location ?? row.locations?.[0];
    const postedAt = row.published ? new Date(row.published) : undefined;
    jobs.push({ externalId: row.shortcode, title: row.title,
      location: [location?.city, location?.region].filter(Boolean).join(', ') || undefined,
      country: location?.countryCode ?? location?.country, contract: row.type,
      url: `https://apply.workable.com/${account}/j/${row.shortcode}/`, description: undefined,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
      raw: { listing: row, detailReadError: 'ABSENT_FROM_DETAIL_WIDGET' },
    });
  }
  // Workable's widget expands a requisition once per location (observed on
  // APIVITA 8841DE97D4). The paginated listing is one row per requisition.
  // Group only the same ATS ID, retain every representation and require the
  // non-geographic content to agree; a name resemblance is never a merge key.
  const representations = new Map<string, NormalizedJob[]>();
  for (const job of jobs) representations.set(job.externalId, [...(representations.get(job.externalId) ?? []), job]);
  let conflictingRepresentations = false;
  const uniqueJobs = [...representations].map(([id, variants]) => {
    if (variants.length === 1) return variants[0];
    const signature = (job: NormalizedJob) => JSON.stringify([job.title,job.description,job.contract,job.postedAt?.toISOString()]);
    const conflict = new Set(variants.map(signature)).size !== 1;
    if (conflict) conflictingRepresentations = true;
    const primary = listed.get(id)?.location;
    const chosen = variants.find(job => (job.raw as any)?.city === primary?.city && (job.raw as any)?.country === primary?.country) ?? variants[0];
    return { ...chosen, raw: { ...(chosen.raw as object),
      widgetRepresentations: variants.map(job=>job.raw), listingEvidence: listed.get(id),
      representationResolution: conflict ? 'CONTENT_CONFLICT_REVIEW_REQUIRED' : 'SAME_REQUISITION_MULTIPLE_LOCATIONS',
    } };
  });
  const sameIds = widgetIds.size === listed.size && [...widgetIds].every(id=>listed.has(id));
  return { jobs: uniqueJobs, declaredTotal, rejectedRows,
    complete: terminal === 'CURSOR_EXHAUSTED' && stableTotal && sameIds && listed.size === declaredTotal && rejectedRows.length === 0 && !conflictingRepresentations,
    enumeration: { method: 'WIDGET_CROSSCHECKED_WITH_CURSOR_LISTING', endpoint, pages,
      rawCount: data.jobs.length, termination: terminal,
      documentation: 'https://workable.readme.io/reference/jobs-1' },
  };
}

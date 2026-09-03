import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

// externalPath is optional in practice: some tenants (Richemont) return rows
// without it, and treating it as always-present crashed the whole source.
type WorkdayPosting = { title: string; externalPath?: string; locationsText?: string; postedOn?: string; bulletFields?: string[] };
type WorkdayPage = { total?: number; jobPostings?: WorkdayPosting[] };

export async function fetchWorkdayJobs(config: Record<string, unknown>): Promise<AdapterResult> {
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
      // A posting without an externalPath has neither a stable id nor a URL to
      // send a candidate to — skip it rather than crash the whole source on
      // `undefined.split`. Richemont's tenant returned such rows, and the throw
      // lost all ~1300 of its offers ("cartier-3 failed: reading 'split'").
      if (!job.externalPath) continue;
      const externalId = job.externalPath.split('/').filter(Boolean).pop() ?? job.externalPath;
      out.push({
        externalId,
        title: job.title,
        location: job.locationsText,
        // The public career URL is {origin}/{site}{externalPath}, joined by
        // string — NOT new URL(externalPath, `${origin}/${site}/`), which
        // silently DROPS the /{site}/ segment because externalPath is an
        // absolute path ("/job/…") that overrides the base path. That produced
        // `${origin}/job/…` on every Richemont/Cartier offer → a 404 on every
        // apply link. Verified: `${origin}/${site}${externalPath}` → 200.
        url: `${origin.replace(/\/$/, '')}/${site}${job.externalPath}`,
        raw: job,
      });
    }
    if (postings.length < 20) break;
    if (total && out.length >= total) break;
  }

  // F-04: `total` is the tenant's own announced count — the truncation signal.
  const declaredTotal = total || undefined;
  if (config.withDescriptions === false) return { jobs: out, declaredTotal };
  return {
    jobs: await attachWorkdayDescriptions(
      out,
      `${origin}/wday/cxs/${tenant}/${site}`,
      Number(config.detailConcurrency ?? 6),
    ),
    declaredTotal,
  };
}

type WorkdayDetail = {
  jobPostingInfo?: {
    jobDescription?: string;
    location?: string;
    country?: { descriptor?: string };
    startDate?: string;
    /** On group tenants, the alt text IS the brand ("Panerai", "Cartier"). */
    logoImage?: { alt?: string };
  };
  /** Legal entity, code-prefixed: "C170 Officine Panerai". */
  hiringOrganization?: { name?: string };
};

/**
 * The Maison this posting belongs to, on a GROUP tenant (audit A-01, D11).
 *
 * Verified live on richemont/broadbean_external: jobPostingInfo.logoImage.alt
 * = "Panerai", hiringOrganization.name = "C170 Officine Panerai". Without this,
 * every offer of the feed inherits the catalogue line's label and 1 300+
 * Richemont offers all read "Cartier".
 */
export function brandFromWorkdayDetail(detail: WorkdayDetail): string | undefined {
  const alt = detail.jobPostingInfo?.logoImage?.alt?.trim();
  if (alt) return alt;
  const legal = detail.hiringOrganization?.name?.trim();
  if (!legal) return undefined;
  // Strip the leading entity code ("C170 Officine Panerai" -> "Officine Panerai").
  return legal.replace(/^[A-Z]{0,2}\d+\s+/, '').trim() || undefined;
}

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
            // Group tenants: credit the offer to its Maison, not the feed label.
            company: brandFromWorkdayDetail(detail) ?? job.company,
          };
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
}

import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * TalentView career sites (Tape à l'œil and others).
 *
 * Its public API calls postings "campaigns". Two details cost a wrong turn:
 * /companies/{slug}/campaigns 404s without `company_website_id`, which itself
 * comes from /companies/{slug}/websites — so the website id has to be resolved
 * first.
 *
 * CAUTION, verified: talentview.io has WILDCARD DNS. Any {slug}.talentview.io
 * returns a 200 SPA shell, so a reachable hostname proves nothing. Only a real
 * record from /companies/{slug} confirms a tenant exists.
 *
 * Verified 2026-09-01 on t-a-o: company record { id: 572, name: "Tape à l'oeil" }
 * and 10 campaigns carrying name, job_type and address.
 *
 * The description lives at /campaigns/{slug} — by SLUG, not by id, and only with
 * a Referer on the tenant's own host. Without it the endpoint answers 404, which
 * reads like "no such route" rather than "wrong headers"; I first concluded the
 * platform published no descriptions at all, which was wrong.
 *
 * That payload also carries salary_min/max, remote_level, experience_level and
 * education_level — fields most of the other adapters never see.
 */

const API = 'https://api.talentview.io/funnel/v2';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

/** The detail endpoint requires a Referer on the tenant's own host. */
function detailHeaders(slug: string) {
  return {
    ...HEADERS,
    referer: `https://${slug}.talentview.io/`,
    origin: `https://${slug}.talentview.io`,
  };
}

type CampaignDetail = {
  description?: string;
  profile?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  remote_level?: string;
  experience_level?: string;
};

function stripHtml(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|#39);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

type Website = { id?: number; locale?: string; website_type?: string };

type Campaign = {
  id?: number | string;
  slug?: string;
  name?: string;
  job_type?: string;
  last_activation_at?: string;
  address?: {
    city?: string;
    zip_code?: string;
    country?: string;
    formatted_address?: string;
  };
  entity?: { name?: string };
};

function toNormalized(campaign: Campaign, slug: string): NormalizedJob | null {
  if (!campaign.name) return null;

  const address = campaign.address;
  const posted = campaign.last_activation_at ? new Date(campaign.last_activation_at) : undefined;

  return {
    externalId: String(campaign.id ?? campaign.slug ?? campaign.name),
    title: campaign.name,
    location:
      [address?.city, address?.zip_code].filter(Boolean).join(', ') ??
      address?.formatted_address,
    country: address?.country,
    contract: campaign.job_type,
    url: `https://${slug}.talentview.io/jobs/${campaign.slug ?? campaign.id ?? ''}`,
    postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : undefined,
    raw: campaign,
  };
}

/**
 * Reads a whole TalentView board.
 * `config.slug` is the tenant slug, e.g. "t-a-o".
 */
export async function fetchTalentViewJobs(
  config: Record<string, unknown>,
): Promise<NormalizedJob[]> {
  const slug = String(config.slug ?? '');
  if (!slug) throw new Error('TalentView slug missing');

  // The campaigns endpoint needs a website id, and wildcard DNS means this call
  // is also what proves the tenant is real rather than a shell.
  const websites = await fetchJson<Website[]>(
    `${API}/companies/${encodeURIComponent(slug)}/websites?website_type=public`,
    { headers: HEADERS },
  );

  const websiteId = websites.find((site) => site.id)?.id;
  if (!websiteId) return [];

  const campaigns = await fetchJson<Campaign[]>(
    `${API}/companies/${encodeURIComponent(slug)}/campaigns?company_website_id=${websiteId}`,
    { headers: HEADERS },
  );

  const jobs = campaigns
    .map((campaign) => toNormalized(campaign, slug))
    .filter((job): job is NormalizedJob => job !== null);

  if (config.withDescriptions === false) return jobs;

  // The listing carries no text; /campaigns/{slug} does. Keyed by SLUG — the id
  // 404s — and the campaign slug lives on the raw listing entry.
  const limit = pLimit(Number(config.detailConcurrency ?? 6));
  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const campaignSlug = (job.raw as Campaign | undefined)?.slug;
        if (!campaignSlug) return job;
        try {
          const detail = await fetchJson<CampaignDetail>(
            `${API}/companies/${encodeURIComponent(slug)}/campaigns/${encodeURIComponent(campaignSlug)}`,
            { headers: detailHeaders(slug) },
          );
          const description = [stripHtml(detail.description), stripHtml(detail.profile)]
            .filter(Boolean)
            .join('\n\n');
          // The detail payload also carries salary, remote and experience —
          // fields the listing omits entirely.
          return {
            ...job,
            ...(description ? { description } : {}),
            salaryMin: detail.salary_min,
            salaryMax: detail.salary_max,
            salaryCurrency: detail.salary_currency,
            remote: detail.remote_level,
            raw: { ...(job.raw as object), detail },
          };
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
}

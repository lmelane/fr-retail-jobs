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
 * KNOWN LIMIT: no public description. /campaigns/{id} and /campaigns/{slug} both
 * 404, and the public job page is a 2KB SPA shell with no JSON-LD. So these rows
 * carry title, location and contract only, and the detail pane sends the
 * candidate to the employer's page. Low volume, so not worth a browser.
 */

const API = 'https://api.talentview.io/funnel/v2';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

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

  return jobs;
}

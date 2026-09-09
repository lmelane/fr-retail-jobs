import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

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
  // TalentView sends NUMERIC ids here, not text — "1" is EUR for the currency,
  // and remote_level is a code too. The DB columns are String, so an un-mapped
  // number crashed every write ("Expected String or Null, provided Int").
  salary_currency?: number | string;
  remote_level?: number | string;
  experience_level?: number | string;
};

/** TalentView currency IDs → ISO codes; unknown ids yield no currency. */
const TALENTVIEW_CURRENCIES: Record<string, string> = {
  '1': 'EUR',
};

/** TalentView remote-level IDs → a human label; unknown ids yield nothing. */
const TALENTVIEW_REMOTE: Record<string, string> = {
  '1': 'Sur site',
  '2': 'Télétravail partiel',
  '3': 'Télétravail',
};

function talentviewCurrency(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  // Already an ISO-ish code (letters): keep it. A numeric id: map it.
  if (typeof value === 'string' && /[a-z]/i.test(value)) return value;
  return TALENTVIEW_CURRENCIES[String(value)];
}

function talentviewRemote(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && /[a-z]/i.test(value)) return value;
  return TALENTVIEW_REMOTE[String(value)];
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
): Promise<AdapterResult> {
  const slug = String(config.slug ?? '');
  if (!slug) throw new Error('TalentView slug missing');

  // The campaigns endpoint needs a website id, and wildcard DNS means this call
  // is also what proves the tenant is real rather than a shell.
  const websites = await fetchJson<Website[]>(
    `${API}/companies/${encodeURIComponent(slug)}/websites?website_type=public`,
    { headers: HEADERS },
  );

  if (!Array.isArray(websites) || websites.length === 0 ||
      websites.some(site => !site || !Number.isSafeInteger(site.id) || site.id! <= 0)) {
    throw new Error(`TalentView "${slug}": invalid or missing public website inventory`);
  }
  const websiteIds = [...new Set(websites.map(site => site.id!))];
  if (websiteIds.length !== websites.length) throw new Error(`TalentView "${slug}": duplicate public website IDs`);
  const maxPages = Number(config.maxPages ?? 500);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 500) {
    throw new Error('TalentView maxPages must be an integer between 1 and 500');
  }

  // The official client starts offset_start at 1, increments by ONE (page,
  // not row offset), and keeps scrolling while ten campaigns are returned.
  // Without pagination this adapter silently stopped at the first ten jobs.
  // Every public website is enumerated; a website locale is not a country filter.
  const jobs: NormalizedJob[] = [];
  const globalIds = new Set<string>();
  let truncated = false;
  let complete = true;
  for (const websiteId of websiteIds) {
    const websiteIdsSeen = new Set<string>();
    let terminal = false;
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(`${API}/companies/${encodeURIComponent(slug)}/campaigns`);
      url.searchParams.set('company_website_id', String(websiteId));
      url.searchParams.set('display_mode', 'list');
      url.searchParams.set('offset_start', String(page));
      const campaigns = await fetchJson<Campaign[]>(url.toString(), { headers: HEADERS });
      if (!Array.isArray(campaigns)) throw new Error(`TalentView "${slug}": malformed campaigns page ${page}`);
      let fresh = 0;
      for (const campaign of campaigns) {
        if (!campaign || typeof campaign.name !== 'string' || !campaign.name.trim() ||
            typeof campaign.slug !== 'string' || !campaign.slug.trim() ||
            (campaign.id != null && !(typeof campaign.id === 'number' && Number.isSafeInteger(campaign.id) && campaign.id > 0 || typeof campaign.id === 'string' && campaign.id.trim().length > 0))) {
          throw new Error(`TalentView "${slug}": invalid campaign on page ${page}`);
        }
        const job = toNormalized(campaign, slug)!;
        if (websiteIdsSeen.has(job.externalId)) { truncated = true; continue; }
        websiteIdsSeen.add(job.externalId);
        fresh++;
        // The same campaign can appear on several public locale websites.
        if (!globalIds.has(job.externalId)) {
          globalIds.add(job.externalId);
          jobs.push(job);
        }
      }
      if (campaigns.length < 10) { terminal = true; break; }
      if (fresh === 0) { truncated = true; break; }
    }
    if (!terminal) { complete = false; truncated = true; }
  }
  const result = { jobs, truncated, complete: complete && !truncated };
  if (config.withDescriptions === false) return result;

  // The listing carries no text; /campaigns/{slug} does. Keyed by SLUG — the id
  // 404s — and the campaign slug lives on the raw listing entry.
  const limit = pLimit(Number(config.detailConcurrency ?? 4));
  const withDetails = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const campaignSlug = (job.raw as Campaign | undefined)?.slug;
        if (!campaignSlug) return job;
        try {
          const detail = await fetchJson<CampaignDetail>(
            `${API}/companies/${encodeURIComponent(slug)}/campaigns/${encodeURIComponent(campaignSlug)}`,
            { headers: detailHeaders(slug) },
          );
          const description = [htmlToPlainText(detail.description), htmlToPlainText(detail.profile)]
            .filter(Boolean)
            .join('\n\n');
          // The detail payload also carries salary, remote and experience —
          // fields the listing omits entirely.
          return {
            ...job,
            ...(description ? { description } : {}),
            salaryMin: detail.salary_min,
            salaryMax: detail.salary_max,
            salaryCurrency: talentviewCurrency(detail.salary_currency),
            remote: talentviewRemote(detail.remote_level),
            raw: { ...(job.raw as object), detail },
          };
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
  return { ...result, jobs: withDetails };
}

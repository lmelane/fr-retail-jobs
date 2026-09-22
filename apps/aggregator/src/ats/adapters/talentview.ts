import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';
import { captureObservedAt } from '../../capture/context.js';

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
  CRAWLER_IDENTITY;

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
  id?: number | string;
  slug?: string;
  is_draft?: boolean;
  is_online?: boolean;
  description?: string;
  profile?: string;
};

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

export function parseTalentViewCampaign(campaign: Campaign, slug: string): NormalizedJob | null {
  if (!campaign.name) return null;

  const address = campaign.address;
  const posted = campaign.last_activation_at ? new Date(campaign.last_activation_at) : undefined;

  return {
    externalId: String(campaign.id ?? campaign.slug ?? campaign.name),
    title: campaign.name,
    // An entity may name a business unit (e.g. Promod - magasin), not a
    // separate company. Preserve its claim for the reviewed alias resolver;
    // do not create a new employer from this label on its own.
    employerEvidence: campaign.entity?.name?.trim()
      ? { rawName: campaign.entity.name, path: 'entity.name', rule: 'ENTITY_LABEL_REQUIRES_IDENTITY_RESOLUTION' }
      : undefined,
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
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  let truncated = false;
  let complete = true;
  let rawCount = 0;
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
      rawCount += campaigns.length;
      let fresh = 0;
      const pageIds: string[] = [];
      for (const campaign of campaigns) {
        if (!campaign || typeof campaign.name !== 'string' || !campaign.name.trim() ||
            typeof campaign.slug !== 'string' || !campaign.slug.trim() ||
            (campaign.id != null && !(typeof campaign.id === 'number' && Number.isSafeInteger(campaign.id) && campaign.id > 0 || typeof campaign.id === 'string' && campaign.id.trim().length > 0))) {
          throw new Error(`TalentView "${slug}": invalid campaign on page ${page}`);
        }
        const job = parseTalentViewCampaign(campaign, slug)!;
        /**
         * L'identifiant CANONIQUE : `campaign.id`, et `campaign.slug` quand l'API n'en sert pas — exactement
         * le chemin de `parseTalentViewCampaign`, donc de `NormalizedJob.externalId`. Les deux sont NATIFS et
         * servis par la source ; aucun n'est dérivé de l'URL ni du titre.
         *
         * Il entre dans la preuve de SA page avant toute déduplication : une campagne servie par deux sites
         * locale a bien été vue sur chacun, et retirer l'identifiant de la seconde page la rendrait muette.
         * `campaign.name` ne peut pas servir de repli ici — toute campagne sans `slug` fait échouer la page
         * au-dessus, donc ce cas n'atteint jamais ce point.
         */
        if (!pageIds.includes(job.externalId)) pageIds.push(job.externalId);
        if (websiteIdsSeen.has(job.externalId)) { truncated = true; continue; }
        websiteIdsSeen.add(job.externalId);
        fresh++;
        // The same campaign can appear on several public locale websites.
        if (!globalIds.has(job.externalId)) {
          globalIds.add(job.externalId);
          jobs.push(job);
        }
      }
      pageEvidence.push({ url: url.toString(), checkedAt: captureObservedAt().toISOString(),
        sha256: createHash('sha256').update(JSON.stringify(campaigns)).digest('hex'),
        offset: (page - 1) * 10, pagination: null,
        ids: pageIds, canonicalIds: pageIds, publisherCounter: '',
        componentCounters: [`website=${websiteId}`, `rows=${campaigns.length}`] });
      if (campaigns.length < 10) { terminal = true; break; }
      if (fresh === 0) { truncated = true; break; }
    }
    if (!terminal) { complete = false; truncated = true; }
  }
  /**
   * LE CONTRAT DES IDENTIFIANTS CANONIQUES. Toute campagne servie porte un identifiant exploitable — une
   * campagne sans `slug` ni `name` fait ÉCHOUER la page entière plutôt que d'être ignorée, donc il n'existe
   * ici ni ligne anonyme ni ligne rejetée : ce que la preuve nomme est exactement ce qui a été servi.
   */
  const enumeration: AdapterResult['enumeration'] = {
    method: 'PUBLIC_WEBSITE_CAMPAIGN_PAGINATION',
    endpoint: `${API}/companies/${encodeURIComponent(slug)}/campaigns`,
    pages: pageEvidence.length, rawCount,
    termination: complete && !truncated ? 'SHORT_PAGE_PER_WEBSITE' : 'INCOMPLETE_TRAVERSAL',
    canonicalAbsenceProofUsable: true, pageEvidence,
  };
  const result = { jobs, truncated, complete: complete && !truncated, enumeration };
  if (config.withDescriptions === false) return result;

  // The listing carries no text; /campaigns/{slug} does. Keyed by SLUG — the id
  // 404s — and the campaign slug lives on the raw listing entry.
  const limit = pLimit(Number(config.detailConcurrency ?? 4));
  const withDetails = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const campaignSlug = (job.raw as Campaign | undefined)?.slug;
        if (!campaignSlug) return job;
        let detail: CampaignDetail;
        try {
          detail = await fetchJson<CampaignDetail>(
            `${API}/companies/${encodeURIComponent(slug)}/campaigns/${encodeURIComponent(campaignSlug)}`,
            { headers: detailHeaders(slug) },
          );
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
        return mergeTalentViewDetail(job, detail);
      }),
    ),
  );
  return { ...result, jobs: withDetails };
}

/** The detail body is kept in RAW as well as the readable presentation. */
export function mergeTalentViewDetail(job: NormalizedJob, detail: CampaignDetail): NormalizedJob {
  const campaign = job.raw as Campaign;
  if (detail.id == null || String(detail.id) !== job.externalId || !campaign?.slug || detail.slug !== campaign.slug) throw new Error('TALENTVIEW_DETAIL_IDENTITY_MISMATCH');
  const description = [htmlToPlainText(detail.description), htmlToPlainText(detail.profile)]
    .filter(Boolean)
    .join('\n\n');
  // Source-specific facts are read from the retained detail at the shared write boundary.
  return {
    ...job,
    ...(description ? { description } : {}),
    ...(detail.is_draft !== false || detail.is_online !== true ? { publicationHold: 'SOURCE_PUBLICATION_NOT_CONFIRMED' } : {}),
    raw: { ...(job.raw as object), detail },
  };
}

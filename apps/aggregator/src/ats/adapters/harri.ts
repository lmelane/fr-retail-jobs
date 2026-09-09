import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchJson, fetchText, DEFAULT_DETAIL_CONCURRENCY } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { assertSourceRunning } from '../../lib/sourceBudget.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

const API = 'https://gateway.harri.com';
const SEARCH = `${API}/core/api/v1/harri_search/search_jobs`;
const date = (value: unknown) => {
  if (typeof value !== 'string' || !value) return undefined;
  const result = new Date(value); return Number.isFinite(result.getTime()) ? result : undefined;
};
type Location = { city?: string; state?: string; country?: string; country_code?: string; formatted_address?: string; latitude?: number; longitude?: number };
type Listing = { id: number; brand?: { id?: number; name?: string; slug?: string }; position?: { name?: string }; aliasPosition?: string; locations?: Location[]; publishTime?: string };
type Detail = { id: number; alias_position?: string; title?: string; description?: string; publish_date?: string; end_date?: string;
  status?: string; deleted?: boolean; access_mode?: string; post_type?: string; experience_from?: number; language?: string;
  Position?: { name?: string; position_type?: { name?: string } }; Timing?: Array<{ name?: string; code?: string }>;
  JobLocation?: Array<{ Location?: { city?: { name?: string }; country?: { name?: string }; state?: { name?: string }; postal_code?: string; formatted_address?: string; latitude?: number; longitude?: number } }>;
};
type Profile = { id: number; name: string; slug: string; url?: string; active_jobs_count?: number };

/** Public Harri career portal protocol observed on the vendor's own client.
 * No geographic filter: the configured portal's whole hierarchy is enumerated.
 * The listing count and IDs establish coverage; failures retain listing evidence. */
export async function fetchHarriJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const portal = new URL(String(config.portalUrl ?? `https://harri.com/${config.slug ?? ''}`));
  const slug = portal.pathname.split('/').filter(Boolean)[0];
  if (!['harri.com', 'www.harri.com'].includes(portal.hostname) || portal.protocol !== 'https:' || portal.username || portal.password || !slug || !/^[a-z0-9_-]+$/i.test(slug)) throw new Error('HARRI_INVALID_PORTAL');
  if (config.slug !== undefined && String(config.slug).toLowerCase() !== slug.toLowerCase()) throw new Error('HARRI_PORTAL_SLUG_CONFLICT');
  let brandId = Number(config.brandId);
  if (config.brandId !== undefined && (!Number.isSafeInteger(brandId) || brandId <= 0)) throw new Error('HARRI_INVALID_BRAND_ID');
  let portalEvidence: { url: string; sha256: string } | undefined;
  if (!Number.isSafeInteger(brandId) || brandId <= 0) {
    const url = `https://harri.com/${slug}`;
    const html = await fetchText(url), $ = cheerio.load(html);
    // An image ID is only a discovery candidate. The native profile below must
    // independently confirm its exact portal slug before any job request.
    const image = $('meta[property="og:image"]').attr('content');
    const candidate = image?.match(/^https:\/\/media-cdn\.harri\.com\/brands\/(\d+)\//)?.[1];
    if (!candidate) throw new Error('HARRI_PORTAL_ID_UNRESOLVED: native brand profile needs qualification');
    brandId = Number(candidate);
    portalEvidence = { url, sha256: createHash('sha256').update(html).digest('hex') };
  }
  const profileUrl = `${API}/core/api/v2/career_portal/brands/${brandId}/basic_info`;
  const response = await fetchJson<{ status?: string; data?: Profile }>(profileUrl);
  const profile = response.data;
  if (response.status !== 'SUCCESS' || profile?.id !== brandId || profile.slug?.toLowerCase() !== slug.toLowerCase() || !profile.name) throw new Error('HARRI_PORTAL_IDENTITY_MISMATCH');
  const mode = config.employerMode ?? 'POSTING_BRAND';
  if (!['POSTING_BRAND', 'PORTAL_OWNER'].includes(String(mode))) throw new Error('HARRI_INVALID_EMPLOYER_MODE');
  const maxPages = Number(config.maxPages ?? 10_000);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100_000) throw new Error('HARRI_INVALID_PAGE_BUDGET');
  const listings = new Map<number, Listing>();
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const issues: string[] = [];
  let total: number | undefined, rawCount = 0, start = 0, terminated = false;
  for (let page = 0; page < maxPages; page++) {
    assertSourceRunning();
    const body = { size: 30, start, source: 'web', brand_level_ids: [brandId], sort: ['publish_date'], sort_type: 'desc', flow: 'CAREER_PORTAL' };
    const data = await fetchJson<{ status?: string; data?: { hits?: number; results?: Listing[] } }>(SEARCH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = data.data;
    if (data.status !== 'SUCCESS' || !Number.isSafeInteger(result?.hits) || result!.hits! < 0 || !Array.isArray(result?.results)) throw new Error('HARRI_INVALID_LISTING_RESPONSE');
    const rows = result.results;
    const expected = result.hits!;
    if (total !== undefined && total !== expected) issues.push('DECLARED_TOTAL_CHANGED');
    total ??= expected;
    rawCount += rows.length;
    const ids: string[] = [];
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || !(row.aliasPosition || row.position?.name) || !row.brand?.slug || !row.brand?.name) {
        rejectedRows.push({ reason: 'MISSING_POSTING_ID_TITLE_OR_EMPLOYER', raw: row }); continue;
      }
      ids.push(String(row.id));
      if (listings.has(row.id)) issues.push(`REPEATED_POSTING_ID:${row.id}`);
      else listings.set(row.id, row);
    }
    pageEvidence.push({ url: SEARCH, checkedAt: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'), offset: start,
      pagination: { start: start + 1, end: start + rows.length, total: expected }, ids,
      publisherCounter: String(expected), componentCounters: [JSON.stringify(body)] });
    if (issues.length || rejectedRows.length) break;
    if (listings.size === total) { terminated = true; break; }
    if (!rows.length || listings.size > total!) { issues.push('COUNT_OR_TERMINATION_MISMATCH'); break; }
    start += rows.length;
  }
  if (!terminated && !issues.length && !rejectedRows.length) issues.push('PAGE_BUDGET_EXHAUSTED');
  const limit = pLimit(DEFAULT_DETAIL_CONCURRENCY);
  const jobs = await Promise.all([...listings.values()].map(listing => limit(async (): Promise<NormalizedJob> => {
    const detailUrl = `${API}/core-reader/api/v1/profile/job/${listing.id}`;
    let detail: Detail | undefined, detailReadError: string | undefined;
    const observedAt = new Date();
    try {
      const result = await fetchJson<{ data?: { job?: Detail } }>(detailUrl);
      if (result.data?.job?.id !== listing.id) throw new Error('HARRI_DETAIL_ID_MISMATCH');
      const native = result.data.job;
      // Only public posting fields: application workflow/assignee data is not
      // needed for job evidence and is never persisted by this adapter.
      const fields: Array<keyof Detail> = ['id','alias_position','title','description','publish_date','end_date','status','deleted','access_mode','post_type','experience_from','language','Position','Timing','JobLocation'];
      detail = Object.fromEntries(fields.filter(k => native[k] !== undefined).map(k => [k, native[k]])) as Detail;
    } catch (error) { assertSourceRunning(); detailReadError = String(error).slice(0,500); issues.push(`DETAIL_READ_FAILED:${listing.id}`); }
    const primary = detail?.JobLocation?.[0]?.Location, location = listing.locations?.[0];
    const employer = mode === 'PORTAL_OWNER' ? profile.name : listing.brand!.name!;
    const unlisted = detail && (detail.access_mode === 'PRIVATE' || detail.post_type === 'PRIVATE' || detail.deleted === true || detail.status === 'UNPUBLISHED');
    const closed = detail && ['CLOSED','EXPIRED'].includes(detail.status ?? '');
    const unresolvedState = detail && !unlisted && !closed && detail.status !== 'PUBLISHED';
    if (unresolvedState) issues.push(`UNRECOGNISED_PUBLICATION_STATE:${listing.id}`);
    const publicationHold = unlisted ? 'SOURCE_UNLISTED' : closed ? 'APPLICATION_EXPLICITLY_CLOSED' : unresolvedState ? 'UNRECOGNISED_PUBLICATION_STATE' : undefined;
    return { externalId: String(listing.id), title: detail?.alias_position || detail?.title || listing.aliasPosition || listing.position!.name!,
      company: employer, employerEvidence: { rawName: employer, path: mode === 'PORTAL_OWNER' ? 'portal.name' : 'listing.brand.name', rule: mode === 'PORTAL_OWNER' ? 'REVIEWED_PORTAL_OWNER_SCOPE' : 'NATIVE_POSTING_BRAND' },
      location: primary?.formatted_address ?? location?.formatted_address, city: primary?.city?.name ?? location?.city,
      region: primary?.state?.name ?? location?.state, country: primary?.country?.name ?? location?.country,
      postalCode: primary?.postal_code, latitude: primary?.latitude ?? location?.latitude, longitude: primary?.longitude ?? location?.longitude,
      workingTime: detail?.Timing?.map(t => t.name ?? t.code).filter(Boolean).join(' / ') || undefined,
      department: detail?.Position?.position_type?.name, experienceYears: detail?.experience_from,
      description: detail?.description ? htmlToPlainText(detail.description) : undefined, language: detail?.language || undefined,
      postedAt: date(detail?.publish_date) ?? date(listing.publishTime), validThrough: date(detail?.end_date),
      url: `https://harri.com/${encodeURIComponent(listing.brand!.slug!)}/job/${listing.id}`,
      ...(publicationHold ? { publicationHold, ...(!unresolvedState ? { publicationWithdrawnAt: observedAt } : {}) } : {}),
      raw: { listing, detail, detailReadError, detailUrl, portal: { id: profile.id, name: profile.name, slug: profile.slug, url: profile.url }, portalEvidence },
    };
  })));
  return { jobs, declaredTotal: total, complete: terminated && issues.length === 0 && rejectedRows.length === 0, rejectedRows,
    enumeration: { method: 'NATIVE_OFFSET_AND_UNIQUE_IDS', endpoint: SEARCH, pages: pageEvidence.length, rawCount,
      termination: terminated ? 'DECLARED_TOTAL_REACHED' : 'INCOMPLETE', issues, pageEvidence } };
}

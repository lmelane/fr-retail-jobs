import { parse } from 'tldts';
import { ashbyBoard, greenhouseBoard, leverSite, listingPortal, originPortal, personioHost, recruiteeSubdomain, smartrecruitersCompany, talentviewSlug, teamtailorOrigin, workableAccount, workdayPortal } from '../ats/portalConfig.js';
import { isPublicHttpUrl } from '../lib/ssrf.js';
import { ATS_HOST_SUFFIXES } from '../normalize/companyDomain.js';

const locale = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const segment = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
/**
 * Registrable domains shared by many tenants of a recruiting vendor: never an employer's official domain. The list is
 * shared with the catalogue's employer-domain resolver (`ATS_HOST_SUFFIXES`, one list) and closed, therefore incomplete
 * by nature; `sourcePortal.test.ts` checks every vendor host a contract can build against it, and the campaign never
 * derives an official domain at all (`vendorHosted` is consulted before suggesting one to the registry; lot F3b audit).
 */
const vendors = new Set([...ATS_HOST_SUFFIXES, 'workday.com', 'jobaffinity.fr', 'candidater.fr', 'talentsoft.com', 'jibeapply.com',
  'softgarden.io', 'softgarden.de', 'join.com', 'homerun.co', 'radancy.com', 'harri.com']);
/** Is this host served by a recruiting vendor, by its registrable domain? */
export function vendorHost(hostname: string): boolean {
  return vendors.has(parse(hostname, { allowPrivateDomains: true }).domain ?? '');
}

export function reviewedOfficialDomain(value: string): string {
  if (typeof value !== 'string' || value !== value.toLowerCase() ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value) ||
    parse(value, { allowPrivateDomains: true }).domain !== value || vendors.has(value)) {
    throw new Error('A reviewed registrable employer domain is required');
  }
  return value;
}

export function belongsToOfficialDomain(url: string, domain: string): boolean {
  const u = publicHttps(url);
  return !!u && (u.hostname === domain || u.hostname.endsWith(`.${domain}`));
}

function publicHttps(value: string): URL | null {
  if (!isPublicHttpUrl(value)) return null;
  const url = new URL(value);
  return url.protocol === 'https:' && !url.port ? url : null;
}

/**
 * Native Teamtailor listing filters (`/jobs?query=…&split_view=true&geobound_coordinates[ne_lat]=…`,
 * `department_id`, `location_id`, `remote`). Observed on the link provided for Oh My Cream (2026-09-16): a map
 * view of the SAME tenant's listing. They select a subset within the configured site, never another tenant,
 * and a matching reference never attests the subset's completeness (`coverageAttested: false`).
 */
const teamtailorListingFilter = /^(?:query|split_view|remote|department_id|location_id|role_id|region_id|geobound_coordinates\[[a-z_]+\])$/;

/** Unknown query semantics are not discarded when establishing an exact board. */
function referenceUrl(value: string, kind: string): URL | null {
  const url = publicHttps(value);
  if (!url || url.hash || [...url.searchParams.entries()].some(([key, value]) => {
    if (['lang', 'locale', 'source', 'ref'].includes(key) || /^utm_[a-z_]+$/.test(key)) return false;
    // These native Workday facets are observed on the archived LS&Co. official
    // page. They select a subset within the named site, never another tenant.
    // A matching reference does not attest the selected subset's completeness.
    if (kind === 'workday' && ['jobFamily', 'locations'].includes(key) && /^[a-f0-9]{32}$/i.test(value)) return false;
    if (kind === 'teamtailor' && teamtailorListingFilter.test(key)) return false;
    // Greenhouse names the board in `for` (embed) and its referrer in `gh_src`; Lever tags its origin.
    if (kind === 'greenhouse' && ['for', 'gh_src'].includes(key)) return false;
    if (kind === 'lever' && ['lever-origin', 'lever-source'].includes(key)) return false;
    return true;
  })) return null;
  return url;
}

export type PortalContract = {
  url: string;
  /** The configured portal itself: its listing (or its embed loader). */
  matches: (url: string) => boolean;
  /** One of the portal's OWN postings: the URL carries the same tenant identity (lot F3b), never its listing. */
  matchesPosting: (url: string) => boolean;
  /** The portal host is a recruiting vendor's (shared by its tenants): it can never stand for the employer's official domain. */
  vendorHosted: boolean;
};
type PathPredicate = (path: string, candidate: URL) => boolean;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const never: PathPredicate = () => false;

/** This inspects the tenant/site identity only. It certifies neither the
 * employer owning the declared official domain nor the feed's completeness.
 * An official page that lists the board's own postings designates that board
 * (`matchesPosting`); coverage is never attested by either reference. */
export function configuredPortal(kind: string, config: Record<string, unknown>): PortalContract | null {
  let url: URL; let paths: PathPredicate; let postings: PathPredicate = never; let hosts: Set<string> | undefined;
  if (kind === 'ashby') {
    const board = ashbyBoard(config); if (!segment.test(board)) return null;
    url = new URL(`https://jobs.ashbyhq.com/${board}`);
    paths = path => path === `/${board}` || path === `/${board}/`;
    postings = path => new RegExp(`^/${escape(board)}/${UUID}/?$`, 'i').test(path);
  } else if (kind === 'recruitee') {
    const subdomain = recruiteeSubdomain(config);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain)) return null;
    url = new URL(`https://${subdomain}.recruitee.com/`);
    paths = path => path === '/' || /^\/l\/[a-z]{2,3}\/?$/.test(path);
    postings = path => /^\/o\/[a-z0-9-]+\/?$/i.test(path);
  } else if (kind === 'teamtailor') {
    // The exact HTTPS origin of the career site is the tenant identity (`teamtailor:<host>`): a custom domain
    // such as careers.ohmycream.com or a vendor host. Another host, an http:// redirection source, a www alias
    // or a job page never designates the configured site; the listing is `/` or `/jobs`, with native filters.
    const base = publicHttps(teamtailorOrigin(config));
    if (!base || base.pathname !== '/' || base.search || base.hash || base.username || base.password) return null;
    url = base;
    paths = path => path === '/' || path === '/jobs' || path === '/jobs/';
    postings = path => /^\/jobs\/\d+(?:-[^/]*)?\/?$/.test(path);
  } else if (kind === 'greenhouse') {
    // Vendor-hosted boards: `boards.greenhouse.io/<board>`, the newer `job-boards.*` host and their EU variants;
    // the embed form and the embed loader script name the same board in `for`. A posting is `/<board>/jobs/<id>`.
    const board = greenhouseBoard(config).toLowerCase(); if (!/^[a-z0-9]+$/.test(board)) return null;
    url = new URL(`https://boards.greenhouse.io/${board}`);
    hosts = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards.eu.greenhouse.io', 'job-boards.eu.greenhouse.io']);
    paths = (path, candidate) => /^\/embed\/job_board(?:\/js)?\/?$/.test(path) ? candidate.searchParams.get('for')?.toLowerCase() === board
      : path.replace(/\/$/, '').toLowerCase() === `/${board}` && !candidate.searchParams.has('for');
    postings = path => new RegExp(`^/${escape(board)}/jobs/\\d+/?$`, 'i').test(path);
  } else if (kind === 'smartrecruiters-whitelabel' || kind === 'smartrecruiters') {
    // `careers.smartrecruiters.com/<Company>` and `jobs.smartrecruiters.com/<Company>`; identifiers are case-insensitive there.
    const company = smartrecruitersCompany(config); if (!segment.test(company)) return null;
    url = new URL(`https://careers.smartrecruiters.com/${company}`);
    hosts = new Set(['careers.smartrecruiters.com', 'jobs.smartrecruiters.com']);
    paths = path => path.replace(/\/$/, '').toLowerCase() === `/${company.toLowerCase()}`;
    postings = path => new RegExp(`^/${escape(company)}/\\d+(?:-[^/]*)?/?$`, 'i').test(path);
  } else if (kind === 'lever') {
    const { site, region } = leverSite(config); if (!/^[a-z0-9.-]+$/i.test(site)) return null;
    url = new URL(`https://jobs.${region === 'eu' ? 'eu.' : ''}lever.co/${site}`);
    paths = path => path.replace(/\/$/, '') === `/${site}`;
    postings = path => new RegExp(`^/${escape(site)}/${UUID}/?$`, 'i').test(path);
  } else if (kind === 'personio') {
    const host = personioHost(config); if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)) return null;
    url = new URL(`https://${host.toLowerCase()}/`);
    paths = path => path === '/' || /^\/(?:job|jobs|search)\/?$/.test(path);
    postings = path => /^\/job\/\d+\/?$/.test(path);
  } else if (kind === 'workable') {
    const account = workableAccount(config); if (!segment.test(account)) return null;
    url = new URL(`https://apply.workable.com/${account}/`);
    hosts = new Set(['apply.workable.com', `${account.toLowerCase()}.workable.com`]);
    paths = (path, candidate) => candidate.hostname === 'apply.workable.com' ? path.replace(/\/$/, '').toLowerCase() === `/${account.toLowerCase()}` : path.replace(/\/$/, '') === '';
    postings = (path, candidate) => candidate.hostname === 'apply.workable.com' ? new RegExp(`^/${escape(account)}/j/[A-Za-z0-9]+/?$`, 'i').test(path) : /^\/jobs\/\d+\/?$/.test(path);
  } else if (['successfactors', 'phenom', 'jibe', 'talentsoft', 'digitalrecruiters'].includes(kind)) {
    // Career sites served on their own origin: a custom domain under the Maison's domain or a vendor host. The origin
    // is the tenant, so any deeper page of that site is one of its own pages.
    const base = publicHttps(originPortal(config, kind));
    if (!base || base.pathname !== '/' || base.search || base.hash || base.username || base.password) return null;
    url = base;
    const locale = /^\/[a-z]{2}(?:[-_][A-Za-z]{2})?\/?$/;
    paths = path => path === '/' || locale.test(path) || /^\/(?:search|jobs|careers|annonces|accueil\.aspx|content\/[a-z]+)\/?$/i.test(path) ||
      /^\/[a-z]{2}(?:[-_][A-Za-z]{2})?\/(?:search|jobs|careers|annonces|search-results)\/?$/i.test(path);
    postings = path => path !== '/' && !paths(path, url);
  } else if (kind === 'flatchr') {
    const listing = publicHttps(listingPortal(config)); if (!listing || !/\.flatchr\.io$/.test(listing.hostname) || listing.search || listing.hash) return null;
    url = listing;
    paths = path => path.replace(/\/$/, '') === listing.pathname.replace(/\/$/, '');
    postings = path => path.startsWith(`${listing.pathname.replace(/\/$/, '')}/`) && path.length > listing.pathname.length + 1;
  } else if (kind === 'talentview') {
    const slug = talentviewSlug(config); if (!/^[a-z0-9-]+$/i.test(slug)) return null;
    url = new URL(`https://${slug.toLowerCase()}.talentview.io/`);
    paths = path => path === '/';
    postings = path => path !== '/';
  } else if (kind === 'generic-listing' || kind === 'generic-jsonld') {
    // The configured listing page itself, with its own pagination keys (`{page}` template) tolerated; a sitemap names
    // the whole site, whose root page stands for the source. Deeper pages and other paths are never the listing.
    const configured = listingPortal(config);
    const template = publicHttps(configured.replace(/\{page\}/g, '1'));
    if (!template || template.username || template.password || template.hash) return null;
    const templateKeys = new Set(template.searchParams.keys());
    const listingPath = typeof config.sitemapUrl === 'string' && typeof config.listingUrl !== 'string' && typeof config.startUrl !== 'string' ? '/' : template.pathname;
    const base = new URL(listingPath, template.origin);
    return { url: base.toString(), vendorHosted: vendorHost(base.hostname), matchesPosting: () => false, matches: value => {
      let candidate: URL; try { candidate = new URL(value); } catch { return false; }
      for (const key of templateKeys) candidate.searchParams.delete(key);
      const reference = referenceUrl(candidate.toString(), kind);
      return !!reference && reference.origin === base.origin && reference.pathname.replace(/\/$/, '') === listingPath.replace(/\/$/, '');
    } };
  } else if (kind === 'lvmh_algolia') {
    url = new URL('https://www.lvmh.com/');
    paths = path => path === '/' || /^\/(?:[a-z]{2}\/)?(?:join-us|rejoignez-nous)(?:\/our-job-offers|\/nos-offres-d-emploi)?\/?$/i.test(path);
    postings = path => /^\/(?:[a-z]{2}\/)?(?:join-us|rejoignez-nous)\/(?:our-job-offers|nos-offres-d-emploi)\/[^/]+\/?$/i.test(path);
  } else if (kind === 'workday') {
    const { tenant, site, origin } = workdayPortal(config);
    const base = publicHttps(origin);
    if (!segment.test(tenant) || !segment.test(site) || !base || base.pathname !== '/' || base.search || base.hash ||
      !/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.test(base.hostname) ||
      base.hostname.split('.')[0] !== tenant.toLowerCase()) return null;
    url = new URL(`/${site}`, base);
    const segments = (path: string) => { const parts = path.replace(/\/$/, '').split('/').slice(1); return locale.test(parts[0] ?? '') ? parts.slice(1) : parts; };
    paths = path => { const parts = segments(path); return parts.length === 1 && parts[0] === site; };
    postings = path => { const parts = segments(path); return parts.length >= 3 && parts[0] === site && parts[1] === 'job'; };
  } else return null;
  const sameSite = (candidate: URL) => hosts ? hosts.has(candidate.hostname) : candidate.origin === url.origin;
  return { url: url.toString(), vendorHosted: !!hosts || vendorHost(url.hostname),
    matches: value => { const candidate = referenceUrl(value, kind); return !!candidate && sameSite(candidate) && paths(candidate.pathname, candidate); },
    matchesPosting: value => { const candidate = referenceUrl(value, kind); return !!candidate && sameSite(candidate) && postings(candidate.pathname, candidate); } };
}

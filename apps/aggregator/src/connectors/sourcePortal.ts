import { parse } from 'tldts';
import { ashbyBoard, recruiteeSubdomain, workdayPortal } from '../ats/portalConfig.js';
import { isPublicHttpUrl } from '../lib/ssrf.js';

const locale = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const segment = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
const vendors = new Set(['ashbyhq.com', 'myworkdayjobs.com', 'recruitee.com', 'jobaffinity.fr', 'candidater.fr',
  'flatchr.io', 'werecruit.io', 'greenhouse.io', 'lever.co', 'smartrecruiters.com', 'teamtailor.com',
  'oraclecloud.com', 'personio.de', 'personio.com', 'workable.com', 'welcometothejungle.com']);

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

/** Unknown query semantics are not discarded when establishing an exact board. */
function referenceUrl(value: string, kind: string): URL | null {
  const url = publicHttps(value);
  if (!url || url.hash || [...url.searchParams.entries()].some(([key, value]) => {
    if (['lang', 'locale', 'source', 'ref'].includes(key) || /^utm_[a-z_]+$/.test(key)) return false;
    // These native Workday facets are observed on the archived LS&Co. official
    // page. They select a subset within the named site, never another tenant.
    // A matching reference does not attest the selected subset's completeness.
    return !(kind === 'workday' && ['jobFamily', 'locations'].includes(key) && /^[a-f0-9]{32}$/i.test(value));
  })) return null;
  return url;
}

/** This inspects the tenant/site identity only. It certifies neither the
 * employer owning the declared official domain nor the feed's completeness. */
export function configuredPortal(kind: string, config: Record<string, unknown>): {
  url: string; matches: (url: string) => boolean;
} | null {
  let url: URL; let paths: (path: string) => boolean;
  if (kind === 'ashby') {
    const board = ashbyBoard(config); if (!segment.test(board)) return null;
    url = new URL(`https://jobs.ashbyhq.com/${board}`);
    paths = path => path === `/${board}` || path === `/${board}/`;
  } else if (kind === 'recruitee') {
    const subdomain = recruiteeSubdomain(config);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain)) return null;
    url = new URL(`https://${subdomain}.recruitee.com/`);
    paths = path => path === '/' || /^\/l\/[a-z]{2,3}\/?$/.test(path);
  } else if (kind === 'workday') {
    const { tenant, site, origin } = workdayPortal(config);
    const base = publicHttps(origin);
    if (!segment.test(tenant) || !segment.test(site) || !base || base.pathname !== '/' || base.search || base.hash ||
      !/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.test(base.hostname) ||
      base.hostname.split('.')[0] !== tenant.toLowerCase()) return null;
    url = new URL(`/${site}`, base);
    paths = path => {
      const parts = path.replace(/\/$/, '').split('/').slice(1);
      return parts.length === 1 && parts[0] === site || parts.length === 2 && locale.test(parts[0]) && parts[1] === site;
    };
  } else return null;
  return { url: url.toString(), matches: value => {
    const candidate = referenceUrl(value, kind);
    return !!candidate && candidate.origin === url.origin && paths(candidate.pathname);
  } };
}

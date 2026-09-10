/**
 * The three checks a source candidate passes before promotion, shared by the validation tool and the retrospective
 * controls: (1) the host + first path the ADAPTER really requests, per kind; (2) an EXPLICIT robots.txt verdict
 * (RFC 9309 §2.3.1 — the HTTP status decides the branch, nothing is assumed); (3) the classification of every native
 * employer label the board publishes against the catalogued Maison (the perimeter evidence a SINGLE_BRAND
 * certification must be consistent with).
 */
import { createHash } from 'node:crypto';
import { robotsVerdictFor } from './robotsVerdict.js';
import { resolveCompany, stripLegalSuffix } from '../normalize/company.js';
import { normalizedEmployerName } from '../normalize/employerName.js';

/** Host + first path the adapter requests, per kind — only what the adapters actually call. */
export function requestTarget(kind: string, config: Record<string, unknown>): { origin: string; path: string } {
  const str = (k: string) => (typeof config[k] === 'string' ? String(config[k]) : '');
  switch (kind) {
    case 'lever': return { origin: str('region') === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co', path: `/v0/postings/${str('site')}` };
    case 'greenhouse': return { origin: 'https://boards-api.greenhouse.io', path: `/v1/boards/${str('board')}/jobs` };
    case 'smartrecruiters': case 'smartrecruiters-whitelabel': return { origin: 'https://api.smartrecruiters.com', path: `/v1/companies/${str('company')}/postings` };
    case 'workday': return { origin: str('origin'), path: `/wday/cxs/${str('tenant')}/${str('site')}/jobs` };
    case 'teamtailor': { const u = new URL(str('jobs_url') || str('origin') || `https://${str('subdomain')}.teamtailor.com/jobs`); return { origin: u.origin, path: u.pathname || '/jobs' }; }
    case 'digitalrecruiters': return { origin: `https://${str('domainName') || str('domain')}`, path: '/' };
    default: {
      const candidate = str('origin') || str('listingUrl') || str('jobs_url') || str('sitemapUrl') || str('careers_url') || (str('domainName') || str('domain') ? `https://${str('domainName') || str('domain')}` : '');
      if (!candidate) throw new Error(`${kind}: no request origin in the configuration (origin / listingUrl / jobs_url / sitemapUrl / domainName)`);
      const u = new URL(candidate); return { origin: u.origin, path: u.pathname || '/' };
    }
  }
}

export type RobotsVerdict = 'ALLOWED' | 'DISALLOWED' | 'NO_ROBOTS' | 'UNREACHABLE';
export type RobotsReading = { verdict: RobotsVerdict; httpStatus: number | null; sha256: string | null; bytes: number; error?: string };

/**
 * Explicit access verdict from one robots.txt response: 2xx → the `User-agent: *` rules decide on the request path
 * (ALLOWED / DISALLOWED); 404 / 410 → NO_ROBOTS (the RFC allows access, the catalogue keeps it distinct from a READ
 * ALLOWED); anything else (401 / 403 / 429 / 5xx, network error, timeout) → UNREACHABLE (the RFC says assume disallow).
 * Only a read ALLOWED is promotable; an absent or unreachable file never is.
 */
export function robotsReading(response: { status: number; text: string } | { error: string }, path: string): RobotsReading {
  if ('error' in response) return { verdict: 'UNREACHABLE', httpStatus: null, sha256: null, bytes: 0, error: response.error };
  if (response.status === 404 || response.status === 410) return { verdict: 'NO_ROBOTS', httpStatus: response.status, sha256: null, bytes: 0 };
  if (response.status < 200 || response.status >= 300) return { verdict: 'UNREACHABLE', httpStatus: response.status, sha256: null, bytes: 0, error: `HTTP ${response.status}` };
  return { verdict: robotsVerdictFor(response.text, path) as RobotsVerdict, httpStatus: response.status, sha256: createHash('sha256').update(response.text).digest('hex'), bytes: Buffer.byteLength(response.text) };
}

export async function readRobots(origin: string, path: string, fetchImpl: typeof fetch = fetch): Promise<RobotsReading> {
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ModeCareersBot/1.0)' }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
    return robotsReading({ status: res.status, text: res.ok ? await res.text() : '' }, path);
  } catch (error) {
    return robotsReading({ error: error instanceof Error ? error.message : String(error) }, path);
  }
}

export type LabelClass = 'CATALOGUE' | 'OWNER' | 'OWNER_ENTITY' | 'OTHER';
export const CATALOGUE_LABEL = '(catalogue label)';

/**
 * A native employer label against the catalogued Maison: OWNER (same canonical identity or same normalized name),
 * OWNER_ENTITY (the label, stripped of legal forms, still contains the Maison's name as whole words: "UNIQLO Massachusetts
 * LLC", "L'IMPERTINENTE - Ysé"), OTHER (nothing ties it to the Maison: "GU USA LLC" on a UNIQLO site). CATALOGUE = the
 * board publishes no employer label. A SINGLE_BRAND certification is consistent with the evidence only when no label is
 * OTHER; OTHER labels need a MULTI_BRAND review with aliases, or an exclusion — never a silent credit to the owner.
 */
export function classifyLabel(label: string, maison: string): LabelClass {
  if (label === CATALOGUE_LABEL) return 'CATALOGUE';
  const ownerKey = resolveCompany(maison).companyId, ownerNorm = normalizedEmployerName(maison);
  if (resolveCompany(label).companyId === ownerKey || normalizedEmployerName(label) === ownerNorm) return 'OWNER';
  const words = normalizedEmployerName(stripLegalSuffix(label)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const owner = ownerNorm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (owner.length && owner.every((w) => words.includes(w))) return 'OWNER_ENTITY';
  return 'OTHER';
}

export type ScopeEvidence = { maison: string; ownerKey: string; labels: Array<{ label: string; n: number; class: LabelClass }>; verdict: 'NO_NATIVE_LABEL' | 'SINGLE_BRAND_CONSISTENT' | 'LABELS_OUTSIDE_OWNER'; other: string[] };

/** The perimeter evidence of a board: every label read, classified, and the verdict a SINGLE_BRAND certification must match. */
export function scopeEvidence(labels: Map<string, number>, maison: string): ScopeEvidence {
  const classified = [...labels.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n, class: classifyLabel(label, maison) }));
  const other = classified.filter((l) => l.class === 'OTHER');
  return {
    maison, ownerKey: resolveCompany(maison).companyId, labels: classified,
    verdict: classified.every((l) => l.class === 'CATALOGUE') ? 'NO_NATIVE_LABEL' : other.length === 0 ? 'SINGLE_BRAND_CONSISTENT' : 'LABELS_OUTSIDE_OWNER',
    other: other.map((l) => `${l.label} (${l.n})`),
  };
}

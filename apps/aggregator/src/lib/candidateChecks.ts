/**
 * Exploratory diagnostics for source reports: a candidate request target,
 * observed robots rules, and employer-label similarities. They do not certify
 * a source, prove complete transport coverage or establish employer identity.
 */
import { createHash } from 'node:crypto';
import { robotsVerdictFor } from './robotsVerdict.js';
import { CRAWLER_IDENTITY } from './crawlerIdentity.js';
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
    // `recruitee.ts` construit `https://<subdomain>.recruitee.com/api/offers/` : le sous-domaine EST l'hôte
    // appelé. Sans ce cas, la branche par défaut ne trouvait aucune origine et refusait une source valide.
    case 'recruitee': {
      const sub = str('subdomain');
      // Pas de `break` : dans un `switch` il sort du bloc SANS atteindre `default`, et la fonction rendrait
      // `undefined` au lieu de refuser. Un refus qui ne refuse pas est pire que l'absence de contrôle.
      if (sub) return { origin: `https://${sub}.recruitee.com`, path: '/api/offers/' };
      throw new Error(`${kind}: no request origin in the configuration (subdomain)`);
    }
    // `rituals.ts` porte son propre `DEFAULT_ORIGIN` et sa configuration ne contient que des locales : aucune
    // clé de chaîne à lire. On reprend le défaut de l'adaptateur — jamais une URL de catalogue, qui n'est pas
    // l'hôte réellement appelé et ferait lire robots au mauvais endroit.
    case 'rituals': return { origin: str('origin') || 'https://careers.rituals.com', path: '/api/v1/jobs/' };
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
 * One technical observation for CatwalksBot on the requested path and query.
 * 404/410 stay NO_ROBOTS; other unsuccessful responses remain UNREACHABLE.
 * This local policy is stricter than RFC 9309's optional access on other 4xx.
 * It is not the authorization decision and does not certify a whole adapter.
 */
export function robotsReading(response: { status: number; text: string } | { error: string }, path: string): RobotsReading {
  if ('error' in response) return { verdict: 'UNREACHABLE', httpStatus: null, sha256: null, bytes: 0, error: response.error };
  if (response.status === 404 || response.status === 410) return { verdict: 'NO_ROBOTS', httpStatus: response.status, sha256: null, bytes: 0 };
  if (response.status < 200 || response.status >= 300) return { verdict: 'UNREACHABLE', httpStatus: response.status, sha256: null, bytes: 0, error: `HTTP ${response.status}` };
  const evidence = { httpStatus: response.status, sha256: createHash('sha256').update(response.text).digest('hex'), bytes: Buffer.byteLength(response.text) };
  try { return { ...evidence, verdict: robotsVerdictFor(response.text, path) }; }
  catch { return { ...evidence, verdict: 'UNREACHABLE', error: 'ROBOTS_RULES_NOT_EVALUATED' }; }
}

export async function readRobots(origin: string, path: string, fetchImpl: typeof fetch = fetch): Promise<RobotsReading> {
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': CRAWLER_IDENTITY }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
    return robotsReading({ status: res.status, text: res.ok ? await res.text() : '' }, path);
  } catch (error) {
    return robotsReading({ error: error instanceof Error ? error.message : String(error) }, path);
  }
}

export type LabelClass = 'CATALOGUE' | 'OWNER' | 'OWNER_ENTITY' | 'OTHER';
const GENERIC_WORDS = new Set(['group', 'groupe', 'holding', 'holdings', 'company', 'companies', 'brands', 'brand', 'international', 'retail', 'stores', 'store', 'inc', 'corp', 'corporation', 'the', 'and', 'of']);
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
  // The Maison's own legal form is not part of its name either: "VF Outdoor, LLC" is an entity of "VF Corporation" (VF, 2026-09-10).
  const owner = normalizedEmployerName(stripLegalSuffix(maison)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (owner.length && owner.every((w) => words.includes(w))) return 'OWNER_ENTITY';
  // A shorter form of the Maison ("KnitWell" for "KnitWell Group", "Chico's" for "Chico's FAS") is the Maison too — provided the
  // label keeps at least one distinctive word (a generic word alone, "Group", never is).
  if (words.length && words.every((w) => owner.includes(w)) && words.some((w) => !GENERIC_WORDS.has(w))) return 'OWNER_ENTITY';
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

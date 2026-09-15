import type { NormalizedJob } from '../types.js';

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Native iCIMS posting identity stays scoped to the exact regional portal.
 * A hub's reviewed origins permit collection, never alias tenants together. */
export function icimsPostingURL(value: unknown) {
  if (typeof value !== 'string' || /[\\\s]/.test(value) || /%(?:2f|5c|2e)/i.test(value) || /\/\.{1,2}(?:\/|$)/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.icims\.com$/.test(url.hostname)) return;
    const id = /^\/jobs\/([1-9]\d{0,15})\/(?:[^/]+\/)?job$/.exec(url.pathname)?.[1];
    if (!id || !Number.isSafeInteger(Number(id))) return;
    for (const [key, value] of url.searchParams) {
      if (url.searchParams.getAll(key).length !== 1 ||
        !(key === 'hub' && /^[1-9]\d*$/.test(value) || key === 'in_iframe' && value === '1')) return;
    }
    return { url, id };
  } catch { return; }
}

function nativeOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const parsed = icimsPostingURL(value.replace(/\/$/, '') + '/jobs/1/job');
  return parsed && [parsed.url.origin, parsed.url.origin + '/'].includes(value) ? parsed.url.origin : undefined;
}

/** Cross-origin scope is explicit source configuration, backed by a review of
 * the hub's captured links. Wildcards and inferred hostname suffixes are refused. */
export function icimsDetailOrigins(config: Record<string, unknown>): Set<string> {
  const origin = nativeOrigin(config.origin), extra = config.detailOrigins ?? [];
  if (!origin || !Array.isArray(extra) || extra.length > 32 || extra.some(value => !nativeOrigin(value))) {
    throw new Error('iCIMS requires a native origin and at most 32 explicit native detailOrigins');
  }
  return new Set([origin, ...extra.map(value => nativeOrigin(value)!)]);
}

export function icimsDetailIdentity(publication: Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>, requireDeclaredUrl = false) {
  const raw = publication.raw;
  if (!object(raw) || raw.source !== 'icims' || !object(raw.postingEvidence)) return;
  const evidence = raw.postingEvidence, node = evidence.jobPosting, page = icimsPostingURL(publication.url);
  if (!page || page.id !== publication.externalId || evidence.pageUrl !== publication.url ||
    evidence.jobPostingCount !== 1 || typeof evidence.htmlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.htmlSha256) || !object(node) ||
    !(node['@type'] === 'JobPosting' || Array.isArray(node['@type']) && node['@type'].includes('JobPosting')) ||
    evidence.geographyConflict !== undefined && evidence.geographyConflict !== false) return;
  if (raw.reference != null && (typeof raw.reference !== 'string' || !new RegExp(`^\\d{4}-${page.id}$`).test(raw.reference))) return;
  if (node.url != null || requireDeclaredUrl) {
    const declared = icimsPostingURL(node.url);
    if (!declared || declared.url.origin !== page.url.origin || declared.id !== page.id || declared.url.pathname !== page.url.pathname) return;
  }
  return { tenant: `icims:${page.url.origin}`, requisition: page.id };
}

export function icimsDetailMatchesListing(publication: Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>, config: Record<string, unknown>): boolean {
  try {
    const page = icimsPostingURL(publication.url);
    return !!page && icimsDetailOrigins(config).has(page.url.origin) && !!icimsDetailIdentity(publication);
  } catch { return false; }
}

/** Independent feeds may meet only on a posting that declares its own URL. */
export const icimsPublicationIdentity = (publication: Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>) => icimsDetailIdentity(publication, true);

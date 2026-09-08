/** Identity established by an employer's apply URL, independent of feed labels. */
export type PostingIdentity = { tenant: string; requisition: string };

export function postingIdentity(value: string): PostingIdentity | undefined {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
    if (url.hostname === 'jobaffinity.fr' && !url.port) {
      const token = url.pathname.match(/^\/apply\/([a-z0-9]{10,64})\/?$/);
      if (token) return { tenant: 'jobaffinity:jobaffinity.fr', requisition: token[1] };
    }
    if (!/\.oraclecloud\.com$/i.test(url.hostname)) return;
    const match = url.pathname.match(/^\/hcmUI\/CandidateExperience\/[^/]+\/sites\/([^/]+)\/job\/([^/]+)\/?$/i);
    if (!match) return;
    return {
      tenant: `oraclehcm:${url.hostname.toLowerCase()}:${decodeURIComponent(match[1])}`,
      requisition: decodeURIComponent(match[2]),
    };
  } catch { return; }
}

/** Different requisitions of one tenant cannot be merged by title similarity. */
export function hasRequisitionConflict(urls: readonly string[]): boolean {
  const tenants = new Map<string, string>();
  for (const url of urls) {
    const identity = postingIdentity(url);
    if (!identity) continue;
    const previous = tenants.get(identity.tenant);
    if (previous !== undefined && previous !== identity.requisition) return true;
    tenants.set(identity.tenant, identity.requisition);
  }
  return false;
}

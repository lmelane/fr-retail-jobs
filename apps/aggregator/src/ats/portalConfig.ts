/** Native identifiers shared by extraction and official-link inspection. */
export function ashbyBoard(config: Record<string, unknown>): string {
  const board = String(config.board ?? config.slug ?? '');
  if (!board) throw new Error('Ashby board handle missing');
  return board;
}

export function recruiteeSubdomain(config: Record<string, unknown>): string {
  const subdomain = String(config.subdomain ?? '');
  if (!subdomain) throw new Error('Recruitee subdomain missing');
  return subdomain;
}

/** Les identifiants natifs des autres familles, tels que leurs collecteurs les lisent (lot F3). */
export function greenhouseBoard(config: Record<string, unknown>): string {
  const board = String(config.board ?? ''); if (!board) throw new Error('Greenhouse board missing'); return board;
}
export function smartrecruitersCompany(config: Record<string, unknown>): string {
  const company = String(config.company ?? ''); if (!company) throw new Error('SmartRecruiters company missing'); return company;
}
export function leverSite(config: Record<string, unknown>): { site: string; region: string } {
  const site = String(config.site ?? ''); if (!site) throw new Error('Lever site missing');
  return { site, region: String(config.region ?? '') };
}
export function personioHost(config: Record<string, unknown>): string {
  const host = String(config.host ?? (config.subdomain ? `${config.subdomain}.jobs.personio.de` : '')); if (!host) throw new Error('Personio host missing'); return host;
}
export function workableAccount(config: Record<string, unknown>): string {
  const account = String(config.account ?? config.slug ?? ''); if (!account) throw new Error('Workable account handle missing'); return account;
}
export function originPortal(config: Record<string, unknown>, label: string): string {
  const origin = String(config.origin ?? config.domainName ?? '').replace(/\/$/, ''); if (!origin) throw new Error(`${label} origin missing`);
  return /^https?:\/\//.test(origin) ? origin : `https://${origin}`;
}
export function listingPortal(config: Record<string, unknown>): string {
  const url = String(config.listingUrl ?? config.sitemapUrl ?? config.startUrl ?? config.url ?? ''); if (!url) throw new Error('Listing URL missing'); return url;
}
export function talentviewSlug(config: Record<string, unknown>): string {
  const slug = String(config.slug ?? ''); if (!slug) throw new Error('Talentview slug missing'); return slug;
}

/** Teamtailor : l'origine HTTPS du site carrière (domaine personnalisé ou `*.teamtailor.com`), sans chemin ni filtre. */
export function teamtailorOrigin(config: Record<string, unknown>): string {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Teamtailor origin missing');
  return origin;
}

export function workdayPortal(config: Record<string, unknown>) {
  const tenant = String(config.tenant ?? '');
  const site = String(config.site ?? '');
  const origin = String(config.origin ?? '');
  if (!tenant || !site || !origin) throw new Error('Workday tenant/site/origin missing');
  return { tenant, site, origin };
}

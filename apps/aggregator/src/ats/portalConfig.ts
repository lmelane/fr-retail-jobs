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

import type { NormalizedJob } from '../types.js';

/** Bind the feed UUID, the native numeric posting ID and its declared issuer.
 * A hostname alias alone, title or employer label never establishes identity. */
export function teamtailorPublicationIdentity(publication: Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>) {
  const raw = publication.raw as Record<string, any> | null | undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.id !== publication.externalId ||
    typeof raw.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw.id) ||
    raw.url !== publication.url || raw._jobposting?.['@type'] !== 'JobPosting') return;
  const id = raw._jobposting.identifier?.value, declaredIssuer = raw._jobposting.hiringOrganization?.sameAs;
  if (!['string', 'number'].includes(typeof id) || !/^[1-9]\d{0,15}$/.test(String(id)) ||
    !Number.isSafeInteger(Number(id)) || typeof declaredIssuer !== 'string') return;
  try {
    const url = new URL(publication.url), issuer = new URL(declaredIssuer);
    if (![url, issuer].every(value => value.protocol === 'https:' && !value.username && !value.password && !value.port && !value.search && !value.hash) ||
      issuer.pathname !== '/' || !(url.origin === issuer.origin || /^[a-z0-9-]+\.teamtailor\.com$/.test(url.hostname))) return;
    const pathId = url.pathname.match(/^\/jobs\/([1-9]\d{0,15})(?:-[^/\\\s]+)?\/?$/)?.[1];
    if (pathId !== String(id) || /%(?:2f|5c|2e)/i.test(url.pathname)) return;
    return { tenant: `teamtailor:${issuer.origin}`, requisition: `${id}:${raw.id}` };
  } catch { return; }
}

/**
 * R-143 §4 (D-513) : le site carrière d'un GROUPE publie l'offre d'une de ses enseignes avec la fiche native de
 * celle-ci (Etam publie sous `career.groupeetam.com` les offres de Maison 123 et d'Undiz, émetteur déclaré
 * `career.maison123.com`, même UUID de flux, même identifiant numérique). L'adresse n'appartient pas à l'émetteur :
 * l'identité est DÉLÉGUÉE. Elle ne prouve rien seule, ni face à une autre délégation — seulement face à la publication
 * que l'émetteur sert lui-même (`teamtailorPublicationIdentity`), dont elle doit porter le même UUID, le même
 * identifiant numérique et le même émetteur.
 */
export function teamtailorDelegatedIdentity(publication: Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>) {
  if (teamtailorPublicationIdentity(publication)) return;
  const raw = publication.raw as Record<string, any> | null | undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.id !== publication.externalId ||
    typeof raw.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw.id) ||
    raw.url !== publication.url || raw._jobposting?.['@type'] !== 'JobPosting') return;
  const id = raw._jobposting.identifier?.value, declaredIssuer = raw._jobposting.hiringOrganization?.sameAs;
  if (!['string', 'number'].includes(typeof id) || !/^[1-9]\d{0,15}$/.test(String(id)) ||
    !Number.isSafeInteger(Number(id)) || typeof declaredIssuer !== 'string') return;
  try {
    const url = new URL(publication.url), issuer = new URL(declaredIssuer);
    if (![url, issuer].every(value => value.protocol === 'https:' && !value.username && !value.password && !value.port && !value.search && !value.hash) ||
      issuer.pathname !== '/' || url.origin === issuer.origin) return;
    const pathId = url.pathname.match(/^\/jobs\/([1-9]\d{0,15})(?:-[^/\\\s]+)?\/?$/)?.[1];
    if (pathId !== String(id) || /%(?:2f|5c|2e)/i.test(url.pathname)) return;
    return { tenant: `teamtailor:${issuer.origin}`, requisition: `${id}:${raw.id}`, delegated: true as const };
  } catch { return; }
}

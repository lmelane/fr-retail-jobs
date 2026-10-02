import type { NormalizedJob } from '../types.js';

type Publication = Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * R-143 §4 (D-513) : la réquisition SAP SuccessFactors que publient À LA FOIS un flux de groupe (le portail LVMH, qui
 * renvoie vers `career55.sapsf.eu/sfcareer/jobreqcareer?company=SephoraUS&jobId=N`) et le site carrière RMK de la
 * Maison (`jobs.sephora.com/<pays>/job/<slug>/<id RMK>/`, dont le texte publié porte « Job ID: N »).
 *
 * Le site RMK ne déclare que SON identifiant de publication ; le rattachement au tenant SAP est une relecture, gravée
 * ici et nulle part ailleurs : la page déclare `ssoCompanyId: 'SephoraUS'` et `ssoUrl: 'https://career55.sapsf.eu'`
 * (relu le 02/10/2026), et `jobs.sephora.com/job-invite/N/` — la redirection native de l'éditeur, de la réquisition
 * vers sa publication — a renvoyé vers la publication RMK portant « Job ID: N » pour 80 réquisitions sur 80
 * (`audits/2026-10-02/r143-dedoublonnage-maison/`). Un autre site RMK n'est JAMAIS rattaché par analogie.
 */
export const REVIEWED_RMK_TENANTS: Readonly<Record<string, { host: string; company: string }>> = Object.freeze({
  'https://jobs.sephora.com': { host: 'career55.sapsf.eu', company: 'SephoraUS' },
});

const DECLARED_JOB_ID = /\bJob ID ?: ?(\d{4,12})\b/g;

/** Les identifiants « Job ID: N » que déclare un texte publié ; un texte sans déclaration rend un ensemble vide. */
export function declaredJobIds(...texts: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const text of texts) if (typeof text === 'string') for (const match of text.matchAll(DECLARED_JOB_ID)) ids.add(match[1]);
  return ids;
}

/** Le lien de candidature SAP d'un flux de groupe, exact : un hôte `careerNN.sapsf.(eu|com)`, deux paramètres, une fois chacun. */
export function sapRequisitionLink(value: unknown): { host: string; company: string; requisition: string } | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !/^career\d{1,3}\.sapsf\.(?:eu|com)$/.test(url.hostname) || url.pathname !== '/sfcareer/jobreqcareer') return;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('company') || !keys.includes('jobId')) return;
    const company = url.searchParams.get('company')!, requisition = url.searchParams.get('jobId')!;
    if (!/^[A-Za-z0-9_]{1,64}$/.test(company) || !/^[1-9]\d{0,11}$/.test(requisition)) return;
    return { host: url.hostname, company, requisition };
  } catch { return; }
}

/**
 * Côté flux de groupe : le lien SAP, l'`atsId` et l'identifiant de la publication désignent la même réquisition, et
 * le texte publié ne déclare aucun autre « Job ID ». Un seul désaccord, et la publication ne prouve rien.
 */
function groupFeedIdentity(publication: Publication) {
  const raw = publication.raw;
  if (!object(raw) || raw.link !== publication.url) return;
  const link = sapRequisitionLink(publication.url);
  if (!link || String(raw.atsId ?? '') !== link.requisition || publication.externalId !== link.requisition) return;
  const declared = declaredJobIds(raw.description, raw.jobResponsabilities, raw.profile, raw.additionalInformation);
  if (declared.size > 1 || (declared.size === 1 && !declared.has(link.requisition))) return;
  return { tenant: `successfactors:${link.host}:${link.company}`, requisition: link.requisition };
}

/**
 * Côté site RMK relu : la publication est celle que lit l'adaptateur SuccessFactors (identifiant RMK lié à l'adresse),
 * sur une origine relue, et son texte déclare UNE seule réquisition. Zéro ou plusieurs « Job ID » : aucune preuve.
 */
function rmkIdentity(publication: Publication) {
  const raw = publication.raw;
  if (!object(raw) || raw.source !== 'successfactors' || String(raw.id ?? '') !== publication.externalId ||
    !/^[1-9]\d{0,15}$/.test(publication.externalId)) return;
  try {
    const url = new URL(publication.url);
    const tenant = REVIEWED_RMK_TENANTS[url.origin];
    if (!tenant || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      !url.pathname.endsWith(`/${publication.externalId}/`) || /%(?:2f|5c|2e)/i.test(url.pathname)) return;
    const declared = declaredJobIds(object(raw.successfactorsDetail) ? raw.successfactorsDetail.description : undefined);
    if (declared.size !== 1) return;
    return { tenant: `successfactors:${tenant.host}:${tenant.company}`, requisition: [...declared][0] };
  } catch { return; }
}

export function successfactorsRequisitionIdentity(publication: Publication) {
  return groupFeedIdentity(publication) ?? rmkIdentity(publication);
}

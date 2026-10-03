import type { NormalizedJob } from '../types.js';
import { brandText, provenGroupBrand, type GroupBrandList } from './groupBrands.js';
import { spontaneousApplicationProof } from '../pipeline/spontaneousApplication.js';

export const CERTIFIED_SCOPE_RULE = 'EMPLOYER_INFERRED_FROM_CERTIFIED_SINGLE_BRAND_PORTAL';
export const CERTIFIED_SCOPE_PATH = 'portal.certifiedScope';
/** R-142 §3 : sur un portail relu MULTI_BRAND, l'offre qui ne nomme pas son enseigne publie sous le groupe propriétaire. */
export const GROUP_SCOPE_RULE = 'GROUP_INFERRED_FROM_REVIEWED_MULTI_BRAND_PORTAL';
/** R-142 §3 : l'offre qui nomme sa Maison (une marque de la liste fermée du groupe, `groupBrands.ts`) la garde. */
export const GROUP_BRAND_PATH = 'portal.groupBrand';
export const GROUP_BRAND_RULE = 'BRAND_NAMED_ON_REVIEWED_MULTI_BRAND_PORTAL';
/** Holds that mean "the page named no employer" — never a hold that means the page was unreadable. */
const EMPLOYER_ABSENT_HOLDS = new Set(['WORKDAY_EMPLOYER_ABSENT_IN_DETAIL']);

type Scope = 'SINGLE_BRAND' | 'MULTI_BRAND' | null;
const brandEvidence = (name: string) => ({ rawName: name, path: GROUP_BRAND_PATH, rule: GROUP_BRAND_RULE, role: 'BRAND' as const });

/**
 * L'EMPLOYEUR D'UNE OFFRE QUE SA PAGE NE NOMME PAS, D'APRÈS LE PÉRIMÈTRE RELU DU PORTAIL.
 *
 *  - SINGLE_BRAND (décision du 09/09/2026) : l'offre retenue faute d'employeur prend le propriétaire du portail.
 *  - MULTI_BRAND (R-142 §3, D-479 §2 ; D-522 §6) : l'offre retenue faute d'employeur publie sous la marque qu'elle nomme
 *    (intitulé ou lieu, une seule marque de la liste fermée du groupe), sinon sous le groupe propriétaire. Une offre
 *    qui ne porte ni employeur ni retenue (lecteur sans champ employeur, ex. dataLayer Avature sans marque) prend la
 *    marque qu'elle nomme ; sans marque, elle va déjà au groupe par le résolveur (`SOURCE_CATALOGUE_LABEL`).
 *    Une offre dont la page ne nomme qu'une ENTITÉ JURIDIQUE du groupe (`entities` de la liste, ex. « VF Outdoor, LLC »)
 *    prend la marque qu'elle nomme ; sans marque, son libellé natif reste (il mène au groupe par l'alias relu).
 *  - Périmètre non relu (null) : rien ne change, l'offre retenue le reste. Une candidature spontanée non plus (D-511).
 * La provenance est enregistrée à part d'un libellé explicite (`isPortalEmployerOrigin`), et le résolveur la revérifie.
 */
export function employerFromCertifiedScope(job: NormalizedJob, ownerLabel: string, scope: Scope, brands?: GroupBrandList): NormalizedJob {
  const owner = ownerLabel.split('(')[0].trim() || ownerLabel.trim();
  if (!scope || !owner) return job;
  const absentHold = !!job.publicationHold && EMPLOYER_ABSENT_HOLDS.has(job.publicationHold);
  const named = !!job.company?.trim() || !!job.employerEvidence?.rawName.trim();
  if (absentHold) {
    // D-511 : la règle de la collecte cède devant cette retenue (`applySpontaneousApplicationRule`) ; la lever publierait
    // une candidature spontanée (« Send us your CV », Brunello Cucinelli, 02/10/2026). Elle reste donc retenue.
    if (named || spontaneousApplicationProof(job)) return job;
    const { publicationHold: _hold, ...rest } = job;
    if (scope === 'SINGLE_BRAND') return { ...rest, company: undefined, employerEvidence: { rawName: ownerLabel.trim(), path: CERTIFIED_SCOPE_PATH, rule: CERTIFIED_SCOPE_RULE } };
    const brand = provenGroupBrand(job, brands);
    // `company` porte la marque : l'ingestion en déduit le domaine (logo) de la Maison ; vide, elle prendrait celui du
    // propriétaire du portail et l'écrirait sur la marque créée (« Kiehl's » avec loreal.com).
    return brand ? { ...rest, company: brand.name, employerEvidence: brandEvidence(brand.name) }
      : { ...rest, company: undefined, employerEvidence: { rawName: owner, path: CERTIFIED_SCOPE_PATH, rule: GROUP_SCOPE_RULE, role: 'GROUP' } };
  }
  if (scope !== 'MULTI_BRAND' || job.publicationHold || job.publicationWithdrawnAt) return job;
  const label = job.employerEvidence?.rawName ?? job.company;
  const groupEntity = !!label && job.employerEvidence?.path === 'detail.hiringOrganization.name'
    && (brands?.entities ?? []).some(entity => brandText(entity) === brandText(label));
  if (named && !groupEntity) return job;
  const brand = provenGroupBrand(job, brands);
  return brand ? { ...job, company: brand.name, employerEvidence: brandEvidence(brand.name) } : job;
}

/** Only these explicit pipeline origins identify a registry-derived employer. */
export function isPortalEmployerOrigin(origin: string | undefined): boolean {
  return origin === 'SOURCE_CATALOGUE_LABEL' || origin === `${CERTIFIED_SCOPE_PATH}:${CERTIFIED_SCOPE_RULE}`
    || origin === `${CERTIFIED_SCOPE_PATH}:${GROUP_SCOPE_RULE}` || isGroupBrandOrigin(origin);
}

/** L'employeur vient de la liste fermée des marques du groupe (jamais un libellé natif de la page). */
export function isGroupBrandOrigin(origin: string | undefined): boolean {
  return origin === `${GROUP_BRAND_PATH}:${GROUP_BRAND_RULE}`;
}

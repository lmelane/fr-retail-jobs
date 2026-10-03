import type { NormalizedJob } from '../types.js';
import { labelIsOneOf, outOfPerimeterBrand, provenGroupBrand, type GroupBrandList } from './groupBrands.js';
import { spontaneousApplicationProof } from '../pipeline/spontaneousApplication.js';

export const CERTIFIED_SCOPE_RULE = 'EMPLOYER_INFERRED_FROM_CERTIFIED_SINGLE_BRAND_PORTAL';
export const CERTIFIED_SCOPE_PATH = 'portal.certifiedScope';
/** R-142 §3 : sur un portail relu MULTI_BRAND, l'offre qui ne nomme pas son enseigne publie sous le groupe propriétaire. */
export const GROUP_SCOPE_RULE = 'GROUP_INFERRED_FROM_REVIEWED_MULTI_BRAND_PORTAL';
/** R-142 §3 : l'offre qui nomme sa Maison (une marque de la liste fermée du groupe, `groupBrands.ts`) la garde. */
export const GROUP_BRAND_PATH = 'portal.groupBrand';
export const GROUP_BRAND_RULE = 'BRAND_NAMED_ON_REVIEWED_MULTI_BRAND_PORTAL';
/** Une marque SOUS LICENCE nommée par la page (« PRADA » sur le portail L'Oréal) : l'employeur est le groupe, jamais la Maison homonyme. */
export const GROUP_LICENCE_RULE = 'LICENSED_BRAND_ON_REVIEWED_MULTI_BRAND_PORTAL';
/** Une marque du groupe hors périmètre Catwalks (Marchesi 1824, D-522 §6) : retenue sur décision de l'équipe, aucune Maison créée. */
export const GROUP_OUT_OF_PERIMETER_HOLD = 'GROUP_BRAND_OUT_OF_PERIMETER';
/** Holds that mean "the page named no employer" — never a hold that means the page was unreadable. */
const EMPLOYER_ABSENT_HOLDS = new Set(['WORKDAY_EMPLOYER_ABSENT_IN_DETAIL']);

type Scope = 'SINGLE_BRAND' | 'MULTI_BRAND' | null;
const brandEvidence = (name: string) => ({ rawName: name, path: GROUP_BRAND_PATH, rule: GROUP_BRAND_RULE, role: 'BRAND' as const });
const groupEvidence = (name: string, rule: string, licensed?: string) =>
  ({ rawName: name, path: CERTIFIED_SCOPE_PATH, rule, role: 'GROUP' as const, ...(licensed ? { brands: [licensed] } : {}) });

/**
 * L'EMPLOYEUR D'UNE OFFRE QUE SA PAGE NE NOMME PAS, D'APRÈS LE PÉRIMÈTRE RELU DU PORTAIL.
 *
 *  - SINGLE_BRAND (décision du 09/09/2026) : l'offre retenue faute d'employeur prend le propriétaire du portail.
 *  - MULTI_BRAND (R-142 §3, D-479 §2 ; D-522 §6) : l'offre retenue faute d'employeur publie sous la marque qu'elle nomme
 *    (intitulé ou lieu, une seule marque de la liste fermée du groupe), sinon sous le groupe (nom de la liste, à défaut
 *    le propriétaire du portail). Une offre qui ne porte ni employeur ni retenue (dataLayer Avature sans marque) prend la
 *    marque qu'elle nomme ; sans marque, elle va déjà au groupe par le résolveur (`SOURCE_CATALOGUE_LABEL`).
 *    Une offre dont la page ne nomme qu'une ENTITÉ JURIDIQUE du groupe (« VF Outdoor, LLC ») ou que sa colonne de marque
 *    nomme sous une autre graphie (« プラダ ») prend la marque prouvée ; sans marque, son libellé natif reste.
 *    Une marque SOUS LICENCE nommée par la page publie sous le groupe ; une marque HORS PÉRIMÈTRE est retenue
 *    (`GROUP_BRAND_OUT_OF_PERIMETER`, retrait daté par `observedAt` quand l'appelant le connaît).
 *  - Périmètre non relu (null) : rien ne change, l'offre retenue le reste. Une candidature spontanée non plus (D-511).
 * La provenance est enregistrée à part d'un libellé explicite (`isPortalEmployerOrigin`), et le résolveur la revérifie.
 */
export function employerFromCertifiedScope(job: NormalizedJob, ownerLabel: string, scope: Scope, brands?: GroupBrandList, observedAt?: Date): NormalizedJob {
  const owner = ownerLabel.split('(')[0].trim() || ownerLabel.trim();
  if (!scope || !owner) return job;
  const group = brands?.group ?? owner;
  const absentHold = !!job.publicationHold && EMPLOYER_ABSENT_HOLDS.has(job.publicationHold);
  const label = job.employerEvidence?.rawName?.trim() || job.company?.trim() || undefined;
  const outOfPerimeter = () => ({ ...job, publicationHold: GROUP_OUT_OF_PERIMETER_HOLD, ...(observedAt ? { publicationWithdrawnAt: observedAt } : {}) });
  if (absentHold) {
    // D-511 : la règle de la collecte cède devant cette retenue (`applySpontaneousApplicationRule`) ; la lever publierait
    // une candidature spontanée (« Send us your CV », Brunello Cucinelli, 02/10/2026). Elle reste donc retenue.
    if (label || spontaneousApplicationProof(job)) return job;
    const { publicationHold: _hold, ...rest } = job;
    if (scope === 'SINGLE_BRAND') return { ...rest, company: undefined, employerEvidence: { rawName: ownerLabel.trim(), path: CERTIFIED_SCOPE_PATH, rule: CERTIFIED_SCOPE_RULE } };
    if (outOfPerimeterBrand(job, brands)) return outOfPerimeter();
    const brand = provenGroupBrand(job, brands);
    // `company` porte la marque : l'ingestion en déduit le domaine (logo) de la Maison ; vide, elle prendrait celui du
    // propriétaire du portail et l'écrirait sur la marque créée (« Kiehl's » avec loreal.com).
    return brand ? { ...rest, company: brand.name, employerEvidence: brandEvidence(brand.name) }
      : { ...rest, company: undefined, employerEvidence: groupEvidence(group, GROUP_SCOPE_RULE) };
  }
  if (scope !== 'MULTI_BRAND' || job.publicationHold || job.publicationWithdrawnAt || !brands) return job;
  if (outOfPerimeterBrand(job, brands, label)) return outOfPerimeter();
  if (label && labelIsOneOf(label, brands.licences)) return { ...job, company: undefined, employerEvidence: groupEvidence(group, GROUP_LICENCE_RULE, label) };
  const brand = provenGroupBrand(job, brands);
  if (!brand) return job;
  // Un libellé natif ne cède que s'il est une entité du groupe, ou la même marque sous une AUTRE graphie que sa Maison
  // (« プラダ ») ; le nom même de la Maison reste natif, il y mène déjà.
  const otherSpelling = !!label && labelIsOneOf(label, brand.match ?? [brand.name]) && !labelIsOneOf(label, [brand.maison ?? brand.name]);
  if (label && !labelIsOneOf(label, brands.entities) && !otherSpelling) return job;
  return { ...job, company: brand.name, employerEvidence: brandEvidence(brand.name) };
}

/** Les origines d'un employeur venu du registre ou du portail relu, jamais d'un libellé natif de la page. */
export const PORTAL_EMPLOYER_ORIGINS: readonly string[] = ['SOURCE_CATALOGUE_LABEL', `${CERTIFIED_SCOPE_PATH}:${CERTIFIED_SCOPE_RULE}`,
  `${CERTIFIED_SCOPE_PATH}:${GROUP_SCOPE_RULE}`, `${CERTIFIED_SCOPE_PATH}:${GROUP_LICENCE_RULE}`, `${GROUP_BRAND_PATH}:${GROUP_BRAND_RULE}`];

/** Only these explicit pipeline origins identify a registry-derived employer. */
export function isPortalEmployerOrigin(origin: string | undefined): boolean {
  return !!origin && PORTAL_EMPLOYER_ORIGINS.includes(origin);
}

/** La marque sous licence remplacée par le groupe. */
export function isGroupLicenceOrigin(origin: string | undefined): boolean {
  return origin === `${CERTIFIED_SCOPE_PATH}:${GROUP_LICENCE_RULE}`;
}

/** L'employeur vient de la liste fermée des marques du groupe (jamais un libellé natif de la page). */
export function isGroupBrandOrigin(origin: string | undefined): boolean {
  return origin === `${GROUP_BRAND_PATH}:${GROUP_BRAND_RULE}`;
}

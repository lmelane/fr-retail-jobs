/**
 * LES MOTIFS DE REFUS D'ATTRIBUTION D'EMPLOYEUR — une liste FERMÉE, jamais une chaîne libre.
 *
 * ── POURQUOI CETTE LISTE EXISTE ────────────────────────────────────────────────────────────────
 *
 * `resolveEmployer` refuse d'attribuer un employeur à SIX endroits, pour des causes qui appellent
 * des suites opposées : un `portalScope` non renseigné se corrige en renseignant un champ, une
 * contradiction d'identité exige d'instruire le cas. Jusqu'au 2026-09-21, le rapport de
 * complétion ne conservait que le nom de la classe (`ingest.ts:404` écrit `error.name`), et les
 * six causes y étaient indiscernables : 9 386 occurrences sous un seul libellé, dont 27 sources
 * bloquées par une simple configuration absente — découvert en reconstituant les causes depuis
 * l'état du référentiel, faute de les trouver dans les traces.
 *
 * ── POURQUOI UN CODE, ET PAS LE MESSAGE ────────────────────────────────────────────────────────
 *
 * Le contrat de `OutputFate.reason` (`capture/completion.ts:16`) impose « a bounded code […]
 * never a message that could carry a URL or a parameter ». Le motif est donc un code de cette
 * liste, jamais un nom d'employeur : `proposedName` porte déjà la raison sociale, et elle doit
 * rester hors du rapport scellé.
 */
export const MOTIFS_IDENTITE = [
  /** Le portail n'est pas certifié SINGLE_BRAND — souvent un `portalScope` simplement absent. */
  'PORTAL_OWNER_NOT_CERTIFIED',
  /** Le propriétaire du portail contredit l'employeur déjà attribué à cette publication. */
  'PORTAL_OWNER_REPLACES_EMPLOYER',
  /** Deux alias revus mènent à deux racines d'identité différentes. */
  'ALIAS_CONFLICT',
  /** L'alias existe mais ne vaut plus pour cette source ou ce locataire. */
  'ALIAS_SOURCE_OR_TENANT_CHANGED',
  /** Une nouvelle graphie diverge de l'observation précédente, sans converger sur l'employeur. */
  'EMPLOYER_SPELLING_DIVERGED',
  /** L'employeur courant de la publication n'est pas celui que la candidate désigne. */
  'EMPLOYER_TARGET_MISMATCH',
  /** Historical receipt code: new native labels now remain source-scoped without an inferred merge. */
  'SOURCE_NEVER_PUBLISHED_FOR_HOUSE',
] as const;

export type MotifIdentite = typeof MOTIFS_IDENTITE[number];

export class EmployerIdentityReviewRequired extends Error {
  constructor(
    public readonly sourceKey: string,
    public readonly externalId: string,
    public readonly rawEmployerName: string,
    /** La raison sociale proposée ou en conflit — pour le journal, JAMAIS pour le rapport scellé. */
    public readonly proposedName: string,
    /** Le code borné qui dit POURQUOI, et qui seul entre dans le rapport de complétion. */
    public readonly motif: MotifIdentite,
  ) {
    super(`Employer identity needs evidence: source=${sourceKey} externalId=${externalId} raw=${JSON.stringify(rawEmployerName)} proposed=${JSON.stringify(proposedName)} motif=${motif}`);
    this.name = 'EmployerIdentityReviewRequired';
  }
}

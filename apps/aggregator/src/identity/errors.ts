/**
 * LES MOTIFS DE REFUS D'ATTRIBUTION D'EMPLOYEUR — une liste FERMÉE, jamais une chaîne libre.
 *
 * ── POURQUOI CETTE LISTE EXISTE ────────────────────────────────────────────────────────────────
 *
 * `resolveEmployer` lève ce refus à sept endroits depuis D-506 (six auparavant) ; la liste compte huit motifs, dont un
 * code historique qui n'est plus levé. Ces causes appellent des suites opposées : un `portalScope` non renseigné se
 * corrige en renseignant un champ, une contradiction d'identité exige d'instruire le cas. Jusqu'au 2026-09-21, le
 * rapport de complétion ne conservait que le nom de la classe (`ingest.ts:404` écrit `error.name`), et les
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
  /**
   * D-506 §3 : l'offre suivrait l'éditeur vers un employeur que sa source publie déjà, mais la garde de masse est
   * franchie (plus de max(5, 5 %) des offres de la source dans le même RUN) : aucune ne suit, toutes sont revues.
   */
  'EMPLOYER_CHANGE_MASS',
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
    /**
     * D-506 §3 : l'éditeur nommait un employeur et en nomme un autre. Compté par la garde de masse de l'ingestion, que
     * l'offre puisse suivre l'éditeur ou non ; jamais écrit dans le rapport scellé.
     */
    public readonly employerChange = false,
  ) {
    super(`Employer identity needs evidence: source=${sourceKey} externalId=${externalId} raw=${JSON.stringify(rawEmployerName)} proposed=${JSON.stringify(proposedName)} motif=${motif}`);
    this.name = 'EmployerIdentityReviewRequired';
  }
}

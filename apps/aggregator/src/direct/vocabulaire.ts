/**
 * LA CORRESPONDANCE DES VOCABULAIRES — offres directes Catwalks → catalogue
 * mondial (lot 6 ; même discipline que D-421 : des trous assumés et nommés,
 * jamais une valeur devinée).
 *
 * Le backend Catwalks décrit une offre avec le vocabulaire français d'un
 * cabinet (CDI, temps plein, univers Mode/Beauté/Luxe, spécialisations). Le
 * catalogue décrit la relation d'emploi en dimensions mondiales indépendantes
 * (`employmentTerm`, `workTime`, `programType`, `engagementType`) et le
 * secteur en codes de `SectorConcept`. Chaque ligne ci-dessous dit ce qu'une
 * valeur ÉTABLIT, et rien de plus : un stage établit un programme, pas une
 * durée ; « Luxe » est un positionnement, pas un secteur, donc il n'établit
 * aucun code. Cette table est versionnée : une correspondance qui change est
 * une nouvelle version, jamais une réécriture silencieuse. Le lecteur de la
 * liste publique (`photo.ts`) comme le consommateur du flux (`feed.ts`)
 * re-projettent le stock resté à une version antérieure (`reprojeterStock`,
 * reprojection.ts), depuis le contrat conservé.
 *
 *   1 — lot 6 : première correspondance ;
 *   2 — D-455 : l'employeur affiché d'une offre sans Maison publique est
 *       « Catwalks », jamais son univers ni « Maison confidentielle » ;
 *   3 — D-455 (suite) : les libellés d'univers entrent dans le texte indexé
 *       comme mots de secteur de l'offre, avec ou sans Maison publique ;
 *   4 — D-444 : la Maison publique est rattachée au registre `Company`
 *       (`companyId`, d'où le groupe) et l'intitulé reçoit le métier de la
 *       taxonomie active (`occupationCode`) ; les filtres « groupe » et
 *       « métier » ne les excluent plus (`contexte.ts`).
 */
export const CORRESPONDANCE_DIRECTE_VERSION = 4;

export type DimensionsEmploi = {
  employmentTerm: string | null;
  workTime: string | null;
  programType: string | null;
  engagementType: string | null;
};

/** `contractType` du backend : une seule valeur qui mélange durée, programme et statut. */
const CONTRAT: Record<string, Partial<DimensionsEmploi>> = {
  CDI: { employmentTerm: 'PERMANENT' },
  CDD: { employmentTerm: 'FIXED_TERM' },
  INTERIM: { employmentTerm: 'TEMPORARY' },
  STAGE: { programType: 'INTERNSHIP' },
  ALTERNANCE: { programType: 'APPRENTICESHIP' },
  FREELANCE: { engagementType: 'FREELANCE' },
};

const TEMPS: Record<string, string> = { TEMPS_PLEIN: 'FULL_TIME', TEMPS_PARTIEL: 'PART_TIME' };

/** `remotePolicy` : une fréquence de télétravail, projetée sur le lieu de travail du catalogue. */
const TELETRAVAIL: Record<string, string> = { FULL: 'REMOTE', FREQUENT: 'HYBRID', OCCASIONAL: 'HYBRID', NONE: 'ONSITE' };

/**
 * Univers et spécialisations → codes de secteur. « LUXE » n'apparaît pas :
 * ce n'est pas un secteur du catalogue (D-421). Une offre « Luxe » seule reste
 * sans secteur — « Secteur à vérifier » à l'écran — plutôt qu'un secteur inventé.
 */
const SECTEURS: Record<string, string> = {
  MODE: 'FASHION',
  BEAUTE: 'BEAUTY',
  PRET_A_PORTER_ACCESSOIRES: 'FASHION',
  MAROQUINERIE: 'LEATHER_GOODS',
  CHAUSSURE: 'FOOTWEAR',
  BIJOUTERIE_JOAILLERIE: 'JEWELRY',
  HORLOGERIE: 'WATCHMAKING',
  PARFUM: 'FRAGRANCE',
  SOINS: 'BEAUTY',
  MAQUILLAGE: 'BEAUTY',
};

/**
 * Le libellé d'un univers : un MOT DE SECTEUR de l'offre, écrit dans son texte indexé, que la génération de recherche
 * `search-4` verse au document d'une offre directe (« luxe » trouve une offre de l'univers Luxe). Il ne nomme jamais
 * l'employeur (D-455 §1), et « Luxe » n'établit toujours aucun code de secteur.
 */
const UNIVERS_LIBELLE: Record<string, string> = { MODE: 'Mode', BEAUTE: 'Beauté', LUXE: 'Luxe' };

/** Une entrée PROPRE d'une table de correspondance : `constructor` ou `__proto__` reçus ne lisent jamais `Object.prototype`. */
const propre = <T>(table: Record<string, T>, cle: string | null | undefined): T | undefined =>
  cle !== null && cle !== undefined && Object.hasOwn(table, cle) ? table[cle] : undefined;

export function libellesUnivers(univers: readonly string[]): string[] {
  return univers.flatMap((u) => {
    const libelle = propre(UNIVERS_LIBELLE, u);
    return libelle ? [libelle] : [];
  });
}

export function dimensionsEmploi(contrat: string, tempsDeTravail: string, teletravail: string | null): DimensionsEmploi & { workplaceType: string | null } {
  const c = propre(CONTRAT, contrat) ?? {};
  return {
    employmentTerm: c.employmentTerm ?? null,
    workTime: propre(TEMPS, tempsDeTravail) ?? null,
    programType: c.programType ?? null,
    engagementType: c.engagementType ?? null,
    workplaceType: propre(TELETRAVAIL, teletravail) ?? null,
  };
}

export function codesSecteur(univers: readonly string[], specialisations: readonly string[]): string[] {
  const codes = new Set<string>();
  for (const v of [...univers, ...specialisations]) {
    const code = propre(SECTEURS, v);
    if (code) codes.add(code);
  }
  return [...codes];
}

/** L'employeur d'une offre publiée par Catwalks sans Maison publique (D-455 §1). */
export const EMPLOYEUR_CATWALKS = 'Catwalks';

/**
 * L'EMPLOYEUR AFFICHÉ D'UNE OFFRE CATWALKS sur la page Emploi (D-455 §1, R-96) : le nom de sa Maison publique quand le
 * flux en porte une ; sinon « Catwalks ». L'univers et « Maison confidentielle » ne nomment jamais un employeur. Le
 * backend passe déjà la Maison par `maisonPublique` : le mandat interne arrive ici sans Maison (`maison: null`). Un
 * nom vide, que le contrat laisse passer, ne nomme pas une Maison.
 */
export function employeurAffiche(maison: { nom: string } | null): string {
  return maison?.nom.trim() || EMPLOYEUR_CATWALKS;
}

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
 * une nouvelle version, jamais une réécriture silencieuse.
 */
export const CORRESPONDANCE_DIRECTE_VERSION = 1;

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

/** Le libellé français d'un univers, pour nommer une offre dont la Maison est confidentielle. */
const UNIVERS_LIBELLE: Record<string, string> = { MODE: 'Mode', BEAUTE: 'Beauté', LUXE: 'Luxe' };

export function dimensionsEmploi(contrat: string, tempsDeTravail: string, teletravail: string | null): DimensionsEmploi & { workplaceType: string | null } {
  const c = CONTRAT[contrat] ?? {};
  return {
    employmentTerm: c.employmentTerm ?? null,
    workTime: TEMPS[tempsDeTravail] ?? null,
    programType: c.programType ?? null,
    engagementType: c.engagementType ?? null,
    workplaceType: teletravail ? TELETRAVAIL[teletravail] ?? null : null,
  };
}

export function codesSecteur(univers: readonly string[], specialisations: readonly string[]): string[] {
  const codes = new Set<string>();
  for (const v of [...univers, ...specialisations]) {
    const code = SECTEURS[v];
    if (code) codes.add(code);
  }
  return [...codes];
}

/** « Mode, Luxe » — le nom affiché quand la Maison ne sort pas (mandat confidentiel), comme sur `/offres`. */
export function nomUnivers(univers: readonly string[]): string {
  const noms = univers.map((u) => UNIVERS_LIBELLE[u]).filter((n): n is string => Boolean(n));
  return noms.length ? noms.join(', ') : 'Maison confidentielle';
}

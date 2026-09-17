/**
 * SPÉCIFICATION HORS RUNTIME (lot F1, 2026-09-16). Ce fichier a quitté
 * `apps/api/lib/matching/` par déplacement Git (historique conservé) : aucun
 * code de production ne l'importait, et le matching des candidats est le
 * prochain chantier, hors de la phase catalogue. Il n'est ni compilé ni testé
 * par les suites ; ses témoins (`vocabulaire-d421.test.ts`, à côté) documentent
 * la règle D-421 et se rejoueront quand le matching sera branché.
 *
 * Table de correspondance des VOCABULAIRES entre le catalogue agrégé
 * (Railway, anglais mondial) et les préférences d'un candidat Catwalks
 * (français métier) — D-421, premier lot du schéma canonique.
 *
 * Deux règles gravées par D-421, et qui expliquent toute la forme de ce
 * fichier :
 *
 *  1. **Une offre MUETTE n'est jamais éliminée.** Aucune fonction ici ne rend
 *     « faux » : elles rendent un NIVEAU de correspondance, que le moteur
 *     traduit en ordre. Absent ≠ incompatible.
 *  2. **Les trous sont assumés et NOMMÉS.** Là où le catalogue ne porte pas la
 *     donnée, la table le dit (`SANS_EQUIVALENT`) au lieu de deviner. Une
 *     correspondance inventée est pire qu'une correspondance absente : elle
 *     est invisible.
 *
 * Taux de remplissage mesurés le 14/09/2026 sur 83 431 offres actives
 * (`scripts/mesure-schema-canonique.mjs`) : contrat 31,5 % · séniorité 27,1 %
 * · télétravail 7,4 % · salaire 1,7 % · spécialisation 0 %.
 */

/** Ce que vaut une offre face à UN critère du candidat. L'ordre est le classement. */
export const CORRESPONDANCE = {
  /** L'offre déclare exactement ce que le candidat veut. */
  EXACTE: 'EXACTE',
  /** L'offre déclare une valeur voisine, acceptable (séniorité adjacente). */
  VOISINE: 'VOISINE',
  /** L'offre ne dit rien : elle reste, derrière celles qui parlent (D-421 §1). */
  MUETTE: 'MUETTE',
  /** L'offre déclare autre chose que ce que le candidat veut. */
  AUTRE: 'AUTRE',
} as const;
export type Correspondance = (typeof CORRESPONDANCE)[keyof typeof CORRESPONDANCE];

/** L'ordre de classement : plus le rang est bas, plus l'offre remonte. */
export const RANG: Record<Correspondance, number> = {
  EXACTE: 0,
  VOISINE: 1,
  MUETTE: 2,
  AUTRE: 3,
};

/** Marque explicite d'un axe que le catalogue agrégé ne porte pas. */
export const SANS_EQUIVALENT = Symbol('sans équivalent au catalogue agrégé');

// ---------------------------------------------------------------------------
// CONTRAT — Catwalks (CDI, CDD…) ↔ agrégateur (employmentTerm).
// Rempli à 31,5 % : 57 154 offres muettes. Le vocabulaire agrégateur est
// MONDIAL (PERMANENT n'est pas juridiquement un CDI, c'est sa traduction
// d'affichage — voir apps/api/lib/format.ts).
// ---------------------------------------------------------------------------
export const CONTRAT: Record<string, readonly string[] | typeof SANS_EQUIVALENT> = {
  CDI: ['PERMANENT'],
  CDD: ['FIXED_TERM'],
  INTERIM: ['TEMPORARY'],
  // Le catalogue ne distingue ni l'alternance ni le stage de la durée : ils
  // vivent dans `programType`, une AUTRE dimension (D-419 §3 du vocabulaire
  // d'emploi). Croisement à faire au lot suivant, pas à deviner ici.
  ALTERNANCE: SANS_EQUIVALENT,
  STAGE: SANS_EQUIVALENT,
  FREELANCE: SANS_EQUIVALENT,
};

// ---------------------------------------------------------------------------
// TEMPS DE TRAVAIL — rempli à 72,1 %, le mieux servi après le lieu.
// ---------------------------------------------------------------------------
export const TEMPS_DE_TRAVAIL: Record<string, readonly string[]> = {
  TEMPS_PLEIN: ['FULL_TIME'],
  TEMPS_PARTIEL: ['PART_TIME'],
};

// ---------------------------------------------------------------------------
// TÉLÉTRAVAIL — rempli à 7,4 % SEULEMENT (77 269 offres muettes).
// Le candidat déclare une fréquence souhaitée, le catalogue un lieu de
// travail : deux notions voisines, pas identiques.
// ---------------------------------------------------------------------------
export const TELETRAVAIL: Record<string, readonly string[]> = {
  NONE: ['ONSITE'],
  OCCASIONAL: ['HYBRID'],
  FREQUENT: ['HYBRID', 'REMOTE'],
  FULL: ['REMOTE'],
};

// ---------------------------------------------------------------------------
// SÉNIORITÉ — le candidat déclare des ANNÉES, le catalogue un NIVEAU.
// Rempli à 27,1 %. La correspondance est approximative par nature : elle
// produit donc des niveaux VOISINS, jamais un rejet.
// ---------------------------------------------------------------------------
const NIVEAUX_ORDONNES = ['JUNIOR', 'MID', 'SENIOR', 'MANAGER', 'DIRECTOR', 'EXECUTIVE'] as const;

export const SENIORITE: Record<string, { exacte: readonly string[]; voisine: readonly string[] }> = {
  LESS_THAN_2: { exacte: ['JUNIOR'], voisine: ['MID'] },
  TWO_TO_FIVE: { exacte: ['MID', 'SENIOR'], voisine: ['JUNIOR', 'MANAGER'] },
  FIVE_TO_TEN: { exacte: ['SENIOR', 'MANAGER'], voisine: ['MID', 'DIRECTOR'] },
  TEN_TO_FIFTEEN: { exacte: ['MANAGER', 'DIRECTOR'], voisine: ['SENIOR', 'EXECUTIVE'] },
  OVER_FIFTEEN: { exacte: ['DIRECTOR', 'EXECUTIVE'], voisine: ['MANAGER'] },
};

// ---------------------------------------------------------------------------
// UNIVERS — Catwalks en porte 3 (MODE, BEAUTE, LUXE), le catalogue 15 codes
// de secteur. Rempli à 57,3 %. Les comptes sont ceux du 14/09/2026.
// ---------------------------------------------------------------------------
export const UNIVERS: Record<string, readonly string[]> = {
  MODE: ['FASHION', 'LEATHER_GOODS', 'FOOTWEAR', 'EYEWEAR'],
  BEAUTE: ['BEAUTY', 'FRAGRANCE'],
  // « Luxe » n'est pas un secteur du catalogue : c'est un positionnement qui
  // traverse la joaillerie, l'horlogerie et l'hôtellerie de prestige.
  LUXE: ['JEWELRY', 'WATCHMAKING', 'HOSPITALITY', 'HOME_LIFESTYLE'],
};

// ---------------------------------------------------------------------------
// SPÉCIALISATION — le candidat en déclare une (soins, parfum, maroquinerie…),
// le catalogue n'en porte AUCUNE. 0 % : pas un trou de remplissage, un champ
// absent. Le métier (`occupationCode`, 48,4 %) est l'axe le plus proche.
// ---------------------------------------------------------------------------
export const SPECIALISATION = SANS_EQUIVALENT;

/**
 * Le niveau de correspondance d'une offre face à UNE préférence.
 * `valeurOffre` à `null` = la source ne l'a pas dit : MUETTE, jamais AUTRE.
 */
export function correspondance(
  valeurOffre: string | null | undefined,
  attendues: readonly string[] | typeof SANS_EQUIVALENT,
  voisines: readonly string[] = [],
): Correspondance {
  // Un axe sans équivalent ne départage rien : toutes les offres à égalité.
  if (attendues === SANS_EQUIVALENT) return CORRESPONDANCE.MUETTE;
  if (!valeurOffre) return CORRESPONDANCE.MUETTE;
  if (attendues.includes(valeurOffre)) return CORRESPONDANCE.EXACTE;
  if (voisines.includes(valeurOffre)) return CORRESPONDANCE.VOISINE;
  return CORRESPONDANCE.AUTRE;
}

/** Les niveaux de séniorité, du plus junior au plus élevé (pour les tests et l'affichage). */
export { NIVEAUX_ORDONNES };

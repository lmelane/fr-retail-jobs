/**
 * Mots de niveau hiérarchique sans domaine (D-475, points 32 c, 36 et 37). Un intitulé fait UNIQUEMENT de ces mots
 * (« Team Manager », « Team Leader », « Supervisor I », « General Manager », « Supervisor », « Lead ») reçoit un métier
 * d'encadrement pour l'intitulé EXACT seulement : il ne se généralise jamais, ni en règle (curation v3), ni en métier lu
 * dans un intitulé plus long (« Team Leader Corporate Tax » n'est pas un Floor manager). Une seule définition, pour la
 * curation (apps/aggregator/scripts/taxonomie/curation/commun.mts) et pour les métiers lus dans l'intitulé.
 */
const HIERARCHIE = new Set(["TEAM", "SHIFT", "LEAD", "LEADER", "MANAGER", "SUPERVISOR", "SUPERVISEUR", "SUPERVISEURE", "SUPERVISEUSE", "CHEF", "CHEFFE",
  "D", "DE", "DI", "EQUIPE", "GENERAL", "GENERALE", "RESPONSABLE", "ACTING", "SENIOR", "SR", "JUNIOR", "JR", "I", "II", "III", "IV", "1", "2", "3",
  "TEAMLEITER", "TEAMLEITERIN", "SCHICHTLEITER", "SCHICHTLEITERIN", "ENCARGADO", "ENCARGADA", "JEFE", "JEFA", "EQUIPO", "CAPO", "SQUADRA"]);
/** Une forme faite seulement de mots de niveau (mots séparés par des espaces, casse et accents indifférents). */
export function occupationLevelOnly(forme: string): boolean {
  const mots = forme.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return mots.length > 0 && mots.every((m) => HIERARCHIE.has(m));
}

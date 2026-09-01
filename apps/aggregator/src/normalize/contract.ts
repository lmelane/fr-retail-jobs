/**
 * Contract normalization across sources.
 *
 * Each ATS names contracts differently ("Permanent", "Full-time", "CDI",
 * "Regular"). Dedup compares postings across sources, so the contract has to
 * collapse to one vocabulary. The canonical set follows the French market
 * (and matches LVMH's own list, verified 2026-09-01).
 */

export type ContractType =
  | 'CDI'
  | 'CDD'
  | 'STAGE'
  | 'ALTERNANCE'
  | 'VIE'
  | 'INTERIM'
  | 'FREELANCE'
  | 'GRADUATE'
  | 'UNKNOWN';

/** Ordered: the first pattern that matches wins, so put specifics first. */
const PATTERNS: ReadonlyArray<readonly [ContractType, RegExp]> = [
  ['ALTERNANCE', /ALTERNANCE|APPRENTISSAGE|APPRENTICE|PROFESSIONNALISATION|WORK[ -]STUDY/],
  ['STAGE', /\bSTAGE\b|STAGIAIRE|INTERNSHIP|\bINTERN\b|\bTRAINEE\b/],
  ['VIE', /\bV\.?I\.?E\.?\b|VOLONTARIAT INTERNATIONAL/],
  ['GRADUATE', /GRADUATE PROGRAM|JEUNE DIPLOME/],
  ['INTERIM', /INTERIM|INT[ÉE]RIMAIRE|TEMPORARY|TEMP\b|MISSION|ZERO HEURE|ZERO[ -]HOUR/],
  ['FREELANCE', /FREELANCE|INDEPENDANT|CONSULTANT|PRESTATAIRE|SELF[ -]EMPLOYED/],
  ['CDD', /\bCDD\b|DUR[ÉE]E D[ÉE]TERMIN[ÉE]E|FIXED[ -]TERM|CONTRAT TEMPORAIRE/],
  // CDI last: "permanent"/"regular" are the generic default many ATS emit.
  ['CDI', /\bCDI\b|IND[ÉE]TERMIN[ÉE]E|PERMANENT|\bREGULAR\b|FULL[ -]TIME EMPLOYEE/],
];

export function normalizeContract(raw?: string | null): ContractType {
  if (!raw) return 'UNKNOWN';
  const value = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

  for (const [type, pattern] of PATTERNS) {
    if (pattern.test(value)) return type;
  }
  return 'UNKNOWN';
}

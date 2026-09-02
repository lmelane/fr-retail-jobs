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

function upper(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

export function normalizeContract(raw?: string | null): ContractType {
  if (!raw) return 'UNKNOWN';
  const value = upper(raw);

  for (const [type, pattern] of PATTERNS) {
    if (pattern.test(value)) return type;
  }
  return 'UNKNOWN';
}

/**
 * Working time — a different question from the contract, and the schema keeps
 * them apart.
 *
 * Several ATS put "Full-time" or "Plein Temps" in their contract field, which
 * is not a contract type at all. Left unmapped it fell through to UNKNOWN and
 * the UI printed the source's raw English, so a French jobboard showed
 * "Full-time" next to "CDI".
 */
export type WorkingTime = 'TEMPS_PLEIN' | 'TEMPS_PARTIEL' | 'UNKNOWN';

const WORKING_TIME: ReadonlyArray<readonly [WorkingTime, RegExp]> = [
  ['TEMPS_PARTIEL', /PART[ -]TIME|TEMPS[ -]PARTIEL|MI[ -]TEMPS|\d{1,2}\s?H\b/],
  ['TEMPS_PLEIN', /FULL[ -]TIME|TEMPS[ -]PLEIN|PLEIN[ -]TEMPS|35H|39H/],
];

export function normalizeWorkingTime(raw?: string | null): WorkingTime {
  if (!raw) return 'UNKNOWN';
  const value = upper(raw);

  for (const [type, pattern] of WORKING_TIME) {
    if (pattern.test(value)) return type;
  }
  return 'UNKNOWN';
}

/**
 * True when a value names a working time rather than a contract.
 *
 * Lets the pipeline move a misfiled "Full-time" out of the contract column
 * instead of storing it as an unknown contract.
 */
export function isWorkingTimeValue(raw?: string | null): boolean {
  return normalizeWorkingTime(raw) !== 'UNKNOWN' && normalizeContract(raw) === 'UNKNOWN';
}

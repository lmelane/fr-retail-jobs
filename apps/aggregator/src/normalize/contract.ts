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

/**
 * The contract, read from the posting's own words when the field is useless.
 *
 * Real case, from the screen: Galeries Lafayette files "FULL_TIME" as the
 * employmentType (a working time, not a contract) and announces the actual
 * contract in the CLOSING lines — "🚩 Nous proposons un contrat en CDI de
 * 35h". A 400-character window never reached it, so the offer showed no
 * contract at all.
 *
 * Two confidence tiers keep this safe on long text:
 *  - CDI / CDD / intérim / V.I.E are unambiguous tokens in French job copy;
 *    they are trusted ANYWHERE in the description.
 *  - stage / alternance also appear incidentally ("après un stage réussi",
 *    "encadrer les alternants"), so they only count near the top, where a
 *    posting announces its own nature.
 */
export function extractContract(title?: string | null, description?: string | null): ContractType {
  const fromTitle = normalizeContract(title);
  if (fromTitle !== 'UNKNOWN') return fromTitle;

  const text = description ?? '';

  // The unambiguous tokens win first, wherever they appear: a posting that
  // says "évoluerez vers un CDI" after mentioning "nos alternants" is a CDI —
  // the incidental word must not outrank the explicit contract.
  const anywhere = upper(text);
  if (/\bCDI\b/.test(anywhere)) return 'CDI';
  if (/\bCDD\b|DUR[E]E DETERMIN/.test(anywhere)) return 'CDD';
  if (/\bINTERIM\b|INT[E]RIMAIRE/.test(anywhere)) return 'INTERIM';
  if (/\bV\.?I\.?E\.?\b/.test(anywhere)) return 'VIE';

  const head = upper(text.slice(0, 400));
  for (const type of ['ALTERNANCE', 'STAGE', 'GRADUATE'] as const) {
    const pattern = PATTERNS.find(([name]) => name === type)?.[1];
    if (pattern?.test(head)) return type;
  }

  return 'UNKNOWN';
}

/**
 * A salary band, read from prose when the structured field is empty.
 *
 * Deliberately conservative: only euro amounts with an explicit currency mark
 * count ("2 000 €", "35K€", "30 000 - 35 000 EUR"), because bare numbers in a
 * posting are usually hours, headcounts or years. Amounts under 500 are
 * treated as hourly/daily noise and ignored rather than guessed at.
 */
export function extractSalaryBand(
  description?: string | null,
): { min?: number; max?: number; period?: 'YEAR' | 'MONTH' } | null {
  if (!description) return null;
  const text = description.replace(/ /g, ' ');

  const toAmount = (raw: string): number => {
    const cleaned = raw.replace(/[\s.]/g, '').replace(',', '.');
    const value = Number(cleaned.replace(/K/i, ''));
    return /K/i.test(raw) ? value * 1000 : value;
  };

  const band = text.match(
    /(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)?\s?(?:-|à|et)\s?(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)/i,
  );
  if (band) {
    const min = toAmount(band[1]);
    const max = toAmount(band[2]);
    if (min >= 500 && max >= min) {
      return { min, max, period: min < 10_000 ? 'MONTH' : 'YEAR' };
    }
  }

  const single = text.match(/(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)/i);
  if (single) {
    const value = toAmount(single[1]);
    if (value >= 500) return { min: value, period: value < 10_000 ? 'MONTH' : 'YEAR' };
  }

  return null;
}

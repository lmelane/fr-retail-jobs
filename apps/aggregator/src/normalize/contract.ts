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

/**
 * Ordered: the first pattern that matches wins, so put specifics first.
 *
 * The explicit French contract tokens (CDI, CDD) come FIRST: a "Consultant … CDI"
 * or a "Mission d'intérim … CDD" states its contract outright, and that must
 * outrank the role word ("Consultant") or a loose "mission". A word that names a
 * *job* (consultant) is never a contract by itself.
 */
const PATTERNS: ReadonlyArray<readonly [PatternType, RegExp]> = [
  // Explicit, unambiguous contract tokens win over role words and generic terms.
  // l2 (2026-09-06) : « Temporary » / « Seasonal » sont ce que les ATS anglophones
  // publient pour un contrat à durée déterminée (Eightfold « Fulltime-Temporary »,
  // Sephora « Seasonal Associate ») — un CDD, pas une mission d'intérim.
  ['CDD', /\bCDD\b|DUR[ÉE]E D[ÉE]TERMIN[ÉE]E|FIXED[ -]?TERM|CONTRAT TEMPORAIRE|\bTEMPORARY\b|\bTEMP\b|SEASONAL|SAISONNI/],
  ['CDI', /\bCDI\b|CONTRAT (?:À|A) DUR[ÉE]E IND[ÉE]TERMIN[ÉE]E/],
  ['ALTERNANCE', /ALTERNANCE|APPRENTISSAGE|APPRENTICE|PROFESSIONNALISATION|WORK[ -]STUDY/],
  ['STAGE', /\bSTAGE\b|STAGIAIRE|INTERNSHIP|\bINTERN\b|\bTRAINEE\b/],
  // V.I.E only via the dotted form or the full wording — the bare word "VIE"
  // collides with the French word "vie" (qualité de vie, assurance vie) once
  // uppercased, and flooded the classifier with false positives.
  ['VIE', /\bV\.I\.E\.?\b|VOLONTARIAT INTERNATIONAL/],
  ['GRADUATE', /GRADUATE PROGRAM|JEUNE DIPLOME/],
  // "MISSION" alone is dropped (Commission/Emission/"Chef de Mission"); a real
  // interim mission carries "intérim" and matches through INTERIM below.
  ['INTERIM', /\bINTERIM\b|INT[ÉE]RIMAIRE|ZERO HEURE|ZERO[ -]HOUR/],
  // CONSULTANT dropped: a consultant can be a salaried employee. Only words that
  // genuinely name a freelance arrangement qualify.
  ['FREELANCE', /FREELANCE|\bINDEPENDANT\b|PRESTATAIRE|SELF[ -]EMPLOYED/],
  // Generic defaults last: "permanent"/"regular" are what many ATS emit for any
  // open-ended role.
  ['CDI_GENERIC', /IND[ÉE]TERMIN[ÉE]E|PERMANENT|\bREGULAR\b|FULL[ -]TIME EMPLOYEE/],
];

/** CDI_GENERIC is a matching tier, not a stored type — it resolves to CDI. */
type PatternType = ContractType | 'CDI_GENERIC';

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
    if (pattern.test(value)) return type === 'CDI_GENERIC' ? 'CDI' : type;
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

/**
 * l2 (2026-09-06) : `PART_TIME` / `FULL_TIME` (schema.org, Phenom, Workday
 * `timeType`, Jibe) ne passaient pas le `[ -]` — 64 472 offres sans temps de
 * travail (84 %). La forme collée (« Fulltime-Regular », Eightfold), l'allemand
 * (Teilzeit / Vollzeit, Kastner & Öhler) et le chinois (全职 / 兼职, LVMH) sont
 * lus aussi ; « À temps plein » (Workday fr-FR) passe par la perte d'accents.
 */
const WORKING_TIME: ReadonlyArray<readonly [WorkingTime, RegExp]> = [
  // Un horaire chiffré n'est un temps partiel qu'en dessous de 35 h : « 35H »
  // et « 39H » tombaient ici avant d'atteindre la ligne temps plein (revue l2).
  ['TEMPS_PARTIEL', /PART[ _-]?TIME|TEMPS[ -]PARTIEL|MI[ -]TEMPS|TEILZEIT|兼职|\b(?:[0-2]?\d|3[0-4])\s?H\b/],
  ['TEMPS_PLEIN', /FULL[ _-]?TIME|TEMPS[ -]PLEIN|PLEIN[ -]TEMPS|VOLLZEIT|全职|\b3[5-9]\s?H\b/],
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

/** True when a value names a contract or a working time — anything the two normalizers recognise. */
export function isEmploymentTerm(raw?: string | null): boolean {
  return normalizeContract(raw) !== 'UNKNOWN' || normalizeWorkingTime(raw) !== 'UNKNOWN';
}

/**
 * The employment terms among a source's loose, tenant-configured values.
 *
 * Phenom-family APIs (Foot Locker, Ulta/Jibe) publish the contract and the
 * working time in numbered `tags` whose meaning each tenant chooses: Foot Locker
 * puts « Regular Part-Time » in tags2 next to a date in tags1 and a banner in
 * tags4. Only the values that NAME a term are kept, joined so the contract and
 * the working-time normalizers each find their word — a date or a banner never
 * reaches the contract column.
 */
export function employmentTermsFrom(values: ReadonlyArray<unknown>): string | undefined {
  const terms = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => (value === undefined || value === null ? '' : String(value).trim()))
    .filter((value) => value && isEmploymentTerm(value));
  return terms.length ? [...new Set(terms)].join(' · ') : undefined;
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
  // the incidental word must not outrank the explicit contract. But a NEGATED
  // token ("pas un CDI", "hors CDI") is not that contract, so a negation
  // immediately before the token disqualifies it.
  const anywhere = upper(text);
  const negatedBefore = (token: string) =>
    new RegExp(`\\b(?:PAS|NON|SANS|HORS|NI)\\b[^.;:!?]{0,20}\\b${token}\\b`).test(anywhere);
  const hasToken = (re: RegExp, token: string) => re.test(anywhere) && !negatedBefore(token);

  if (hasToken(/\bCDI\b/, 'CDI')) return 'CDI';
  if (hasToken(/\bCDD\b|DUR[E]E DETERMIN/, 'CDD')) return 'CDD';
  if (hasToken(/\bINTERIM\b|INT[E]RIMAIRE/, 'INTERIM')) return 'INTERIM';
  // V.I.E only via the dotted form here too — never the bare "vie".
  if (/\bV\.I\.E\.?\b/.test(anywhere)) return 'VIE';

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
/** Words that mark a euro amount as compensation rather than any other figure. */
const PAY_CONTEXT =
  /SALAIRE|SALARY|R[ÉE]MUN[ÉE]RATION|PACKAGE|\bBRUT\b|\bNET\b|COMPENSATION|K€|€\s?(?:BRUT|NET)|PAR\s?(?:AN|MOIS)|\/\s?(?:AN|MOIS|MONTH|YEAR)|ANNUEL|MENSUEL|PER\s?(?:YEAR|MONTH|ANNUM)/;

export function extractSalaryBand(
  description?: string | null,
): { min?: number; max?: number; period?: 'YEAR' | 'MONTH' } | null {
  if (!description) return null;
  const text = description.replace(/ /g, ' ');

  const upperText = upper(text);

  const toAmount = (raw: string): number => {
    const cleaned = raw.replace(/[\s.]/g, '').replace(',', '.');
    const value = Number(cleaned.replace(/K/i, ''));
    return /K/i.test(raw) ? value * 1000 : value;
  };

  // A pay word must appear within ~60 chars of the amount — a turnover or
  // budget figure elsewhere in the same posting must not qualify it.
  const hasPayContext = (index: number, length: number): boolean =>
    PAY_CONTEXT.test(upperText.slice(Math.max(0, index - 60), index + length + 60));

  const band = text.match(
    /(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)?\s?(?:-|à|et)\s?(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)/i,
  );
  if (band && band.index !== undefined && hasPayContext(band.index, band[0].length)) {
    const min = toAmount(band[1]);
    const max = toAmount(band[2]);
    if (min >= 500 && max >= min) {
      return { min, max, period: min < 10_000 ? 'MONTH' : 'YEAR' };
    }
  }

  const single = text.match(/(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)/i);
  if (single && single.index !== undefined && hasPayContext(single.index, single[0].length)) {
    const value = toAmount(single[1]);
    if (value >= 500) return { min: value, period: value < 10_000 ? 'MONTH' : 'YEAR' };
  }

  return null;
}

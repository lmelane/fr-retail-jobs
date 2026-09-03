const RELATIVE = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

/**
 * Offer title, normalised for display only (design_2.md [UX] §2.3): a source
 * that shouts "STAGE - INGENIEUR.E PLANIFICATION (H/F)" is rendered
 * "Stage - Ingénieur.e planification (H/F)". Sentence case — first letter up,
 * the rest down — EXCEPT recognised acronyms and tokens already mixed-case in the
 * source (a real Maison name like "iOS" or "L'Oréal" keeps its casing). The
 * ingest and the stored value are untouched; this is purely at render time.
 */
const KEEP_UPPER = new Set([
  'H/F', 'F/H', 'H', 'F', 'CDI', 'CDD', 'VIE', 'RTW', 'S&OP', 'DE&I', 'HR', 'RH', 'IT',
  'CDD/CDI', 'BTP', 'QHSE', 'RSE', 'KPI', 'B2B', 'B2C', 'UX', 'UI', 'PLV', 'SAV',
]);
export function displayTitle(raw: string): string {
  if (!raw) return raw;
  // Only rewrite a title that is (almost) all-caps — leave a well-cased one alone.
  const letters = raw.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const isShouting = letters.length > 0 && letters === letters.toUpperCase();
  return raw
    .split(/(\s+|[-–—/·|(),])/)
    .map((tok) => {
      if (!/[A-Za-zÀ-ÿ]/.test(tok)) return tok; // separators/spaces
      const upper = tok.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      // Roman numerals (II, III, IV…) and any short token containing & (FP&A,
      // S&OP, R&D) stay uppercase — they read wrong title-cased.
      if (/^[IVXLCDM]{2,}$/.test(upper) || (upper.includes('&') && upper.length <= 5)) return upper;
      // A token that is mixed-case in the source is intentional — keep it.
      if (!isShouting && tok !== upper) return tok;
      return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    })
    .join('')
    .replace(/^(.)/, (c) => c.toUpperCase());
}

/**
 * "il y a 3 jours" rather than a date: on a job board, recency is the signal a
 * candidate scans for, and an absolute date makes them do the arithmetic.
 *
 * Kept out of lib/utils.ts because the shadcn CLI owns that file and overwrites
 * it on every `add`.
 */
export function relativeDate(date: Date | string | null): string {
  if (!date) return '';
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "aujourd'hui";
  if (days > -31) return RELATIVE.format(days, 'day');
  return RELATIVE.format(Math.round(days / 30), 'month');
}

/**
 * French display labels for the normalized vocabularies.
 *
 * The normalizers answer "UNKNOWN" when a source states nothing — that is a
 * non-answer, not a value, and it reached the screen as a literal chip reading
 * "UNKNOWN" on every offer whose source omits the field. contractLabel returns
 * null for it so callers render nothing instead.
 */
const CONTRACT_LABELS: Record<string, string> = {
  CDI: 'CDI',
  CDD: 'CDD',
  STAGE: 'Stage',
  ALTERNANCE: 'Alternance',
  VIE: 'V.I.E',
  INTERIM: 'Intérim',
  FREELANCE: 'Freelance',
  GRADUATE: 'Graduate program',
  TEMPS_PLEIN: 'Temps plein',
  TEMPS_PARTIEL: 'Temps partiel',
};

export function contractLabel(value: string | null | undefined): string | null {
  if (!value || value === 'UNKNOWN') return null;
  return CONTRACT_LABELS[value] ?? value;
}

const RELATIVE = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

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

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

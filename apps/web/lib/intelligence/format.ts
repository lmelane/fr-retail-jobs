/**
 * Seuils et formatteurs Catwalks Intelligence.
 *
 * Règle 3 du brief : une métrique DÉRIVÉE sous seuil (moins de 30 offres, ou
 * moins de 2 jours de snapshot) s'affiche « n/d — échantillon insuffisant »,
 * jamais un chiffre trompeur. Un FAIT (un compte) s'affiche toujours : 12
 * offres, c'est 12 offres.
 */

export const MIN_SAMPLE = 30;
export const MIN_SNAPSHOT_DAYS = 2;
/**
 * Début de l'observation FIABLE des nouvelles offres : le catalogue a été
 * consolidé le 2026-09-06 (23 portails ajoutés, une quarantaine de sources
 * retirées, WTTJ par balayage sectoriel) — jusqu'à ce jour inclus, « vue pour
 * la première fois » mesure l'entrée d'une source au catalogue, pas le marché
 * (mesuré en prod : « 32 600 nouvelles offres en 24 h » le jour même). Une
 * fenêtre de N jours ne s'affiche que N jours après cette date.
 */
export const OBSERVATION_START = '2026-09-07';

/** La fenêtre de N jours est-elle entièrement couverte par l'observation fiable ? */
export function windowAvailable(days: number, today = isoDay(new Date())): boolean {
  return addDays(OBSERVATION_START, days) <= today;
}

/** Date à partir de laquelle une fenêtre de N jours devient disponible. */
export function windowFrom(days: number): string {
  return addDays(OBSERVATION_START, days);
}

const NF_RAW = new Intl.NumberFormat('fr-FR');
const NF1_RAW = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/**
 * fr-FR sépare les milliers par une espace fine insécable (U+202F) que la
 * police display du site ne dessine pas : « 71525 » à l'écran. L'espace
 * insécable classique (U+00A0) existe dans toutes les polices.
 */
const glyphSafe = (s: string) => s.replace(/\u202f/g, '\u00a0');
const NF = { format: (n: number) => glyphSafe(NF_RAW.format(n)) };
const NF1 = { format: (n: number) => glyphSafe(NF1_RAW.format(n)) };
const DF = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const DF_SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export function fmtInt(n: number): string {
  return NF.format(Math.round(n));
}

/** 0.342 → « 34,2 % ». */
export function fmtPct(ratio: number, digits: 0 | 1 = 1): string {
  const value = ratio * 100;
  return `${digits === 0 ? NF.format(Math.round(value)) : NF1.format(value)} %`;
}

/** +12 → « +12 », -3 → « −3 » (vrai signe moins), 0 → « 0 ». */
export function fmtSigned(n: number): string {
  if (n > 0) return `+${NF.format(n)}`;
  if (n < 0) return `−${NF.format(Math.abs(n))}`;
  return '0';
}

/** Variation relative signée : 0.072 → « +7,2 % ». */
export function fmtSignedPct(ratio: number): string {
  const value = ratio * 100;
  if (value > 0) return `+${NF1.format(value)} %`;
  if (value < 0) return `−${NF1.format(Math.abs(value))} %`;
  return `0,0 %`;
}

/** Indice base 100 : 112.37 → « 112,4 ». */
export function fmtIndex(v: number): string {
  return NF1.format(v);
}

export function fmtDays(d: number): string {
  return `${NF.format(Math.round(d))} j`;
}

/** ISO date (YYYY-MM-DD ou ISO complet) → « 6 sept. 2026 ». */
export function fmtDate(iso: string): string {
  return DF.format(parseIso(iso));
}

export function fmtDateShort(iso: string): string {
  return DF_SHORT.format(parseIso(iso));
}

function parseIso(iso: string): Date {
  // Une date-seule est interprétée en UTC par Date : on la fixe à midi pour
  // qu'aucun fuseau ne la fasse basculer la veille à l'affichage.
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
}

/** YYYY-MM-DD d'une date, en UTC (les snapshots sont des DATE). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

/** Pourquoi une métrique n'est pas affichée. */
export type NotAvailable =
  | { kind: 'insufficient'; n: number }
  | { kind: 'from'; date: string }
  | { kind: 'none' };

export const NA_INSUFFICIENT = (n: number): NotAvailable => ({ kind: 'insufficient', n });
export const NA_FROM = (date: string): NotAvailable => ({ kind: 'from', date });
export const NA_NONE: NotAvailable = { kind: 'none' };

/** Texte affiché à la place d'une métrique indisponible. */
export function naText(na: NotAvailable): string {
  switch (na.kind) {
    case 'insufficient':
      return 'n/d — échantillon insuffisant';
    case 'from':
      return `disponible à partir du ${fmtDate(na.date)}`;
    case 'none':
      return 'n/d';
  }
}

/** Slug : minuscules, accents retirés, non-alphanumériques → tirets. */
export function kebab(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Slug d'une ville : `fr-paris`, `ae-dubai`. */
export function citySlug(countryCode: string, city: string): string {
  return `${countryCode.toLowerCase()}-${kebab(city)}`;
}

/** Sépare `fr-paris` en { cc: 'FR', rest: 'paris' } ; null si mal formé. */
export function parseCitySlug(slug: string): { cc: string; rest: string } | null {
  const m = /^([a-z]{2})-(.+)$/.exec(slug);
  if (!m) return null;
  return { cc: m[1].toUpperCase(), rest: m[2] };
}

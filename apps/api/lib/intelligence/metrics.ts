import { MIN_SAMPLE, MIN_SNAPSHOT_DAYS, addDays, type NotAvailable, NA_FROM, NA_INSUFFICIENT, NA_NONE } from './format';

/**
 * Métriques DÉRIVÉES (niveau 2) — fonctions pures sur des séries et des
 * comptes, testées sur des séries synthétiques. Aucune ne lit la base ; aucune
 * n'invente : sans historique suffisant, elle rend un `NotAvailable` daté.
 */

export type SnapshotPoint = {
  /** YYYY-MM-DD */
  date: string;
  activeJobs: number;
  newJobs: number;
  closedJobs: number;
  hiringCompanies: number;
  medianLifespanDays: number | null;
  reopenedJobs: number;
};

export type Result<T> = { ok: true; value: T } | { ok: false; na: NotAvailable };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const na = <T>(reason: NotAvailable): Result<T> => ({ ok: false, na: reason });

/** Le point daté exactement `daysBack` jours avant le dernier point, s'il existe. */
export function pointDaysBefore(series: ReadonlyArray<SnapshotPoint>, daysBack: number): SnapshotPoint | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const target = addDays(last.date, -daysBack);
  return series.find((p) => p.date === target) ?? null;
}

/**
 * Catwalks Global Hiring Index : base 100 au PREMIER snapshot du périmètre,
 * valeur(jour) = activeJobs(jour) / activeJobs(base) × 100.
 */
export function indexBase100(series: ReadonlyArray<SnapshotPoint>): Result<{ date: string; value: number }[]> {
  if (series.length < MIN_SNAPSHOT_DAYS) {
    return na(series.length === 0 ? NA_NONE : NA_FROM(addDays(series[0].date, MIN_SNAPSHOT_DAYS - 1)));
  }
  const base = series[0].activeJobs;
  if (base <= 0) return na(NA_INSUFFICIENT(base));
  return ok(series.map((p) => ({ date: p.date, value: (p.activeJobs / base) * 100 })));
}

/** Variation des actives entre le dernier point et J-`daysBack` (exacte, jamais interpolée). */
export function variation(
  series: ReadonlyArray<SnapshotPoint>,
  daysBack: number,
): Result<{ from: number; to: number; abs: number; pct: number }> {
  if (series.length === 0) return na(NA_NONE);
  const last = series[series.length - 1];
  const before = pointDaysBefore(series, daysBack);
  if (!before) return na(NA_FROM(addDays(series[0].date, daysBack)));
  if (before.activeJobs < MIN_SAMPLE) return na(NA_INSUFFICIENT(before.activeJobs));
  const abs = last.activeJobs - before.activeJobs;
  return ok({ from: before.activeJobs, to: last.activeJobs, abs, pct: abs / before.activeJobs });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Hiring momentum (0-100). Formule documentée sur /intelligence/methodologie :
 *   50 + 20·m7 + 15·m30 + 10·flux + 5·largeur, borné à [0, 100], où
 *   m7   = variation 7 j des actives / 10 %   (bornée ±1)
 *   m30  = variation 30 j des actives / 20 %  (bornée ±1 ; neutre = 0 tant que J-30 n'existe pas)
 *   flux = (nouvelles − fermées) / (nouvelles + fermées) sur les 7 derniers jours
 *   largeur = variation 7 j du nombre d'entités qui recrutent / 10 % (bornée ±1)
 * 50 = marché stable. Rien n'est affiché sous 2 snapshots ni sans point J-7.
 */
export function momentum(series: ReadonlyArray<SnapshotPoint>): Result<{ score: number; m7: number; m30: number; flow: number; breadth: number }> {
  if (series.length === 0) return na(NA_NONE);
  // Le point J-7 est requis : la date annoncée est celle où il existera,
  // pas celle du 2e snapshot (qui ne suffirait pas).
  const last = series[series.length - 1];
  const p7 = pointDaysBefore(series, 7);
  if (!p7) return na(NA_FROM(addDays(series[0].date, 7)));
  if (p7.activeJobs < MIN_SAMPLE) return na(NA_INSUFFICIENT(p7.activeJobs));
  const p30 = pointDaysBefore(series, 30);

  const m7 = clamp((last.activeJobs - p7.activeJobs) / p7.activeJobs / 0.1, -1, 1);
  const m30 = p30 && p30.activeJobs > 0 ? clamp((last.activeJobs - p30.activeJobs) / p30.activeJobs / 0.2, -1, 1) : 0;

  const week = series.filter((p) => p.date > p7.date);
  const opened = week.reduce((s, p) => s + p.newJobs, 0);
  const closed = week.reduce((s, p) => s + p.closedJobs, 0);
  const flow = opened + closed === 0 ? 0 : (opened - closed) / (opened + closed);

  const breadth = p7.hiringCompanies > 0 ? clamp((last.hiringCompanies - p7.hiringCompanies) / p7.hiringCompanies / 0.1, -1, 1) : 0;

  const score = Math.round(clamp(50 + 20 * m7 + 15 * m30 + 10 * flow + 5 * breadth, 0, 100));
  return ok({ score, m7, m30, flow, breadth });
}

/** Part de marché : part / total — seuil sur le PÉRIMÈTRE comme sur le total (audit I-1 : 0,0 % affiché à 0 offre). */
export function share(part: number, total: number): Result<number> {
  if (total < MIN_SAMPLE) return na(NA_INSUFFICIENT(total));
  if (part < MIN_SAMPLE) return na(NA_INSUFFICIENT(part));
  return ok(part / total);
}

/** Concentration : part des N premiers employeurs (comptes triés desc) dans le total. */
export function concentration(counts: ReadonlyArray<number>, total: number, top = 10): Result<{ top: number; share: number }> {
  if (total < MIN_SAMPLE) return na(NA_INSUFFICIENT(total));
  const sorted = [...counts].sort((a, b) => b - a).slice(0, top);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return ok({ top: sorted.length, share: sum / total });
}

/** Médiane d'un échantillon (interpolation linéaire, comme percentile_cont). */
export function median(values: ReadonlyArray<number>): Result<number> {
  if (values.length < MIN_SAMPLE) return na(NA_INSUFFICIENT(values.length));
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return ok((sorted[lo] + sorted[hi]) / 2);
}

/** Taux de repost : offres avec reopenedCount > 0 / actives. */
export function repostRate(reopened: number, active: number): Result<number> {
  if (active < MIN_SAMPLE) return na(NA_INSUFFICIENT(active));
  return ok(reopened / active);
}

/**
 * Intensité vs référence : actives d'une Maison / moyenne de ses snapshots
 * sur 90 j. Sans historique → n/d daté (le premier snapshot + 2 j).
 */
export function intensity(current: number, series: ReadonlyArray<SnapshotPoint>): Result<number> {
  if (series.length < MIN_SNAPSHOT_DAYS) {
    return na(series.length === 0 ? NA_NONE : NA_FROM(addDays(series[0].date, MIN_SNAPSHOT_DAYS - 1)));
  }
  const last = series[series.length - 1];
  const window = series.filter((p) => p.date > addDays(last.date, -90));
  const mean = window.reduce((s, p) => s + p.activeJobs, 0) / window.length;
  if (mean < MIN_SAMPLE) return na(NA_INSUFFICIENT(Math.round(mean)));
  return ok(current / mean);
}

/** Un compte suffit-il pour une métrique dérivée ? */
export function sampleOk(n: number): boolean {
  return n >= MIN_SAMPLE;
}

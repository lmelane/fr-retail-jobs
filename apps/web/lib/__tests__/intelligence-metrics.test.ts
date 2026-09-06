import { describe, it, expect } from 'vitest';
import { concentration, indexBase100, intensity, median, momentum, pointDaysBefore, repostRate, share, variation, type SnapshotPoint } from '../intelligence/metrics';

/**
 * Métriques dérivées sur des séries SYNTHÉTIQUES : chaque formule est pinée
 * par un cas exact, et chaque garde (seuil 30, 2 snapshots, point J-n absent)
 * rend un n/d daté plutôt qu'un chiffre.
 */
function series(values: number[], start = '2026-09-06', extra: Partial<SnapshotPoint> = {}): SnapshotPoint[] {
  return values.map((activeJobs, i) => {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), activeJobs, newJobs: 0, closedJobs: 0, hiringCompanies: 10, medianLifespanDays: null, reopenedJobs: 0, ...extra };
  });
}

describe('indexBase100', () => {
  it('is 100 at the first snapshot and scales with active jobs', () => {
    const r = indexBase100(series([200, 220, 180]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((p) => Math.round(p.value * 10) / 10)).toEqual([100, 110, 90]);
  });
  it('is n/d with an empty table, and dated with a single snapshot', () => {
    expect(indexBase100([])).toEqual({ ok: false, na: { kind: 'none' } });
    expect(indexBase100(series([100]))).toEqual({ ok: false, na: { kind: 'from', date: '2026-09-07' } });
  });
  it('refuses a zero base', () => {
    expect(indexBase100(series([0, 5])).ok).toBe(false);
  });
});

describe('variation / pointDaysBefore', () => {
  const s = series([100, 101, 102, 103, 104, 105, 106, 110]); // 8 points: J-7 exists
  it('compares to the point dated exactly J-n, never interpolated', () => {
    expect(pointDaysBefore(s, 7)?.activeJobs).toBe(100);
    const v = variation(s, 7);
    expect(v).toEqual({ ok: true, value: { from: 100, to: 110, abs: 10, pct: 0.1 } });
  });
  it('is dated when J-n does not exist yet', () => {
    expect(variation(s, 30)).toEqual({ ok: false, na: { kind: 'from', date: '2026-10-06' } });
  });
  it('is insufficient when the reference point is under the sample threshold', () => {
    expect(variation(series([10, 10, 10, 10, 10, 10, 10, 12]), 7)).toEqual({ ok: false, na: { kind: 'insufficient', n: 10 } });
  });
});

describe('momentum', () => {
  it('is 50 on a flat market', () => {
    const r = momentum(series([100, 100, 100, 100, 100, 100, 100, 100]));
    expect(r.ok && r.value.score).toBe(50);
  });
  it('rises with growth, new postings and breadth, capped at 100', () => {
    const s = series([100, 105, 110, 115, 120, 125, 130, 140], '2026-09-06', { newJobs: 30, closedJobs: 5 });
    s[7].hiringCompanies = 13;
    const r = momentum(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // m7 = +40 % / 10 % → 1 ; m30 absent → 0 ; flux = (210-35)/(245) ≈ 0.71 ; largeur = +30 % / 10 % → 1
    expect(r.value.m7).toBe(1);
    expect(r.value.m30).toBe(0);
    expect(r.value.breadth).toBe(1);
    expect(r.value.score).toBe(Math.round(50 + 20 + 0 + 10 * (175 / 245) + 5));
  });
  it('falls on contraction, floored at 0', () => {
    const s = series([200, 190, 180, 170, 160, 150, 140, 100], '2026-09-06', { newJobs: 0, closedJobs: 20 });
    s[7].hiringCompanies = 5;
    const r = momentum(s);
    expect(r.ok && r.value.score).toBe(Math.round(50 - 20 - 10 - 5));
  });
  it('shows nothing under 2 snapshots or without a J-7 point', () => {
    expect(momentum([])).toEqual({ ok: false, na: { kind: 'none' } });
    expect(momentum(series([100]))).toEqual({ ok: false, na: { kind: 'from', date: '2026-09-13' } });
    expect(momentum(series([100, 101, 102]))).toEqual({ ok: false, na: { kind: 'from', date: '2026-09-13' } });
  });
});

describe('share / concentration / median / repostRate / intensity', () => {
  it('share is thresholded on the perimeter AND the total (audit I-1 : « 0,0 % » shown at 0 offers)', () => {
    expect(share(30, 120)).toEqual({ ok: true, value: 0.25 });
    expect(share(15, 60)).toEqual({ ok: false, na: { kind: 'insufficient', n: 15 } });
    expect(share(15, 29)).toEqual({ ok: false, na: { kind: 'insufficient', n: 29 } });
    expect(share(0, 2000)).toEqual({ ok: false, na: { kind: 'insufficient', n: 0 } });
  });
  it('concentration takes the ten largest counts', () => {
    const counts = [50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3];
    const r = concentration(counts, 192);
    expect(r.ok && r.value.top).toBe(10);
    expect(r.ok ? r.value.share : NaN).toBeCloseTo(185 / 192, 6);
  });
  it('median interpolates like percentile_cont', () => {
    const even = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30 → (15+16)/2
    expect(median(even)).toEqual({ ok: true, value: 15.5 });
    expect(median([1, 2, 3])).toEqual({ ok: false, na: { kind: 'insufficient', n: 3 } });
  });
  it('repost rate needs 30 active offers', () => {
    expect(repostRate(3, 30)).toEqual({ ok: true, value: 0.1 });
    expect(repostRate(3, 10).ok).toBe(false);
  });
  it('intensity compares to the 90-day snapshot mean', () => {
    const s = series([100, 100, 100, 100]);
    expect(intensity(140, s)).toEqual({ ok: true, value: 1.4 });
    expect(intensity(140, [])).toEqual({ ok: false, na: { kind: 'none' } });
  });
});

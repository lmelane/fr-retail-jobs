/**
 * Reporting primitives shared by the LOT 4 coverage reports.
 *
 * These exist as a tested module rather than inline helpers because both defects they encode were shipped in a
 * report and read as facts: a share of 440/441 printed as "100 %" (an open publication defect rounded away), and an
 * absence of verification printed in the same column as a measured failure.
 */

/**
 * An exact share, never rounded up to "100 %" while a single row fails.
 *
 * `Math.round(100 * 440 / 441)` is 100 — which is how one open defect disappeared from a summary table. A ratio is
 * therefore only "100 %" when it is unanimous; anything short of that keeps a decimal and always shows n/total.
 */
export function share(n: number, total: number): string {
  if (!Number.isFinite(n) || !Number.isFinite(total) || n < 0 || total < 0) throw new Error('share: n and total must be finite and non-negative');
  if (n > total) throw new Error(`share: ${n} of ${total} is not a share`);
  if (total === 0) return 'n/d (dénominateur nul)';
  if (n === total) return `100 % (${n}/${total})`;
  const pct = (100 * n) / total;
  // Below unanimity the value must never READ as 100: 440/441 is 99,8 %, and 9999/10000 stays 99,9 %.
  const shown = pct >= 99.95 ? '99,9' : pct.toFixed(1).replace('.', ',');
  return `${shown} % (${n}/${total})`;
}

/** The three outcomes a check can have. `NOT_VERIFIED` is an absence of proof — never a success, never a failure. */
export type CheckOutcome = 'PROVEN' | 'FAILED' | 'NOT_VERIFIED';

/**
 * Classify a check from what was actually observed.
 *
 * `observed = 0` means nothing was measured: the result is NOT_VERIFIED, whatever the expectation. Reporting it as a
 * failure invents a defect; reporting it as a success invents a proof.
 */
export function outcome(observed: number, proven: number, total: number): CheckOutcome {
  if (!Number.isFinite(observed) || !Number.isFinite(proven) || !Number.isFinite(total)) throw new Error('outcome: counts must be finite');
  if (proven > observed || observed > total) throw new Error(`outcome: inconsistent counts (proven ${proven} ≤ observed ${observed} ≤ total ${total})`);
  if (total === 0) return 'NOT_VERIFIED';
  if (observed === 0) return 'NOT_VERIFIED';
  return proven === total ? 'PROVEN' : 'FAILED';
}

/** Human-readable state for a per-source attribution cell, with its real denominator always visible. */
export function attributionLabel(observed: number, proven: number, total: number): string {
  switch (outcome(observed, proven, total)) {
    case 'NOT_VERIFIED':
      return total === 0 ? 'aucune représentation active' : `non vérifiée (0 / ${total} observées)`;
    case 'PROVEN':
      return 'proven';
    default:
      return `${proven} / ${total} prouvées${observed < total ? `, ${total - observed} non observées` : ''}`;
  }
}

import { describe, it, expect } from 'vitest';
import { ROTATING_SOURCES, INGEST_INTERVAL_HOURS, requiredStaleHours } from './sourceCursor.js';

/**
 * L-01 (DEC-5) — the cadence invariant, as a test so it cannot drift.
 *
 * A rotating source re-sees each offer only once per FULL rotation. If the
 * refresh staleness window is shorter than a rotation (×1.5 for a missed run),
 * the refresh closes offers that are still listed — the pipeline would then
 * churn the same offers open/closed forever. Whoever changes the ingest
 * cadence, a window size, or REFRESH_STALE_HOURS must keep this green.
 */
describe('cadence invariant (L-01)', () => {
  const STALE_HOURS = Number(process.env.REFRESH_STALE_HOURS ?? 48);

  it('graves the DEC-5 ingest cadence', () => {
    expect(INGEST_INTERVAL_HOURS).toBe(4);
  });

  it('staleHours covers a full rotation ×1.5 for every rotating source', () => {
    for (const key of Object.keys(ROTATING_SOURCES)) {
      const required = requiredStaleHours(key);
      expect(required, `${key}: staleHours ${STALE_HOURS} < required ${required}`).toBeLessThanOrEqual(
        STALE_HOURS,
      );
    }
  });

  it('computes the requirement from pages, window and interval', () => {
    // FashionJobs: ceil(282/40)=8 runs × 4h × 1.5 = 48h — exactly the window.
    expect(requiredStaleHours('fashionjobs')).toBe(48);
    // A non-rotating source has no rotation requirement.
    expect(requiredStaleHours('hermes')).toBe(0);
  });
});

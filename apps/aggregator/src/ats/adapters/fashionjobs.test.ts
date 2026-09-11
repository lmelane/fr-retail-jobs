import { describe, expect, it } from 'vitest';
import { fetchFashionjobsJobs, FashionjobsOffersWithdrawn } from './fashionjobs.js';
import { FASHIONJOBS_COMPANIES_URL } from '../../connectors/fashionjobs/companyDirectory.js';

/**
 * Owner decision, 2026-09-11: FashionJobs is EXCLUSIVELY a discovery source for Maisons, groups and retailers,
 * and leaves the offer circuit entirely.
 *
 * These tests exist because the withdrawal has to survive things a catalogue row cannot protect against: a
 * re-created `Source`, a re-import of `sources.csv` (which rewrites config at every boot), a copied config, or an
 * older execution path replayed during a resume. The guard sits at the adapter — the single door postings could
 * come back through — so every one of those routes fails loudly instead of quietly refeeding the circuit.
 */
describe('FashionJobs — discovery only, never a posting source', () => {
  it('refuses to return postings, whatever configuration it is handed', async () => {
    await expect(fetchFashionjobsJobs()).rejects.toBeInstanceOf(FashionjobsOffersWithdrawn);
    // The shapes a resume or an old catalogue row would actually pass.
    await expect(fetchFashionjobsJobs({ maxPages: 40 })).rejects.toBeInstanceOf(FashionjobsOffersWithdrawn);
    await expect(fetchFashionjobsJobs({ maxPages: 300, startPage: 12, maxJobs: 500 })).rejects.toBeInstanceOf(FashionjobsOffersWithdrawn);
  });

  it('says why it refuses, so a failed run is diagnosable rather than mysterious', async () => {
    await expect(fetchFashionjobsJobs()).rejects.toThrow(/discovery-only source/i);
    await expect(fetchFashionjobsJobs()).rejects.toThrow(/never supply postings/i);
  });

  it('keeps the actor-discovery circuit usable — that is the whole point of the decision', () => {
    // Discovery reads the company directory, not the offer pages: it is untouched and must stay so.
    expect(FASHIONJOBS_COMPANIES_URL).toMatch(/^https:\/\/fr\.fashionjobs\.com\//);
  });
});

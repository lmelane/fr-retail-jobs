import { afterAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('FASHIONJOBS_MIN_COMPANIES', '1');
const { parseFashionJobsCompanies } = await import('./companyDirectory.js');
afterAll(() => vi.unstubAllEnvs());

describe('FashionJobs employer directory count metadata', () => {
  it('does not concatenate the numeric employer suffix with the offer count', () => {
    // Structure observed on the live directory, 2026-09-08. No offer content.
    const [row] = parseFashionJobsCompanies('<li><div><h3><a href="/recrutement/maison-1-2-3.html">MAISON 1-2-3</a></h3><div><span>40&nbsp;</span><span>offres d’emploi</span></div></div></li>');
    expect(row.name).toBe('MAISON 1-2-3');
    expect(row.offerCount).toBe(40);
  });
  it('reads the alphabetical list and deduplicates its featured employer card', () => {
    const rows = parseFashionJobsCompanies('<li><a href="/recrutement/maison-1-2-3.html">MAISON 1-2-3</a><span> (40)</span></li><li><a href="/recrutement/maison-1-2-3.html">MAISON 1-2-3</a><span>40 offres d’emploi</span></li>');
    expect(rows).toHaveLength(1);
    expect(rows[0].offerCount).toBe(40);
  });
  it('does not invent a count from a numeric company name alone', () => {
    expect(parseFashionJobsCompanies('<li><a href="/recrutement/16paris.html">16PARIS</a></li>')[0].offerCount).toBeUndefined();
  });
});

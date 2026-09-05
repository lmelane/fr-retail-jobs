import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), fetchJson: vi.fn() }));
vi.mock('../../lib/browser.js', () => ({ fetchRenderedHtml: vi.fn(), closeBrowser: vi.fn() }));

import { fetchText } from '../../lib/http.js';
import { fetchGenericJsonLdJobs } from './genericJsonLd.js';

const mockFetch = vi.mocked(fetchText);
const detail = (id: string) =>
  `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: `Offer ${id}`, hiringOrganization: { name: 'Pandora' }, jobLocation: { address: { addressLocality: 'Paris', addressCountry: 'FR' } } })}</script>`;

beforeEach(() => mockFetch.mockClear());

describe('fetchGenericJsonLdJobs — pagination par CHEMIN ({page})', () => {
  /**
   * Mesuré le 2026-09-05 : Pandora (TalentHub) pagine en /jobs/page/N, 1-based.
   * Le générique ne connaissait que ?page=N : il rendait 10 offres — la page 1
   * seule — quand le portail en a ~1 800 sur 180 pages.
   */
  it('remplace {page} dans l’URL, respecte pageStart, s’arrête sur une page sans lien nouveau', async () => {
    const requested: string[] = [];
    mockFetch.mockImplementation(async (url) => {
      requested.push(String(url));
      if (String(url).endsWith('/page/1')) return '<a href="/x/job/A1">a</a>';
      if (String(url).endsWith('/page/2')) return '<a href="/x/job/B2">b</a>';
      if (String(url).includes('/job/')) return detail(String(url).split('/').pop() ?? '');
      return '<p>rien</p>';
    });
    const jobs = await fetchGenericJsonLdJobs({ listingUrl: 'https://careers.pandoragroup.com/fr/jobs/page/{page}', pageStart: 1, linkPattern: '/job/' });
    expect(requested[0]).toBe('https://careers.pandoragroup.com/fr/jobs/page/1');
    expect(requested).toContain('https://careers.pandoragroup.com/fr/jobs/page/2');
    expect(requested).not.toContain('https://careers.pandoragroup.com/fr/jobs/page/0');
    expect(requested.some((u) => u.includes('?page='))).toBe(false);
    expect(jobs.map((j) => j.title).sort()).toEqual(['Offer A1', 'Offer B2']);
  });

  it('sans {page}, la forme ?page=N reste inchangée (0-based)', async () => {
    const requested: string[] = [];
    mockFetch.mockImplementation(async (url) => {
      requested.push(String(url));
      if (String(url).endsWith('page=0')) return '<a href="/x/job/A">a</a>';
      if (String(url).includes('/job/')) return detail('A');
      return '<p>rien</p>';
    });
    await fetchGenericJsonLdJobs({ listingUrl: 'https://www.michaelpage.fr/jobs', linkPattern: '/job/' });
    expect(requested[0]).toBe('https://www.michaelpage.fr/jobs?page=0');
  });
});

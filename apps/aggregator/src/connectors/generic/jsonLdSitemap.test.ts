import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), fetchWithRetry: vi.fn(), fetchJson: vi.fn() }));

import { fetchText } from '../../lib/http.js';
import { fetchSitemapUrls, normalizeJobPosting } from './jsonLdSitemap.js';

const mockFetch = vi.mocked(fetchText);
beforeEach(() => mockFetch.mockClear());

describe('normalizeJobPosting — lieu', () => {
  /**
   * Mesuré le 2026-09-06 sur Boots (1 391 offres) : le JSON-LD met « - » en
   * addressLocality, addressRegion et postalCode, et le vrai lieu dans
   * streetAddress. Le normaliseur produisait « -, -, - » sur chaque offre.
   */
  it('ignore les tirets et replie sur streetAddress quand la ville est vide', () => {
    const job = normalizeJobPosting(
      {
        title: 'Pharmacist',
        jobLocation: {
          address: { streetAddress: 'Nottingham, Nottinghamshire', addressLocality: '-', addressRegion: '-', postalCode: '-', addressCountry: 'GB' },
        },
      },
      'https://www.boots.jobs/jobs/1',
    );
    expect(job?.city).toBeUndefined();
    expect(job?.location).toBe('Nottingham, Nottinghamshire');
    expect(job?.country).toBe('GB');
  });

  it('garde la ville structurée quand elle existe, sans streetAddress', () => {
    const job = normalizeJobPosting(
      { title: 'Vendeur', jobLocation: { address: { streetAddress: '12 rue de la Paix', addressLocality: 'Paris', postalCode: '75002' } } },
      'https://x/1',
    );
    expect(job?.city).toBe('Paris');
    expect(job?.location).toBe('Paris, 75002');
  });
});

describe('fetchSitemapUrls — index mal déclaré', () => {
  /**
   * Selfridges (2026-09-06) : sitemap.xml liste 5 sitemaps enfants mais les
   * enveloppe dans <urlset> au lieu de <sitemapindex>. Vu comme une liste de
   * pages, il rendait 5 « offres » .xml, donc 0 offre réelle.
   */
  it('développe un urlset dont tous les liens sont des sitemaps', async () => {
    mockFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith('/sitemap.xml')) return '<urlset><url><loc>https://s/sitemap/1</loc></url><url><loc>https://s/sitemap/2.xml</loc></url></urlset>';
      if (u.endsWith('/sitemap/1')) return '<urlset><url><loc>https://s/jobs/job/a</loc></url></urlset>';
      if (u.endsWith('/sitemap/2.xml')) return '<urlset><url><loc>https://s/jobs/job/b</loc></url></urlset>';
      return '';
    });
    const urls = await fetchSitemapUrls('https://s/sitemap.xml');
    expect(urls.sort()).toEqual(['https://s/jobs/job/a', 'https://s/jobs/job/b']);
  });

  it('ne développe pas une vraie liste de pages', async () => {
    mockFetch.mockResolvedValue('<urlset><url><loc>https://s/jobs/job/a</loc></url><url><loc>https://s/jobs/job/b</loc></url></urlset>');
    const urls = await fetchSitemapUrls('https://s/sitemap.xml');
    expect(urls).toEqual(['https://s/jobs/job/a', 'https://s/jobs/job/b']);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/http.js')>(),
  fetchText: vi.fn(), fetchWithRetry: vi.fn(), fetchJson: vi.fn(),
}));

import { fetchText, fetchWithRetry } from '../../lib/http.js';
import { fetchJobFromPage, fetchSitemapUrls, normalizeJobPosting, richestDescription } from './jsonLdSitemap.js';
import { parseSitemapLocations } from './jsonLdSitemap.js';

const mockFetch = vi.mocked(fetchText);
beforeEach(() => mockFetch.mockClear());

it('refuses a compressed sitemap whose decompressed body exceeds the cap', async () => {
  const compressed = gzipSync(Buffer.alloc(20_000_001, 65));
  vi.mocked(fetchWithRetry).mockResolvedValueOnce(new Response(compressed));
  await expect(fetchSitemapUrls('https://example.com/sitemap.xml.gz')).rejects.toThrow();
});

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

describe('fetchJobFromPage — la description la plus riche de la page (g6, 2026-09-06)', () => {
  const fixture = (name: string) =>
    readFileSync(new URL(`../../ats/adapters/__fixtures__/${name}`, import.meta.url), 'utf8');

  /**
   * L'Oréal (1 716 offres du sitemap, 0 % de description) : le JSON-LD ne
   * porte que titre + datePosted ; le texte est en microdata sur la même page.
   */
  it('L’Oréal : replie sur le bloc microdata quand le JSON-LD est vide', async () => {
    mockFetch.mockResolvedValueOnce(fixture('g6-loreal-jobdetail.html'));
    const job = await fetchJobFromPage('https://careers.loreal.com/en_US/jobs/JobDetail/x/253106');
    expect(job?.title).toBe('_SYNERGIE - Skincare expert');
    expect(job?.description!.length).toBeGreaterThan(1500);
    expect(job?.description).toContain('\n');
    expect(job?.description).toContain("Jsme L'Oréal CZ/HU/SK!");
  });

  /**
   * Kering (1 427 offres du sitemap, 12 % de description) : le JSON-LD porte
   * le portrait de la Maison (~170 caractères) ; l'offre est dans __NEXT_DATA__.
   */
  it('Kering : prend le texte du poste dans __NEXT_DATA__, pas le portrait de la Maison', async () => {
    mockFetch.mockResolvedValueOnce(fixture('g6-kering-jobdetail.html'));
    const job = await fetchJobFromPage('https://www.kering.com/fr/talent/offres-d-emploi/europe/x/');
    expect(job?.description!.length).toBeGreaterThan(1500);
    expect(job?.description).toContain('ROLE');
    expect(job?.description).toContain('• ');
    expect(job?.description).not.toMatch(/^Fondée en 1961/);
  });

  it('un JSON-LD complet n’est pas évincé par un bloc microdata étranger à l’offre', () => {
    const full = 'Texte complet de l’offre. '.repeat(20);
    const html = '<div itemprop="description">Portrait de l’entreprise, plus court que l’offre.</div>';
    expect(richestDescription(html, full)).toBe(full);
  });

  it('sans texte de page, le JSON-LD reste tel quel', () => {
    expect(richestDescription('<html></html>', 'court')).toBe('court');
    expect(richestDescription('<html></html>', undefined)).toBeUndefined();
  });
});


describe('sitemap <loc> decoding', () => {
  it('decodes XML character references and CDATA so the URL fetched is the one the publisher meant', () => {
    const xml = `<urlset><url><loc>https://careers.oniverse.it/en-GB/carriere/&#214;sterreich_157730240.htm</loc></url>
      <url><loc>https://attaquercycling.com/sitemap_pages_1.xml?from=1&amp;to=2</loc></url>
      <url><loc><![CDATA[https://example.com/jobs/caf%C3%A9?x=1&y=2]]></loc></url>
      <url><loc>https://example.com/&#x00E9;t&#233;</loc></url></urlset>`;
    expect(parseSitemapLocations(xml)).toEqual([
      'https://careers.oniverse.it/en-GB/carriere/Österreich_157730240.htm',
      'https://attaquercycling.com/sitemap_pages_1.xml?from=1&to=2',
      'https://example.com/jobs/caf%C3%A9?x=1&y=2',
      'https://example.com/été',
    ]);
  });
});

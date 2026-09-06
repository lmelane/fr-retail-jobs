import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn() }));
// Mock partiel : `successfactors.js` importe `microdataDescriptionHtml` du même module.
vi.mock('../../connectors/generic/jsonLdSitemap.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSitemapUrls: vi.fn(),
}));

import { fetchText } from '../../lib/http.js';
import { fetchAvatureJobs, postedAtFromJsonLd } from './avature.js';

const mockText = vi.mocked(fetchText);
beforeEach(() => mockText.mockReset());

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const CARD = fixture('g6-loreal-listing-card.html');
const DETAIL = fixture('g6-loreal-jobdetail.html');
/** La même carte, sans sa mention « Posted 15-Jul-2026 » : la liste ne date pas toujours (13/120 mesuré le 2026-09-06). */
const CARD_UNDATED = CARD.replace(/(posted|publi\S*)\s+\d{1,2}-\w{3}-\d{4}/i, 'Posted');

/**
 * l2 (2026-09-06) — mode « liste » (careers.loreal.com) : la fusion de détail ne
 * recopiait que la description ; la fiche publie pourtant `datePosted` en
 * JSON-LD (vérifié sur trois fiches sans date de liste : 2026-08-24, 2026-01-01).
 */
describe('fetchAvatureJobs (mode liste) — l2 : la fiche date ce que la carte ne date pas', () => {
  it('lit le datePosted JSON-LD de la fiche quand la carte est sans date', async () => {
    mockText
      .mockResolvedValueOnce(CARD_UNDATED) // page 0
      .mockResolvedValueOnce('<html></html>') // page 1 : vide → fin de liste
      .mockResolvedValueOnce(DETAIL); // fiche

    const { jobs } = await fetchAvatureJobs({
      listingUrl: 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0',
      origin: 'https://careers.loreal.com',
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].postedAt?.toISOString().slice(0, 10)).toBe('2026-07-15');
  });

  it('garde la date de la carte quand elle existe (la fiche ne la remplace pas)', async () => {
    mockText
      .mockResolvedValueOnce(CARD)
      .mockResolvedValueOnce('<html></html>')
      .mockResolvedValueOnce(DETAIL.replace('"datePosted":"2026-07-15"', '"datePosted":"2026-01-01"'));

    const { jobs } = await fetchAvatureJobs({ listingUrl: 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0' });
    expect(jobs[0].postedAt?.toISOString().slice(0, 10)).toBe('2026-07-15');
  });
});

describe('postedAtFromJsonLd', () => {
  it('lit la date de la fiche L’Oréal et rend undefined sans JSON-LD', () => {
    expect(postedAtFromJsonLd(DETAIL)?.toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(postedAtFromJsonLd('<html><body>maintenance</body></html>')).toBeUndefined();
  });
});

/** Run global du 2026-09-06 13:11 : `…?jobOffset=0&jobOffset=1160` → 406, L'Oréal BROKEN (1 716 offres). */
describe('fetchAvatureJobs (mode liste) — pagination', () => {
  it('remplace jobOffset dans une listingUrl qui le porte déjà, sans le dupliquer', async () => {
    mockText.mockResolvedValue('<html></html>');
    await fetchAvatureJobs({ listingUrl: 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0', maxPages: 1 }).catch(() => undefined);
    const first = String(mockText.mock.calls[0]?.[0]);
    expect(first).toBe('https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0');
    expect(first.match(/jobOffset=/g)).toHaveLength(1);
  });
});

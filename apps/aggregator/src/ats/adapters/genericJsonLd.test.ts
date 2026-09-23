import { withSourceBudget } from '../../lib/sourceBudget.js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the network layer: the adapter's pagination and detail fetch both go
// through fetchText, so the test drives the listing → detail → 404 sequence.
vi.mock('../../lib/http.js', () => ({
  fetchText: vi.fn(),
}));

import { fetchText } from '../../lib/http.js';
import { fetchGenericJsonLdJobs } from './genericJsonLd.js';

const mockFetch = vi.mocked(fetchText);

/** A listing page linking one detail URL. */
function listingPage(id: number): string {
  return `<a href="/job-detail/offer-${id}">Offer ${id}</a>`;
}

/** A detail page with a minimal valid JobPosting. */
function detailPage(id: number): string {
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: `Offer ${id}`,
    hiringOrganization: { name: 'Michael Page' },
    jobLocation: { address: { addressLocality: 'Paris', addressCountry: 'FR' } },
  })}</script>`;
}

const config = {
  listingUrl: 'https://www.michaelpage.fr/jobs',
  linkPattern: '/job-detail/',
  pageParam: 'page',
};

beforeEach(() => mockFetch.mockReset());

describe('mixed sitemap with reviewed job paths', () => {
  const sitemapUrl = 'https://careers.example/sitemap.xml';
  const urls = ['https://careers.example/job/paris/advisor/1', 'https://careers.example/fr/job/lyon/advisor/2',
    'https://careers.example/business/retail%2520%2526%2520beauty/1', 'https://careers.example/search?next=/job/3'];
  const xml = `<urlset>${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;

  it('fetches only posting paths and retains the measured exclusion count', async () => {
    mockFetch.mockImplementation(async url => url === sitemapUrl ? xml : detailPage(1));
    const result = await fetchGenericJsonLdJobs({ sitemapUrl, linkPattern: '/job/' });
    expect(mockFetch.mock.calls.map(call => call[0])).toEqual([sitemapUrl, ...urls.slice(0, 2)]);
    expect(result.jobs).toHaveLength(2);
    expect(result).toMatchObject({ complete: true, declaredTotal: 2, enumeration: { rawCount: 4 } });
    expect(result.enumeration?.scopes).toContainEqual({ scope: 'sitemapUrlsOutsideJobPath', declaredTotal: 2, uniqueIds: 2, pages: 1, complete: true });
  });

  it('fails visibly when a configured path matches no posting, without claiming an empty catalogue', async () => {
    mockFetch.mockResolvedValue(xml);
    await expect(fetchGenericJsonLdJobs({ sitemapUrl, linkPattern: '/other-jobs/' })).rejects.toThrow('0 URLs');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps full sitemap enumeration when no path is configured', async () => {
    mockFetch.mockImplementation(async url => url === sitemapUrl ? xml : detailPage(1));
    expect((await fetchGenericJsonLdJobs({ sitemapUrl })).jobs).toHaveLength(4);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});

describe('fetchGenericJsonLdJobs — paginated listing that 404s past the last page', () => {
  it('stops cleanly on a 404 and keeps every offer already collected', async () => {
    mockFetch.mockImplementation(async (url) => {
      const u = String(url ?? '');
      // Two listing pages (0, 1), then page 2 is 404 — Michael Page's shape.
      if (u.includes('page=0')) return listingPage(1);
      if (u.includes('page=1')) return listingPage(2);
      if (u.includes('page=2')) throw new Error(`HTTP 404 for ${u}`);
      // Detail pages.
      if (u.endsWith('offer-1')) return detailPage(1);
      if (u.endsWith('offer-2')) return detailPage(2);
      return '<p></p>';
    });

    const result = await fetchGenericJsonLdJobs(config);

    // The old code threw the 404 up and lost BOTH offers; now both survive.
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((j) => j.title).sort()).toEqual(['Offer 1', 'Offer 2']);
    expect(result.complete).toBe(true);
  });

  it('stops when a page returns no more offer links', async () => {
    mockFetch.mockImplementation(async (url) => {
      const u = String(url ?? "");
      if (u.includes('page=0')) return listingPage(1);
      if (u.includes('page=1')) return '<p>no offers here</p>';
      if (u.endsWith('offer-1')) return detailPage(1);
      return '<p></p>';
    });

    const result = await fetchGenericJsonLdJobs(config);
    expect(result.jobs).toHaveLength(1);
  });

  it('does not throw the whole source away when a mid-listing fetch fails', async () => {
    mockFetch.mockImplementation(async (url) => {
      const u = String(url ?? "");
      if (u.includes('page=0')) return listingPage(1);
      if (u.includes('page=1')) throw new Error('HTTP 503 for …'); // exhausted-retry blip
      if (u.endsWith('offer-1')) return detailPage(1);
      return '<p></p>';
    });

    const result = await fetchGenericJsonLdJobs(config);
    expect(result.truncated).toBe(true);
    expect(result.complete).toBe(false);
    // The page-0 offer still ingests rather than the source failing outright.
    expect(result.jobs).toHaveLength(1);
  });

  it('stops paginating immediately when the deadline is already past', async () => {
    let listingFetches = 0;
    mockFetch.mockImplementation(async (url) => {
      const u = String(url ?? '');
      if (u.includes('page=')) listingFetches++;
      if (u.includes('page=0')) return listingPage(1);
      if (u.includes('page=1')) return listingPage(2);
      return '<p></p>';
    });

    // An exhausted execution budget: not a single listing page should be fetched, and
    // the source returns cleanly rather than failing.
    const result = await withSourceBudget(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return fetchGenericJsonLdJobs(config);
    }, 1000, 'listing-fixture', { softTimeoutMs: 1 });
    expect(result.truncated).toBe(true);
    expect(result.complete).toBe(false);
    expect(listingFetches).toBe(0);
    expect(result.jobs).toHaveLength(0);
  });

  it('ignores the deadline guard entirely when no deadline is set', async () => {
    mockFetch.mockImplementation(async (url) => {
      const u = String(url ?? '');
      if (u.includes('page=0')) return listingPage(1);
      if (u.includes('page=1')) return '<p></p>';
      if (u.endsWith('offer-1')) return detailPage(1);
      return '<p></p>';
    });
    // No execution budget: normal full behaviour.
    const result = await fetchGenericJsonLdJobs(config);
    expect(result.jobs).toHaveLength(1);
  });
});

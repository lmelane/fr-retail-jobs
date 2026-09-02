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

    const jobs = await fetchGenericJsonLdJobs(config);

    // The old code threw the 404 up and lost BOTH offers; now both survive.
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.title).sort()).toEqual(['Offer 1', 'Offer 2']);
  });

  it('stops when a page returns no more offer links', async () => {
    mockFetch.mockImplementation(async (url) => {
      const u = String(url ?? "");
      if (u.includes('page=0')) return listingPage(1);
      if (u.includes('page=1')) return '<p>no offers here</p>';
      if (u.endsWith('offer-1')) return detailPage(1);
      return '<p></p>';
    });

    const jobs = await fetchGenericJsonLdJobs(config);
    expect(jobs).toHaveLength(1);
  });

  it('does not throw the whole source away when a mid-listing fetch fails', async () => {
    mockFetch.mockImplementation(async (url) => {
      const u = String(url ?? "");
      if (u.includes('page=0')) return listingPage(1);
      if (u.includes('page=1')) throw new Error('HTTP 503 for …'); // exhausted-retry blip
      if (u.endsWith('offer-1')) return detailPage(1);
      return '<p></p>';
    });

    const jobs = await fetchGenericJsonLdJobs(config);
    // The page-0 offer still ingests rather than the source failing outright.
    expect(jobs).toHaveLength(1);
  });
});

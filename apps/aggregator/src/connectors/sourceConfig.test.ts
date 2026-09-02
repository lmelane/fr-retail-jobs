import { describe, expect, it } from 'vitest';
import { normalizeSourceConfig } from './sourceConfig.js';

/**
 * Regression for the live "Teamtailor origin missing" / "startUrl required"
 * failures: the config carried the value under a synonym the adapter did not
 * read. These are the exact shapes from data/sources.csv.
 */
describe('normalizeSourceConfig', () => {
  it('resolves Showroomprive: careers_url -> origin, jobs_url -> listingUrl', () => {
    const filled = normalizeSourceConfig({
      vendor: 'teamtailor',
      careers_url: 'https://talents.showroomprivegroup.com/',
      jobs_url: 'https://talents.showroomprivegroup.com/jobs',
      rss: 'https://talents.showroomprivegroup.com/jobs.rss',
    });
    expect(filled.origin).toBe('https://talents.showroomprivegroup.com/');
    expect(filled.listingUrl).toBe('https://talents.showroomprivegroup.com/jobs');
  });

  it('resolves Oh My Cream: host -> origin', () => {
    const filled = normalizeSourceConfig({ vendor: 'teamtailor', host: 'careers.ohmycream.com' });
    expect(filled.origin).toBe('careers.ohmycream.com');
  });

  it('resolves a sitemap synonym -> sitemapUrl (NARS/Prada)', () => {
    expect(normalizeSourceConfig({ sitemap: 'https://x/sitemap.xml' }).sitemapUrl).toBe('https://x/sitemap.xml');
  });

  it('leaves a config that already has the canonical key untouched', () => {
    const filled = normalizeSourceConfig({ origin: 'https://careers.medik8.com' });
    expect(filled.origin).toBe('https://careers.medik8.com');
  });

  it('keeps the original synonym keys too (an adapter reading either still wins)', () => {
    const filled = normalizeSourceConfig({ careers_url: 'https://x/' });
    expect(filled.careers_url).toBe('https://x/');
    expect(filled.origin).toBe('https://x/');
  });

  it('does nothing when no synonym is present', () => {
    expect(normalizeSourceConfig({ vendor: 'teamtailor' })).toEqual({ vendor: 'teamtailor' });
  });
});

import { describe, expect, test } from 'vitest';
import { parseMicrodataDetail, splitSlug } from './successfactors.js';

/**
 * Issue #6 — Clarins/My Blend postings stored with title and location swapped.
 *
 * The slug order is per-tenant ({City}-{Title} on Amway, {City}-{Title}-{Postcode}
 * on Clarins, ALL-CAPS titles on the German feed), so slug guessing can never be
 * authoritative. The detail page's microdata is.
 */

const CLARINS_DETAIL = `
<div>
  <span itemprop="title">Beauty Coach (7.3hrs/wk)</span>
  <span itemprop="jobLocation" itemscope itemtype="http://schema.org/Place">
    <span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress"><meta itemprop="streetAddress" content="Liverpool, GB, L1 8BJ"></span>
  </span>
  <meta itemprop="datePosted" content="Thu Sep 03 02:00:00 UTC 2026">
  <meta itemprop="validThrough" content="Sat Nov 14 00:00:00 UTC 2026">
  <div itemprop="description"><div><p>Join the counter team.</p><p>Retail experience preferred, since the counter is busy.</p></div></div>
</div>`;

describe('parseMicrodataDetail', () => {
  test('reads exact title, address parts and dates from the detail page', () => {
    const detail = parseMicrodataDetail(CLARINS_DETAIL);

    expect(detail.title).toBe('Beauty Coach (7.3hrs/wk)');
    expect(detail.location).toBe('Liverpool, GB, L1 8BJ');
    expect(detail.city).toBe('Liverpool');
    expect(detail.country).toBe('GB');
    expect(detail.postalCode).toBe('L1 8BJ');
    expect(detail.postedAt?.getUTCFullYear()).toBe(2026);
    expect(detail.validThrough?.getUTCMonth()).toBe(10);
    expect(detail.description).toContain('Join the counter team.');
  });

  test('returns empty fields on a page without microdata, so slug values survive', () => {
    const detail = parseMicrodataDetail('<html><body>maintenance</body></html>');
    expect(detail.title).toBeUndefined();
    expect(detail.location).toBeUndefined();
  });
});

describe('splitSlug (fallback only)', () => {
  test('still splits the classic CITY-Title order', () => {
    expect(splitSlug('PARIS-Social-Media-Coordinator')).toEqual({
      city: 'PARIS',
      title: 'Social Media Coordinator',
    });
  });

  test('an all-caps German title no longer matters: detail data overrides it', () => {
    // Documented failure shape (issue #6): the caps heuristic reads the TITLE
    // as the city on this tenant. Kept as a fallback-only quirk — the microdata
    // override in attachSuccessFactorsDescriptions is what candidates see.
    const { city } = splitSlug('BEAUTY-COACH-(M-W-D)-Baden-W%C3%BCrttemberg');
    expect(city).not.toBe('Baden Württemberg');
  });
});

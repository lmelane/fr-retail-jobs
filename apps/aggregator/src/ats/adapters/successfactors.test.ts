import { describe, expect, test } from 'vitest';
import { parseListing, parseMicrodataDetail, splitSlug } from './successfactors.js';

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

describe('parseMicrodataDetail — tenants sans streetAddress', () => {
  /**
   * Mesuré 2026-09-04 : Coty 127 offres / 0 lieu, Burberry 133 / 0, Prada
   * 54 / 0, EssilorLuxottica 1505 / 8 — alors que chaque page détail portait
   * addressLocality/addressRegion/addressCountry. Ces tenants n'émettent pas
   * streetAddress, et le repli par slug ne peut rien : il n'accepte une ville
   * qu'en MAJUSCULES, or ils écrivent « Granollers ».
   */
  const separate = `
    <span itemprop="title">Process Engineer</span>
    <meta itemprop="addressLocality" content="Granollers">
    <meta itemprop="addressRegion" content="B">
    <meta itemprop="addressCountry" content="ES">
  `;

  test('lit les champs d’adresse séparés', () => {
    const d = parseMicrodataDetail(separate);
    expect(d.city).toBe('Granollers');
    expect(d.country).toBe('ES');
    expect(d.location).toBe('Granollers, ES');
  });

  test('écarte un code de province d’une lettre, qui ne dit rien au candidat', () => {
    expect(parseMicrodataDetail(separate).location).not.toContain(', B,');
  });

  test('garde une région quand c’est un vrai nom', () => {
    const d = parseMicrodataDetail(`
      <meta itemprop="addressLocality" content="Milano">
      <meta itemprop="addressRegion" content="Lombardia">
      <meta itemprop="addressCountry" content="IT">
    `);
    expect(d.location).toBe('Milano, Lombardia, IT');
  });

  test('streetAddress reste prioritaire quand il existe', () => {
    const d = parseMicrodataDetail(`
      <meta itemprop="streetAddress" content="Liverpool, GB, L1 8BJ">
      <meta itemprop="addressLocality" content="IGNORE">
    `);
    expect(d.city).toBe('Liverpool');
    expect(d.country).toBe('GB');
  });
})

describe('parseListing — offres sous un préfixe de site', () => {
  /**
   * Mesuré le 2026-09-04 : jobs.sephora.com sert ses offres sous
   * `/France/job/...`. Le motif ancré sur `/job/` n'en voyait aucune — 48 liens
   * présents dans la page, 0 offre remontée.
   */
  test('accepte un segment de préfixe (Sephora /France/job/…)', () => {
    const jobs = parseListing(
      '<a href="/France/job/SARAN-CDD-Charge-des-Services-Generaux/1367267555/">x</a>',
      'https://jobs.sephora.com',
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].externalId).toBe('1367267555');
    expect(jobs[0].url).toBe('https://jobs.sephora.com/France/job/SARAN-CDD-Charge-des-Services-Generaux/1367267555/');
  });

  test('le cas sans préfixe continue de marcher', () => {
    const jobs = parseListing('<a href="/job/PARIS-Vendeur/123/">x</a>', 'https://careers.coty.com');
    expect(jobs[0].url).toBe('https://careers.coty.com/job/PARIS-Vendeur/123/');
  });

  test('ne ramasse pas un lien à deux segments de préfixe', () => {
    expect(parseListing('<a href="/a/b/job/X/9/">x</a>', 'https://x.com')).toHaveLength(0);
  });
})

describe('parseMicrodataDetail — troisième format : data-careersite-propertyid', () => {
  /**
   * Mesuré le 2026-09-05 sur jobs.adidas-group.com : ni streetAddress ni
   * addressLocality — le lieu est dans <span data-careersite-propertyid="city">.
   * 1 056 offres, 0 lieu sans cette branche ; 1 056/1 056 avec.
   */
  const html = `
    <span data-careersite-propertyid="city" class="rtltextaligneligible">Singapore</span>
    <span data-careersite-propertyid="state" class="rtltextaligneligible">Sing</span>
    <span data-careersite-propertyid="country" class="rtltextaligneligible">SG</span>`;
  test('lit ville et pays depuis les propriétés du site carrière', () => {
    const d = parseMicrodataDetail(html);
    expect(d.city).toBe('Singapore');
    expect(d.country).toBe('SG');
    expect(d.location).toBe('Singapore, SG');
  });
  test('les deux premiers formats gardent la priorité', () => {
    const d = parseMicrodataDetail(`<meta itemprop="addressLocality" content="Paris"><meta itemprop="addressCountry" content="FR">` + html);
    expect(d.city).toBe('Paris');
  });
});

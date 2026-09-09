import { readFileSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// SAP RMK v2 — the JSON path (fixtures captured 2026-09-06).
// ---------------------------------------------------------------------------
import { normalizeRmkItem, parseRmkDate, parseRmkLocales, parseRmkLocation, rmkJobUrl, type RmkV2Item } from './successfactors.js';

/** jobs.douglas.group — POST /services/recruiting/v1/jobs, locale de_DE, pageNumber 0, first `response`. */
const DOUGLAS_ITEM: RmkV2Item & Record<string, unknown> = {
  jobLocationShort: ['Hamburg, Deutschland '],
  supportedLocales: ['de_DE'],
  filter2: ['Brand, Marketing & Communications'],
  filter3: ['Experienced Professional'],
  sfstd_marketingBrand_obj: ['DOUGLAS'],
  custFullTimePartTime: ['Vollzeit'],
  jobLocationShortWithCoordinates: [{ value: 'Hamburg, Deutschland ', key: '53.5488282,9.9871703' }],
  brandUrl: 'default',
  unifiedUrlTitle: 'Senior-Graphic-Designer-&amp;-Team-Lead-Layout-%28wmx%29',
  unifiedStandardStart: '10.07.26',
  currency: ['EUR'],
  custOnsiteRemote: ['Hybrid'],
  unifiedStandardTitle: 'Senior Graphic Designer & Team Lead Layout (w/m/x)',
  id: '696',
  urlTitle: 'Senior-Graphic-Designer-&amp;-Team-Lead-Layout-%28wmx%29',
};

/** careers.breitling.com — same endpoint, locale en_GB (no brandUrl) and de_DE (three sites, ISO-3 countries). */
const BREITLING_ITEM: RmkV2Item = {
  jobLocationShort: ['Montreal, QC, CAN, '],
  supportedLocales: ['en_GB'],
  unifiedUrlTitle: 'Sales-Associate-Montreal',
  unifiedStandardStart: '23/06/2026',
  unifiedStandardTitle: 'Sales Associate Montreal',
  id: '1426',
  urlTitle: 'Sales-Associate-Montreal',
};
const BREITLING_POOL: RmkV2Item = {
  jobLocationShort: ['La Chaux-de-Fonds, NE, CHE, 2301<br/>', 'Grenchen, SO, CHE, ', 'ZH, CHE, 8002<br/>'],
  unifiedUrlTitle: 'Talent-Pool-Squadonamission',
  unifiedStandardStart: '05.12.25',
  unifiedStandardTitle: 'Talent Pool #Squadonamission',
  id: '540',
  urlTitle: 'Talent-Pool-Squadonamission',
};

/** The language switcher of careers.breitling.com/ — the /search/ page lists en_GB only. */
const SWITCHER = `
<a href="https://careers.breitling.com/search/?createNewAlert=false&amp;q=&amp;locationsearch=&amp;startrow=0&amp;locale=de_DE">Deutsch</a>
<a href="/search/?q=&locale=en_GB">English</a>
<a href="/search/?q=&locale=fr_FR">Français</a>
<a href="/search/?q=&locale=ja_JP">日本語</a>
<a href="/search/?q=&locale=en_GB">English (again)</a>`;

describe('RMK v2 — parseRmkLocales', () => {
  test('reads every locale once, preferred ones first', () => {
    expect(parseRmkLocales(SWITCHER)).toEqual(['fr_FR', 'en_GB', 'de_DE', 'ja_JP']);
  });

  test('falls back to en_US when the page names no locale', () => {
    expect(parseRmkLocales('<html></html>')).toEqual(['en_US']);
  });
});

describe('RMK v2 — parseRmkLocation', () => {
  test('city + ISO-3 country + postcode, markup stripped', () => {
    expect(parseRmkLocation('La Chaux-de-Fonds, NE, CHE, 2301<br/>')).toEqual({
      location: 'La Chaux-de-Fonds, NE, CHE, 2301',
      city: 'La Chaux-de-Fonds',
      country: 'CH',
      postalCode: '2301',
    });
  });

  test('city + country name when the tenant writes no code', () => {
    expect(parseRmkLocation('Hamburg, Deutschland ')).toEqual({ location: 'Hamburg, Deutschland', city: 'Hamburg', country: 'Deutschland' });
  });

  test('keeps an unmapped ISO-3 code rather than inventing a country', () => {
    expect(parseRmkLocation('Ulaanbaatar, MNG, ').country).toBe('MNG');
  });

  test('empty input gives nothing, not an empty string', () => {
    expect(parseRmkLocation('')).toEqual({});
  });
});

describe('RMK v2 — parseRmkDate', () => {
  const usWitnesses: { raw: RmkV2Item & {locale:string}; expectedDate: string; storedDate: string }[] = JSON.parse(readFixture(new URL('./__fixtures__/rmk-douglas-us-dates.json', import.meta.url), 'utf8'));
  test.each(usWitnesses)('production requisition $raw.id: locale prevents $storedDate', (w) => {
    expect(parseRmkDate(w.raw.unifiedStandardStart, w.raw.locale)?.toISOString()).toBe(w.expectedDate);
    const job = normalizeRmkItem(w.raw, w.raw.locale, 'https://jobs.douglas.group')!;
    expect(job.postedAt?.toISOString()).toBe(w.expectedDate);
    expect((job.raw as any).rmkDateEvidence).toMatchObject({ rawValue: w.raw.unifiedStandardStart, locale: 'en_US', parsedValue: w.expectedDate });
  });
  test.each(['31/02/2026', '29/02/2025', '00/08/2026', '13/13/2026', '1/2-26', '1/2/026'])('rejects invalid calendar input %s', (raw) => {
    expect(parseRmkDate(raw, 'en_GB')).toBeUndefined();
  });
  test('same numbers differ by known locale, unknown formats stay unresolved', () => {
    expect(parseRmkDate('8/12/26', 'en_US')?.toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(parseRmkDate('8/12/26', 'en_GB')?.toISOString()).toBe('2026-12-08T00:00:00.000Z');
    expect(parseRmkDate('8/12/26')).toBeUndefined();
    expect(parseRmkDate('8/12/26', 'xx_XX')).toBeUndefined();
    expect(parseRmkDate('8.12.26', 'en_US')).toBeUndefined();
  });
  test('valid leap day and strict ISO dates work without runtime date guessing', () => {
    expect(parseRmkDate('29/02/2024', 'fr_FR')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(parseRmkDate('2026-08-27')?.toISOString()).toBe('2026-08-27T00:00:00.000Z');
    expect(parseRmkDate('2026-08-27T10:30:00+02:00')?.toISOString()).toBe('2026-08-27T08:30:00.000Z');
    expect(parseRmkDate('2026-02-31')).toBeUndefined();
    expect(parseRmkDate('2026-02-31T10:00:00Z')).toBeUndefined();
    expect(parseRmkDate('August 27')).toBeUndefined();
  });

  test('day first in both the dotted two-digit-year and the slashed forms', () => {
    expect(parseRmkDate('10.07.26', 'de_DE')?.toISOString().slice(0, 10)).toBe('2026-07-10');
    expect(parseRmkDate('23/06/2026', 'en_GB')?.toISOString().slice(0, 10)).toBe('2026-06-23');
    expect(parseRmkDate('05.12.25', 'de_DE')?.toISOString().slice(0, 10)).toBe('2025-12-05');
  });

  test('undefined on garbage', () => {
    expect(parseRmkDate('n/a')).toBeUndefined();
    expect(parseRmkDate(undefined)).toBeUndefined();
  });
});

describe('RMK v2 — rmkJobUrl and normalizeRmkItem', () => {
  test('builds the /brand/job/… URL Douglas serves (200) and decodes &amp;', () => {
    expect(rmkJobUrl('https://jobs.douglas.group', DOUGLAS_ITEM, 'de_DE')).toBe(
      'https://jobs.douglas.group/default/job/Senior-Graphic-Designer-&-Team-Lead-Layout-%28wmx%29/696-de_DE',
    );
  });

  test('builds the /job/… URL Breitling serves (200) when brandUrl is absent', () => {
    expect(rmkJobUrl('https://careers.breitling.com', BREITLING_ITEM, 'en_GB')).toBe(
      'https://careers.breitling.com/job/Sales-Associate-Montreal/1426-en_GB',
    );
  });

  test('normalises a Douglas entry: id, title, city, country, date, language', () => {
    const job = normalizeRmkItem(DOUGLAS_ITEM, 'de_DE', 'https://jobs.douglas.group')!;
    expect(job.externalId).toBe('696');
    expect(job.title).toBe('Senior Graphic Designer & Team Lead Layout (w/m/x)');
    expect(job.city).toBe('Hamburg');
    expect(job.country).toBe('Deutschland');
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe('2026-07-10');
    expect(job.language).toBe('de');
  });

  test('a multi-site posting keeps the first city and lists every site', () => {
    const job = normalizeRmkItem(BREITLING_POOL, 'de_DE', 'https://careers.breitling.com')!;
    expect(job.city).toBe('La Chaux-de-Fonds');
    expect(job.country).toBe('CH');
    expect(job.location).toBe('La Chaux-de-Fonds, NE, CHE, 2301 / Grenchen, SO, CHE / ZH, CHE, 8002');
  });

  test('drops an entry without id or title rather than emit an unlinkable row', () => {
    expect(normalizeRmkItem({ unifiedStandardTitle: 'x' }, 'en_GB', 'https://x')).toBeNull();
    expect(normalizeRmkItem({ id: '1', urlTitle: 'y' }, 'en_GB', 'https://x')).toBeNull();
  });
});

describe('parseListing — origine avec segment de site (g6, 2026-09-06)', () => {
  /**
   * Sephora France est cataloguée avec `origin: https://jobs.sephora.com/France`
   * et ses liens sont déjà `/France/job/…`. La concaténation donnait
   * `/France/France/job/…`, servi en 200 comme page générique sans microdata :
   * 24 offres à 0 % de description, 0 % de date, 0 % de pays.
   */
  test('un chemin absolu se résout sur l’hôte, jamais en doublant le segment', () => {
    const [job] = parseListing(
      '<a href="/France/job/SARAN-CDI-Demand-Planner-%28FHX%29/1354866455/">x</a>',
      'https://jobs.sephora.com/France',
    );
    expect(job.url).toBe('https://jobs.sephora.com/France/job/SARAN-CDI-Demand-Planner-%28FHX%29/1354866455/');
  });
});

describe('parseMicrodataDetail — le texte garde ses paragraphes (g6, 2026-09-06)', () => {
  /** Page réelle de Sephora France, tronquée au bloc microdata. */
  const SEPHORA = readFileSync(new URL('./__fixtures__/g6-sephora-france-1354866455.html', import.meta.url), 'utf8');

  test('lit titre, adresse, date et une description structurée', () => {
    const d = parseMicrodataDetail(SEPHORA);
    expect(d.title).toBe('CDI - Demand Planner (F/H/X)');
    expect(d.city).toBe('SARAN');
    expect(d.country).toBe('FR');
    expect(d.postedAt).toBeInstanceOf(Date);
    expect(d.description!.length).toBeGreaterThan(1500);
    // 19 <p> et 6 <li> à la source : un pavé sans saut de ligne serait une perte.
    expect((d.description!.match(/\n/g) ?? []).length).toBeGreaterThan(15);
    expect(d.description).toContain('• ');
  });

  test('un bloc à paragraphes ne devient pas un pavé', () => {
    const d = parseMicrodataDetail(
      '<div itemprop="description"><div><p>Première phrase.</p></div><div><p>Seconde phrase.</p><ul><li>Un</li><li>Deux</li></ul></div></div><div>hors bloc</div>',
    );
    expect(d.description).toBe('Première phrase.\n\nSeconde phrase.\n• Un\n• Deux');
  });
});

// ——— l2 (2026-09-06) : RMK v2 publie temps de travail et mode de travail (Douglas 130/130 sans temps) ———
import { readFileSync as readFixture } from 'node:fs';

describe('normalizeRmkItem — l2 : custFullTimePartTime, custOnsiteRemote, unifiedStandardEmploymentType', () => {
  const DOUGLAS_L2 = JSON.parse(readFixture(new URL('./__fixtures__/l2-successfactors-douglas-item.json', import.meta.url), 'utf8'));

  test('lit « Full Time » et « Hybrid » sur un item Douglas réel', () => {
    const job = normalizeRmkItem(DOUGLAS_L2, 'de_DE', 'https://jobs.douglas.group')!;
    expect(job.workingTime).toBe('Full Time');
    expect(job.remote).toBe('Hybrid');
    expect(job.contract).toBeUndefined();
  });

  test('lit unifiedStandardEmploymentType comme contrat quand un tenant le remplit', () => {
    const job = normalizeRmkItem({ ...DOUGLAS_L2, unifiedStandardEmploymentType: ['Permanent'] }, 'de_DE', 'https://jobs.douglas.group')!;
    expect(job.contract).toBe('Permanent');
  });
});

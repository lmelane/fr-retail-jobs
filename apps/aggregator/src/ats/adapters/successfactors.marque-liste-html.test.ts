import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySuccessFactorsDetail, fetchSuccessFactorsResult, parseListing, parseListingBrands, parseMicrodataDetail } from './successfactors.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';

/**
 * LA MARQUE DU PORTAIL DE GROUPE, LUE SUR LA LIGNE DE LISTE HTML (D-522 §6, 03/10/2026).
 *
 * ── CE QUE LA MESURE A ÉTABLI ──────────────────────────────────────────────────────────────────
 *
 * `prada-group` (`jobs.pradagroup.com`, gabarit SuccessFactors classique, tableau `tr.data-row`) : cassette du
 * 03/10/2026, 41 pages de liste, 243 offres. La colonne « Brand » du portail (`td.colFacility`, filtre de recherche
 * `optionsFacetsDD_facility`) nomme la marque de CHAQUE offre : Prada 125 · Prada Group 50 · Miu Miu 35 · Versace 13 ·
 * Marchesi 1824 10 · Church's 4, plus 6 libellés japonais (ミュウミュウ 3, プラダ・グループ 2, プラダ 1).
 * La page de détail, elle, ne porte AUCUNE propriété de marque (`title, date, country, city, adcode, department`) et
 * son microdata `hiringOrganization` dit « Prada Group » pour toutes. Résultat en base le 03/10 : les 303 offres actives
 * de la source sont attribuées à « Prada Group », dont les offres Miu Miu et Versace.
 *
 * ── CE QUE CE LOT FAIT ─────────────────────────────────────────────────────────────────────────
 *
 * `brandProperty` (déjà opt-in, par tenant) nomme aussi la COLONNE de la liste HTML : `facility` → `td.colFacility`.
 * La marque ainsi servie par l'éditeur prime sur le `hiringOrganization` générique du groupe ; une propriété de marque
 * portée par la page de détail (OTB, `dept`) prime sur la liste. Rien n'est lu d'un titre. Un tenant qui ne déclare
 * rien, ou une ligne sans cellule, garde exactement le comportement d'avant.
 */
const fixture = (name: string) => gunzipSync(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))).toString('utf8');
const LISTE = fixture('successfactors-prada-liste-p0-20261003.html.gz');
const DETAIL_MIU_MIU = fixture('successfactors-prada-1423904333-20261003.html.gz');
const ORIGIN = 'https://jobs.pradagroup.com';
const MIU_MIU_ID = '1423904333';
/* La même page réelle, cellule « Brand » de la ligne Miu Miu vidée (seule la cellule du tableau, pas le bloc mobile). */
const SANS_CELLULE_MIU_MIU = LISTE.replace(/(<td class="colFacility hidden-phone" headers="hdrFacility">\s*<span class="jobFacility">)Miu Miu(<\/span>)/, '$1$2');

afterEach(() => vi.unstubAllGlobals());

describe('marque servie par la ligne de liste HTML (SuccessFactors classique)', () => {
  it('PRÉMISSE : la page réelle nomme la marque dans la ligne, et la page de détail dit « Prada Group »', () => {
    expect(SANS_CELLULE_MIU_MIU).not.toBe(LISTE);
    /* Sans ces deux faits, les témoins ci-dessous ne testeraient rien. */
    const ids = parseListing(LISTE, ORIGIN).map(job => job.externalId);
    expect(ids).toHaveLength(6);
    expect(ids).toContain(MIU_MIU_ID);
    expect(LISTE).toMatch(/<td class="colFacility hidden-phone" headers="hdrFacility">\s*<span class="jobFacility">Miu Miu<\/span>/);
    /* Le piège du gabarit : le bloc mobile porte la classe `jobFacility` AUSSI sur le département. Un lecteur par classe de
     * span lirait « Finance & Controlling » comme marque. */
    expect(LISTE).toMatch(/<span class="jobFacility visible-phone">Finance &amp; Controlling<\/span>/);
    const detail = parseMicrodataDetail(DETAIL_MIU_MIU);
    expect(detail.company).toBe('Prada Group');
    expect(detail.properties).not.toHaveProperty('facility');
  });

  it('lit la colonne déclarée, ligne par ligne, sans confondre avec le bloc mobile', () => {
    const brands = parseListingBrands(LISTE, 'facility');
    expect(brands.get(MIU_MIU_ID)).toBe('Miu Miu');
    expect([...brands.values()].sort()).toEqual(['Miu Miu', 'Prada', 'Prada', 'Prada Group', 'Prada Group', 'Prada Group']);
    expect([...brands.values()]).not.toContain('Finance & Controlling');
    /* Une cellule VIDE ne donne ni marque ni preuve creuse. */
    expect(parseListingBrands(SANS_CELLULE_MIU_MIU, 'facility').has(MIU_MIU_ID)).toBe(false);
    expect(parseListingBrands(SANS_CELLULE_MIU_MIU, 'facility').size).toBe(5);
    expect(parseListingBrands(LISTE, 'department').get(MIU_MIU_ID)).toBe('Finance & Controlling');
  });

  it('la CHAÎNE DE COLLECTE attribue l’offre Miu Miu à Miu Miu, pas au groupe', async () => {
    /* Le vrai chemin : `fetchSuccessFactorsResult` → liste HTML → page de détail. Les pages suivantes rendent la même
     * page (fin par page répétée) ; chaque détail rend la page Miu Miu réelle. */
    const served: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input); served.push(url);
      return new Response(url.includes('/search/') ? LISTE : DETAIL_MIU_MIU, { headers: { 'content-type': 'text/html' } });
    }));
    const avec = await fetchSuccessFactorsResult({ origin: ORIGIN, brandProperty: 'facility', detailConcurrency: 1 });
    const miu = avec.jobs.find(job => job.externalId === MIU_MIU_ID)!;
    expect(served.some(url => url.includes(`/${MIU_MIU_ID}/`))).toBe(true);
    expect(miu.company).toBe('Miu Miu');
    expect(miu.employerEvidence).toEqual({ rawName: 'Miu Miu', path: 'listing.facility', rule: 'CONFIGURED_BRAND_PROPERTY' });
    expect(miu.raw).toMatchObject({ listingBrand: { property: 'facility', value: 'Miu Miu' } });
  });

  it('une ligne dont la cellule de marque est vide reste au propriétaire du portail, comme avant', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) =>
      new Response(String(input).includes('/search/') ? SANS_CELLULE_MIU_MIU : DETAIL_MIU_MIU, { headers: { 'content-type': 'text/html' } })));
    const result = await fetchSuccessFactorsResult({ origin: ORIGIN, brandProperty: 'facility', detailConcurrency: 1 });
    const miu = result.jobs.find(job => job.externalId === MIU_MIU_ID)!;
    expect(miu.employerEvidence?.rule).toBe('EXPLICIT_JOBPOSTING_EMPLOYER');
    expect(miu.company).toBe('Prada Group');
    expect(miu.raw).not.toHaveProperty('listingBrand');
  });

  it('ne change RIEN quand le tenant ne déclare pas de colonne de marque', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) =>
      new Response(String(input).includes('/search/') ? LISTE : DETAIL_MIU_MIU, { headers: { 'content-type': 'text/html' } })));
    const sans = await fetchSuccessFactorsResult({ origin: ORIGIN, detailConcurrency: 1 });
    const miu = sans.jobs.find(job => job.externalId === MIU_MIU_ID)!;
    expect(miu.company).toBe('Prada Group');
    expect(miu.employerEvidence?.rule).toBe('EXPLICIT_JOBPOSTING_EMPLOYER');
    expect(miu.raw).not.toHaveProperty('listingBrand');
  });

  it('une propriété de marque portée par la page de détail prime sur la liste (OTB, `dept`)', () => {
    const job = { externalId: '1', title: 'Store Manager', url: 'https://careers.example/job/x/1/', raw: {},
      company: 'Diesel', employerEvidence: { rawName: 'Diesel', path: 'listing.dept', rule: 'CONFIGURED_BRAND_PROPERTY' } };
    const detail = { company: 'OTB Spa', employerEvidence: { rawName: 'OTB Spa', path: 'microdata.hiringOrganization', rule: 'EXPLICIT_JOBPOSTING_EMPLOYER' }, properties: { dept: 'Marni' } };
    expect(applySuccessFactorsDetail(job, detail, 'dept')).toMatchObject({ company: 'Marni', employerEvidence: { rawName: 'Marni', path: 'careersite.dept' } });
    const { properties: _p, ...sansPropriete } = detail;
    expect(applySuccessFactorsDetail(job, sansPropriete, 'dept')).toMatchObject({ company: 'Diesel', employerEvidence: { rawName: 'Diesel', path: 'listing.dept' } });
    /* Sans réglage, la preuve de liste ne vaut rien : elle ne peut venir que d'un réglage. */
    expect(applySuccessFactorsDetail(job, sansPropriete)).toMatchObject({ company: 'OTB Spa' });
  });

  it('la RELECTURE hors réseau du RAW retenu rend la même marque que la collecte', () => {
    const detail = parseMicrodataDetail(DETAIL_MIU_MIU);
    const url = `${ORIGIN}/job/Milano-MIU-MIU-Pricing-&amp;-Costing-Analyst/${MIU_MIU_ID}/`;
    const raw = { slug: 'Milano-MIU-MIU-Pricing-&amp;-Costing-Analyst', id: MIU_MIU_ID, path: new URL(url).pathname, source: 'successfactors',
      listingBrand: { property: 'facility', value: 'Miu Miu' },
      successfactorsDetail: { ...detail, postedAt: detail.postedAt?.toISOString() ?? null, validThrough: detail.validThrough?.toISOString() ?? null } };
    const read = (config: Record<string, unknown>, body: unknown = raw) =>
      recoverRetainedPublication('successfactors', body, { externalId: MIU_MIU_ID, url: new URL(url).toString(), observedAt: new Date('2026-10-03T06:20:00Z'), config });
    const avec = read({ origin: ORIGIN, brandProperty: 'facility' });
    expect(avec).toMatchObject({ status: 'RECOVERABLE', job: { company: 'Miu Miu', employerEvidence: { rawName: 'Miu Miu', path: 'listing.facility', rule: 'CONFIGURED_BRAND_PROPERTY' } } });
    /* Réglage retiré, ou colonne différente de celle retenue : la marque de liste n'est pas appliquée. */
    expect(read({ origin: ORIGIN })).toMatchObject({ status: 'RECOVERABLE', job: { company: 'Prada Group' } });
    expect(read({ origin: ORIGIN, brandProperty: 'brand' })).toMatchObject({ status: 'RECOVERABLE', job: { company: 'Prada Group' } });
    expect(read({ origin: ORIGIN, brandProperty: 'facility' }, { ...raw, listingBrand: { property: 'facility', value: '  ' } }))
      .toMatchObject({ status: 'RECOLLECT_OR_REVIEW', reason: 'RAW_SCHEMA_INVALID' });
  });
});

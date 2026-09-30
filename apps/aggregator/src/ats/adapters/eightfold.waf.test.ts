import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchWithRetry: vi.fn() }));
vi.mock('../../lib/browser.js', () => ({ fetchRenderedHtml: vi.fn() }));
// L'attente de la fenêtre du pare-feu est OBSERVÉE (sa durée), jamais subie : quatre minutes par témoin sinon.
vi.mock('../../lib/sourceBudget.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sourceBudget.js')>()), sourceDelay: vi.fn(async () => undefined) }));

import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import { sourceDelay } from '../../lib/sourceBudget.js';
import { htmlToPlainText } from '../../lib/html.js';
import { fetchEightfoldJobs, nativeDescriptionEmpty, NATIVE_DESCRIPTION_EMPTY } from './eightfold.js';
import { isNativeEvidenceRetention, retentionStatus } from '../../pipeline/publicationDisposition.js';

/**
 * EIGHTFOLD — LA FENÊTRE DU PARE-FEU ET LA DESCRIPTION VIDE CHEZ L'ÉDITEUR (30/09/2026).
 *
 * Formes réelles : les positions et fiches Kering et Estée Lauder des fixtures (relevées en ligne le 06/09), et les
 * trois descriptions vides relevées dans la capture Estée Lauder du 29/09 (`scripts/ops/eightfold-descriptions.mts`,
 * lecture seule), recopiées octet pour octet. Le refus est celui que le transport lève après ses trois essais sur un
 * 405 du pare-feu (`HttpStatusError`, statut 405).
 */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));
const keringSearch = fixture('l2-eightfold-kering-search.json');
const keringDetail = fixture('l2-eightfold-kering-detail.json');
const elcSearch = fixture('l2-eightfold-elc-search.json');
const elcDetail = fixture('l2-eightfold-elc-detail.json');

/** Les trois formes vides publiées par l'éditeur (capture du 29/09) : 2, 10 et 16 offres. */
const EMPTY_DIV = '<div></div>';
const EMPTY_TEMPLATE = '<div><div style="padding: 10px 0px;border: 1px solid transparent;"><div style="font-size:16px;word-wrap: break-word;"><h2 style="font-size: 1em; margin: 0px"></h2>\r</div><div></div></div><div style="padding: 10px 0px;border: 1px solid transparent;"><div style="font-size:16px;word-wrap: break-word;"><h2 style="font-size: 1em; margin: 0px"></h2>\r</div><div></div></div></div>';
/** Identique, octet pour octet, à la fiche 1168275706359 relue en ligne le 30/09 (400 caractères). */
const HEADINGS_ONLY = '<div><div style="padding: 10px 0px;border: 1px solid transparent;"><div style="font-size:16px;word-wrap: break-word;"><h2 style="font-size: 1em; margin: 0px">Description</h2>\r</div><div></div></div><div style="padding: 10px 0px;border: 1px solid transparent;"><div style="font-size:16px;word-wrap: break-word;"><h2 style="font-size: 1em; margin: 0px">Qualifications</h2>\r</div><div></div></div></div>';

const waf405 = () => Object.assign(new Error('HTTP 405 for position_details'), { name: 'HttpStatusError', status: 405 });
const gone404 = () => Object.assign(new Error('HTTP 404 for position_details'), { name: 'HttpStatusError', status: 404 });
const idOf = (url: string) => new URL(url).searchParams.get('position_id');
const detailCalls = (id: string) => vi.mocked(fetchJson).mock.calls.filter(([url]) => idOf(String(url)) === id).length;
/** Le listing Kering des fixtures, ramené à ses trois positions : la pagination s'arrête sur le total annoncé. */
const board = (search: { data: { positions: unknown[] } }) => ({ data: { ...search.data, count: search.data.positions.length } });

beforeEach(() => {
  vi.mocked(fetchJson).mockReset();
  vi.mocked(fetchWithRetry).mockReset().mockRejectedValue(new Error('no session'));
  vi.mocked(sourceDelay).mockClear();
});

describe('Eightfold — une fiche perdue dans une fenêtre du pare-feu est relue après elle', () => {
  const kering = { origin: 'https://careers.kering.com', domain: 'kering.com' };
  const keringIds = keringSearch.data.positions.map((p: { id: number }) => String(p.id));

  it('relit la fiche refusée : la description ET la Maison reviennent (Kering, 29/09 : 9 fiches perdues)', async () => {
    const lost = keringIds[1];
    let refusals = 0;
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.includes('/api/pcsx/search')) return board(keringSearch);
      if (idOf(url) === lost && refusals === 0) { refusals++; throw waf405(); }
      return keringDetail;
    });
    const r = await fetchEightfoldJobs(kering);
    // Prémisse : la fiche a bien été refusée au premier passage (sinon ce témoin ne teste rien).
    expect(refusals).toBe(1);
    expect(detailCalls(lost)).toBe(2);
    const job = r.jobs.find((j) => j.externalId === lost)!;
    expect(job.company).toBe('Bottega Veneta');
    expect(job.description).toContain('Bottega Veneta');
    expect(job.publicationHold).toBeUndefined();
    // L'attente couvre la fenêtre la plus longue mesurée (2 min 49 s) depuis CE refus, qui vient d'avoir lieu.
    expect(vi.mocked(sourceDelay)).toHaveBeenCalledTimes(1);
    const [waited] = vi.mocked(sourceDelay).mock.calls[0];
    expect(waited).toBeGreaterThan(169_000);
    expect(waited).toBeLessThanOrEqual(240_000);
  });

  it('ne relit pas une position disparue (404) : une seule demande, l’offre de liste reste, aucune attente', async () => {
    const withdrawn = keringIds[2];
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.includes('/api/pcsx/search')) return board(keringSearch);
      if (idOf(url) === withdrawn) throw gone404();
      return keringDetail;
    });
    const r = await fetchEightfoldJobs(kering);
    expect(detailCalls(withdrawn)).toBe(1);
    expect(r.jobs.find((j) => j.externalId === withdrawn)?.description).toBeUndefined();
    expect(vi.mocked(sourceDelay)).not.toHaveBeenCalled();
  });

  it('un portail en panne n’est pas relu : au-delà de 5 % des fiches (et de cinq), ni attente ni seconde demande', async () => {
    const positions = Array.from({ length: 40 }, (_, i) => ({ ...keringSearch.data.positions[0], id: 900 + i }));
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.includes('/api/pcsx/search')) return { data: { positions: positions.slice(Number(new URL(url).searchParams.get('start')), Number(new URL(url).searchParams.get('start')) + 10), count: 40 } };
      throw waf405();
    });
    const r = await fetchEightfoldJobs(kering);
    // Prémisse : 40 fiches refusées, au-delà de max(5, 5 % de 40).
    expect(vi.mocked(fetchJson).mock.calls.filter(([url]) => String(url).includes('position_details'))).toHaveLength(40);
    expect(r.jobs).toHaveLength(40);
    expect(vi.mocked(sourceDelay)).not.toHaveBeenCalled();
  });

  it('une page de liste refusée est relue après la fenêtre : la collecte ne tombe plus entière (Kering, 28/09, start=700)', async () => {
    let searchRefusals = 0;
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.includes('/api/pcsx/search')) {
        if (searchRefusals === 0) { searchRefusals++; throw waf405(); }
        return board(keringSearch);
      }
      return keringDetail;
    });
    const r = await fetchEightfoldJobs({ ...kering, withDescriptions: false });
    // Prémisse : la page a bien été refusée une fois.
    expect(searchRefusals).toBe(1);
    expect(r.jobs).toHaveLength(3);
    expect(r.complete).toBe(true);
    expect(vi.mocked(sourceDelay)).toHaveBeenCalledWith(240_000);
  });

  it('une page de liste refusée deux fois fait toujours échouer la collecte : pas de liste inventée', async () => {
    vi.mocked(fetchJson).mockImplementation(async () => { throw waf405(); });
    await expect(fetchEightfoldJobs({ ...kering, withDescriptions: false })).rejects.toThrow('HTTP 405');
    expect(vi.mocked(fetchJson)).toHaveBeenCalledTimes(2);
  });
});

describe('D-481 §3 — la description que l’éditeur laisse vide est une retenue sur SA preuve, jamais notre échec', () => {
  const elc = { origin: 'https://elcompanies.eightfold.ai', domain: 'elcompanies.com' };
  const elcIds = elcSearch.data.positions.map((p: { id: number }) => String(p.id));
  const collect = async (descriptionOf: (id: string) => string | Error) => {
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.includes('/api/pcsx/search')) return board(elcSearch);
      const answer = descriptionOf(idOf(url)!);
      if (answer instanceof Error) throw answer;
      return { data: { ...elcDetail.data, jobDescription: answer } };
    });
    return fetchEightfoldJobs(elc);
  };

  it('PRÉMISSE : le gabarit à titres seuls passait pour une description (30 caractères), les deux autres formes pour rien', () => {
    // Les longueurs relevées dans la capture : les chaînes du témoin sont bien celles de l'éditeur.
    expect([EMPTY_DIV.length, EMPTY_TEMPLATE.length, HEADINGS_ONLY.length]).toEqual([11, 375, 400]);
    expect(htmlToPlainText(HEADINGS_ONLY)).toBe('Description\n\n\r\n\nQualifications');
    expect(htmlToPlainText(EMPTY_TEMPLATE)).toBeUndefined();
    expect(htmlToPlainText(EMPTY_DIV)).toBeUndefined();
  });

  it.each([['<div></div>', EMPTY_DIV], ['gabarit aux titres vides', EMPTY_TEMPLATE], ['gabarit « Description / Qualifications » sans contenu', HEADINGS_ONLY]])(
    'fiche lue, %s : retenue NATIVE_DESCRIPTION_EMPTY, sur preuve de la source et décidée', async (_label, html) => {
      const r = await collect((id) => (id === elcIds[0] ? html : elcDetail.data.jobDescription));
      const [held, ...rest] = r.jobs;
      expect(held.publicationHold).toBe(NATIVE_DESCRIPTION_EMPTY);
      // La preuve reste dans le RAW, telle que l'éditeur l'a rendue : le rejeu la relit (`recovery.ts`).
      expect((held.raw as { eightfoldDetail: { jobDescription: string } }).eightfoldDetail.jobDescription).toBe(html);
      expect(isNativeEvidenceRetention(held.publicationHold!)).toBe(true);
      expect(retentionStatus(held.publicationHold!)).toBe('décidé');
      // Les offres voisines, décrites, ne sont pas touchées.
      expect(rest.every((job) => !job.publicationHold && (job.description?.length ?? 0) >= 40)).toBe(true);
    });

  it('une fiche NON LUE n’est jamais cette retenue : elle reste sans description, donc refusée et comptée', async () => {
    const r = await collect((id) => (id === elcIds[0] ? gone404() : elcDetail.data.jobDescription));
    expect(r.jobs[0].publicationHold).toBeUndefined();
    expect(r.jobs[0].description).toBeUndefined();
    expect((r.jobs[0].raw as Record<string, unknown>).eightfoldDetail).toBeUndefined();
  });

  it('une fiche lue au format inconnu (champ absent, ou non textuel) n’est pas une preuve de vide', () => {
    const { jobDescription: _removed, ...sansChamp } = elcDetail.data;
    expect(nativeDescriptionEmpty(sansChamp)).toBe(false);
    expect(nativeDescriptionEmpty({ ...sansChamp, jobDescription: null })).toBe(false);
    expect(nativeDescriptionEmpty(undefined)).toBe(false);
    // L'ancienne clé, quand elle porte la chaîne, est lue comme par le collecteur.
    expect(nativeDescriptionEmpty({ ...sansChamp, job_description: HEADINGS_ONLY })).toBe(true);
  });

  it('une description réelle, même courte ou toute en titre long, n’est jamais retenue', () => {
    expect(nativeDescriptionEmpty(elcDetail.data)).toBe(false);
    expect(nativeDescriptionEmpty(keringDetail.data)).toBe(false);
    expect(nativeDescriptionEmpty({ jobDescription: '<h2>Description</h2><div><p>Conseiller la clientèle.</p></div>' })).toBe(false);
    // Un titre de plus de 60 caractères n'est pas un titre de rubrique : c'est le contenu que l'éditeur publie.
    const longTitle = 'Beauty Advisor – Clinique – Galeries Lafayette Haussmann, 75009 Paris, temps plein';
    expect(longTitle.length).toBeGreaterThan(60);
    expect(nativeDescriptionEmpty({ jobDescription: `<h2>${longTitle}</h2>` })).toBe(false);
  });
});

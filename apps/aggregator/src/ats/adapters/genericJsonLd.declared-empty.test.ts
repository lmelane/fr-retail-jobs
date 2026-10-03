import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn() }));

import { fetchText } from '../../lib/http.js';
import { archivedStartPageDeclaresNoOpening, fetchGenericJsonLdJobs, startPageDeclaresNoOpening, visiblePageText, DECLARED_EMPTY_TERMINATION } from './genericJsonLd.js';
import { normalizeAdapterResult } from '../index.js';
import { PROVING_TERMINATIONS, enumerationEvidence, massAbsenceGuard } from '../../pipeline/refreshPlan.js';

/**
 * D-522 §6 — le zéro natif d'une page carrières (03/10/2026). Deux pages réelles, lues ce jour sous CatwalksBot et
 * réduites : Sioux (« Derzeit haben wir keine offenen Stellen. ») et Ghost (« Although we do not have current
 * openings »). Le lecteur générique n'avait aucun moyen d'en faire une preuve : la page lue en mode `startUrl` rendait
 * toujours `complete: false`, et la validation refusait `EMPTY_FEED_NOT_NATIVELY_PROVEN`.
 */
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const SIOUX = { url: 'https://www.sioux.de/pages/stellenangebote', html: fixture('generic-sioux-stellenangebote-20261003.html'),
  text: 'Derzeit haben wir keine offenen Stellen.' };
const GHOST = { url: 'https://www.ghostfashion.com/careers', html: fixture('generic-ghost-careers-20261003.html'),
  text: 'Although we do not have current openings' };
const mockFetch = vi.mocked(fetchText);
beforeEach(() => { mockFetch.mockReset(); });

const jobPosting = (title: string) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting',
  title, description: 'Native description', hiringOrganization: { name: 'Sioux' }, jobLocation: { address: { addressLocality: 'Walheim', addressCountry: 'DE' } } })}</script>`;

describe('D-522 §6 : une page carrières qui annonce elle-même l\'absence d\'offres', () => {
  it.each([SIOUX, GHOST])('prouve le zéro natif de $url par sa phrase native, sans aucune offre', async page => {
    // Prémisse : la phrase est dans le texte VISIBLE de la page réelle, et la page ne porte aucun JobPosting.
    expect(visiblePageText(page.html)).toContain(page.text);
    expect(page.html).not.toMatch(/JobPosting/);
    mockFetch.mockImplementation(async () => page.html);
    const result = normalizeAdapterResult(await fetchGenericJsonLdJobs({ startUrl: page.url, emptyListingText: page.text }));
    expect(result).toMatchObject({ jobs: [], declaredTotal: 0, complete: true, truncated: false, enumerationVerdict: 'PROVEN' });
    expect(result.enumeration).toMatchObject({ termination: DECLARED_EMPTY_TERMINATION, issues: [] });
    expect(result.enumeration?.pageEvidence).toEqual([expect.objectContaining({ url: page.url, ids: [], canonicalIds: [], publisherCounter: page.text })]);
    // La preuve est de celles qui démontrent la fin du parcours, avec un contrat canonique déclaré (vide).
    expect(PROVING_TERMINATIONS.has(DECLARED_EMPTY_TERMINATION)).toBe(true);
    expect(enumerationEvidence('k', 'b', { enumeration: result.enumeration })).toMatchObject({ canonicalSet: [], canonicalContractDeclared: true });
  });

  it('sans phrase native configurée, la même page reste une lecture de page qui ne prouve rien (comportement inchangé)', async () => {
    mockFetch.mockImplementation(async () => SIOUX.html);
    const result = await fetchGenericJsonLdJobs({ startUrl: SIOUX.url });
    expect(result).toMatchObject({ jobs: [], complete: false });
    expect(result.enumeration).toMatchObject({ method: 'START_PAGE_LINK_CRAWL_NO_ENUMERATION_PROOF', issues: ['NO_PUBLISHER_LISTING_OR_SITEMAP', 'ENUMERATION_NOT_PROVEN'] });
  });

  it('une phrase qui n\'est que dans un script, un gabarit ou un commentaire ne prouve rien', async () => {
    const hidden = SIOUX.html.replace(SIOUX.text, 'Wir freuen uns auf Ihre Bewerbung.')
      .replace('</body>', `<script>var empty = "${SIOUX.text}";</script><template><p>${SIOUX.text}</p></template><!-- ${SIOUX.text} --><noscript>${SIOUX.text}</noscript></body>`);
    // Prémisse : la phrase est bien dans les octets, mais nulle part dans le texte visible.
    expect(hidden).toContain(SIOUX.text);
    expect(visiblePageText(hidden)).not.toContain(SIOUX.text);
    mockFetch.mockImplementation(async () => hidden);
    const result = await fetchGenericJsonLdJobs({ startUrl: SIOUX.url, emptyListingText: SIOUX.text });
    expect(result.complete).toBe(false);
    expect(result.enumeration?.issues).toContain('DECLARED_EMPTY_TEXT_ABSENT');
    expect(startPageDeclaresNoOpening(hidden, SIOUX.text, SIOUX.url)).toBe(false);
  });

  it.each([
    ['dans un élément masqué (display:none)', (html: string) => html.replace(`<p class="has-text-align-center" style="text-align: center;">${SIOUX.text}</p>`,
      `<p class="has-text-align-center" style="text-align: center; display: none">${SIOUX.text}</p>`)],
    ['dans un élément hidden', (html: string) => html.replace(`<p class="has-text-align-center" style="text-align: center;">${SIOUX.text}</p>`,
      `<div hidden><p>${SIOUX.text}</p></div>`)],
  ])('une phrase %s ne prouve rien', async (_label, mutate) => {
    const html = mutate(SIOUX.html);
    // Prémisse : la mutation a bien porté sur la phrase (elle est toujours dans les octets, plus dans le texte visible).
    expect(html).not.toBe(SIOUX.html);
    expect(html).toContain(SIOUX.text);
    expect(visiblePageText(html)).not.toContain(SIOUX.text);
    mockFetch.mockImplementation(async () => html);
    expect((await fetchGenericJsonLdJobs({ startUrl: SIOUX.url, emptyListingText: SIOUX.text })).complete).toBe(false);
  });

  it('une page qui charge un portail d\'éditeur d\'ATS ne prouve jamais un zéro, même phrase visible', async () => {
    const html = GHOST.html.replace('</body>', '<script src="https://boards.greenhouse.io/embed/job_board/js?for=ghost"></script></body>');
    expect(visiblePageText(html)).toContain(GHOST.text);
    mockFetch.mockImplementation(async () => html);
    const result = await fetchGenericJsonLdJobs({ startUrl: GHOST.url, emptyListingText: GHOST.text });
    expect(result.complete).toBe(false);
    expect(result.enumeration?.issues).toContain('DECLARED_EMPTY_CONTRADICTED');
    // Une marque voisine n'est pas un éditeur : « clever.com » ne contient pas lever.co.
    expect(startPageDeclaresNoOpening(GHOST.html.replace('</body>', '<a href="https://clever.com">clever</a></body>'), GHOST.text, GHOST.url)).toBe(true);
  });

  it('une offre trouvée sur une page liée contredit la phrase : rien n\'est prouvé, l\'offre est rendue', async () => {
    const withLink = GHOST.html.replace('</footer>', '<a href="/careers/store-manager">Store Manager</a></footer>');
    mockFetch.mockImplementation(async url => String(url).endsWith('/store-manager') ? jobPosting('Store Manager') : withLink);
    const result = await fetchGenericJsonLdJobs({ startUrl: GHOST.url, emptyListingText: GHOST.text });
    expect(result.jobs.map(job => job.title)).toEqual(['Store Manager']);
    expect(result.complete).toBe(false);
    expect(result.enumeration?.issues).toContain('DECLARED_EMPTY_CONTRADICTED');
  });

  it.each([
    ['un JobPosting sur la page même', (html: string) => html.replace('</body>', `${jobPosting('Verkäufer')}</body>`)],
    ['un JobPosting illisible (JSON cassé) sur la page même', (html: string) => html.replace('</body>', '<script type="application/ld+json">{"@type":"JobPosting", title: }</script></body>')],
    ['une offre en microdonnées', (html: string) => html.replace('</body>', '<div itemscope itemtype="https://schema.org/JobPosting"><h2 itemprop="title">Verkäufer</h2></div></body>')],
  ])('%s contredit la phrase', async (_label, mutate) => {
    const html = mutate(SIOUX.html);
    expect(visiblePageText(html)).toContain(SIOUX.text);
    mockFetch.mockImplementation(async () => html);
    const result = await fetchGenericJsonLdJobs({ startUrl: SIOUX.url, emptyListingText: SIOUX.text });
    expect(result.complete).toBe(false);
    expect(result.enumeration?.termination).not.toBe(DECLARED_EMPTY_TERMINATION);
    expect(startPageDeclaresNoOpening(html, SIOUX.text, SIOUX.url)).toBe(false);
  });

  it('une page liée illisible empêche la preuve : le zéro n\'est jamais déduit d\'un échec', async () => {
    // Depuis le correctif Lumentee (81eae5b), l'ancre `/careers#` de la page Ghost n'est plus relue : la page réelle ne lie
    // plus aucune autre page. Le témoin lui ajoute donc un lien vers une AUTRE page carrières, qui échoue.
    const linked = 'https://www.ghostfashion.com/careers/stylist';
    const html = GHOST.html.replace('</body>', '<a href="/careers/stylist">Stylist</a></body>');
    mockFetch.mockImplementation(async url => { if (String(url) === linked) throw new Error('HTTP 503 Service Unavailable'); return html; });
    const result = await fetchGenericJsonLdJobs({ startUrl: GHOST.url, emptyListingText: GHOST.text });
    // Prémisse : la page liée a bien été demandée, et c'est elle qui a échoué.
    expect(mockFetch.mock.calls.map(c => String(c[0]))).toContain(linked);
    expect(result.complete).toBe(false);
    expect(result.enumeration?.issues).toContain('LINKED_PAGE_FETCH_FAILURES=1');
  });

  it('refuse une phrase trop courte pour être une preuve, et toute phrase hors du mode page carrières', async () => {
    mockFetch.mockImplementation(async () => SIOUX.html);
    await expect(fetchGenericJsonLdJobs({ startUrl: SIOUX.url, emptyListingText: 'keine' })).rejects.toThrow(/emptyListingText/);
    await expect(fetchGenericJsonLdJobs({ sitemapUrl: 'https://www.sioux.de/sitemap.xml', emptyListingText: SIOUX.text })).rejects.toThrow(/emptyListingText/);
  });

  it('la validation relit la preuve sur les octets archivés : page de départ en 200, complète, phrase visible, aucune offre nulle part', () => {
    const config = { startUrl: GHOST.url, emptyListingText: GHOST.text };
    const ok = (url: string, body = GHOST.html) => ({ url, status: 200, complete: true, body });
    expect(archivedStartPageDeclaresNoOpening(config, [ok(GHOST.url), ok(`${GHOST.url}#`)])).toBe(true);
    expect(archivedStartPageDeclaresNoOpening({ startUrl: GHOST.url }, [ok(GHOST.url)])).toBe(false);
    expect(archivedStartPageDeclaresNoOpening(config, [ok(`${GHOST.url}#`)])).toBe(false);
    expect(archivedStartPageDeclaresNoOpening(config, [ok(GHOST.url), { ...ok(`${GHOST.url}#`), status: 503 }])).toBe(false);
    expect(archivedStartPageDeclaresNoOpening(config, [ok(GHOST.url), { ...ok(`${GHOST.url}#`), complete: false }])).toBe(false);
    expect(archivedStartPageDeclaresNoOpening(config, [ok(GHOST.url), ok('https://www.ghostfashion.com/careers/x', jobPosting('Store Manager'))])).toBe(false);
    expect(archivedStartPageDeclaresNoOpening(config, [ok(GHOST.url, GHOST.html.replace(GHOST.text, 'We are hiring'))])).toBe(false);
  });

  it('la relecture compte les ADRESSES, pas les tentatives : 150 liens dont 5 lus après une reprise, la preuve tient', () => {
    const config = { startUrl: GHOST.url, emptyListingText: GHOST.text };
    const ok = (url: string) => ({ url, status: 200, complete: true, body: GHOST.html.replace(GHOST.text, 'About us') });
    const links = Array.from({ length: 150 }, (_, i) => `https://www.ghostfashion.com/careers/page-${i}`);
    const rows = [{ url: GHOST.url, status: 200, complete: true, body: GHOST.html },
      ...links.flatMap((url, i) => i < 5 ? [{ url, status: 503, complete: true, body: 'busy' }, ok(url)] : [ok(url)])];
    // Prémisse : plus de lignes archivées que d'adresses, et des tentatives en échec parmi elles.
    expect(rows.length).toBe(156);
    expect(new Set(rows.map(row => row.url)).size).toBe(151);
    expect(archivedStartPageDeclaresNoOpening(config, rows)).toBe(true);
    // La DERNIÈRE tentative compte : une adresse dont la dernière lecture échoue ne prouve rien.
    expect(archivedStartPageDeclaresNoOpening(config, [...rows, { url: links[7], status: 503, complete: true, body: 'busy' }])).toBe(false);
    // Plus d'adresses que le lecteur n'en lit (1 + 150) : refusé.
    expect(archivedStartPageDeclaresNoOpening(config, [...rows, ok('https://www.ghostfashion.com/careers/page-150')])).toBe(false);
  });

  it.each([
    ['un script d\'un fournisseur inconnu', '<script src="https://widget.unknown-jobs.example/embed.js"></script>'],
    ['une iframe d\'un fournisseur inconnu', '<iframe src="https://careers.unknown-host.example/board"></iframe>'],
  ])('%s sur la page de départ empêche la preuve (offres possibles en JavaScript)', async (_label, tag) => {
    const html = GHOST.html.replace('</body>', `${tag}</body>`);
    expect(visiblePageText(html)).toContain(GHOST.text);
    mockFetch.mockImplementation(async () => html);
    expect((await fetchGenericJsonLdJobs({ startUrl: GHOST.url, emptyListingText: GHOST.text })).complete).toBe(false);
    expect(startPageDeclaresNoOpening(html, GHOST.text, GHOST.url)).toBe(false);
    // Les hôtes neutres de la liste fermée et l'origine de la Maison restent admis.
    const neutral = GHOST.html.replace('</body>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/x.js"></script><script src="https://www.ghostfashion.com/app.js"></script><script src="/rel.js"></script></body>');
    expect(startPageDeclaresNoOpening(neutral, GHOST.text, GHOST.url)).toBe(true);
  });

  it('Sioux : le zéro prouvé ne ferme pas seul les 19 offres homonymes servies (garde de masse R-143 §2)', () => {
    expect(massAbsenceGuard({ stock: 19, absent: 19, confirmedDrop: false })).toMatch(/tout le stock/);
  });
});

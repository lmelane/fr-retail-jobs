import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), fetchJson: vi.fn() }));
import { fetchText } from '../../lib/http.js';
import { fetchSuccessFactorsResult, parseSuccessFactorsJobFeed } from './successfactors.js';
import { PROVING_TERMINATIONS } from '../../pipeline/refreshPlan.js';
import { readEnumeration } from '../../pipeline/enumerationReading.js';

/**
 * SEPHORA, RUN DU 02/10/2026 (D-522 §6) : « troncature : 2 069 collectées, total inconnu ».
 *
 * Cause lue dans la capture 95470f67 : la langue en_US annonce 1 673 puis 1 672 puis 1 673… d'une page à l'autre (huit
 * bascules sur la première passe, quatre sur la passe fraîche) ; deux états de l'index servis en alternance. La passe
 * fraîche, faite pour un total qui change une fois, oscille de la même façon : aucune passe ne se prouve seule.
 * L'éditeur publie pourtant la liste entière d'un seul tenant : `/sitemap.xml` est un flux RSS de toutes ses offres
 * (2 090 articles le 03/10, toutes langues ; 50 identifiants en_US relus en ligne, 50 présents ; trois offres lues au
 * RUN et absentes du flux relues en ligne : « has been filled »). Quand les seules langues non prouvées le sont par un
 * total changeant, le flux est lu une fois : si chacun de ses identifiants a été lu, la liste est complète. Comme la
 * passe fraîche, cette réconciliation ne ferme rien ce jour-là (terminaison non probante).
 */
const real = JSON.parse(readFileSync(new URL('./__fixtures__/d522-6-successfactors-sephora-flux.json', import.meta.url), 'utf8'));
const [A, B, C, D, E] = real.ids as string[];
const feed = (ids: string[], tail = real.feedTail as string) => real.feedHead + ids.map((id) => real.items[id]).join('') + tail;
const text = vi.mocked(fetchText);
/** Une page en_US telle que la rend SAP : son compteur et ses liens d'offres. */
const listing = (start: number, total: number, ids: string[]) => `<span class="paginationLabel">Results <b>${start} – ${start + ids.length - 1}</b> of <b>${total}</b></span>` +
  ids.map((id) => `<a href="/job/Sunrise-Beauty-Advisor/${id}/">Beauty Advisor</a>`).join('');

/**
 * Deux états de l'index servis en alternance, à pas de deux : X = [A, B, C, D, E] annonce 5 offres, Y = [A, B, D, E] en
 * annonce 4. Première passe Y, X, Y (C et D, puis rien au-delà du total de Y : E manquée) ; passe fraîche X, Y (D et E :
 * C manquée). Aucune passe ne se prouve, l'union a tout lu.
 */
function board(feedBody: string | (() => never)) {
  const pass1 = [listing(1, 4, [A, B]), listing(3, 5, [C, D]), '<div class="searchResultsShell"></div>'];
  const pass2 = [listing(1, 5, [A, B]), listing(3, 4, [D, E])];
  const served = { feed: 0 };
  text.mockImplementation(async (raw) => {
    const u = new URL(String(raw));
    if (u.pathname === '/sitemap.xml') { served.feed++; return typeof feedBody === 'string' ? feedBody : feedBody(); }
    if (u.pathname === '/') return '<a href="/USA/?locale=en_US">US</a>';
    if (!u.searchParams.get('locale')) return listing(1, 1, [A]);
    const queue = pass1.length ? pass1 : pass2;
    return queue.shift() ?? '<div class="searchResultsShell"></div>';
  });
  return served;
}
const config = { origin: 'https://jobs.sephora.com', allLocales: true, withDescriptions: false };
beforeEach(() => vi.resetAllMocks());

describe('SuccessFactors — total HTML oscillant, réconciliation par le flux complet de l’éditeur (Sephora, 02/10/2026)', () => {
  it('lit le flux réel : un document entier, un identifiant par article', () => {
    const origin = 'https://jobs.sephora.com';
    expect(parseSuccessFactorsJobFeed(feed([A, B, C]), origin)?.map((job) => job.externalId)).toEqual([A, B, C]);
    expect(parseSuccessFactorsJobFeed(feed([A]), origin)?.[0]?.url).toMatch(new RegExp(`^https://jobs\\.sephora\\.com/[A-Za-z]+/job/[^/]+/${A}/$`));
    // Coupé avant sa fin : ce n'est plus la liste entière.
    expect(parseSuccessFactorsJobFeed(feed([A, B, C], ''), origin)).toBeNull();
    // Un article sans identifiant, ou dont le lien nomme une autre offre, rend le flux inexploitable, jamais plus court.
    expect(parseSuccessFactorsJobFeed(feed([A]).replace(/<g:id>\d+<\/g:id>/, ''), origin)).toBeNull();
    expect(parseSuccessFactorsJobFeed(feed([A]).replace(`<g:id>${A}</g:id>`, '<g:id>1999999999</g:id>'), origin)).toBeNull();
    // Un lien vers un autre hôte n'est pas une offre de ce portail.
    expect(parseSuccessFactorsJobFeed(feed([A]), 'https://jobs.example.com')).toBeNull();
    expect(parseSuccessFactorsJobFeed('<html><body>Not found</body></html>', origin)).toBeNull();
  });

  it('prémisse : sans flux, deux passes oscillantes ne prouvent rien ; avec le flux entièrement lu, la liste est complète', async () => {
    // Prémisse : le flux est refusé, le lecteur retombe sur l'état d'avant.
    board(() => { throw new Error('HTTP 503'); });
    const before = await fetchSuccessFactorsResult(config);
    expect(new Set(before.jobs.map((j) => j.externalId))).toEqual(new Set([A, B, C, D, E]));
    expect(before.complete).toBe(false);
    expect(before.enumeration?.issues).toEqual(expect.arrayContaining(['en_US:SOURCE_TOTAL_CHANGED', 'HTML_LOCALE_INCOMPLETE:en_US']));

    // C pourvue entre-temps : le flux, lu après la liste, ne la porte plus — chacun de ses identifiants a été lu.
    const served = board(feed([A, B, D, E]));
    const r = await fetchSuccessFactorsResult(config);
    expect(served.feed).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.enumeration?.termination).toBe('ALL_LOCALE_TOTALS_RECONCILED_BY_PUBLISHER_FEED');
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['en_US:SOURCE_TOTAL_CHANGED', 'PUBLISHER_FEED_RECONCILED']));
    expect(r.enumeration?.pageEvidence?.at(-1)).toMatchObject({ url: 'https://jobs.sephora.com/sitemap.xml', ids: [A, B, D, E], publisherCounter: 'items=4' });
    expect(readEnumeration(r).enumerationReading).toBe('PROVEN');
    // Comme la passe fraîche : la source est saine, ses absences ne ferment rien ce jour-là.
    expect(PROVING_TERMINATIONS.has('ALL_LOCALE_TOTALS_RECONCILED_BY_PUBLISHER_FEED')).toBe(false);
  });

  it('une offre du flux que les pages n’ont pas servie est collectée depuis son lien, et comptée', async () => {
    const F = '1999999999';
    board(feed([A, B, C, D, E]) .replace('</channel>', real.items[A].replaceAll(A, F) + '</channel>'));
    const r = await fetchSuccessFactorsResult(config);
    expect(r.complete).toBe(true);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['PUBLISHER_FEED_ONLY:1', 'PUBLISHER_FEED_RECONCILED']));
    const added = r.jobs.find((j) => j.externalId === F);
    expect(added).toMatchObject({ url: expect.stringMatching(new RegExp(`/job/[^/]+/${F}/$`)), raw: expect.objectContaining({ id: F, source: 'successfactors' }) });
    expect(added?.title).toBeTruthy();
  });

  it('un flux incohérent ne prouve rien et n’ajoute rien', async () => {
    board(feed([A, B, C, D, E]).replace(`<g:id>${A}</g:id>`, '<g:id>1999999999</g:id>'));
    const r = await fetchSuccessFactorsResult(config);
    expect(r.complete).toBe(false);
    expect(r.jobs).toHaveLength(5);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['PUBLISHER_FEED_UNREADABLE']));
    expect(r.enumeration?.issues).not.toContain('PUBLISHER_FEED_RECONCILED');
  });

  it('une langue en échec de lecture n’est jamais rattrapée par le flux', async () => {
    const served = { feed: 0 };
    text.mockImplementation(async (raw) => {
      const u = new URL(String(raw));
      if (u.pathname === '/sitemap.xml') { served.feed++; return feed([A]); }
      if (u.pathname === '/') return '<a href="?locale=en_US">US</a><a href="?locale=fr_FR">FR</a>';
      if (u.searchParams.get('locale') === 'fr_FR') throw new Error('HTTP 503');
      return listing(1, 1, [A]);
    });
    const r = await fetchSuccessFactorsResult(config);
    expect(r.complete).toBe(false);
    expect(served.feed).toBe(0);
  });
});

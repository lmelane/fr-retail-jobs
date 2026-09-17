import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn() }));
import { fetchText } from '../../lib/http.js';
import { externalIdFromLink, fetchTalentsoftJobs } from './talentsoft.js';
import { normalizeAdapterResult } from '../index.js';

/**
 * Lagardère (lagardere-recrute.talent-soft.com, mesuré le 2026-09-09) : le
 * listing annonce 109 offres sur 11 pages puis ressert sa première page ;
 * le RSS (20 items) lie `lagardere.com/nous-rejoindre/postuler/offre-2026-10266-502`
 * — hors du board, redirigé vers la page d'accueil du groupe. L'ancien
 * identifiant RSS (le lien entier) ne rencontrait jamais l'identifiant de la
 * carte (`_10266.aspx`) : 20 « offres » de plus, aux URLs mortes, 129 pour 109.
 */
const origin = 'https://tenant.talent-soft.com';
const card = (id: number, title: string) => `<a class="ts-offer-list-item__title-link" href="/offre-de-emploi/emploi-${title.toLowerCase().replace(/[^a-z]+/g, '-')}_${id}.aspx">${title} - 2026-${id}</a><ul class="ts-offer-list-item__description">Réf. : 2026-${id} | 08/09/2026 | Paris</ul>`;
const listing = (total: number, page: number, ids: number[]) => `<html><head><title>TENANT - Résultat de votre recherche (${total} offres, page ${page}) / Tout afficher</title></head><body>${ids.map((i) => card(i, `Conseiller ${i}`)).join('')}</body></html>`;
const rss = (items: Array<{ id: number; link: string }>) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>2026-${i.id} - Conseiller ${i.id} H/F</title><link>${i.link}</link><category>CDI</category><category>Paris</category><pubDate>Tue, 08 Sep 2026 22:04:35 Z</pubDate><description><![CDATA[<b>Contrat :</b> CDI]]></description></item>`).join('')}</channel></rss>`;

beforeEach(() => vi.resetAllMocks());

describe('externalIdFromLink', () => {
  it('lit idOffre, puis le suffixe _<id>.aspx, puis la référence <année>-<id>', () => {
    expect(externalIdFromLink(`${origin}/offre-de-emploi/detailoffre.aspx?idOffre=4242`)).toBe('4242');
    expect(externalIdFromLink(`${origin}/offre-de-emploi/emploi-conseiller_10266.aspx`)).toBe('10266');
    expect(externalIdFromLink('https://www.lagardere.com/nous-rejoindre/postuler/offre-2026-10266-502', '2026-10266 - Conseiller H/F')).toBe('10266');
    expect(externalIdFromLink('https://example.org/x', 'Sans référence')).toBe('https://example.org/x');
  });
});

describe('fetchTalentsoftJobs — énumération prouvée et RSS hors board', () => {
  it('rapproche les items RSS hors board de leurs cartes, garde l’URL du board et prouve le total annoncé', async () => {
    const ids = Array.from({ length: 23 }, (_, i) => 1000 + i);
    vi.mocked(fetchText).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('offerRss')) return rss(ids.slice(0, 3).map((id) => ({ id, link: `https://www.group.com/postuler/offre-2026-${id}-502` })));
      const page = Number(/page=(\d+)/.exec(u)?.[1] ?? 1);
      const slice = ids.slice((page - 1) * 10, page * 10);
      return listing(23, slice.length ? page : 1, slice.length ? slice : ids.slice(0, 10));   // page 4 ressert la page 1
    });
    const r = await fetchTalentsoftJobs({ origin, withDescriptions: false });
    expect(r.jobs).toHaveLength(23);
    expect(r.declaredTotal).toBe(23); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.rejectedRows).toEqual([]);
    const enriched = r.jobs.find((j) => j.externalId === '1000')!;
    expect(enriched.url).toBe(`${origin}/offre-de-emploi/emploi-conseiller-_1000.aspx`);   // jamais le lien RSS redirigé
    expect(enriched.contract).toBe('CDI'); expect(enriched.postedAt?.toISOString()).toBe('2026-09-08T22:04:35.000Z');
    expect(r.enumeration?.termination).toBe('ANNOUNCED_TOTAL_REACHED'); expect(r.enumeration?.pages).toBe(3);
    expect(r.enumeration?.scopes?.[0]).toEqual({ scope: 'listing', declaredTotal: 23, uniqueIds: 23, pages: 3, complete: true });
  });

  it('retient sans le compter un item RSS hors board absent du listing, et n’annonce pas complet si le total n’est pas atteint', async () => {
    vi.mocked(fetchText).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('offerRss')) return rss([{ id: 9999, link: 'https://www.group.com/postuler/offre-2026-9999-1' }]);
      const page = Number(/page=(\d+)/.exec(u)?.[1] ?? 1);
      return page === 1 ? listing(12, 1, [1, 2, 3]) : listing(12, 1, [1, 2, 3]);
    });
    const r = await fetchTalentsoftJobs({ origin, withDescriptions: false });
    expect(r.jobs.map((j) => j.externalId)).toEqual(['1', '2', '3']);
    expect(r.rejectedRows?.[0].reason).toBe('RSS_ITEM_LINK_OFF_BOARD_AND_ABSENT_FROM_LISTING');
    expect(r.complete).toBe(false); expect(r.truncated).toBe(true); expect(r.enumeration?.issues).toContain('ENUMERATION_NOT_PROVEN');
  });

  it('un item RSS ON board absent du listing est ajouté mais signalé', async () => {
    vi.mocked(fetchText).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('offerRss')) return rss([{ id: 77, link: `${origin}/offre-de-emploi/detailoffre.aspx?idOffre=77` }]);
      return listing(2, 1, [1, 2]);
    });
    const r = await fetchTalentsoftJobs({ origin, withDescriptions: false });
    expect(r.jobs.map((j) => j.externalId).sort()).toEqual(['1', '2', '77']);
    expect(r.complete).toBe(false); expect(r.enumeration?.issues).toContain('RSS_ITEM_ABSENT_FROM_LISTING');
  });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
 *
 * DEUX chemins produisent des offres — le listing HTML et le flux RSS — donc DEUX familles de pages de preuve.
 * Un contrat partiel n'est pas un contrat : si le flux se taisait, une offre qu'il porte seul (listing
 * illisible, ou carte absente) n'apparaîtrait dans aucun `canonicalIds` et paraîtrait disparue au refresh.
 * Le témoin passe au rouge si `canonicalIds` est retiré de l'un ou l'autre chemin.
 */
describe('TalentSoft — contrat des identifiants canoniques', () => {
  it('déclare canonicalIds sur le flux RSS ET sur chaque page de listing', async () => {
    const ids = Array.from({ length: 23 }, (_, i) => 1000 + i);
    vi.mocked(fetchText).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('offerRss')) return rss(ids.slice(0, 3).map((id) => ({ id, link: `https://www.group.com/postuler/offre-2026-${id}-502` })));
      const page = Number(/page=(\d+)/.exec(u)?.[1] ?? 1);
      const slice = ids.slice((page - 1) * 10, page * 10);
      return listing(23, slice.length ? page : 1, slice.length ? slice : ids.slice(0, 10));
    });
    const r = await fetchTalentsoftJobs({ origin, withDescriptions: false });

    const evidence = r.enumeration!.pageEvidence!;
    expect(evidence).toHaveLength(4);                        // 1 flux RSS + 3 pages de listing
    for (const pe of evidence) expect(Object.hasOwn(pe, 'canonicalIds')).toBe(true);
    // Le flux nomme les trois items par leur référence « 2026-<n> », pas par leur lien hors board.
    expect(evidence[0].canonicalIds).toEqual(['1000', '1001', '1002']);
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(true);

    const canonical = new Set(evidence.flatMap((pe) => pe.canonicalIds ?? []));
    expect([...canonical].sort()).toEqual(r.jobs.map((j) => j.externalId).sort());
    const n = normalizeAdapterResult(r);
    expect(n.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(n.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });

  it('une offre portée par le SEUL flux RSS figure dans la preuve du flux', async () => {
    vi.mocked(fetchText).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('offerRss')) return rss([{ id: 77, link: `${origin}/offre-de-emploi/detailoffre.aspx?idOffre=77` }]);
      return listing(2, 1, [1, 2]);
    });
    const r = await fetchTalentsoftJobs({ origin, withDescriptions: false });

    expect(r.jobs.map((j) => j.externalId).sort()).toEqual(['1', '2', '77']);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['77']);
    // Sans la page du flux, « 77 » serait écrite hors de toute preuve.
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it('un item RSS hors board reste une DISPOSITION nommée, pas un trou dans la preuve du flux', async () => {
    vi.mocked(fetchText).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('offerRss')) return rss([{ id: 9999, link: 'https://www.group.com/postuler/offre-2026-9999-1' }]);
      return listing(12, 1, [1, 2, 3]);
    });
    const r = await fetchTalentsoftJobs({ origin, withDescriptions: false });

    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['9999']);
    expect(r.rejectedRows?.map((row) => [row.reason, row.canonicalId]))
      .toEqual([['RSS_ITEM_LINK_OFF_BOARD_AND_ABSENT_FROM_LISTING', '9999']]);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it("un item RSS sans identifiant natif n'est jamais publié sous un identifiant d'URL", async () => {
    vi.mocked(fetchText).mockImplementation(async (url) => {
      const u = String(url);
      // Lien sur le board, mais sans idOffre, sans _<n>.aspx et sans référence « <année>-<n> ».
      if (u.includes('offerRss')) return `<?xml version="1.0"?><rss><channel><item><title>Conseiller H/F</title><link>${origin}/nous-rejoindre/spontanee</link></item></channel></rss>`;
      return listing(2, 1, [1, 2]);
    });
    const r = await fetchTalentsoftJobs({ origin, withDescriptions: false });

    // Publier cette offre lui donnerait un identifiant dérivé de son URL, absent de tout canonicalIds.
    expect(r.jobs.map((j) => j.externalId).sort()).toEqual(['1', '2']);
    expect(r.rejectedRows?.map((row) => row.reason)).toEqual(['RSS_ITEM_WITHOUT_NATIVE_ID']);
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(false);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual([]);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });
});

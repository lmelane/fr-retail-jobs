import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn() }));
import { fetchText } from '../../lib/http.js';
import { fetchTalentsoftJobs, readTalentsoftDetail } from './talentsoft.js';

/*
 * Réponses réelles de groupechantelle-recrute.talent-soft.com, corps archivés par la collecte du 29/09/2026 à 16:39
 * (lot 5d0224a1) : le flux RSS, les trois pages du listing (29 offres), et l'accueil du portail servi à la place de la
 * fiche 2450 ; la fiche 2513 elle-même vient de la collecte du 28/09 (lot c8f9a02a) et sert de fiche lue.
 * Ce jour-là, 13 des 29 fiches ont rendu l'accueil ; 6 d'entre elles n'avaient pas de description dans le RSS, et la
 * validation a refusé la source (CONTENT_MISSING=6, tolérance 2).
 */
const fixture = (name: string) => gunzipSync(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))).toString('utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const rss = fixture('talentsoft-chantelle-rss-20260929.xml.gz');
const pages = [1, 2, 3].map(page => fixture(`talentsoft-chantelle-liste-p${page}-20260929.html.gz`));
const home = fixture('talentsoft-chantelle-accueil-20260929.html.gz');
const offer = fixture('talentsoft-chantelle-2513-20260928.html.gz');
/** La configuration du registre, telle quelle ; seul le délai de relecture est raccourci pour le test. */
const config = { origin: 'https://groupechantelle-recrute.talent-soft.com', employerFromDetail: true, detailRetryDelayMs: 0,
  nativeEmployerRules: [{ id: 'chantelle-native-group', when: [{ path: 'talentsoftDetail.entityDescription', startsWith: 'Nous sommes le Groupe Chantelle' }],
    employer: { name: 'Groupe Chantelle', role: 'GROUP' } }] };
/** Les fiches qui ont rendu l'accueil le 29/09, et parmi elles les 6 sans description RSS. */
const HOME_0929 = ['2559', '2566', '2570', '2569', '2568', '2563', '2501', '2450', '2513', '2556', '2553', '2528', '2521'];
const WITHOUT_RSS_DESCRIPTION = ['2450', '2513', '2521', '2528', '2553', '2556'];
const idOf = (url: string) => /_(\d+)\.aspx$/.exec(url)?.[1];

/** Sert le flux et le listing réels ; chaque fiche répond, lecture après lecture, ce que `reads(id)` prévoit. */
function serve(reads: (id: string) => Array<'accueil' | 'fiche' | '403'>) {
  const calls = new Map<string, number>();
  vi.mocked(fetchText).mockImplementation(async (url: string) => {
    if (url.includes('/handlers/offerRss.ashx')) return rss;
    const listing = /liste-toutes-offres\.aspx\?page=(\d+)/.exec(url);
    if (listing) return pages[Number(listing[1]) - 1] ?? pages[0];
    const id = idOf(url)!;
    const n = calls.get(id) ?? 0; calls.set(id, n + 1);
    const plan = reads(id);
    const answer = plan[Math.min(n, plan.length - 1)];
    if (answer === '403') throw new Error(`HTTP 403 ${url}`);
    return answer === 'accueil' ? home : offer;
  });
  return calls;
}
const withoutDescription = (jobs: Array<{ externalId: string; description?: string }>) =>
  jobs.filter(job => !job.description?.trim()).map(job => job.externalId).sort();
beforeEach(() => vi.resetAllMocks());

describe('Talentsoft : une fiche redirigée vers l\'accueil est relue une fois, plus tard (Groupe Chantelle, 29/09/2026)', () => {
  it('prémisse : réponses archivées ; l\'accueil ne porte aucun contenu d\'offre ; le rejeu du 29/09 rend les 6 offres sans description', async () => {
    expect(sha256(rss)).toBe('b135ec1bb3a613bfc769eb0bfb3252b4f9ef3b3329bb361cba5277c5696590d5');
    expect(pages.map(sha256)).toEqual(['657d84b748cfffa9374992c7a21f31ab24616b96caf063c70d7f96c30de55401',
      'dc4994be6c714a31138489eecc3851842d41cfb1904e955074dd797d9a6a1f8c', 'afe8c374def74f6874c515321bb9f24876c2dbe48dd1d1d52579a582190bd211']);
    expect(sha256(home)).toBe('c8f539bf567b59a019310626901d5b46701e0d4e8100c128a5c0ee6f94a838d0');
    expect(sha256(offer)).toBe('e5081388c9bf045f7a947b80e0d5fc69857840a0e3527455feb79dc5adb4d10c');
    expect(readTalentsoftDetail(home, 'x')).toMatchObject({ description: '', entityDescription: undefined });
    expect(readTalentsoftDetail(offer, 'x').description.length).toBeGreaterThan(200);
    // Le 29/09 si l'accueil persiste : 13 accueils, relus une fois sous la borne Talentsoft, toujours l'accueil — les 6
    // offres sans description de RSS restent sans description, comme en production ce jour-là.
    const calls = serve(id => HOME_0929.includes(id) ? ['accueil'] : ['fiche']);
    const r = await fetchTalentsoftJobs(config);
    expect(r.jobs).toHaveLength(29);
    expect(withoutDescription(r.jobs)).toEqual(WITHOUT_RSS_DESCRIPTION);
    expect(HOME_0929.every(id => calls.get(id) === 2)).toBe(true);
  });

  it('cinq accueils, relus plus tard : chaque offre retrouve sa fiche, et la fiche retenue est celle relue', async () => {
    const redirected = WITHOUT_RSS_DESCRIPTION.slice(0, 5);
    const calls = serve(id => redirected.includes(id) ? ['accueil', 'fiche'] : ['fiche']);
    const r = await fetchTalentsoftJobs(config);
    expect(withoutDescription(r.jobs)).toEqual([]);
    for (const id of redirected) {
      expect(calls.get(id)).toBe(2);
      const job = r.jobs.find(j => j.externalId === id)!;
      expect((job.raw as { talentsoftDetail: { htmlSha256: string } }).talentsoftDetail.htmlSha256).toBe(sha256(offer));
    }
    expect([...calls].filter(([id]) => !redirected.includes(id)).every(([, n]) => n === 1)).toBe(true);
  });

  it('une fiche en échec (403) est relue de la même façon', async () => {
    const calls = serve(id => id === '2450' ? ['403', 'fiche'] : ['fiche']);
    const r = await fetchTalentsoftJobs(config);
    expect(calls.get('2450')).toBe(2);
    expect(withoutDescription(r.jobs)).toEqual([]);
  });

  it('si la relecture rend encore l\'accueil, la fiche s\'applique comme avant : l\'offre reste sans description', async () => {
    const calls = serve(id => id === '2450' ? ['accueil'] : ['fiche']);
    const r = await fetchTalentsoftJobs(config);
    expect(calls.get('2450')).toBe(2);
    expect(withoutDescription(r.jobs)).toEqual(['2450']);
    const job = r.jobs.find(j => j.externalId === '2450')!;
    expect((job.raw as { talentsoftDetail: { htmlSha256: string } }).talentsoftDetail.htmlSha256).toBe(sha256(home));
  });

  it('la rafale du 29/09 (13 sur 29 vers l\'accueil) est relue, sous la borne Talentsoft (moins de la moitié)', async () => {
    const calls = serve(id => HOME_0929.includes(id) ? ['accueil', 'fiche'] : ['fiche']);
    const r = await fetchTalentsoftJobs(config);
    // Prémisse : treize fiches servies une première fois comme l'accueil, au-delà de la borne des listes génériques (5).
    expect(HOME_0929).toHaveLength(13);
    expect(HOME_0929.every(id => calls.get(id) === 2)).toBe(true);
    expect(withoutDescription(r.jobs)).toEqual([]);
  });

  it('la moitié ou plus des fiches vers l\'accueil, ou toutes : panne du portail, aucune relecture', async () => {
    const half = (id: string) => Number(id) % 2 === 0;
    const ids = [...new Set([...HOME_0929])];
    for (const plan of [(id: string) => (half(id) || ids.includes(id)) ? ['accueil', 'fiche'] : ['fiche'], () => ['accueil', 'fiche']] as const) {
      vi.resetAllMocks();
      const calls = serve(plan as (id: string) => Array<'accueil' | 'fiche'>);
      await fetchTalentsoftJobs(config);
      expect(calls.size).toBe(29);
      expect([...calls.values()].every(n => n === 1)).toBe(true);
    }
  });
});

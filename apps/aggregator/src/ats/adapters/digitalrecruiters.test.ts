import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchDigitalRecruitersJobs, normalizeAnnouncement } from './digitalrecruiters.js';

/**
 * Modèle natif mesuré sur careers.lacoste.com (2026-09-09) : l'API liste des
 * DIFFUSIONS (`count` = 460, `id` = `<job_ad_id>-<diffusion>`), 453 annonces
 * distinctes. Une annonce diffusée pour « Japan », « Tokyo » et « Shinjuku
 * City » est UNE offre : identité = job_ad_id, toutes les diffusions dans le
 * RAW, la localisation la plus précise affichée, deux compteurs séparés dans
 * la preuve d'énumération.
 */
const item = (jobAd: string, diff: string, location: string, specific = true) => ({
  id: `${jobAd}-${diff}`, job_ad_id: Number(jobAd), title: `Sales Associate ${jobAd}`, contract: 'CDI', location,
  url: specific ? `${jobAd}/${diff}-sales-associate-${location.toLowerCase()}` : `${jobAd}--sales-associate-${location.toLowerCase()}`,
});
const page = (count: number, items: unknown[]) => ({ count, items, filters: {}, viewport: {} });

beforeEach(() => vi.resetAllMocks());

describe('DigitalRecruiters — annonces et diffusions', () => {
  it('regroupe les diffusions d’une annonce en une offre, garde toutes les localisations et compte séparément', async () => {
    const rows = [item('3827169', '62445899', 'Japan', false), item('3827169', '100956485', 'Tokyo'), item('3827169', '100956487', 'Shinjuku City'), item('2935039', '1', 'Paris')];
    vi.mocked(fetchJson).mockResolvedValueOnce(page(4, rows));
    const r = await fetchDigitalRecruitersJobs({ domainName: 'careers.example.com', locale: 'fr_FR', withDescriptions: false });
    expect(r.jobs).toHaveLength(2);
    const japan = r.jobs.find((j) => j.externalId === '3827169')!;
    expect(japan.location).toBe('Tokyo');                                   // première diffusion localisée, pas le niveau pays
    expect(japan.url).toBe('https://careers.example.com/fr/annonce/3827169/100956485-sales-associate-tokyo');
    expect((japan.raw as any).locations).toEqual(['Japan', 'Tokyo', 'Shinjuku City']);
    expect((japan.raw as any).diffusions).toHaveLength(3);
    expect(r.declaredTotal).toBe(4);
    expect(r.complete).toBe(true);
    expect(r.enumeration?.scopes).toEqual([
      { scope: 'diffusions', declaredTotal: 4, uniqueIds: 4, pages: 1, complete: true },
      { scope: 'announcements', declaredTotal: 2, uniqueIds: 2, pages: 1, complete: true },
    ]);
    expect(r.enumeration?.pageEvidence?.[0].componentCounters).toEqual(['diffusions=4', 'announcements=2']);
  });

  it('pagine jusqu’au compteur éditeur et prouve l’énumération sur plusieurs pages', async () => {
    const first = Array.from({ length: 100 }, (_, i) => item(String(1000 + i), '1', 'Paris'));
    const second = Array.from({ length: 60 }, (_, i) => item(String(2000 + i), '1', 'Lyon'));
    vi.mocked(fetchJson).mockResolvedValueOnce(page(160, first)).mockResolvedValueOnce(page(160, second));
    const r = await fetchDigitalRecruitersJobs({ domainName: 'careers.example.com', locale: 'fr_FR', withDescriptions: false });
    expect(r.jobs).toHaveLength(160); expect(r.complete).toBe(true); expect(r.enumeration?.pages).toBe(2); expect(r.enumeration?.termination).toBe('SHORT_PAGE');
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('n’annonce jamais une énumération complète quand le compteur change ou qu’une page se répète', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => item(String(i), '1', 'Paris'));
    vi.mocked(fetchJson).mockResolvedValueOnce(page(250, rows)).mockResolvedValueOnce(page(251, rows));
    const r = await fetchDigitalRecruitersJobs({ domainName: 'careers.example.com', locale: 'fr_FR', withDescriptions: false });
    expect(r.complete).toBe(false); expect(r.enumeration?.termination).toBe('REPEATED_PAGE');
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'REPEATED_DIFFUSION_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN']));
  });

  it('retombe sur en_US quand fr_FR est vide, et conserve les lignes invalides sans les compter', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page(0, [])).mockResolvedValueOnce(page(2, [item('1', '1', 'New York'), { id: '9-9', location: 'Nowhere' }]));
    const r = await fetchDigitalRecruitersJobs({ domainName: 'careers.example.com', withDescriptions: false });
    expect(r.jobs).toHaveLength(1); expect(r.rejectedRows).toHaveLength(1); expect(r.complete).toBe(false);
    expect(vi.mocked(fetchJson).mock.calls[1][0]).toContain('locale=en_US');
  });

  it('normalizeAnnouncement garde la diffusion générique quand aucune n’est localisée', () => {
    const j = normalizeAnnouncement([item('5', '62445899', 'Japan', false)], 'careers.example.com', 'fr_FR')!;
    expect(j.location).toBe('Japan'); expect(j.externalId).toBe('5'); expect((j.raw as any).locations).toEqual(['Japan']);
  });
});

/**
 * LA PREUVE CANONIQUE — le défaut mesuré le 2026-09-12 sur `american-vintage-dr`.
 *
 * La preuve n'archivait que les DIFFUSIONS (`4594925-72559621`) là où la base stocke les ANNONCES
 * (`4459569`) : recouvrement NUL, et 37 offres vivantes déclarées absentes au refresh. Les deux unités sont
 * légitimes — c'est de ne pas archiver la seconde qui était le défaut.
 */
describe('DigitalRecruiters — identifiants canoniques dans la preuve', () => {
  it('archive les ANNONCES à côté des diffusions, et elles correspondent aux externalId écrits', async () => {
    const rows = [item('3827169', '62445899', 'Japan', false), item('3827169', '100956485', 'Tokyo'), item('2935039', '1', 'Paris')];
    vi.mocked(fetchJson).mockResolvedValueOnce(page(3, rows));
    const r = await fetchDigitalRecruitersJobs({ domainName: 'careers.x.com' });

    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    const written = r.jobs.map((j) => j.externalId);
    expect([...new Set(canonical)].sort()).toEqual(['2935039', '3827169']);
    expect(written.sort()).toEqual(['2935039', '3827169']);
    // Les diffusions restent archivées : l'unité que le publieur pagine n'est pas perdue.
    expect(r.enumeration!.pageEvidence![0]!.ids).toHaveLength(3);
    expect(written.every((id) => canonical.includes(id))).toBe(true);
  });

  /**
   * UNE LIGNE VUE PUIS REJETÉE reste dans la preuve, avec son identifiant : sinon l'offre correspondante,
   * si elle existe en base, paraîtrait absente. Le rejet est une DISPOSITION nommée, pas un trou.
   */
  it('une annonce sans titre est observée ET rejetée avec son identifiant canonique', async () => {
    const sansTitre = { id: '999-1', job_ad_id: 999, location: 'Paris', url: '999/1-x' };
    vi.mocked(fetchJson).mockResolvedValueOnce(page(2, [item('2935039', '1', 'Paris'), sansTitre]));
    const r = await fetchDigitalRecruitersJobs({ domainName: 'careers.x.com' });

    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect(canonical).toContain('999');                       // observée : elle a bien été vue
    expect(r.jobs.map((j) => j.externalId)).not.toContain('999'); // mais pas publiée
    const rejected = r.rejectedRows!.find((x) => (x as { canonicalId?: string }).canonicalId === '999');
    expect(rejected?.reason).toBe('MISSING_TITLE_OR_ID');     // avec son motif exact
    // Et le contrat ne voit donc AUCUN identifiant observé sans disposition.
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
  });
});

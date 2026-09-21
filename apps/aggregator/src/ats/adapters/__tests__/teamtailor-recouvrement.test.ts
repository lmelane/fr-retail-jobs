import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchTeamtailorJobs } from '../teamtailor.js';

/**
 * LE RECOUVREMENT DE PAGINATION TEAMTAILOR — un doublon IDENTIQUE n'est pas une contradiction.
 *
 * ── CE QUE LA MESURE A ÉTABLI ──────────────────────────────────────────────────────────────────
 *
 * `galeries-lafayette`, 2026-09-21 : deux pages (100 + 59 items), `next_url` s'arrête
 * normalement, AUCUNE boucle de pagination. Sur 157 identifiants, **2** apparaissent deux fois —
 * et leurs charges utiles sont **strictement identiques**. C'est le recouvrement classique d'un
 * flux qui bouge entre deux requêtes, pas une énumération contradictoire.
 *
 * Le garde refusait alors la collecte entière : 157 offres perdues pour 2 doublons inoffensifs.
 *
 * ── CE QUI RESTE REFUSÉ, ET POURQUOI ───────────────────────────────────────────────────────────
 *
 * La preuve d'énumération sert à prouver une ABSENCE : « cette offre n'est plus publiée ». Elle
 * exige donc que chaque page nomme exactement ce qu'elle a vu. Deux versions DIFFÉRENTES d'un
 * même identifiant cassent cette garantie — on ne sait plus laquelle fait foi — et restent
 * refusées. Seule l'identité stricte des charges utiles autorise à ignorer la répétition.
 */
const reponses = (pages: unknown[]) => {
  let i = 0;
  return vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(pages[i++]) } as unknown as Response));
};

const item = (id: string, titre = 'Conseiller de vente') => ({
  id, title: titre, url: `https://demo.teamtailor.com/jobs/${id}`,
  date_published: '2026-09-01T00:00:00Z', content_text: 'x'.repeat(250),
});

const page = (items: unknown[], suivante: string | null) => ({
  version: 'https://jsonfeed.org/version/1.1',
  feed_url: 'https://demo.teamtailor.com/jobs.json',
  items, next_url: suivante,
});

afterEach(() => vi.unstubAllGlobals());

describe('recouvrement de pagination Teamtailor', () => {
  it('accepte un identifiant répété à charge utile IDENTIQUE', async () => {
    /*
     * LE CAS MESURÉ. `a` est servi sur les deux pages, à l'identique — exactement ce que
     * galeries-lafayette produit sur 2 de ses 157 offres.
     */
    const commun = item('a');
    vi.stubGlobal('fetch', reponses([
      page([commun, item('b')], 'https://demo.teamtailor.com/jobs.json?page=2'),
      page([commun, item('c')], null),
    ]));

    const res = await fetchTeamtailorJobs({ origin: 'https://demo.teamtailor.com', withDescriptions: false });

    // L'offre répétée n'est comptée qu'UNE fois : le catalogue ne doit pas la dédoubler.
    expect(res.jobs.map((j) => j.externalId).sort()).toEqual(['a', 'b', 'c']);
    expect(res.complete).toBe(true);
  });

  it('REFUSE toujours deux versions DIFFÉRENTES du même identifiant', async () => {
    /*
     * Ici la preuve d'énumération est réellement compromise : deux titres pour un identifiant,
     * on ne sait plus lequel fait foi. Le refus protège l'attestation d'absence.
     */
    vi.stubGlobal('fetch', reponses([
      page([item('a', 'Conseiller de vente'), item('b')], 'https://demo.teamtailor.com/jobs.json?page=2'),
      page([item('a', 'Responsable boutique'), item('c')], null),
    ]));

    await expect(fetchTeamtailorJobs({ origin: 'https://demo.teamtailor.com', withDescriptions: false }))
      .rejects.toThrow(/duplicate item across pages/);
  });

  it('REFUSE toujours une boucle de pagination', async () => {
    // Une page qui se redonne elle-même n'est pas un recouvrement : c'est un cycle.
    vi.stubGlobal('fetch', reponses([
      page([item('a')], 'https://demo.teamtailor.com/jobs.json?per_page=100'),
    ]));

    await expect(fetchTeamtailorJobs({ origin: 'https://demo.teamtailor.com', withDescriptions: false }))
      .rejects.toThrow(/pagination cycle/);
  });
});

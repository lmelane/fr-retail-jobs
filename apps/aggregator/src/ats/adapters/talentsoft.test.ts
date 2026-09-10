import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { talentsoftItemToJob, listingCards } from './talentsoft.js';
import { cleanPlace } from '../../lib/normalize.js';

/**
 * Parsing the TalentSoft RSS <item> shape, verified live against Longchamp's
 * feed on 2026-09-02: the offer id is in the link's `idOffre`, the categories
 * are contract-then-city, and the description is HTML.
 */
describe('talentsoftItemToJob', () => {
  const item = {
    link: 'https://longchamp-career.talent-soft.com/Pages/Offre/detailoffre.aspx?idOffre=2825&idOrigine=502&LCID=1036',
    category: ['CDI', 'Nice'],
    title: '2026-2825 - Conseiller de Vente - Galeries Lafayette Nice Massena H/F',
    description: '<b>Contrat : </b>CDI<br />Rejoindre la Maison Longchamp…',
    pubDate: 'Mon, 25 Aug 2026 09:00:00 GMT',
  };

  it('extracts the numeric offer id from idOffre', () => {
    expect(talentsoftItemToJob(item)?.externalId).toBe('2825');
  });

  it('reads the contract from the first category and the city from the rest', () => {
    const job = talentsoftItemToJob(item);
    expect(job?.contract).toBe('CDI');
    expect(job?.location).toBe('Nice');
  });

  it('strips HTML from the description', () => {
    const job = talentsoftItemToJob(item);
    expect(job?.description).toContain('Contrat : CDI');
    expect(job?.description).not.toContain('<b>');
  });

  /**
   * Real Lagardère raw, read in production on 2026-09-10: the FIRST category is the job family, not the contract.
   * Taking categories by position pushed the contract into the location — 102 postings across five talentsoft
   * sources stored "Stage, Malakoff" / "CDI, Nice", and two cities canonicalised to "Cdi" and "Apprentissage".
   */
  it('reads the contract wherever it sits, never as part of the location (Lagardère: family first)', () => {
    const job = talentsoftItemToJob({
      link: 'https://www.lagardere.com/nous-rejoindre/postuler/offre-2026-10345-502',
      category: ['Commerce / Vente / Relations Clients', 'Stage', 'Malakoff'],
      title: '2026-10345 - Stage - Assistant.e Commercial.e et Administratif.ve H/F',
      pubDate: 'Mon, 07 Sep 2026 22:07:21 Z',
    });
    expect(job?.contract).toBe('Stage');
    expect(job?.location).toBe('Malakoff');
    expect(job?.location).not.toMatch(/stage/i);
  });

  it('keeps the German tenant location clean (Lagardère DE)', () => {
    const job = talentsoftItemToJob({
      link: 'https://www.lagardere.com/nous-rejoindre/postuler/offre-2026-11002-502',
      category: ['Commerce / Vente / Relations Clients', 'CDI', 'Frankfurt am Main'],
      title: '2026-11002 - Verkäufer (m/w/d)',
      pubDate: 'Tue, 08 Sep 2026 09:00:00 Z',
    });
    expect(job?.contract).toBe('CDI');
    expect(job?.location).toBe('Frankfurt am Main');
  });

  it('still reads the Longchamp shape, where the contract does come first', () => {
    const job = talentsoftItemToJob({ ...item, category: ['CDI', 'Nice'] });
    expect(job?.contract).toBe('CDI');
    expect(job?.location).toBe('Nice');
  });

  it('a city is not mistaken for a contract because of its letters', () => {
    const job = talentsoftItemToJob({ ...item, category: ['CDI', 'Stagira'] });
    expect(job?.contract).toBe('CDI');
    expect(job?.location).toBe('Stagira');
  });

  /**
   * The three shapes met in production, exercised through the ADAPTER and then through the production
   * normalisation (`cleanPlace`) — the path an ingest actually takes. Testing the repair script proved nothing
   * about this path: `cleanPlace` only tidies whitespace and rejects markup, so anything the adapter lets
   * through is stored verbatim. If the adapter emits "Stage" as a place, the database keeps "Stage".
   */
  it('never lets a contract word reach the stored place, on the three real shapes', () => {
    const shapes = [
      { name: 'job family first (Lagardère)', category: ['Commerce / Vente / Relations Clients', 'Stage', 'Malakoff'], place: 'Malakoff', contract: 'Stage' },
      { name: 'family without a slash (Printemps)', category: ['Marketing', 'Stage', 'Paris'], place: 'Paris', contract: 'Stage' },
      { name: 'family without a slash (retail)', category: ['Management de boutiques', 'CDI', 'Nice'], place: 'Nice', contract: 'CDI' },
      { name: 'contract only, no place at all', category: ['Marketing', 'Stage'], place: undefined, contract: 'Stage' },
    ];
    for (const s of shapes) {
      const job = talentsoftItemToJob({ ...item, category: s.category });
      expect(job?.contract, s.name).toBe(s.contract);
      // What the pipeline would store, through the real normaliser.
      const storedLocation = cleanPlace(job?.location);
      const storedCity = cleanPlace(job?.city);
      for (const stored of [storedLocation, storedCity]) {
        if (stored !== undefined) expect(stored, `${s.name}: stored place must not be a contract`).not.toMatch(/^(cdi|cdd|stage|alternance|apprentissage|int[ée]rim)\b/i);
      }
      if (s.place) expect(storedLocation, s.name).toBe(s.place);
      else expect(storedLocation, `${s.name}: no place available means no place stored`).toBeUndefined();
    }
  });

  it('handles a single category (contract only, no city)', () => {
    const job = talentsoftItemToJob({ ...item, category: 'Stage' });
    expect(job?.contract).toBe('Stage');
    expect(job?.location).toBeUndefined();
  });

  it('returns null for an item with no link or no title', () => {
    expect(talentsoftItemToJob({ title: 'x' })).toBeNull();
    expect(talentsoftItemToJob({ link: 'https://x/detailoffre.aspx?idOffre=1' })).toBeNull();
  });
});

// ——— F-04 : lecture complète du listing HTML (le RSS est plafonné à 20) ———
import { talentsoftDetailDescription } from './talentsoft.js';

const LISTING_FIXTURE = `
<title>PRINTEMPS - Résultat de votre recherche (2 offres, page 1) / Tout afficher</title>
<div class="ts-offer-card Layer">
  <h3 class="ts-offer-card__title">
    <a class="ts-offer-card__title-link  " href="/offre-de-emploi/emploi-vendeur-h-f_6125.aspx" title="Vendeur H/F">
      Vendeur H/F
    </a>
  </h3>
  <div class="ts-offer-card-content offerContent">
    <ul class="ts-offer-card-content__list "><li>Réf. : 2026-6125</li><li>01/09/2026</li><li class="noBorder">Paris (75)</li></ul>
  </div>
</div>
<div class="ts-offer-card Layer">
  <h3><a class="ts-offer-card__title-link" href="/offre-de-emploi/emploi-comptable_5900.aspx" title="Comptable">Comptable</a></h3>
  <div><ul><li>Réf. : 2026-5900</li><li>15/08/2026</li><li>Lille (59)</li></ul></div>
</div>`;

describe('listingCards (F-04 — lecture complète)', () => {
  it('extrait id, titre, lieu et date de chaque carte, sans déborder sur la suivante', () => {
    const jobs = listingCards(LISTING_FIXTURE, 'https://x.talent-soft.com');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '6125',
      title: 'Vendeur H/F',
      location: 'Paris (75)',
      url: 'https://x.talent-soft.com/offre-de-emploi/emploi-vendeur-h-f_6125.aspx',
    });
    expect(jobs[0].postedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    // La 2e carte garde SON lieu — la fenêtre de la 1re ne l'a pas avalé.
    expect(jobs[1].location).toBe('Lille (59)');
  });
});

describe('talentsoftDetailDescription', () => {
  it('extrait la section « Description du poste » en texte', () => {
    const html = '<h2>Description du poste</h2><p>Vos <b>missions</b> : vendre.</p><h2>Critères candidat</h2>';
    expect(talentsoftDetailDescription(html)).toContain('missions : vendre');
  });
  it('rend vide quand la section est absente, jamais un texte inventé', () => {
    expect(talentsoftDetailDescription('<h2>Autre</h2>x<h2>Fin</h2>')).toBe('');
  });
});

/**
 * LE CAS LAGARDÈRE (2026-09-08, D51/P1) — la troncature 20/109.
 *
 * Le site a changé de gabarit : ses cartes portent `ts-offer-list-item__title-link`
 * (70 occurrences dans la page servie) là où le motif cherchait
 * `ts-offer-card__title-link` — **0 occurrence**. Le listing entier devenait
 * invisible, et les 20 offres restantes venaient du seul flux RSS (qui ne sert
 * que les 20 plus récentes). Le fetch, lui, réussissait : 96 Ko, HTTP 200,
 * 12 cartes par page, pages 2 et 3 accessibles — donc ni pagination bloquée,
 * ni anti-bot, ni limite serveur.
 *
 * La fixture est le HTML RÉELLEMENT SERVI, capturé ce jour-là.
 */
describe('listingCards — gabarits TalentSoft', () => {
  const fixture = readFileSync(
    new URL('./__fixtures__/talentsoft-lagardere-listing.html', import.meta.url),
    'utf8',
  );

  it('lit le gabarit ACTUEL du site (ts-offer-list-item)', () => {
    const jobs = listingCards(fixture, 'https://lagardere-recrute.talent-soft.com');
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    expect(jobs[0].externalId).toMatch(/^\d+$/);
    expect(jobs[0].title.length).toBeGreaterThan(3);
    expect(jobs[0].url).toContain('https://lagardere-recrute.talent-soft.com/offre-de-emploi/');
  });

  it("garde le gabarit HISTORIQUE (ts-offer-card) — d'autres tenants le servent encore", () => {
    const legacy =
      '<a class="ts-offer-card__title-link " href="/offre-de-emploi/emploi-vendeur-h-f_1234.aspx">Vendeur H/F</a>' +
      '<ul><li>Réf. 1234</li><li>01/09/2026</li><li>Paris</li></ul>';
    const jobs = listingCards(legacy, 'https://x.talent-soft.com');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].externalId).toBe('1234');
    expect(jobs[0].title).toBe('Vendeur H/F');
  });

  /**
   * Le gabarit actuel ne met PAS ses métadonnées dans des <li> : il écrit une
   * seule ligne « Réf. : 2026-10345 | 08/09/2026 | Malakoff ». Sans cette
   * lecture, 109 des 129 offres partaient sans lieu ni date — mesuré le
   * 2026-09-08 : 20 offres localisées sur 129, les 20 du seul flux RSS.
   */
  it('lit le lieu et la date de la ligne « Réf. | date | ville »', () => {
    const jobs = listingCards(fixture, 'https://lagardere-recrute.talent-soft.com');
    const located = jobs.filter((j) => j.location);
    expect(located.length).toBe(jobs.length);
    expect(jobs.filter((j) => j.postedAt).length).toBe(jobs.length);
    expect(jobs.some((j) => j.location === 'Malakoff')).toBe(true);
  });

  /**
   * Le HTML servi porte des entités (« A&#233;roport de Nice ») : un candidat
   * ne doit jamais lire « Aéroport » écrit en code source.
   */
  it('décode les entités HTML du titre', () => {
    const jobs = listingCards(fixture, 'https://lagardere-recrute.talent-soft.com');
    expect(jobs.some((j) => /&#\d+;|&amp;|&quot;/.test(j.title))).toBe(false);
  });

  it("n'invente aucune offre sur une page sans carte", () => {
    expect(listingCards('<html><body><p>Aucune offre</p></body></html>', 'https://x')).toEqual([]);
  });
});

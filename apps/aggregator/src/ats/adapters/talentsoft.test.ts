import { describe, expect, it } from 'vitest';
import { talentsoftItemToJob } from './talentsoft.js';

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
import { listingCards, talentsoftDetailDescription } from './talentsoft.js';

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

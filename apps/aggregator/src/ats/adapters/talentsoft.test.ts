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

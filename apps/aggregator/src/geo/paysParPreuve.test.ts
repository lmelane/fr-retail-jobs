import { describe, expect, it } from 'vitest';
import { decidePays, paysDuPointNatif, subdivisionDuLieu, type EntreesPreuve } from './paysParPreuve.js';
import { countryChainStatus, publicationCountry } from '../publication/content.js';
import type { CandidateJob } from '../dedup/match.js';

/**
 * D-520, offres sans pays (02/10/2026) — la décision, sur les cas mesurés en production (audits/2026-10-02/offres-sans-pays).
 * Chaque témoin affirme d'abord sa prémisse : la ville est ambiguë, ou le marché ne contient pas le pays proposé.
 */
const base: EntreesPreuve = { ville: null, subdivision: null, lieu: null, paysDuPoint: null,
  villeConnue: { pays: [], paysAvecSubdivision: [] }, subdivisionSeule: [], marche: [] };

describe('le pays sur preuve', () => {
  it('Boots : le point natif départage une ville connue dans six pays', () => {
    const e = { ...base, ville: 'Aberdeen', lieu: 'Aberdeen, Bon Accord Centre', paysDuPoint: 'GB',
      villeConnue: { pays: ['AU', 'CA', 'GB', 'HK', 'US', 'ZA'], paysAvecSubdivision: [], paysProches: ['GB'] }, marche: ['GG', 'IM', 'JE', 'NF'] };
    expect(e.villeConnue.pays.length).toBeGreaterThan(1); // prémisse : la ville seule ne prouve rien
    expect(e.marche).not.toContain('GB'); // prémisse : le marché observé de Boots ne contient pas GB
    expect(decidePays(e)).toEqual({ pays: 'GB', motif: 'COORDONNEES_ET_VILLE', marche: e.marche });
    expect(decidePays({ ...e, paysDuPoint: 'IE', ville: 'Dublin', villeConnue: { pays: ['IE', 'US'], paysAvecSubdivision: [], paysProches: ['IE'] } }))
      .toMatchObject({ pays: 'IE', motif: 'COORDONNEES_ET_VILLE' });
  });

  it('Intersport : un point dans un pays qui ne connaît pas la ville est une contradiction, jamais un pays', () => {
    const e = { ...base, ville: 'Morteau', paysDuPoint: 'US', villeConnue: { pays: ['FR'], paysAvecSubdivision: [] }, marche: ['FR'] };
    expect(decidePays(e)).toEqual({ pays: null, cause: 'COORDONNEES_DISCORDANTES' });
  });

  it('un point loin de toute ville du même nom dans son pays est une contradiction (« Paris » avec un point en Californie)', () => {
    const e = { ...base, ville: 'Paris', paysDuPoint: 'US', villeConnue: { pays: ['CA', 'FR', 'US'], paysAvecSubdivision: [], paysProches: [] }, marche: ['FR'] };
    expect(e.villeConnue.pays).toContain('US'); // prémisse : le pays du point connaît le nom
    expect(decidePays(e)).toEqual({ pays: null, cause: 'COORDONNEES_DISCORDANTES' });
  });

  it('un point dans un autre pays que celui que désignent la ville et l’État est une contradiction (« Boston, MA », point en France)', () => {
    const e = { ...base, ville: 'Boston', subdivision: 'MA', paysDuPoint: 'FR', villeConnue: { pays: ['GB', 'US'], paysAvecSubdivision: ['US'], paysProches: [] }, marche: ['FR', 'US'] };
    expect(decidePays({ ...e, paysDuPoint: null })).toMatchObject({ pays: 'US' }); // prémisse : sans point, la ville et l'État prouvent
    expect(decidePays(e)).toEqual({ pays: null, cause: 'COORDONNEES_DISCORDANTES' });
  });

  it('un point sans ville connue ne suffit pas', () => {
    expect(decidePays({ ...base, ville: 'Rushden Lakes', paysDuPoint: 'GB', marche: ['GB'] })).toEqual({ pays: null, cause: 'POINT_NON_CORROBORE' });
    expect(decidePays({ ...base, lieu: '-', paysDuPoint: 'GB', marche: ['GB'] })).toEqual({ pays: null, cause: 'POINT_NON_CORROBORE' });
  });

  it('R-125 §1 : une ville seule ne donne jamais de pays, même connue d’un seul pays et dans le marché de la source', () => {
    const e = { ...base, ville: 'Vanves', villeConnue: { pays: ['FR'], paysAvecSubdivision: [] }, marche: ['FR', 'MA'] };
    expect(e.villeConnue.pays).toEqual(['FR']); // prémisse : le référentiel ne connaît Vanves qu'en France
    expect(e.marche).toContain('FR'); // prémisse : la source publie en France
    expect(decidePays(e)).toEqual({ pays: null, cause: 'VILLE_SEULE_R125' });
    expect(decidePays({ ...e, ville: 'Mans', villeConnue: { pays: ['TR'], paysAvecSubdivision: [] } })).toEqual({ pays: null, cause: 'VILLE_SEULE_R125' });
  });

  it('le marché de la source ne fait que refuser une ville et son État : « Boston, MA » chez une source française', () => {
    const e = { ...base, ville: 'Boston', subdivision: 'MA', villeConnue: { pays: ['GB', 'US'], paysAvecSubdivision: ['US'] }, marche: ['FR'] };
    expect(decidePays(e)).toEqual({ pays: null, cause: 'HORS_MARCHE_DE_LA_SOURCE' });
    expect(decidePays({ ...e, marche: [] })).toEqual({ pays: null, cause: 'MARCHE_DE_LA_SOURCE_INCONNU' });
  });

  it('le marché ne choisit jamais entre deux pays : « Amsterdam » chez On reste ambiguë même si seuls les US sont au marché', () => {
    const e = { ...base, ville: 'Amsterdam', villeConnue: { pays: ['NL', 'US', 'ZA'], paysAvecSubdivision: [] }, marche: ['CH', 'GB', 'US'] };
    expect(e.marche.filter((p) => e.villeConnue.pays.includes(p))).toEqual(['US']); // prémisse : l'intersection désignerait les US
    expect(decidePays(e)).toEqual({ pays: null, cause: 'VILLE_AMBIGUE' });
  });

  it('la subdivision écrite après la ville départage (« Boston, MA »)', () => {
    const e = { ...base, ville: 'Boston', subdivision: 'MA', villeConnue: { pays: ['GB', 'IE', 'PH', 'US'], paysAvecSubdivision: ['US'] }, marche: ['US'] };
    expect(decidePays(e)).toEqual({ pays: 'US', motif: 'VILLE_ET_SUBDIVISION', marche: ['US'] });
    expect(decidePays({ ...e, villeConnue: { pays: e.villeConnue.pays, paysAvecSubdivision: [] } })).toEqual({ pays: null, cause: 'VILLE_AMBIGUE' });
  });

  it('R-125 §1 : un lieu qui n’est qu’une subdivision (« California ») ne donne jamais de pays', () => {
    expect(decidePays({ ...base, lieu: 'California', subdivisionSeule: ['US'], marche: ['FR', 'GE', 'US'] }))
      .toEqual({ pays: null, cause: 'VILLE_SEULE_R125' });
    expect(decidePays({ ...base, lieu: 'Nord', subdivisionSeule: ['BF', 'CM', 'HT'], marche: ['FR'] })).toEqual({ pays: null, cause: 'VILLE_AMBIGUE' });
    expect(decidePays({ ...base, lieu: 'Brown Thomas' })).toEqual({ pays: null, cause: 'LIEU_INCONNU' });
    expect(decidePays(base)).toEqual({ pays: null, cause: 'LIEU_ABSENT' });
  });

  it('lit la subdivision écrite à la suite de la ville, jamais un code postal ni la ville elle-même', () => {
    expect(subdivisionDuLieu('Atlanta, GA', 'Atlanta')).toBe('GA');
    expect(subdivisionDuLieu('AMILLY, 45200, Centre-Val de Loire', 'Amilly')).toBe('Centre-Val de Loire');
    expect(subdivisionDuLieu('Landquart, Grisons, 7302', 'Landquart')).toBe('Grisons');
    expect(subdivisionDuLieu('Taipei City, Taipei City', 'Taipei')).toBeNull();
    expect(subdivisionDuLieu('Vanves', 'Vanves')).toBeNull();
    // Une lettre seule n'est pas une subdivision (« M » est aussi la clé de la province irlandaise de Munster).
    expect(subdivisionDuLieu('Cork, M', 'Cork')).toBeNull();
  });

  it('lit le pays du point par le tracé des frontières, sans jamais le point (0, 0)', () => {
    expect(paysDuPointNatif(57.1497, -2.0943)).toBe('GB'); // Aberdeen
    expect(paysDuPointNatif(53.3498, -6.2603)).toBe('IE'); // Dublin
    expect(paysDuPointNatif(54.5973, -5.9301)).toBe('GB'); // Belfast
    expect(paysDuPointNatif(0, 0)).toBeNull();
    expect(paysDuPointNatif(null, null)).toBeNull();
  });
});

describe('la preuve ne s’applique qu’après la chaîne', () => {
  const offre = (over: Partial<CandidateJob>): CandidateJob => ({ company: 'X', sourceKey: 'x', sourceTier: 'EMPLOYER_DIRECT',
    externalId: '1', title: 'Advisor', url: 'https://example.com/1', ...over });

  it('ne remplace jamais un pays que la chaîne retient', () => {
    const c = offre({ location: 'Paris, France', paysParPreuve: { pays: 'US', motif: 'VILLE_ET_SUBDIVISION', marche: ['US'] } });
    expect(countryChainStatus(c)).toBe('DECIDED');
    expect(publicationCountry(c).countryCode).toBe('FR');
  });

  it('donne son pays à une offre que la chaîne laissait sans pays, et la subdivision sous ce pays (« Atlanta, GA »)', () => {
    const c = offre({ location: 'Atlanta, GA' });
    expect(countryChainStatus(c)).toBe('OPEN'); // prémisse : GA (Gabon) bloque la chaîne
    expect(publicationCountry(c).countryCode).toBeNull();
    expect(publicationCountry({ ...c, paysParPreuve: { pays: 'US', motif: 'VILLE_ET_SUBDIVISION', marche: ['US'] } }))
      .toEqual({ countryCode: 'US', countryIntegrity: null, adminArea1: 'Georgia' });
  });

  it('ne lève jamais une abstention sur contradiction (D-440), et une publication qui nomme un autre pays s’abstient', () => {
    const facts = (label: string) => ({ status: 'DECLARED', issues: [], evidence: [], value: [{ path: '/l', label, city: null, region: null,
      country: null, postalCode: null, latitude: null, longitude: null, coordinateStatus: 'NOT_OBSERVED', issues: [] }] }) as never;
    const contradite = offre({ country: 'DE', location: 'Lyon', sourceFacts: { locations: facts('Lyon, France') } as never });
    expect(countryChainStatus(contradite)).toBe('ABSTAINED');
    expect(publicationCountry({ ...contradite, paysParPreuve: { pays: 'FR', motif: 'VILLE_ET_SUBDIVISION', marche: ['FR'] } }).countryCode).toBeNull();
    const ailleurs = offre({ location: 'Aberdeen', sourceFacts: { locations: facts('Aberdeen, United States') } as never,
      paysParPreuve: { pays: 'GB', motif: 'COORDONNEES_ET_VILLE', marche: [] } });
    expect(publicationCountry(ailleurs).countryCode).toBeNull();
  });
});

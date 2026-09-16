import { describe, expect, it } from 'vitest';
import { resolveLieu } from '../lieu';
import { parseFilters } from '../jobs';

/**
 * F1 / D-418 §3, lot 6 — le champ « lieu » se résout côté moteur : ville,
 * subdivision, code postal ou télétravail ; un pays seulement s'il appartient
 * au périmètre, ce que le plan de recherche décide (`search-plan.test.ts`).
 * Ces témoins passent au rouge si un code inconnu devient un pays, si un nom
 * de pays retombe en ville, si le télétravail n'est plus reconnu, ou si un
 * code postal est lu comme une ville.
 */
describe('resolveLieu', () => {
  it('vide → null', () => {
    expect(resolveLieu('')).toBeNull();
    expect(resolveLieu('   ')).toBeNull();
    expect(resolveLieu(undefined)).toBeNull();
  });

  it('un code ISO-2 CONNU ou un alias est un pays, un digramme inconnu reste une ville', () => {
    expect(resolveLieu('fr')).toEqual({ type: 'pays', country: 'FR', libelle: 'France' });
    expect(resolveLieu('US')).toEqual({ type: 'pays', country: 'US', libelle: 'États-Unis' });
    expect(resolveLieu('uk')).toEqual({ type: 'pays', country: 'GB', libelle: 'Royaume-Uni' });
    // Prémisse : « xq » n'est pas un code attribué.
    expect(resolveLieu('xq')).toEqual({ type: 'ville', cityLoose: 'xq', libelle: 'Xq' });
  });

  it('un nom de pays, en français ou en anglais, est un pays avec son libellé français', () => {
    expect(resolveLieu('France')).toEqual({ type: 'pays', country: 'FR', libelle: 'France' });
    expect(resolveLieu('royaume-uni')).toEqual({ type: 'pays', country: 'GB', libelle: 'Royaume-Uni' });
    expect(resolveLieu('Germany')).toEqual({ type: 'pays', country: 'DE', libelle: 'Allemagne' });
    expect(resolveLieu('États-Unis')).toEqual({ type: 'pays', country: 'US', libelle: 'États-Unis' });
  });

  it('télétravail, remote, à distance → télétravail', () => {
    for (const v of ['télétravail', 'Teletravail', 'remote', 'à distance', 'home office']) {
      expect(resolveLieu(v)).toEqual({ type: 'teletravail', remote: true, libelle: 'Télétravail' });
    }
  });

  it('un code postal reste une chaîne, dans ses formes réelles ; « Paris 8 » reste une ville', () => {
    expect(resolveLieu('75008')).toEqual({ type: 'codePostal', postalCode: '75008', libelle: '75008' });
    expect(resolveLieu('10001')).toEqual({ type: 'codePostal', postalCode: '10001', libelle: '10001' });
    expect(resolveLieu('sw1a 1aa')).toEqual({ type: 'codePostal', postalCode: 'SW1A 1AA', libelle: 'SW1A 1AA' });
    expect(resolveLieu('H2Y 1C6')).toEqual({ type: 'codePostal', postalCode: 'H2Y 1C6', libelle: 'H2Y 1C6' });
    expect(resolveLieu('1012 AB')).toEqual({ type: 'codePostal', postalCode: '1012 AB', libelle: '1012 AB' });
    expect(resolveLieu('Paris 8')).toEqual({ type: 'ville', cityLoose: 'Paris 8', libelle: 'Paris 8' });
    // Un code postal ne perd jamais son zéro de tête : jamais un nombre.
    expect(resolveLieu('06000')).toEqual({ type: 'codePostal', postalCode: '06000', libelle: '06000' });
  });

  it('tout le reste est un lieu en correspondance large, espaces normalisés, libellé capitalisé', () => {
    expect(resolveLieu('Paris')).toEqual({ type: 'ville', cityLoose: 'Paris', libelle: 'Paris' });
    expect(resolveLieu('  pari ')).toEqual({ type: 'ville', cityLoose: 'pari', libelle: 'Pari' });
    expect(resolveLieu('aix  en   provence')).toEqual({ type: 'ville', cityLoose: 'aix en provence', libelle: 'Aix En Provence' });
    expect(resolveLieu('Texas')).toEqual({ type: 'ville', cityLoose: 'Texas', libelle: 'Texas' });
  });
});

describe('parseFilters : lieu, langue et pays prioritaire', () => {
  it('le lieu est transmis tel quel au plan, borné en longueur', () => {
    expect(parseFilters({ lieu: 'France' }).lieu).toBe('France');
    expect(parseFilters({ lieu: 'x'.repeat(500) }).lieu).toHaveLength(200);
    expect(parseFilters({ q: 'vendeuse' }).lieu).toBeUndefined();
  });
  it('langue : deux lettres en minuscules, sinon ignorée', () => {
    expect(parseFilters({ langue: 'FR' }).filtres.langue).toEqual(['fr']);
    expect(parseFilters({ langue: 'français' }).filtres.langue).toBeUndefined();
  });
  it('prioritePays : deux lettres en majuscules, jamais un filtre', () => {
    const f = parseFilters({ prioritePays: 'fr' });
    expect(f.prioritePays).toBe('FR');
    expect(f.filtres.pays).toBeUndefined();
    expect(parseFilters({ prioritePays: "'; drop" }).prioritePays).toBeUndefined();
  });
});

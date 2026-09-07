import { describe, expect, it } from 'vitest';
import { parentFromNote, parseDomainSheet } from './applyDomainSheet.js';

/** Les notes viennent telles quelles du fichier de Loïc (2026-09-07). */
describe('parentFromNote', () => {
  it('lit la marque mère d’une entité pays', () => {
    expect(parentFromNote('Entité juridique / pays rattachée à Mango.')).toBe('Mango');
    expect(parentFromNote('Entité juridique / pays rattachée à Michael Kors.')).toBe('Michael Kors');
    expect(parentFromNote('Entité juridique / pays rattachée à New Balance.')).toBe('New Balance');
  });

  it('refuse un DOMAINE comme mère : « rattaché à lvmh.com » ne nomme pas une société', () => {
    expect(parentFromNote('LVMH Fashion Group — rattaché à lvmh.com.')).toBeNull();
  });

  it('lit une mère au masculin quand elle est bien nommée', () => {
    expect(parentFromNote('Entité rattaché à Condé Nast.')).toBe('Condé Nast');
  });

  it('ne nomme personne quand la note dit seulement « le groupe »', () => {
    expect(parentFromNote('Société du Swatch Group — rattachée au domaine du groupe.')).toBeNull();
  });

  it('rend null sur une note sans rattachement', () => {
    expect(parentFromNote('Domaine officiel de la marque / société.')).toBeNull();
    expect(parentFromNote('')).toBeNull();
  });
});

describe('parseDomainSheet', () => {
  const tsv = [
    'Maison\tOffres actives\tSecteur\tGroupe\tSite officiel\tURL source\tStatut\tNote',
    'Tapestry\t1620\tRETAIL\t\ttapestry.com\thttps://tapestry.com/\tIDENTIFIÉ\tDomaine officiel de la marque / société.',
    'Sandro\t541\tFASHION\tSMCP\tsandro-paris.com\thttps://sandro-paris.com/\tIDENTIFIÉ\tDomaine officiel de la marque / société.',
    'NIKE Korea\t21\tRETAIL\t\tnike.com\thttps://nike.com/\tRATTACHÉ\tEntité juridique / pays rattachée à Nike.',
    'B2\t67\tRETAIL\t\t\t\tÀ VÉRIFIER\tNom trop ambigu ou insuffisamment distinctif.',
  ].join('\n');

  it('lit les colonnes malgré une cellule Groupe vide', () => {
    const rows = parseDomainSheet(tsv);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ maison: 'Tapestry', domain: 'tapestry.com', status: 'IDENTIFIÉ', parent: null });
    expect(rows[1].domain).toBe('sandro-paris.com');
  });

  it('extrait la marque mère des seules lignes RATTACHÉ', () => {
    const rows = parseDomainSheet(tsv);
    expect(rows[2]).toMatchObject({ maison: 'NIKE Korea', status: 'RATTACHÉ', parent: 'Nike' });
    expect(rows[0].parent).toBeNull();
  });

  it('garde les lignes À VÉRIFIER sans domaine', () => {
    const rows = parseDomainSheet(tsv);
    expect(rows[3]).toMatchObject({ maison: 'B2', status: 'À VÉRIFIER', domain: '' });
  });
});

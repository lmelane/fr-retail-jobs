import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TAXONOMY } from '../normalize/taxonomy.js';
import { cleMaison, contexteDepuis, metierDepuisTaxonomie, rattacheurRegistre } from './contexte.js';

/**
 * D-444 — LE RATTACHEMENT D'UNE MAISON AU REGISTRE ET LE MÉTIER D'UN INTITULÉ, sans rien deviner : un nom qui désigne
 * deux sociétés, ou aucune, ne rattache rien ; un intitulé sans règle revue n'a pas de métier.
 */
describe('contexte de projection des offres directes (D-444)', () => {
  const societes = [
    { id: 'guerlain', name: 'Guerlain', mergedIntoId: null },
    { id: 'occitane', name: 'L’Occitane en Provence', mergedIntoId: null },
    { id: 'ancienne', name: 'Sézane Paris', mergedIntoId: 'sezane' },
    { id: 'sezane', name: 'Sézane', mergedIntoId: null },
    { id: 'homonyme-a', name: 'Maison Double', mergedIntoId: null },
    { id: 'homonyme-b', name: 'MAISON  DOUBLE', mergedIntoId: null },
    { id: 'boucle-a', name: 'Boucle', mergedIntoId: 'boucle-b' },
    { id: 'boucle-b', name: 'Boucle B', mergedIntoId: 'boucle-a' },
  ];
  const alias = [{ companyId: 'ancienne', displayName: 'Sezane Studio' }, { companyId: 'guerlain', displayName: 'Maison Guerlain' }];
  const rattacher = rattacheurRegistre(societes, alias);

  it('la clé ignore accents, casse, apostrophes typographiques et espaces répétés, rien d’autre', () => {
    expect(cleMaison('  L’Occitane   en PROVENCE ')).toBe(cleMaison("l'occitane en provence"));
    expect(cleMaison('Sézane')).toBe('sezane');
    expect(cleMaison('Oh My Cream!')).not.toBe(cleMaison('Oh My Cream'));
  });

  it('rattache par nom, par alias revu et par le nom d’une société fusionnée, toujours à la société canonique', () => {
    expect(rattacher('Guerlain')).toBe('guerlain');
    expect(rattacher("L'Occitane en Provence")).toBe('occitane');
    expect(rattacher('Maison Guerlain')).toBe('guerlain');
    // Le nom d'une société fusionnée, et l'alias posé sur elle, mènent à la société qui l'a absorbée.
    expect(rattacher('Sezane Paris')).toBe('sezane');
    expect(rattacher('Sézane Studio')).toBe('sezane');
  });

  it('ne rattache rien quand le nom est ambigu, inconnu, vide, ou pris dans une boucle de fusions', () => {
    expect(rattacher('Maison Double')).toBeNull();
    expect(rattacher('Maison Inconnue')).toBeNull();
    expect(rattacher('')).toBeNull();
    expect(rattacher(null)).toBeNull();
    expect(rattacher('Boucle')).toBeNull();
  });

  it('le métier : un code seulement quand une règle revue le désigne ; la version de la taxonomie est consignée', () => {
    const metier = metierDepuisTaxonomie(BOOTSTRAP_TAXONOMY);
    expect(metier('Conseiller de vente H/F')).toEqual({ occupationCode: 'sales-advisor', occupationReleaseId: BOOTSTRAP_TAXONOMY.manifest.id });
    // Une famille seule n'est pas un métier : l'intitulé reste sans code, jamais deviné.
    expect(metier('Animateur·rice des ventes')).toEqual({ occupationCode: null, occupationReleaseId: BOOTSTRAP_TAXONOMY.manifest.id });
  });
});

/**
 * D-471 — LE LIEN DU BACK-OFFICE PRIME SUR LE NOM. Il suit les fusions comme le nom ; un lien vers une société inconnue ne
 * rattache pas à sa place, le nom reprend la main et le lien est signalé.
 */
describe('lien explicite au registre (D-471, correspondance version 6)', () => {
  const societes = [
    { id: 'loewe', name: 'Loewe', mergedIntoId: null, domain: 'loewe.com' },
    { id: 'perfumesloewe', name: 'Perfumes Loewe', mergedIntoId: null, domain: ' loewe.com ' },
    { id: 'lancelancien', name: 'Lancel Paris', mergedIntoId: 'lancel', domain: 'lancel.fr' },
    { id: 'lancel', name: 'LANCEL', mergedIntoId: null, domain: 'lancel.com' },
    { id: 'frame', name: 'Frame', mergedIntoId: null, domain: null },
  ];

  it('le lien prime sur un nom qui rattacherait ailleurs, et suit les fusions', () => {
    const inconnus: string[] = [];
    const rattacher = rattacheurRegistre(societes, [], (id) => inconnus.push(id));
    // PRÉMISSE : sans lien, le nom rattache à une AUTRE société que celle du lien.
    expect(rattacher('Loewe')).toBe('loewe');
    expect(rattacher('Loewe', 'perfumesloewe')).toBe('perfumesloewe');
    expect(rattacher('Maison sans homonyme', 'lancelancien')).toBe('lancel');
    expect(inconnus).toEqual([]);
  });

  it('un lien inconnu ne rattache pas à sa place : le nom reprend la main, et le lien est signalé', () => {
    const inconnus: string[] = [];
    const rattacher = rattacheurRegistre(societes, [], (id) => inconnus.push(id));
    expect(rattacher('Loewe', 'societeabsente1')).toBe('loewe');
    expect(rattacher('Inconnue', 'societeabsente2')).toBeNull();
    expect(inconnus).toEqual(['societeabsente1', 'societeabsente2']);
  });

  it('le contexte sert le domaine de la société rattachée, et compte les liens inconnus', () => {
    const contexte = contexteDepuis(societes, [], BOOTSTRAP_TAXONOMY);
    expect(contexte.domaine('perfumesloewe')).toBe('loewe.com');
    expect(contexte.domaine('frame')).toBeNull();
    expect(contexte.domaine(null)).toBeNull();
    expect(contexte.domaine('absente')).toBeNull();
    contexte.rattacher('Loewe', 'societeabsente1');
    contexte.rattacher('Loewe', 'societeabsente1');
    expect(contexte.liensInconnus()).toEqual(['societeabsente1']);
  });
});

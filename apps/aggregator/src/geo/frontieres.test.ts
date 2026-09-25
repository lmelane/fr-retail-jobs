import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { chargerFrontieres, FRONTIERES_CONTENU_SHA256, lireFrontieres, paysDesCoordonnees } from './frontieres.js';

/**
 * D-444 — LE PAYS D'UNE OFFRE CATWALKS VIENT DE SES COORDONNÉES, PAR LE TRACÉ NATURAL EARTH AU 1:10 000 000 ; LE DOUTE
 * S'ABSTIENT (D-435). Les points Nice, Monaco, New York, Berlin, Londres, Saint-Tropez et Cannes sont ceux de la liste
 * publique de production lue le 25/09/2026.
 */
describe('le pays d’un point par le tracé des frontières (D-444)', () => {
  const pays = (lat: number | null, lon: number | null) => paysDesCoordonnees(lat, lon);

  it('le fichier versionné est exactement celui que la revue a épinglé', () => {
    const octets = readFileSync(fileURLToPath(new URL('../../data/reference/frontieres-ne10m.json.gz', import.meta.url)));
    expect(createHash('sha256').update(gunzipSync(octets)).digest('hex')).toBe(FRONTIERES_CONTENU_SHA256);
    const frontieres = chargerFrontieres();
    expect(frontieres.version).toBe('5.1.1');
    expect(frontieres.entites).toHaveLength(258);
  });

  it('les offres de la liste publique : Nice, Cannes, Saint-Tropez en France, Monaco à Monaco, New York, Berlin, Londres', () => {
    expect(pays(43.6963773, 7.2676739)).toMatchObject({ pays: 'FR' });
    expect(pays(43.5513854, 7.017333)).toMatchObject({ pays: 'FR' });
    expect(pays(43.2676808, 6.640710899999999)).toMatchObject({ pays: 'FR' });
    expect(pays(43.73841760000001, 7.424615799999999)).toMatchObject({ pays: 'MC' });
    expect(pays(40.7422083, -73.9869957)).toMatchObject({ pays: 'US' });
    expect(pays(52.5043937, 13.3353476)).toMatchObject({ pays: 'DE' });
    expect(pays(51.5116269, -0.147806)).toMatchObject({ pays: 'GB' });
  });

  it('un territoire qui a son marché (R-125 §4) est une entité du tracé : Hong Kong, Taïwan, Porto Rico', () => {
    expect(pays(22.3193, 114.1694)).toMatchObject({ pays: 'HK' });
    expect(pays(25.033, 121.5654)).toMatchObject({ pays: 'TW' });
    expect(pays(18.4655, -66.1057)).toMatchObject({ pays: 'PR' });
    // L'entité France porte ses départements d'outre-mer : Saint-Denis de La Réunion est en France.
    expect(pays(-20.8821, 55.4507)).toMatchObject({ pays: 'FR' });
  });

  it('un État enclavé est un trou de l’entité qui l’entoure : Maseru au Lesotho, le Vatican, Saint-Marin', () => {
    // PRÉMISSE : ces points sont DANS la boîte englobante de l'entité qui les entoure — seul le trou les en exclut.
    const englobante = (code: string) => chargerFrontieres().entites.find((e) => e.pays === code && e.nom !== 'Brazilian I.')!;
    const dansBoite = (code: string, lat: number, lon: number) => {
      const b = englobante(code).boite;
      return lon >= b.minX && lon <= b.maxX && lat >= b.minY && lat <= b.maxY;
    };
    expect(dansBoite('ZA', -29.3151, 27.4869)).toBe(true);
    expect(dansBoite('IT', 41.9029, 12.4534)).toBe(true);
    expect(pays(-29.3151, 27.4869)).toMatchObject({ pays: 'LS' });
    expect(pays(41.9029, 12.4534)).toMatchObject({ pays: 'VA' });
    expect(pays(43.9424, 12.4578)).toMatchObject({ pays: 'SM' });
  });

  it('le doute s’abstient : en mer, sans coordonnées, coordonnées invalides, territoire sans code', () => {
    // Au large de Nice, en Méditerranée ; le point (0, 0) aussi.
    expect(pays(43.6, 7.3)).toEqual({ pays: null, motif: 'HORS_TRACE' });
    expect(pays(0, 0)).toEqual({ pays: null, motif: 'HORS_TRACE' });
    expect(pays(null, 2.35)).toEqual({ pays: null, motif: 'COORDONNEES_ABSENTES' });
    expect(pays(48.85, null)).toEqual({ pays: null, motif: 'COORDONNEES_ABSENTES' });
    expect(pays(95, 2)).toEqual({ pays: null, motif: 'COORDONNEES_INVALIDES' });
    expect(pays(Number.NaN, 2)).toEqual({ pays: null, motif: 'COORDONNEES_INVALIDES' });
    expect(pays(48, 181)).toEqual({ pays: null, motif: 'COORDONNEES_INVALIDES' });
    // Nicosie-Nord, en Chypre du Nord : l'entité n'a pas de code pays (-99).
    expect(pays(35.2, 33.36)).toMatchObject({ pays: null, motif: 'TERRITOIRE_SANS_CODE', entites: ['N. Cyprus'] });
    // LIMITE DOCUMENTÉE : un point d'un front de mer gagné sur l'eau peut sortir du tracé au 1:10 000 000. Central, à
    // Hong Kong (bord du port), s'abstient ; Mong Kok, à 4 km, est classé HK.
    expect(pays(22.2819, 114.1588)).toEqual({ pays: null, motif: 'HORS_TRACE' });
  });

  it('deux entités de codes différents qui contiennent le même point : abstention, jamais la première trouvée', () => {
    const carre = (x: number, y: number, c: number) => [x, y, c, 0, 0, c, -c, 0, 0, -c];
    const contenu = Buffer.from(JSON.stringify({ format: 1, source: { version: 'témoin' }, champPays: 'ISO_A2_EH', quantification: 1_000_000,
      entites: [['AA', 'A', [carre(0, 0, 2_000_000)]], ['BB', 'B', [carre(1_000_000, 1_000_000, 2_000_000)]], ['CC', 'C', [carre(10_000_000, 10_000_000, 1_000_000)]]] }));
    const frontieres = lireFrontieres(gzipSync(contenu), createHash('sha256').update(contenu).digest('hex'));
    // PRÉMISSE : le point (1,5 ; 1,5) est dans A et dans B ; le point (10,5 ; 10,5) dans C seulement.
    expect(paysDesCoordonnees(1.5, 1.5, frontieres)).toEqual({ pays: null, motif: 'TRACE_AMBIGU', entites: ['A', 'B'] });
    expect(paysDesCoordonnees(10.5, 10.5, frontieres)).toEqual({ pays: 'CC', entite: 'C' });
    expect(paysDesCoordonnees(0.5, 0.5, frontieres)).toEqual({ pays: 'AA', entite: 'A' });
  });

  it('un tracé qui n’est pas celui de la revue n’est jamais utilisé', () => {
    const vrai = gunzipSync(readFileSync(fileURLToPath(new URL('../../data/reference/frontieres-ne10m.json.gz', import.meta.url))));
    const falsifie = Buffer.from(vrai.toString('utf8').replace('"FR"', '"MC"'));
    expect(() => lireFrontieres(gzipSync(falsifie))).toThrow(/non revu/);
  });
});

import { describe, expect, it } from 'vitest';
import { ContratInvalideError, lireEvenement, lireFlux, lireOffre } from './contrat.js';
import { evenementPublie, evenementRetire, offreBrute, page } from './fixture.js';

/**
 * LE LECTEUR DU CONTRAT NE FAIT CONFIANCE À RIEN (lot 6, D-423).
 *
 * Chaque témoin de refus nomme le chemin fautif : c'est ce que l'exploitant
 * lira sur le curseur quand le backend changera de forme sans prévenir.
 */
describe('lecture stricte du contrat catalogue v1', () => {
  it('lit une offre conforme et normalise son URL de candidature', () => {
    const offre = lireOffre(offreBrute({ candidature: { type: 'CATWALKS', url: 'https://catwalks.io/offres/vm' } }));
    expect(offre.id).toBe('cmoffre0001');
    expect(offre.lieu).toMatchObject({ pays: 'FR', ville: 'Paris', codePostal: '75008' });
    expect(offre.candidature).toEqual({ type: 'CATWALKS', url: 'https://catwalks.io/offres/vm' });
    expect(offre.salaire).toEqual({ min: 38000, max: 45000, devise: 'EUR', texte: '38–45 k€' });
  });

  it('refuse une version de contrat inconnue, sur l’offre comme sur le flux', () => {
    expect(() => lireOffre(offreBrute({ version: 2 }))).toThrow(ContratInvalideError);
    expect(() => lireOffre(offreBrute({ version: 2 }))).toThrow(/offre\.version/);
    expect(() => lireFlux({ version: 2, evenements: [], suivant: null })).toThrow(/flux\.version/);
  });

  it('lit les grands entiers en chaînes, exactement — jamais par un nombre', () => {
    // Au-delà de 2^53 un `number` arrondit ; au-delà de 19 chiffres un BIGINT PostgreSQL déborde — refusé avant la base.
    const e = lireEvenement(evenementPublie('9007199254740993', '9223372036854775807'));
    expect(e.seq).toBe(BigInt('9007199254740993'));
    expect(e.version).toBe(BigInt('9223372036854775807'));
    expect(() => lireEvenement({ ...evenementPublie(1, 1), seq: 1 })).toThrow(/evenement\.seq/);
    expect(() => lireEvenement({ ...evenementPublie(1, 1), version: '-1' })).toThrow(/evenement\.version/);
    expect(() => lireEvenement({ ...evenementPublie(1, 1), seq: '12345678901234567890' })).toThrow(/evenement\.seq/);
  });

  it('refuse ce qui n’est pas une offre Catwalks : autre action, URL non http(s), pays hors ISO-2', () => {
    expect(() => lireOffre(offreBrute({ candidature: { type: 'EXTERNE', url: 'https://x.example' } }))).toThrow(/candidature\.type/);
    expect(() => lireOffre(offreBrute({ candidature: { type: 'CATWALKS', url: 'javascript:alert(1)' } }))).toThrow(/candidature\.url/);
    expect(() => lireOffre(offreBrute({ candidature: { type: 'CATWALKS', url: 'pas une url' } }))).toThrow(/candidature\.url/);
    expect(() => lireOffre(offreBrute({ lieu: { ...(offreBrute().lieu as object), pays: 'France' } }))).toThrow(/lieu\.pays/);
    expect(() => lireOffre(offreBrute({ lieu: { ...(offreBrute().lieu as object), pays: 'fr' } }))).toThrow(/lieu\.pays/);
    expect(lireOffre(offreBrute({ lieu: { ...(offreBrute().lieu as object), pays: null } })).lieu.pays).toBeNull();
  });

  it('refuse un identifiant qui n’en est pas un et une date illisible', () => {
    expect(() => lireOffre(offreBrute({ id: '../x' }))).toThrow(/offre\.id/);
    expect(() => lireOffre(offreBrute({ publieeLe: 'hier' }))).toThrow(/publieeLe/);
    expect(() => lireOffre(offreBrute({ maison: { nom: 'X', slug: 'pas un slug !' } }))).toThrow(/maison\.slug/);
  });

  it('un événement RETIRE porte l’identifiant seul ; toute autre action est refusée', () => {
    expect(lireEvenement(evenementRetire(7, 3, 'cmoffre0001'))).toEqual({ seq: BigInt(7), version: BigInt(3), evenement: 'RETIRE', offreId: 'cmoffre0001' });
    expect(() => lireEvenement({ seq: '1', version: '1', evenement: 'SUPPRIME', offreId: 'x' })).toThrow(/evenement\.evenement/);
  });

  it('une page : séquences strictement croissantes, `suivant` égal à la dernière séquence servie', () => {
    const ok = lireFlux(page([evenementPublie(1, 1), evenementPublie(2, 1)]));
    expect(ok.evenements.map((e) => e.seq)).toEqual([BigInt(1), BigInt(2)]);
    expect(ok.suivant).toBe(BigInt(2));
    expect(lireFlux(page([])).suivant).toBeNull();
    expect(() => lireFlux(page([evenementPublie(2, 1), evenementPublie(2, 2)]))).toThrow(/evenements\[1\]\.seq/);
    expect(() => lireFlux(page([evenementPublie(3, 1), evenementPublie(2, 1)]))).toThrow(/séquence non croissante/);
    expect(() => lireFlux(page([evenementPublie(1, 1)], '5'))).toThrow(/flux\.suivant/);
  });

  it('nomme le chemin exact d’une divergence au fond d’une page', () => {
    const fautif = evenementPublie(2, 1, offreBrute({ lieu: { ...(offreBrute().lieu as object), pays: 'FRA' } }));
    expect(() => lireFlux(page([evenementPublie(1, 1), fautif]))).toThrow(/flux\.evenements\[1\]\.offre\.lieu\.pays/);
  });

  it('borne la page : plus de mille événements est un refus, pas une lecture', () => {
    const trop = Array.from({ length: 1_001 }, (_, i) => evenementRetire(i + 1, 1, 'x'));
    expect(() => lireFlux(page(trop))).toThrow(/flux\.evenements/);
  });
});

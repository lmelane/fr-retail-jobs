import { describe, expect, it } from 'vitest';
import { unqualifiedAllowanceFor, VALIDATION_UNQUALIFIED_ALLOWANCE } from './sourceCertification.js';

/**
 * LE SEUIL DE TOLÉRANCE (politique v2, décision du propriétaire du 19/09/2026).
 *
 * La v1 exigeait 100 % d'offres relisibles : UNE annonce sans description faisait échouer la
 * source entière, donc aucune de ses offres n'était publiée. Mesuré sur 10 sources : 5 004 offres
 * relisibles bloquées par 11 annonces.
 *
 * La formule est `max(floor, min(ratio × observées, count))`, et chacun des trois termes répond à
 * un contournement précis. Les témoins ci-dessous éprouvent les trois, et surtout les cas qui
 * doivent RESTER refusés — un seuil qui n'interdit plus rien ne protège plus de rien.
 */
describe('seuil d\'offres non qualifiées', () => {
  it('laisse passer les sources mesurées le 19/09, une à deux annonces près', () => {
    // Les huit cas réels, avec leur nombre d'offres observées et d'échecs.
    const mesures = [
      { nom: 'hm-group', vues: 1806, echecs: 1 },
      { nom: 'l-oreal-professionnel', vues: 1693, echecs: 1 },
      { nom: 'bloomingdales-oracle', vues: 794, echecs: 1 },
      { nom: 'kiabi', vues: 222, echecs: 1 },
      { nom: 'dr-martens-tf', vues: 199, echecs: 2 },
      { nom: 'burberry', vues: 154, echecs: 2 },
      { nom: 'selfridges', vues: 75, echecs: 2 },
      { nom: 'uniqlo-au-stores', vues: 73, echecs: 2 },
    ];
    for (const m of mesures) {
      // PRÉMISSE : sans plancher, 1 % des petits lots vaut ZÉRO — c'est le défaut corrigé.
      // Si cette assertion tombait, le témoin n'exercerait plus le cas qu'il prétend couvrir.
      if (m.vues < 200) expect(Math.floor(m.vues * VALIDATION_UNQUALIFIED_ALLOWANCE.ratio)).toBeLessThan(m.echecs);
      expect(m.echecs, m.nom).toBeLessThanOrEqual(unqualifiedAllowanceFor(m.vues));
    }
  });

  it('refuse une source qui se dégrade, quelle que soit sa taille', () => {
    // Le PLAFOND : une grosse source ne perd jamais plus de 5 offres en silence.
    expect(unqualifiedAllowanceFor(10_000)).toBe(5);
    expect(6).toBeGreaterThan(unqualifiedAllowanceFor(10_000));
    // 100 offres perdues sur 10 000, c'est 1 % — un ratio seul les aurait tolérées.
    expect(100).toBeGreaterThan(unqualifiedAllowanceFor(10_000));
  });

  it('refuse un petit lot dont une part notable échoue', () => {
    // Le PLANCHER vaut 2, pas davantage : une source de 20 offres qui en perd 3 (15 %) est
    // refusée. C'est la contrepartie du plancher, et elle doit tenir.
    expect(3).toBeGreaterThan(unqualifiedAllowanceFor(20));
    expect(3).toBeGreaterThan(unqualifiedAllowanceFor(50));
    // Une source dont TOUT échoue reste refusée, à toute taille.
    expect(311).toBeGreaterThan(unqualifiedAllowanceFor(311));
    expect(1).toBeGreaterThan(unqualifiedAllowanceFor(1));
  });

  it('ne couvre jamais la moitié d\'un lot minuscule', () => {
    // Sans cette borne, une source de 2 offres dont les 2 échouent serait « validée » avec zéro
    // offre publiable. Le seuil doit tolérer une marge, jamais la totalité du lot.
    expect(unqualifiedAllowanceFor(0)).toBe(0);
    expect(unqualifiedAllowanceFor(1)).toBe(0);
    expect(unqualifiedAllowanceFor(2)).toBe(1);
    expect(unqualifiedAllowanceFor(3)).toBe(1);
    expect(unqualifiedAllowanceFor(4)).toBe(2);
  });

  it('croît avec la taille du lot, puis se stabilise au plafond', () => {
    expect(unqualifiedAllowanceFor(100)).toBe(2);
    expect(unqualifiedAllowanceFor(300)).toBe(3);
    expect(unqualifiedAllowanceFor(400)).toBe(4);
    expect(unqualifiedAllowanceFor(500)).toBe(5);
    expect(unqualifiedAllowanceFor(50_000)).toBe(5);
  });
});

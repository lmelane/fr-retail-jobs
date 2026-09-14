import { describe, expect, it } from 'vitest';
import {
  CONTRAT,
  CORRESPONDANCE,
  RANG,
  SANS_EQUIVALENT,
  SENIORITE,
  TELETRAVAIL,
  TEMPS_DE_TRAVAIL,
  UNIVERS,
  correspondance,
} from '../matching/vocabulaire';

/**
 * D-421 — la règle qui décide de ce que voit chaque candidat : une offre
 * MUETTE reste, elle n'est jamais éliminée. Ces témoins échouent si quelqu'un
 * transforme un jour un classement en filtre.
 */
describe('une offre muette reste (D-421 §1)', () => {
  it('une offre qui ne déclare pas son contrat est MUETTE, jamais AUTRE', () => {
    // Prémisse : 57 154 offres du catalogue SONT dans ce cas (mesuré 14/09).
    expect(correspondance(null, CONTRAT.CDI as readonly string[])).toBe(CORRESPONDANCE.MUETTE);
    expect(correspondance(undefined, CONTRAT.CDI as readonly string[])).toBe(CORRESPONDANCE.MUETTE);
    expect(correspondance('', CONTRAT.CDI as readonly string[])).toBe(CORRESPONDANCE.MUETTE);
  });

  it('elle passe DEVANT une offre qui déclare autre chose', () => {
    const muette = correspondance(null, CONTRAT.CDI as readonly string[]);
    const autre = correspondance('FIXED_TERM', CONTRAT.CDI as readonly string[]);
    expect(RANG[muette]).toBeLessThan(RANG[autre]);
  });

  it("l'ordre complet va de l'exact à l'autre, sans égalité", () => {
    const rangs = [
      RANG[CORRESPONDANCE.EXACTE],
      RANG[CORRESPONDANCE.VOISINE],
      RANG[CORRESPONDANCE.MUETTE],
      RANG[CORRESPONDANCE.AUTRE],
    ];
    expect(rangs).toEqual([...rangs].sort((a, b) => a - b));
    expect(new Set(rangs).size).toBe(4);
  });
});

describe('les trous sont nommés, jamais devinés (D-421 §3)', () => {
  it("un axe sans équivalent ne départage RIEN : toutes les offres à égalité", () => {
    // Prémisse : la spécialisation est absente du catalogue (0 % mesuré).
    expect(correspondance('SOINS', SANS_EQUIVALENT)).toBe(CORRESPONDANCE.MUETTE);
    expect(correspondance(null, SANS_EQUIVALENT)).toBe(CORRESPONDANCE.MUETTE);
  });

  it("l'alternance, le stage et le freelance sont déclarés SANS_EQUIVALENT", () => {
    // Ils vivent dans `programType`, une autre dimension : les mapper sur
    // `employmentTerm` inventerait une correspondance fausse et invisible.
    expect(CONTRAT.ALTERNANCE).toBe(SANS_EQUIVALENT);
    expect(CONTRAT.STAGE).toBe(SANS_EQUIVALENT);
    expect(CONTRAT.FREELANCE).toBe(SANS_EQUIVALENT);
  });
});

describe('correspondances mesurées', () => {
  it('contrat : CDI ↔ PERMANENT, CDD ↔ FIXED_TERM', () => {
    expect(correspondance('PERMANENT', CONTRAT.CDI as readonly string[])).toBe(CORRESPONDANCE.EXACTE);
    expect(correspondance('FIXED_TERM', CONTRAT.CDD as readonly string[])).toBe(CORRESPONDANCE.EXACTE);
    expect(correspondance('PERMANENT', CONTRAT.CDD as readonly string[])).toBe(CORRESPONDANCE.AUTRE);
  });

  it('temps de travail : le mieux rempli après le lieu (72,1 %)', () => {
    expect(correspondance('FULL_TIME', TEMPS_DE_TRAVAIL.TEMPS_PLEIN)).toBe(CORRESPONDANCE.EXACTE);
    expect(correspondance('PART_TIME', TEMPS_DE_TRAVAIL.TEMPS_PARTIEL)).toBe(CORRESPONDANCE.EXACTE);
  });

  it('télétravail : une fréquence souhaitée contre un lieu de travail', () => {
    expect(correspondance('REMOTE', TELETRAVAIL.FULL)).toBe(CORRESPONDANCE.EXACTE);
    expect(correspondance('HYBRID', TELETRAVAIL.FREQUENT)).toBe(CORRESPONDANCE.EXACTE);
    expect(correspondance('ONSITE', TELETRAVAIL.NONE)).toBe(CORRESPONDANCE.EXACTE);
    // 77 269 offres ne le déclarent pas : elles restent.
    expect(correspondance(null, TELETRAVAIL.FULL)).toBe(CORRESPONDANCE.MUETTE);
  });

  it('séniorité : des années côté candidat, un niveau côté offre, donc des voisines', () => {
    const cinqADix = SENIORITE.FIVE_TO_TEN;
    expect(correspondance('SENIOR', cinqADix.exacte, cinqADix.voisine)).toBe(CORRESPONDANCE.EXACTE);
    expect(correspondance('DIRECTOR', cinqADix.exacte, cinqADix.voisine)).toBe(CORRESPONDANCE.VOISINE);
    expect(correspondance('JUNIOR', cinqADix.exacte, cinqADix.voisine)).toBe(CORRESPONDANCE.AUTRE);
  });

  it('univers : 3 côté Catwalks, 15 secteurs côté catalogue, aucun recouvrement', () => {
    expect(correspondance('FASHION', UNIVERS.MODE)).toBe(CORRESPONDANCE.EXACTE);
    expect(correspondance('FRAGRANCE', UNIVERS.BEAUTE)).toBe(CORRESPONDANCE.EXACTE);
    expect(correspondance('JEWELRY', UNIVERS.LUXE)).toBe(CORRESPONDANCE.EXACTE);
    // Prémisse : un même code ne doit jamais tomber dans deux univers.
    const tous = [...UNIVERS.MODE, ...UNIVERS.BEAUTE, ...UNIVERS.LUXE];
    expect(new Set(tous).size).toBe(tous.length);
  });

  it('les secteurs mappés existent VRAIMENT au catalogue (mesuré 14/09)', () => {
    // Si quelqu'un ajoute un code inventé, ce témoin le voit.
    const auCatalogue = new Set([
      'FASHION', 'LEATHER_GOODS', 'FOOTWEAR', 'JEWELRY', 'WATCHMAKING', 'BEAUTY',
      'FRAGRANCE', 'EYEWEAR', 'HOME_LIFESTYLE', 'WINES_SPIRITS', 'HOSPITALITY',
      'LUXURY_MOBILITY', 'ART_DESIGN', 'RETAIL', 'LUXURY_TECH_SERVICES',
    ]);
    for (const code of [...UNIVERS.MODE, ...UNIVERS.BEAUTE, ...UNIVERS.LUXE]) {
      expect(auCatalogue.has(code)).toBe(true);
    }
  });
});

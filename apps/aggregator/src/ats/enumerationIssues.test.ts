import { describe, it, expect } from 'vitest';
import { enumerationComplete, enumerationBlockers, isPerPostingDefect } from './enumerationIssues.js';

/**
 * LE CAS RÉEL QUI A IMPOSÉ CE MODULE — GANNI, 2026-09-12.
 *
 * Parcours PROUVÉ : `DECLARED_TOTAL_REACHED`, une page, 16 identifiants uniques pour un total annoncé de 16,
 * compteurs natifs concordants, `truncated: false`. Et pourtant `complete: false`, parce que **deux offres
 * n'avaient pas de description**. La même source, avec la même preuve de parcours, était `complete: true`
 * trois jours plus tôt.
 */
describe('enumerationComplete — un défaut d\'offre ne réfute pas le parcours', () => {
  it('GANNI : deux descriptions manquantes ne retirent plus l\'exhaustivité', () => {
    expect(enumerationComplete(true, ['DESCRIPTION_MISSING:144681', 'DESCRIPTION_MISSING:144688'])).toBe(true);
  });

  it.each([
    'DESCRIPTION_MISSING:144681',
    'UNRECOGNISED_PROJECT_TYPE:77',
  ])('%s ne concerne que cette offre : la source a publié ainsi', (issue) => {
    expect(isPerPostingDefect(issue)).toBe(true);
    expect(enumerationComplete(true, [issue])).toBe(true);
  });

  /**
   * LA FRONTIÈRE, et elle n'est pas cosmétique : *la source a-t-elle publié une valeur que nous avons lue ?*
   * Une description absente CHEZ LA SOURCE est un défaut d'offre. Une page que NOUS n'avons pas pu lire (403,
   * timeout) est un échec de collecte : nous ignorons ce qu'elle contenait, donc si l'offre est encore ouverte.
   * Les traiter comme bénins donnerait le droit de fermer à un run qui n'a pas lu ce qu'il prétend avoir lu.
   */
  it.each(['DETAIL_READ_FAILED:98', 'PUBLIC_PAGE_READ_FAILED:98'])(
    '%s est un ÉCHEC DE COLLECTE et reste bloquant',
    (issue) => {
      expect(isPerPostingDefect(issue)).toBe(false);
      expect(enumerationComplete(true, [issue])).toBe(false);
    },
  );
});

describe('enumerationComplete — ce qui met en cause le PARCOURS réfute toujours', () => {
  it.each([
    'PAGINATION_COUNTER_MISMATCH',
    'UNFILTERED_CUSTOMER_SCOPE_MISMATCH',
    'DECLARED_TOTAL_CHANGED',
    'COUNT_OR_TERMINATION_MISMATCH',
    'PAGE_BUDGET_EXHAUSTED',
    'REPEATED_POSTING_ID:144692',
  ])('%s refuse l\'exhaustivité', (issue) => {
    expect(isPerPostingDefect(issue)).toBe(false);
    expect(enumerationComplete(true, [issue])).toBe(false);
  });

  it('un parcours non terminé n\'est jamais complet, même sans aucun motif', () => {
    expect(enumerationComplete(false, [])).toBe(false);
  });

  /**
   * La liste est FERMÉE dans le sens conservateur : un motif inconnu réfute. Un nouveau motif d'énumération
   * qu'on aurait oublié de classer ne doit pas obtenir le droit de fermer par accident de configuration.
   */
  it('un motif INCONNU réfute par défaut', () => {
    expect(enumerationComplete(true, ['UN_MOTIF_QUE_PERSONNE_N_A_CLASSE'])).toBe(false);
    expect(enumerationBlockers(['UN_MOTIF_QUE_PERSONNE_N_A_CLASSE'])).toHaveLength(1);
  });

  it('nomme les motifs bloquants sans les mélanger aux défauts d\'offre', () => {
    expect(enumerationBlockers(['DESCRIPTION_MISSING:1', 'PAGE_BUDGET_EXHAUSTED', 'DETAIL_READ_FAILED:2']))
      .toEqual(['PAGE_BUDGET_EXHAUSTED', 'DETAIL_READ_FAILED:2']);
  });
});

/**
 * Les refus ne se traitent pas en bloc : le dépôt porte déjà la distinction (`rejectedRows.ts`), et la
 * réutiliser évite qu'un `FETCH_FAILED` obtienne le droit de fermer.
 */
describe('enumerationComplete — refus expliqués contre échecs de collecte', () => {
  it('un refus EXPLIQUÉ qui n\'engage que la ligne est un témoin : l\'exhaustivité tient', () => {
    // Une URL hors tenant est une décision d'IDENTITÉ sur une ligne lue et identifiée : le parcours est entier.
    expect(enumerationComplete(true, [], [{ reason: 'POSTING_URL_IDENTITY_MISMATCH' }])).toBe(true);
  });

  /**
   * Un DOUBLON, en revanche, met en cause le parcours : la liste du publieur se contredit, donc on ne peut pas
   * affirmer que les N identifiants lus couvrent les N offres annoncées. Workday classe déjà le même cas comme
   * motif d'énumération (`REPEATED_IDS_ACROSS_PAGES`) — les adaptateurs doivent juger pareil.
   */
  it.each(['DUPLICATE_NATIVE_ID', 'INVALID_ID_TITLE_OR_NATIVE_VACANCY_URL',
    'INVALID_POSTING_ID_TITLE_EMPLOYER_OR_URL'])(
    '%s met en cause le PÉRIMÈTRE lu et réfute',
    (reason) => expect(enumerationComplete(true, [], [{ reason }])).toBe(false),
  );

  it.each(['FETCH_FAILED', 'UNPARSED_DETAIL', 'DETAIL_TIMEOUT', 'HTTP_ERROR_502'])(
    'un ÉCHEC de collecte (%s) réfute : l\'offre existe peut-être et n\'a pas été lue',
    (reason) => expect(enumerationComplete(true, [], [{ reason }])).toBe(false),
  );
});

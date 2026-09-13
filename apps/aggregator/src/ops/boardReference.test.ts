import { describe, it, expect } from 'vitest';
import { boardReferenceFor } from '../certification/boardReference.js';

/**
 * LA RÉFÉRENCE DU BOARD — dérivée de la configuration, jamais saisie.
 *
 * D60 : la page officielle doit nommer le board **configuré**, « référence dérivée de la configuration par
 * type d'ATS, jamais un mot libre ». Si l'opérateur choisissait la chaîne à chercher, il pourrait chercher le
 * nom de la Maison et le trouver sur sa propre page : preuve circulaire, qui n'établit rien sur le board.
 */
describe('référence de board dérivée de la configuration', () => {
  it('ATS mutualisés : le tenant, car c\'est lui qui distingue une Maison d\'une autre', () => {
    expect(boardReferenceFor('greenhouse', { board: 'jennikayne' })).toBe('jennikayne');
    expect(boardReferenceFor('lever', { site: 'Catbird' })).toBe('Catbird');
    expect(boardReferenceFor('smartrecruiters-whitelabel', { company: 'Primark' })).toBe('Primark');
    expect(boardReferenceFor('recruitee', { subdomain: 'jpweltersgorgensgmbhcobekleidungskg' }))
      .toBe('jpweltersgorgensgmbhcobekleidungskg');
    expect(boardReferenceFor('workday', { tenant: 'fastretailing', origin: 'https://fastretailing.wd3.myworkdayjobs.com' }))
      .toBe('fastretailing');
  });

  it('les deux écarts réels de la vague 1 sortent bien de la configuration', () => {
    // Ce sont exactement les cas qu'une comparaison de domaines aurait manqués.
    expect(boardReferenceFor('recruitee', { subdomain: 'jpweltersgorgensgmbhcobekleidungskg' }))
      .not.toMatch(/kult|olymp|hades/i);
    expect(boardReferenceFor('greenhouse', { board: 'jennikayne' })).not.toMatch(/oak/i);
  });

  it('hôte dédié : l\'hôte configuré, extrait de l\'URL et non l\'URL entière', () => {
    expect(boardReferenceFor('avature', { origin: 'https://careers.ralphlauren.com' })).toBe('careers.ralphlauren.com');
    expect(boardReferenceFor('generic-listing', { sitemapUrl: 'https://careers.psychobunny.com/jobs-sitemap.xml' }))
      .toBe('careers.psychobunny.com');
    expect(boardReferenceFor('rituals', { origin: 'https://careers.rituals.com' })).toBe('careers.rituals.com');
  });

  it('teamtailor : le sous-domaine s\'il existe, sinon l\'hôte du flux', () => {
    expect(boardReferenceFor('teamtailor', { subdomain: 'lovisa' })).toBe('lovisa');
    expect(boardReferenceFor('teamtailor', { origin: 'https://careers.lovisa.com' })).toBe('careers.lovisa.com');
  });

  it('REFUSE quand rien n\'est dérivable — on ne cherche pas une chaîne inventée', () => {
    expect(() => boardReferenceFor('generic-listing', {})).toThrow(/aucune référence/i);
  });

  it('ignore une valeur non textuelle plutôt que de la coercer', () => {
    // `{ board: 42 }` ne doit pas produire « 42 » : une configuration mal formée se refuse.
    expect(() => boardReferenceFor('generic-listing', { origin: 42 as unknown as string })).toThrow();
  });
});

import { expect, it } from 'vitest';
import { findOverlaps, normalizeActor, parseDossiers, registrableDomain, type CatalogueView, type Dossier } from './reconcile.js';
const dossier: Dossier = { acteur: 'Example', type: 'MAISON', urlOfficielle: 'https://careers.example.com/global' };
const catalogue: CatalogueView = {
 sourcesByDomain: new Map([['example.com', 'existing-site'], ['myworkdayjobs.com', 'other-employer']]),
 companiesWithOffers: new Map([['example', 3]]), sourcesByCompany: new Map([['example', ['existing-site']]]),
 brandCoveredByGroup: new Map([['example', 'possible-group']]),
};
it('keeps domain, group and name overlap as separate hints without a coverage or admission verdict', () => {
 const hints = findOverlaps(dossier, catalogue);
 expect(hints.map(h => h.kind)).toEqual(['SHARED_EMPLOYER_DOMAIN', 'POSSIBLE_GROUP', 'SIMILAR_ACTOR']);
 expect(hints.every(h => !('blocking' in h) && !('verdict' in h))).toBe(true);
 expect(hints[1].detail).toContain('aucune couverture');
 expect(findOverlaps({ ...dossier, type: 'PORTAIL_REGIONAL' }, catalogue)).toEqual(hints);
});
it('does not merge employers sharing an ATS vendor', () => {
 const hints = findOverlaps({ ...dossier, acteur: 'Unrelated', urlOfficielle: 'https://other.wd3.myworkdayjobs.com/Careers' }, catalogue);
 expect(hints).toEqual([]);
});
it('resolves public suffixes and private hosting boundaries without conflating UK employers', () => {
 expect(registrableDomain('https://careers.employer.co.uk/jobs')).toBe('employer.co.uk');
 expect(registrableDomain('https://tenant.github.io/careers')).toBe('tenant.github.io');
 expect(registrableDomain('not a URL')).toBeNull();
 expect(registrableDomain('https://co.uk')).toBeNull();
});
it('loosely matches names only for research', () => {
 expect(normalizeActor('Example, Inc.')).toBe(normalizeActor('EXAMPLE'));
 expect(normalizeActor("L’Oréal")).toBe(normalizeActor('L Oreal'));
});
it('accepts bounded dossiers in single, list or wrapper form', () => {
 expect(parseDossiers(dossier)).toEqual([dossier]);
 expect(parseDossiers([dossier])).toEqual([dossier]);
 expect(parseDossiers({ dossiers: [dossier] })).toEqual([dossier]);
});
it.each([null, [], Array(101).fill(dossier), { ...dossier, acteur: '' }, { ...dossier, type: 'ACTIVE' },
 { ...dossier, status: 'VERIFIED' }, { ...dossier, urlOfficielle: 'file:///private' },
 { ...dossier, urlOfficielle: 'https://user:secret@example.com' }, { ...dossier, pays: {} },
 { ...dossier, portalScope: 'VERIFIED' }, { dossiers: 'not a list' }])('refuses invalid discovery dossiers %#', value => {
 expect(() => parseDossiers(value)).toThrow();
});

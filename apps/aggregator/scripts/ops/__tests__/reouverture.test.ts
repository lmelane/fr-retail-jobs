import { describe, expect, it } from 'vitest';
import { checkReopening, planReopening, planStillHolds, type AfterState, type Representation } from '../reouverture.js';

/**
 * D-520 §4 a — la réparation des fausses preuves de knitwell (23-30/09/2026) : l'aperçu ne retient pour réouverture que
 * ce que la liste COMPLÈTE porte encore, refuse sans preuve, et l'application ne vaut que si la collecte native a
 * réellement rouvert chaque ligne qu'elle a revue.
 */
const row = (externalId: string, etat: Representation['etat'] = 'FERMEE', jobSourceId = `js-${externalId}`): Representation =>
  ({ jobSourceId, jobId: `job-${externalId}`, externalId, etat, depuis: '2026-09-28T19:00:00.000Z', regle: etat === 'RETENUE' ? 'MISSED_BY_CREDIBLE_COLLECTION' : null });
const proof = (listed: string[], complete = true) => ({ at: '2026-10-02T19:00:00.000Z', complete, termination: complete ? 'COVERING_FACET_RECONCILED' : 'COVERING_FACET_UNPROVEN',
  declaredTotal: listed.length, listed });
const rows = [row('R-3'), row('R-1', 'RETENUE'), row('R-9')];

describe('aperçu de la réouverture', () => {
  it('rouvre ce que la liste complète porte encore, laisse fermé ce qu’elle ne porte plus', () => {
    const plan = planReopening({ sourceKey: 'knitwell-us-retail', since: '2026-09-23T00:00:00.000Z', rows, proof: proof(['R-1', 'R-2', 'R-3']) });
    expect(plan.aRouvrir.map(r => r.externalId)).toEqual(['R-1', 'R-3']);
    expect(plan.resteFermees.map(r => r.externalId)).toEqual(['R-9']);
    expect(plan.preuve).toMatchObject({ termination: 'COVERING_FACET_RECONCILED', listed: 3 });
  });
  it('sans liste prouvée complète, aucun aperçu : rien ne dit qu’une offre fermée est encore en ligne', () => {
    expect(() => planReopening({ sourceKey: 'k', since: 's', rows, proof: proof(['R-1'], false) })).toThrow(/PREUVE_ABSENTE/);
    expect(() => planReopening({ sourceKey: 'k', since: 's', rows, proof: proof(['R-1', 'R-1']) })).toThrow(/PREUVE_INVALIDE/);
  });
  it('le plan relu ne vaut que pour la base qu’il a lue : une fermeture de plus, ou une de moins, le périme', () => {
    const plan = planReopening({ sourceKey: 'k', since: 's', rows, proof: proof(['R-1', 'R-3']) });
    expect(planStillHolds(plan, [...rows].reverse())).toBe(true);
    expect(planStillHolds(plan, [...rows, row('R-4')])).toBe(false);
    expect(planStillHolds(plan, rows.slice(1))).toBe(false);
    // A hand-edited plan (a line moved from « reste fermée » to « à rouvrir », or dropped) no longer matches its fingerprints.
    expect(planStillHolds({ ...plan, aRouvrir: [...plan.aRouvrir, plan.resteFermees[0]!], resteFermees: [] }, rows)).toBe(false);
    expect(planStillHolds({ ...plan, aRouvrir: plan.aRouvrir.slice(1) }, rows)).toBe(false);
  });
});

describe('vérification après la collecte native', () => {
  const started = new Date('2026-10-03T08:00:00.000Z');
  const plan = planReopening({ sourceKey: 'k', since: 's', rows, proof: proof(['R-1', 'R-3', 'R-9']) });
  const state = (over: Partial<AfterState>): AfterState => ({ jobSourceId: '', isActive: true, publisherClosedAt: null, availabilityHold: null,
    lastSeenAt: '2026-10-03T08:10:00.000Z', jobActive: true, ...over });
  it('chaque ligne revue doit être rouverte ; une ligne non revue a quitté la liste depuis l’aperçu', () => {
    const after = new Map([['js-R-1', state({})], ['js-R-3', state({ lastSeenAt: '2026-10-01T00:00:00.000Z', isActive: false })], ['js-R-9', state({})]]);
    expect(checkReopening(plan, after, started)).toEqual({ rouvertes: ['R-1', 'R-9'], nonRevues: ['R-3'], nonRouvertes: [] });
  });
  it('revue mais encore fermée, retenue ou offre inactive : nommée, la réparation échoue', () => {
    const after = new Map([['js-R-1', state({ availabilityHold: 'NOT_RECONFIRMED' })], ['js-R-3', state({ jobActive: false })], ['js-R-9', state({ publisherClosedAt: '2026-10-03T08:20:00.000Z' })]]);
    const check = checkReopening(plan, after, started);
    expect(check.rouvertes).toEqual([]);
    expect(check.nonRouvertes.map(r => r.externalId)).toEqual(['R-1', 'R-3', 'R-9']);
    expect(checkReopening(plan, new Map(), started).nonRouvertes).toHaveLength(3);
  });
});

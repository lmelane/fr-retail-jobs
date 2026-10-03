import { describe, expect, it } from 'vitest';
import { enumerationEvidence, outsideAbsenceScope, planRefresh, representationState, type Representation } from './refreshPlan.js';

/**
 * D-522 §6, lecture métier du 03/10/2026 (HIGH) : wttj-sector est la seule source de 2 656 offres actives (124 Maisons,
 * Hermès 929). Le refresh jugeait l'absence sur la source ENTIÈRE : une organisation sortie de la facette WTTJ n'est plus
 * balayée, ses offres manquent à l'ensemble observé, et toutes auraient été fermées alors qu'elles sont encore en ligne
 * (Hermès, 929, passe sous la garde globale de 4 568). Seule une organisation présente ET prouvée peut attester
 * l'absence de ses offres : le lecteur déclare son périmètre d'absence (`absenceScope`), le refresh s'y restreint.
 */
const rep = (id: string, org: string): Representation & { org: string } => ({ sourceKey: 'wttj-sector', externalId: id, jobId: `job-${id}`,
  jobSourceId: `js-${id}`, lastSeenAt: new Date('2026-09-30T18:00:00Z'), held: false, writeFailed: false, org });
const scope = { rawPath: ['organization', 'slug'], proven: ['hermes', 'diptyque'] };

describe('le périmètre d’absence d’une source balayée par organisation', () => {
  const reps = [rep('h-seen', 'hermes'), rep('h-gone', 'hermes'), rep('x-1', 'maison-sortie'), rep('x-2', 'maison-sortie')];
  const observed = new Set(['h-seen', 'd-1']);
  const values = new Map(reps.map((r) => [r.jobSourceId, r.org]));

  it('une organisation disparue de la facette ne ferme AUCUNE de ses offres ; une organisation prouvée ferme l’offre absente', () => {
    // Prémisse : sans périmètre, les offres de l'organisation sortie sont déclarées absentes (le défaut).
    expect(representationState(reps[2]!, observed, true)).toBe('ABSENT_FROM_PROVEN_ENUMERATION');
    const outside = outsideAbsenceScope(scope, values);
    expect([...outside].sort()).toEqual(['js-x-1', 'js-x-2']);
    const states = new Map(reps.map((r) => [r.jobSourceId, representationState(r, observed, true, outside.has(r.jobSourceId))]));
    expect(states.get('js-x-1')).toBe('UNVERIFIABLE');
    expect(states.get('js-h-gone')).toBe('ABSENT_FROM_PROVEN_ENUMERATION');
    expect(states.get('js-h-seen')).toBe('PRESENT_AND_REATTESTED');
    const plan = planRefresh(reps, states, new Map(reps.map((r) => [r.jobId!, [r.jobSourceId]])));
    expect(plan.deactivations.map((d) => d.externalId)).toEqual(['h-gone']);
  });

  it('une représentation sans valeur de périmètre lisible n’est jamais déclarée absente', () => {
    expect([...outsideAbsenceScope(scope, new Map([['js-a', null], ['js-b', 'hermes']]))]).toEqual(['js-a']);
  });

  it('sans périmètre déclaré, rien ne change ; un périmètre illisible dans la preuve scellée ne prouve rien', () => {
    expect(outsideAbsenceScope(undefined, values).size).toBe(0);
    const sealed = (absenceScope: unknown) => enumerationEvidence('wttj-sector', 'b', { enumeration: { termination: 'ORGANIZATIONS_RECONCILED', pageEvidence: [{ canonicalIds: ['a'] }], absenceScope } });
    expect(sealed(scope).absenceScope).toEqual(scope);
    expect(sealed({ rawPath: ['organization', 'slug; drop'], proven: ['hermes'] }).absenceScope).toEqual({ rawPath: [], proven: [] });
    expect(sealed(undefined)).not.toHaveProperty('absenceScope');
    expect(outsideAbsenceScope({ rawPath: [], proven: [] }, values).size).toBe(values.size);
  });
});

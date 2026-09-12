import { describe, it, expect } from 'vitest';
import {
  sourceEligibility, representationState, planRefresh, identifiersComparable,
  type Representation, type RepresentationState,
} from './refreshPlan.js';

const run = (over: Partial<Parameters<typeof sourceEligibility>[0] & object> = {}) => ({
  sourceKey: 's', runId: 'run-1', status: 'OK', errors: 0, truncated: false,
  complete: true, canAttestAbsence: true, ranAt: new Date('2026-09-12T09:00:00Z'), ...over,
});
const evidence = (over: Partial<Parameters<typeof sourceEligibility>[1] & object> = {}) => ({
  sourceKey: 's', runId: 'run-1', termination: 'DECLARED_TOTAL_REACHED',
  observedIds: ['a', 'b'], idsUnavailable: false, ...over,
});

describe('sourceEligibility — dérivée des FAITS du dernier run', () => {
  it('un run sain avec une terminaison probante et des identifiants archivés est recevable', () => {
    expect(sourceEligibility(run(), evidence())).toEqual({ eligible: true, reasons: [] });
  });

  it.each([
    [{ errors: 9 }, /errors = 9/],
    [{ truncated: true }, /truncated/],
    [{ complete: false }, /complete = false/],
    [{ canAttestAbsence: false }, /canAttestAbsence = false/],
  ])('refuse %o', (over, pattern) => {
    const r = sourceEligibility(run(over as any), evidence());
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(pattern);
  });

  /**
   * LA CORRÉLATION PAR CYCLE. Juxtaposer le dernier `SourceRun` avec une ANCIENNE preuve d'énumération ferait
   * fermer des offres sur la foi d'un balayage qui n'est pas celui-là.
   */
  it('refuse une preuve d\'énumération qui n\'appartient pas au même cycle', () => {
    const r = sourceEligibility(run({ runId: 'run-2' }), evidence({ runId: 'run-1' }));
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/autre cycle/);
  });

  /** Mesuré : `beiersdorf` n'archive AUCUN identifiant. Une absence n'y est donc pas démontrable. */
  it('refuse une source dont la preuve n\'archive aucun identifiant', () => {
    const r = sourceEligibility(run(), evidence({ idsUnavailable: true, observedIds: [] }));
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/aucun identifiant/);
  });

  it('refuse une terminaison non probante', () => {
    expect(sourceEligibility(run(), evidence({ termination: 'INCOMPLETE' })).eligible).toBe(false);
  });
});

const rep = (over: Partial<Representation> = {}): Representation => ({
  sourceKey: 's', externalId: 'a', jobId: 'J1', jobSourceId: 'JS1',
  lastSeenAt: new Date('2026-09-06T00:00:00Z'), held: false, writeFailed: false, ...over,
});

describe('representationState — cinq états, un seul autorise la fermeture', () => {
  const observed = new Set(['a', 'b']);

  it('vue et ré-attestée', () => {
    expect(representationState(rep(), observed, true)).toBe('PRESENT_AND_REATTESTED');
  });

  /** Une offre VUE mais retenue n'est pas absente : la confondre fermerait un poste bien publié. */
  it('vue mais RETENUE n\'est jamais absente', () => {
    expect(representationState(rep({ held: true }), observed, true)).toBe('PRESENT_BUT_HELD');
  });

  it('vue mais REFUSÉE à l\'écriture n\'est jamais absente', () => {
    expect(representationState(rep({ writeFailed: true }), observed, true)).toBe('PRESENT_BUT_WRITE_FAILED');
  });

  it('absente de l\'ensemble réellement observé : le seul état qui prouve la disparition', () => {
    expect(representationState(rep({ externalId: 'z' }), observed, true)).toBe('ABSENT_FROM_PROVEN_ENUMERATION');
  });

  it('source non recevable, ou identifiants indisponibles → INVÉRIFIABLE, aucune mutation', () => {
    expect(representationState(rep({ externalId: 'z' }), observed, false)).toBe('UNVERIFIABLE');
    expect(representationState(rep({ externalId: 'z' }), null, true)).toBe('UNVERIFIABLE');
  });

  /**
   * LE DÉFAUT DE MA PREMIÈRE PRÉVISUALISATION : elle déduisait l'absence d'un `lastSeenAt` ancien. Une offre
   * peut n'avoir pas été RÉ-ÉCRITE tout en étant parfaitement présente dans le balayage.
   */
  it('un lastSeenAt ancien ne suffit PAS à déclarer une absence', () => {
    const old = rep({ lastSeenAt: new Date('2026-01-01T00:00:00Z') });
    expect(representationState(old, observed, true)).toBe('PRESENT_AND_REATTESTED');
  });
});

describe('planRefresh — la conséquence se calcule APRÈS les seules désactivations prévues', () => {
  const states = (m: Record<string, RepresentationState>) => new Map(Object.entries(m));

  it('ne désactive que les représentations réellement absentes', () => {
    const reps = [rep({ jobSourceId: 'JS1' }), rep({ jobSourceId: 'JS2', externalId: 'z' })];
    const { deactivations } = planRefresh(reps, states({
      JS1: 'PRESENT_AND_REATTESTED', JS2: 'ABSENT_FROM_PROVEN_ENUMERATION',
    }), new Map([['J1', ['JS1', 'JS2']]]));
    expect(deactivations.map((d) => d.jobSourceId)).toEqual(['JS2']);
  });

  /**
   * UNE SOURCE HORS PÉRIMÈTRE MAINTIENT L'OFFRE OUVERTE, même avec un `lastSeenAt` ancien : elle n'est pas
   * désactivée par ce plan, donc elle survit. C'était le second défaut de ma prévisualisation, qui regardait
   * la fraîcheur des autres sources au lieu du plan.
   */
  it('une autre source active NON désactivée conserve l\'offre', () => {
    const reps = [rep({ jobSourceId: 'JS1', externalId: 'z' })];
    const { jobs } = planRefresh(reps, states({ JS1: 'ABSENT_FROM_PROVEN_ENUMERATION' }),
      new Map([['J1', ['JS1', 'JS-hors-perimetre']]]));
    expect(jobs.get('J1')).toBe('JOB_KEPT_BY_ANOTHER_SOURCE');
  });

  it('sans aucune autre attestation, l\'offre devient candidate à fermeture', () => {
    const reps = [rep({ jobSourceId: 'JS1', externalId: 'z' })];
    const { jobs } = planRefresh(reps, states({ JS1: 'ABSENT_FROM_PROVEN_ENUMERATION' }),
      new Map([['J1', ['JS1']]]));
    expect(jobs.get('J1')).toBe('JOB_CANDIDATE_FOR_CLOSURE');
  });

  it('deux représentations absentes de la MÊME offre la ferment, aucune ne se sauve l\'une l\'autre', () => {
    const reps = [rep({ jobSourceId: 'JS1', externalId: 'z' }), rep({ jobSourceId: 'JS2', externalId: 'y' })];
    const { jobs } = planRefresh(reps, states({
      JS1: 'ABSENT_FROM_PROVEN_ENUMERATION', JS2: 'ABSENT_FROM_PROVEN_ENUMERATION',
    }), new Map([['J1', ['JS1', 'JS2']]]));
    expect(jobs.get('J1')).toBe('JOB_CANDIDATE_FOR_CLOSURE');
  });

  it.each<RepresentationState>(['PRESENT_BUT_HELD', 'PRESENT_BUT_WRITE_FAILED', 'UNVERIFIABLE'])(
    '%s ne produit AUCUNE désactivation',
    (state) => {
      const { deactivations, jobs } = planRefresh([rep()], states({ JS1: state }), new Map([['J1', ['JS1']]]));
      expect(deactivations).toEqual([]);
      expect(jobs.size).toBe(0);
    },
  );
});

/**
 * LE DÉFAUT QUI AURAIT FERMÉ DES OFFRES VIVANTES, mesuré le 2026-09-12.
 *
 * `american-vintage-dr` archive des identifiants COMPOSITES (`4589457-125350751`) là où la base stocke
 * l'identifiant simple (`4459569`). Comparés tels quels, 100 % des offres paraissaient absentes — alors que la
 * source venait d'en lire 31 sans une seule erreur. Les cinq autres sources de la vague correspondent à
 * 84–89 %, l'écart étant les absences réelles.
 */
describe('identifiersComparable — un recouvrement nul est une incomparabilité, pas une disparition', () => {
  it('le cas réel american-vintage-dr : aucun identifiant en commun', () => {
    const observed = new Set(['4589457-125350751', '4589143-51323249']);
    expect(identifiersComparable(observed, ['4459569', '4472375'])).toBe(false);
  });

  it('les sources saines partagent le vocabulaire, même avec des absences réelles', () => {
    // 64 observés / 72 stockés : l'écart EST la disparition, et la comparaison reste valide.
    const observed = new Set(['a', 'b', 'c']);
    expect(identifiersComparable(observed, ['a', 'b', 'c', 'disparue-1', 'disparue-2'])).toBe(true);
  });

  it('un seul recouvrement suffit : le contrôle détecte l\'incomparabilité, pas la qualité', () => {
    expect(identifiersComparable(new Set(['a', 'x', 'y']), ['a', 'z'])).toBe(true);
  });

  it('des ensembles vides ne se comparent pas', () => {
    expect(identifiersComparable(new Set(), ['a'])).toBe(false);
    expect(identifiersComparable(new Set(['a']), [])).toBe(false);
  });
});

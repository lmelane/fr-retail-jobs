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
  canonicalSet: ['a', 'b'], canonicalContractDeclared: true, canonicalContractBroken: false, ...over,
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

  /** A. Mesuré sur `beiersdorf` : le contrat n'est pas déclaré, donc aucune absence n'y est démontrable. */
  it('A. contrat NON déclaré : source non recevable', () => {
    const r = sourceEligibility(run(), evidence({ canonicalContractDeclared: false, canonicalSet: [] }));
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/ne déclare pas le contrat canonique/);
  });

  /** C. Contrat déclaré mais rompu — l'adaptateur l'a constaté lui-même. */
  it('C. contrat déclaré mais ROMPU : source non recevable', () => {
    const r = sourceEligibility(run(), evidence({ canonicalContractBroken: true }));
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/contrat canonique déclaré mais rompu/);
  });

  /**
   * D. LA CONTRADICTION CORRIGÉE : un board réellement vide, dont la terminaison est démontrée, est une preuve
   * VALIDE. « La source ne publie plus rien » est même la seule preuve qui justifie de fermer tout un board.
   * La cardinalité de l'ensemble ne décide donc jamais de la disponibilité du contrat.
   */
  it('D. contrat déclaré, ensemble VIDE, board réellement vide et terminaison probante : RECEVABLE', () => {
    const r = sourceEligibility(run(), evidence({ canonicalSet: [], termination: 'FULL_XML_DOCUMENT' }));
    expect(r).toEqual({ eligible: true, reasons: [] });
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

/**
 * LA DÉRIVE PARTIELLE — pourquoi la protection ne peut PAS venir d'un ratio.
 *
 * 1 identifiant à l'ancien format, 99 au nouveau : un seuil de recouvrement aurait déclaré les ensembles
 * comparables et produit 99 fausses absences. C'est le CONTRAT DE LA SOURCE
 * (`ats/canonicalIdContract.ts`) qui refuse ce cas, en exigeant que CHAQUE offre écrite figure dans la preuve —
 * pas une proportion d'entre elles.
 *
 * `identifiersComparable` ne répond qu'à une question plus modeste, et le dit : « cet ensemble décrit-il ce
 * board ? ». Il attrape le vocabulaire entièrement étranger ; il n'a jamais vocation à mesurer une dérive
 * partielle, et ne doit donc pas être pris pour la garde qui le fait.
 */
describe('identifiersComparable — ce qu\'il garantit, et ce qu\'il ne garantit pas', () => {
  it('une disposition nommée compte comme une correspondance : l\'offre a bien été traitée', () => {
    // Vue puis retenue : le vocabulaire est partagé, même si l'identifiant n'est pas dans `observed`.
    expect(identifiersComparable(new Set(['autre']), ['retenue-1'], new Set(['retenue-1']))).toBe(true);
  });

  it('dérive PARTIELLE : non détectée ici — c\'est le contrat de la source qui la refuse', () => {
    const stored = ['legacy-1', ...Array.from({ length: 99 }, (_, i) => `legacy-${i + 2}`)];
    const observed = new Set(['legacy-1', ...Array.from({ length: 99 }, (_, i) => `nouveau/${i + 2}`)]);
    // Documenté comme une LIMITE assumée de cette fonction, pas comme un comportement souhaitable.
    expect(identifiersComparable(observed, stored)).toBe(true);
  });
});

/**
 * E. LE PARCOURS COMPLET, de la recevabilité au plan — pas seulement `normalizeAdapterResult`.
 *
 * Un board réellement vide, prouvé, doit rendre ses anciennes représentations ABSENTES et non INVÉRIFIABLES :
 * c'est précisément le cas où fermer est justifié. Traiter l'ensemble vide comme une indisponibilité aurait
 * rendu ce board éternellement infermable — la contradiction que ce test verrouille.
 */
describe('E. board vide prouvé — de sourceEligibility à planRefresh', () => {
  it('une JobSource ancienne face à un board vide PROUVÉ est ABSENT, puis candidate à fermeture', () => {
    const facts = run();
    const proof = evidence({ canonicalSet: [], termination: 'FULL_XML_DOCUMENT' });

    // 1. la source est recevable : le contrat est déclaré, la terminaison démontrée
    const verdict = sourceEligibility(facts, proof);
    expect(verdict.eligible).toBe(true);

    // 2. l'ancienne représentation n'est PAS dans l'ensemble observé — qui est vide, et c'est une preuve
    const old = rep({ jobSourceId: 'JS-vieille', externalId: 'partie-depuis-longtemps' });
    const state = representationState(old, new Set(proof.canonicalSet), verdict.eligible);
    expect(state).toBe('ABSENT_FROM_PROVEN_ENUMERATION');

    // 3. et le plan la désactive, fermant l'offre faute d'autre attestation
    const { deactivations, jobs } = planRefresh([old], new Map([[old.jobSourceId, state]]),
      new Map([[old.jobId, [old.jobSourceId]]]));
    expect(deactivations.map((d) => d.jobSourceId)).toEqual(['JS-vieille']);
    expect(jobs.get(old.jobId)).toBe('JOB_CANDIDATE_FOR_CLOSURE');
  });

  it('le même board vide, mais contrat NON déclaré : INVÉRIFIABLE et aucune mutation', () => {
    const verdict = sourceEligibility(run(), evidence({ canonicalSet: [], canonicalContractDeclared: false }));
    expect(verdict.eligible).toBe(false);

    const old = rep({ jobSourceId: 'JS-vieille', externalId: 'inconnue' });
    const state = representationState(old, null, verdict.eligible);
    expect(state).toBe('UNVERIFIABLE');

    const { deactivations } = planRefresh([old], new Map([[old.jobSourceId, state]]),
      new Map([[old.jobId, [old.jobSourceId]]]));
    expect(deactivations).toEqual([]);
  });
});

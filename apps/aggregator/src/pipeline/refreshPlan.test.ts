import { describe, it, expect } from 'vitest';
import {
  sourceEligibility, representationState, planRefresh, identifiersComparable,
  PROVING_TERMINATIONS, DECLARED_BUT_NOT_PROVING,
  type Representation, type RepresentationState,
} from './refreshPlan.js';

const run = (over: Partial<NonNullable<Parameters<typeof sourceEligibility>[0]>> = {}) => ({
  sourceKey: 's', captureBatchId: 'batch-1', startedAt: new Date('2026-09-12T09:00:00Z'), status: 'OK' as const,
  errors: 0, truncated: false, complete: true, declaredTotal: 2, fetched: 2, published: 2, previous: 2, canAttestAbsence: true, ...over,
});
const evidence = (over: Partial<NonNullable<Parameters<typeof sourceEligibility>[1]>> = {}) => ({
  sourceKey: 's', captureBatchId: 'batch-1', termination: 'DECLARED_TOTAL_REACHED',
  canonicalSet: ['a', 'b'], canonicalContractDeclared: true, canonicalContractBroken: false, ...over,
});

describe('sourceEligibility — dérivée des FAITS scellés de la capture attestante', () => {
  it('une collecte saine avec une terminaison probante et des identifiants scellés est recevable', () => {
    expect(sourceEligibility(run(), evidence())).toEqual({ eligible: true, reasons: [] });
  });

  it.each([
    [{ errors: 9 }, /errors = 9/],
    [{ truncated: true }, /truncated/],
    [{ complete: false }, /complete = false/],
    [{ canAttestAbsence: false }, /canAttestAbsence = false/],
    [{ status: 'NEW' as const }, /statut non probant : NEW/],
    [{ status: 'BROKEN' as const }, /statut non probant : BROKEN/],
  ])('refuse %o', (over, pattern) => {
    const r = sourceEligibility(run(over), evidence());
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(pattern);
  });

  it('sans capture attestante, rien n\'est recevable', () => {
    expect(sourceEligibility(undefined, evidence())).toEqual({ eligible: false, reasons: ['aucune collecte admise, scellée et achevée'] });
  });

  /**
   * LA CORRÉLATION PAR COLLECTE. Juxtaposer des faits avec une preuve d'énumération d'une AUTRE capture ferait
   * fermer des offres sur la foi d'un balayage qui n'est pas celui-là.
   */
  it('refuse une preuve d\'énumération qui n\'appartient pas à la même collecte', () => {
    const r = sourceEligibility(run({ captureBatchId: 'batch-2' }), evidence({ captureBatchId: 'batch-1' }));
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/autre collecte/);
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
  it('admet la fin documentée d’un JSON Feed Teamtailor (NEXT_URL_NULL) et refuse son plafond de pages', () => {
    // Prémisse : la même capture, seule la terminaison change ; rien d'autre ne rend la source éligible.
    expect(sourceEligibility(run(), evidence({ termination: 'PAGE_BUDGET_REACHED' })).eligible).toBe(false);
    expect(sourceEligibility(run(), evidence({ termination: 'NEXT_URL_NULL' })).eligible).toBe(true);
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

  it('vue mais ÉCARTÉE par le filtre sectoriel n\'est jamais absente : l\'employeur la publie toujours', () => {
    expect(representationState(rep({ skipped: true }), observed, true)).toBe('PRESENT_BUT_SKIPPED');
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

  it.each<RepresentationState>(['PRESENT_BUT_HELD', 'PRESENT_BUT_WRITE_FAILED', 'PRESENT_BUT_SKIPPED', 'UNVERIFIABLE'])(
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
      new Map([[old.jobId!, [old.jobSourceId]]]));
    expect(deactivations.map((d) => d.jobSourceId)).toEqual(['JS-vieille']);
    expect(jobs.get(old.jobId!)).toBe('JOB_CANDIDATE_FOR_CLOSURE');
  });

  it('le même board vide, mais contrat NON déclaré : INVÉRIFIABLE et aucune mutation', () => {
    const verdict = sourceEligibility(run(), evidence({ canonicalSet: [], canonicalContractDeclared: false }));
    expect(verdict.eligible).toBe(false);

    const old = rep({ jobSourceId: 'JS-vieille', externalId: 'inconnue' });
    const state = representationState(old, null, verdict.eligible);
    expect(state).toBe('UNVERIFIABLE');

    const { deactivations } = planRefresh([old], new Map([[old.jobSourceId, state]]),
      new Map([[old.jobId!, [old.jobSourceId]]]));
    expect(deactivations).toEqual([]);
  });
});

/**
 * D. UNE LIGNE VUE PUIS REJETÉE NE SE FERME JAMAIS.
 *
 * L'identifiant est dans la preuve : la source le publie toujours, c'est nous qui n'avons pas su en faire une
 * offre. La présenter comme absente fermerait une offre vivante ; la présenter comme ré-attestée mentirait sur
 * ce qui a été écrit. D'où un état distinct, qui ne mute rien.
 */
describe('PRESENT_BUT_REJECTED — vue, non persistée, jamais fermée', () => {
  it('une représentation historique face à une ligne vue mais rejetée n\'est pas ABSENTE', () => {
    const observed = new Set(['123']);
    const state = representationState(rep({ externalId: '123', rejected: true }), observed, true);
    expect(state).toBe('PRESENT_BUT_REJECTED');
    expect(state).not.toBe('ABSENT_FROM_PROVEN_ENUMERATION');
  });

  it('et le plan ne la désactive pas, donc ne ferme rien', () => {
    const r = rep({ jobSourceId: 'JS1', externalId: '123', rejected: true });
    const { deactivations, jobs } = planRefresh([r], new Map([['JS1', 'PRESENT_BUT_REJECTED']]),
      new Map([['J1', ['JS1']]]));
    expect(deactivations).toEqual([]);
    expect(jobs.size).toBe(0);
  });

  /** Les dispositions ont une priorité : un refus d'écriture prime sur un rejet d'adaptateur. */
  it('un refus d\'écriture reste distinct d\'un rejet d\'adaptateur', () => {
    const observed = new Set(['123']);
    expect(representationState(rep({ externalId: '123', rejected: true, writeFailed: true }), observed, true))
      .toBe('PRESENT_BUT_WRITE_FAILED');
  });
});

/**
 * PARCOURS COMPLET ≠ PREUVE D'ABSENCE EXPLOITABLE.
 *
 * Une ligne Workday sans `externalPath` est observée mais anonyme. Le listing peut avoir été lu en entier et,
 * pourtant, aucun identifiant historique ne peut être déclaré disparu : il pourrait être cette ligne-là.
 */
describe('canonicalAbsenceProofUsable — deux propriétés distinctes', () => {
  it('des lignes sans identifiant rendent la source non recevable, même parcours complet', () => {
    const r = sourceEligibility(run(), evidence({ canonicalAbsenceProofUsable: false }));
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/aucun identifiant canonique/);
  });

  it('toutes les lignes identifiables : la preuve est exploitable', () => {
    expect(sourceEligibility(run(), evidence({ canonicalAbsenceProofUsable: true })).eligible).toBe(true);
  });

  it('un adaptateur qui ne se prononce pas ne se voit rien présumer de défavorable', () => {
    expect(sourceEligibility(run(), evidence({ canonicalAbsenceProofUsable: undefined })).eligible).toBe(true);
  });
});

/**
 * Le contrat canonique et la preuve de FIN DE PARCOURS sont deux conditions indépendantes, et l'audit du
 * 2026-09-17 a montré qu'on les confond : six familles ont reçu un contrat exact en croyant gagner le droit
 * de fermer, alors que leur terminaison n'est pas probante. Leur travail est inerte.
 *
 * Ces témoins gardent l'écart lui-même. Le second passe au rouge si une de ces terminaisons est promue sans
 * que la liste documentaire de `refreshPlan.ts` soit mise à jour — le motif « le code avance, le document
 * reste en arrière » que les audits de ce projet trouvent en premier.
 */
describe('contrat déclaré ≠ droit de fermer', () => {
  it('une terminaison non probante refuse la fermeture, contrat canonique parfait ou non', () => {
    for (const termination of DECLARED_BUT_NOT_PROVING) {
      const r = sourceEligibility(run(), evidence({
        termination, canonicalContractDeclared: true, canonicalContractBroken: false,
        canonicalAbsenceProofUsable: true,
      }));
      expect(r.eligible, `${termination} ne doit pas autoriser une fermeture`).toBe(false);
      expect(r.reasons.join(' ')).toMatch(/terminaison non probante/);
    }
  });

  it('les deux ensembles restent disjoints : une promotion se fait en connaissance de cause', () => {
    const promues = DECLARED_BUT_NOT_PROVING.filter((t) => PROVING_TERMINATIONS.has(t));
    expect(promues, 'promue sans mise à jour du relevé de refreshPlan.ts').toEqual([]);
  });
});

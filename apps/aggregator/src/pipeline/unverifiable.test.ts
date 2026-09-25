import { describe, expect, it } from 'vitest';

import { classifyHold, classifySourceBlock, describeUnverifiable, NO_NAMED_DEFECT, OVERDUE_DAYS, registerEntries, type BlockedSourceRow, type HoldRow } from './unverifiable.js';
import { retentionClass } from './publicationDisposition.js';
import { isTrustedForAttestation } from './attestation.js';

/** Les motifs et les runs sont ceux réellement archivés en production le 2026-09-11 (lecture seule). */
describe('classement des retenues par NATURE, pas par libellé', () => {
  it('sépare un défaut TECHNIQUE d\'un fait manquant, d\'une preuve de la source et d\'une décision de l\'équipe', () => {
    expect(classifyHold('WORKDAY_DETAIL_FETCH_FAILED')).toBe('DETAIL_UNREADABLE');
    expect(classifyHold('WORKDAY_EMPLOYER_ABSENT_IN_DETAIL')).toBe('DETAIL_INCOMPLETE');
    // D-453 §1 et D-456 §1 : la source rend la candidature impossible ou publie elle-même la preuve.
    for (const reason of ['APPLICATION_EXPLICITLY_CLOSED', 'APPLICATION_HTTP_404', 'APPLICATION_HTTP_410', 'APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION',
      'SOURCE_UNLISTED', 'NATIVE_TEST_PUBLICATION', 'NATIVE_RECRUITMENT_EVENT'])
      expect(classifyHold(reason)).toBe('NATIVE_EVIDENCE');
    // D-456 §2 : une décision de l'équipe, non bloquante.
    expect(classifyHold('SCOPE_OUT_OF_PERIMETER')).toBe('OUT_OF_PERIMETER');
    // Une contradiction nouvelle reste à instruire.
    expect(classifyHold('LISTING_DATE_CONTRADICTION')).toBe('PUBLISHER_CONTRADICTION');
  });

  it('parle le vocabulaire du RUN : décidé au registre si et seulement si non bloquant au RUN', () => {
    const reasons = ['APPLICATION_EXPLICITLY_CLOSED', 'SOURCE_UNLISTED', 'NATIVE_TEST_PUBLICATION', 'NATIVE_RECRUITMENT_EVENT',
      'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL', 'APPLICATION_HTTP_404', 'APPLICATION_HTTP_410', 'APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION',
      'WORKDAY_DETAIL_FETCH_FAILED', 'ICIMS_DETAIL_FETCH_FAILED', 'SCOPE_OUT_OF_PERIMETER', 'UNRECOGNISED_PROJECT_TYPE', 'SOMETHING_NEW'];
    for (const reason of reasons) {
      const kind = classifyHold(reason);
      const decided = kind === 'NATIVE_EVIDENCE' || kind === 'OUT_OF_PERIMETER';
      // L'employeur absent Workday est non bloquant au RUN mais reste à instruire au registre (certification du portail).
      if (reason === 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL') { expect(kind).toBe('DETAIL_INCOMPLETE'); continue; }
      expect(decided).toBe(retentionClass(reason) !== 'TO_INSTRUCT');
    }
  });

  it('classe un motif inconnu au plus prudent : illisible, ce qui n\'autorise rien', () => {
    expect(classifyHold('SOMETHING_WE_HAVE_NEVER_SEEN')).toBe('DETAIL_UNREADABLE');
  });
});

describe('les entrées du registre, telles que le script les écrit (`scripts/coverage/unverifiable-register.mts`)', () => {
  const now = new Date('2026-09-25T08:00:00Z');
  const hold = (reason: string): HoldRow => ({ sourceKey: 's', externalId: reason, reason, first_held_at: new Date('2026-09-24T18:00:00Z'),
    last_attempt: new Date('2026-09-24T18:00:00Z'), representation_active: false, representation_last_seen: null });
  const source = (sourceKey: string, row: Partial<BlockedSourceRow>): BlockedSourceRow => ({ sourceKey, status: 'DEGRADED', complete: null, truncated: false,
    errors: 0, declaredTotal: null, fetched: 10, previousJobs: 10, last_attempt: now, last_reliable_run: null, blocked_since: now, ...row });

  it('une exclusion de périmètre est la décision de l\'équipe, non bloquante ; une 404 est une preuve de la source', () => {
    const [scope, notFound] = registerEntries([hold('SCOPE_OUT_OF_PERIMETER'), hold('APPLICATION_HTTP_404')], [], now);
    expect(scope).toMatchObject({ kind: 'OUT_OF_PERIMETER', state: 'AWAITING_NEXT_RUN' });
    expect(scope!.nextAction).toContain('non bloquante au RUN (D-456 §2)');
    expect(notFound).toMatchObject({ kind: 'NATIVE_EVIDENCE', state: 'AWAITING_NEXT_RUN' });
  });

  it('une énumération non prouvée n\'est pas décrite comme une coupure ; une inconnue n\'est pas dite « non prouvée »', () => {
    const [picard, boots] = registerEntries([], [source('picard', { complete: false }), source('boots', { complete: null })], now);
    // picard : complete false, aucune coupure observée — le registre ne dit plus « le balayage n'a pas atteint la fin ».
    expect(picard).toMatchObject({ kind: 'LISTING_NOT_ENUMERATED' });
    expect(picard!.nextAction).toContain('énumération non prouvée');
    expect(picard!.nextAction).not.toMatch(/relever le plafond/);
    // boots : énumération inconnue, aucun défaut nommé — et pourtant aucun droit d'attester.
    expect(boots).toMatchObject({ reason: NO_NAMED_DEFECT, kind: 'ENUMERATION_UNKNOWN' });
    // Le RUN ne bloque pas sur une énumération inconnue : le registre ne la dit ni bloquante ni à instruire comme une coupure.
    expect(boots!.nextAction).toContain('Aucune au RUN');
    expect(`${boots!.nextAction} ${boots!.resolvedWhen}`).not.toMatch(/bloquant au RUN|coupure/);
    expect(boots!.blockedBy).toContain('Énumération inconnue (complete absent)');
    expect(boots!.blockedBy).not.toContain('non prouvée');
    expect(boots!.blockedBy).toContain('aucun droit d\'attester');
  });
});

describe('classement du blocage d\'une source', () => {
  it('un échec franc explique tout le reste et passe en premier', () => {
    // l-oreal-professionnel : BROKEN, 0 offre rendue sans erreur levée.
    expect(classifySourceBlock({ status: 'BROKEN', fetched: 0, previous: 1711 })).toBe('COLLECTION_FAILED');
    expect(classifySourceBlock({ status: 'CHALLENGED', fetched: 0 })).toBe('COLLECTION_FAILED');
    // knitwell-us-retail : 1 999/2 000 mais UNE erreur de collecte.
    expect(classifySourceBlock({ status: 'DEGRADED', errors: 1, declaredTotal: 2000, fetched: 1999 })).toBe('COLLECTION_FAILED');
  });

  it('une troncature est un listing non énuméré (ulta-jibe 9 964/9 966, tronqué)', () => {
    expect(classifySourceBlock({ status: 'DEGRADED', truncated: true, declaredTotal: 9966, fetched: 9964, errors: 0 })).toBe('LISTING_NOT_ENUMERATED');
    // oniverse : 483 sur 734 déclarées — sous le seuil de couverture.
    expect(classifySourceBlock({ status: 'DEGRADED', declaredTotal: 734, fetched: 483, errors: 0 })).toBe('LISTING_NOT_ENUMERATED');
  });

  it('un effondrement ne se lit qu\'une fois l\'échec et la troncature écartés (swatch-group 61 pour 275)', () => {
    expect(classifySourceBlock({ status: 'DEGRADED', complete: true, declaredTotal: 61, fetched: 61, errors: 0, previous: 275 })).toBe('VOLUME_COLLAPSED');
  });

  it('ne nomme aucun défaut de collecte quand la source a tout lu (tapestry 2 091/2 091) ou que l\'énumération est inconnue (boots)', () => {
    expect(classifySourceBlock({ status: 'DEGRADED', complete: true, declaredTotal: 2091, fetched: 2091, errors: 0, previous: 2086 })).toBeNull();
    const boots = { status: 'DEGRADED' as const, complete: undefined, fetched: 1472, errors: 0, previous: 1419 };
    expect(classifySourceBlock(boots)).toBeNull();
    // `null` n'est pas un droit d'attester : une énumération inconnue n'en ouvre aucun, référence stable ou non (règle du 11/09).
    expect(isTrustedForAttestation(boots)).toBe(false);
  });
});

describe('chaque situation porte un état, une ancienneté, une action et une condition de levée', () => {
  const firstHeldAt = new Date('2026-09-08T10:00:00Z');
  const now = new Date('2026-09-11T10:00:00Z');

  it('renseigne les six champs exigés, sans jamais en inventer un', () => {
    const e = describeUnverifiable({
      sourceKey: 'vf-corporation', externalId: 'R-12345', kind: 'DETAIL_INCOMPLETE',
      reason: 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL', firstHeldAt,
      lastAttemptAt: new Date('2026-09-10T18:19:51Z'), lastReliableObservationAt: new Date('2026-09-10T18:19:51Z'), now,
    });
    expect(e.ageDays).toBe(3);
    expect(e.nextAction).toContain('Instruire le défaut');
    expect(e.resolvedWhen).toContain('Le fait manquant est lu');
    // 3 jours n'EXCÈDE pas le délai de 3 jours : le cas reste à instruire, sans être encore en retard.
    expect(OVERDUE_DAYS.DETAIL_INCOMPLETE).toBe(3);
    expect(e.state).toBe('NEEDS_REVIEW');
    expect(e.lastReliableObservationAt).not.toBeNull();
  });

  it('une dernière observation FIABLE absente reste nulle : une tentative échouée ne la remplace jamais', () => {
    const e = describeUnverifiable({
      sourceKey: 'l-oreal-professionnel', kind: 'COLLECTION_FAILED', reason: 'BROKEN',
      firstHeldAt, lastAttemptAt: now, lastReliableObservationAt: null, now,
    });
    expect(e.lastAttemptAt).toEqual(now);
    expect(e.lastReliableObservationAt).toBeNull();
  });

  it('l\'ancienneté l\'emporte sur la nature : au-delà du délai, ce n\'est plus « en attente »', () => {
    const fresh = describeUnverifiable({
      sourceKey: 's', kind: 'DETAIL_UNREADABLE', reason: 'X',
      firstHeldAt: new Date('2026-09-10T10:00:00Z'), now,
    });
    expect(fresh.ageDays).toBe(1);
    expect(fresh.state).toBe('AWAITING_NEXT_RUN');

    const old = describeUnverifiable({
      sourceKey: 's', kind: 'DETAIL_UNREADABLE', reason: 'X',
      firstHeldAt: new Date('2026-08-20T10:00:00Z'), now,
    });
    expect(old.ageDays).toBeGreaterThan(OVERDUE_DAYS.DETAIL_UNREADABLE);
    expect(old.state).toBe('OVERDUE');
  });

  it('une décision de périmètre n\'est pas une anomalie en attente', () => {
    const e = describeUnverifiable({
      sourceKey: 'aptar-beauty', externalId: 'X', kind: 'OUT_OF_PERIMETER',
      reason: 'SCOPE_OUT_OF_PERIMETER', firstHeldAt, now,
    });
    expect(e.state).toBe('AWAITING_NEXT_RUN');
    expect(e.nextAction).toContain('Aucune');
  });
});

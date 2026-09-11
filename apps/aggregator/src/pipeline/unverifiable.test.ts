import { describe, expect, it } from 'vitest';

import { classifyHold, classifySourceBlock, describeUnverifiable, OVERDUE_DAYS } from './unverifiable.js';

/** Les motifs et les runs sont ceux réellement archivés en production le 2026-09-11 (lecture seule). */
describe('classement des retenues par NATURE, pas par libellé', () => {
  it('sépare un défaut TECHNIQUE d\'un fait manquant et d\'une contradiction de l\'éditeur', () => {
    expect(classifyHold('WORKDAY_DETAIL_FETCH_FAILED')).toBe('DETAIL_UNREADABLE');
    expect(classifyHold('APPLICATION_HTTP_404')).toBe('DETAIL_UNREADABLE');
    expect(classifyHold('WORKDAY_EMPLOYER_ABSENT_IN_DETAIL')).toBe('DETAIL_INCOMPLETE');
    expect(classifyHold('APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION')).toBe('PUBLISHER_CONTRADICTION');
    expect(classifyHold('APPLICATION_EXPLICITLY_CLOSED')).toBe('PUBLISHER_CONTRADICTION');
    expect(classifyHold('SCOPE_OUT_OF_PERIMETER')).toBe('OUT_OF_PERIMETER');
  });

  it('classe un motif inconnu au plus prudent : illisible, ce qui n\'autorise rien', () => {
    expect(classifyHold('SOMETHING_WE_HAVE_NEVER_SEEN')).toBe('DETAIL_UNREADABLE');
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

  it('ne bloque RIEN quand la source a tout lu (tapestry 2 091/2 091) ou que l\'énumération est simplement inconnue (boots)', () => {
    // C'est la correction du lot : ces deux sources étaient bloquées, elles ne le sont plus.
    expect(classifySourceBlock({ status: 'DEGRADED', complete: true, declaredTotal: 2091, fetched: 2091, errors: 0, previous: 2086 })).toBeNull();
    expect(classifySourceBlock({ status: 'DEGRADED', complete: undefined, fetched: 1472, errors: 0, previous: 1419 })).toBeNull();
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

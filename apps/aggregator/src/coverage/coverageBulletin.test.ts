import { describe, expect, it } from 'vitest';
import { evaluateCoverage, type EntityState, type HistoryRun } from './coverageAlert.js';
import { bulletinHtml, bulletinSubject, findingLines } from './coverageBulletin.js';
import { nextAlertSlot, percentile, type Indicator } from './loopIndicators.js';

/** R-143 §11, D-515 §4 — le bulletin dit, en clair : l'entité, la part perdue, la cause, l'action. */
const steady = (id: string, n: number): HistoryRun[] => Array.from({ length: 7 }, (_, i) =>
  ({ takenAt: new Date(Date.UTC(2026, 8, 24 + i, 18)), served: new Map([[id, n]]), alerts: new Map() }));
const runExits = (cause: 'NON_REVUE', count: number, sourceKey: string) => {
  const bucket = () => ({ counts: { [cause]: count }, sources: { [cause]: [{ sourceKey, count }] } });
  return { RUN: bucket(), LAST: bucket(), WINDOW: bucket() };
};
type Over = Partial<Omit<EntityState, 'exits'>> & Pick<EntityState, 'key' | 'served'> & { exits?: EntityState['exits'] };
const entity = (over: Over): EntityState => ({ scope: 'MAISON', label: over.key, threat: { count: 0, sources: [] }, ...over,
  exits: over.exits ?? { RUN: { counts: {}, sources: {} }, LAST: { counts: {}, sources: {} }, WINDOW: { counts: {}, sources: {} } } });
/** Intl fr-FR groupe les milliers par une espace fine insécable : comparée ici comme une espace. */
const plain = (text: string) => text.replace(/[\u202f\u00a0]/g, ' ');
const indicators: Indicator[] = [{ question: 1, title: 'Délai de découverte', value: 'médiane 17,3 h, p90 41,9 h', definition: 'd', denominator: '1 000 offres', measured: true }];

describe('le bulletin', () => {
  const hm = evaluateCoverage({ history: steady('MAISON:hm', 2839), knownSources: [], entities: [entity({ key: 'hm', label: 'H&M Group', served: 1935,
    before: 2839, exits: runExits('NON_REVUE', 904, 'hm-group') })] });
  const diptyque = evaluateCoverage({ history: [], knownSources: [], entities: [entity({ key: 'd', label: 'Diptyque', served: 186,
    threat: { count: 186, sources: [{ sourceKey: 'diptyque-workday', count: 186, status: 'ERROR', note: 'Access qualification refused — Transaction already closed',
      lastSeenAt: new Date('2026-09-30T16:43:00Z') }] } })] });

  it('dit la Maison, la part perdue, la cause et la source à vérifier', () => {
    const lines = findingLines(hm.findings[0]).map(plain);
    expect(lines[0]).toBe('Maison H&M Group · perte · masquée : une collecte crédible ne la liste plus · nouvelle');
    expect(lines[1]).toBe('904 offres servies en moins (31,8 %) : 1 935 contre 2 839 avant ce RUN');
    expect(lines[2]).toMatch(/^Source : hm-group \(904\) ; vérifier sur son site/);
  });
  it('une menace dit quand les offres seront masquées et comment relancer la collecte', () => {
    const lines = findingLines(diptyque.findings[0]).map(plain);
    expect(lines.join(' | ')).toContain('touche : Diptyque 186 (100 %)');
    expect(lines.join(' | ')).toContain('masquées à partir du 03/10 16:43 UTC si la collecte ne reprend pas');
    expect(lines.join(' | ')).toContain('relancer : ingest --source=diptyque-workday');
  });
  it('l’objet compte ce qui réveille, et seulement ce qui est nouveau', () => {
    expect(bulletinSubject(hm)).toBe('[Catwalks] Couverture : 1 à vérifier · boucle candidat');
    expect(bulletinSubject(evaluateCoverage({ history: [], knownSources: [], entities: [] }))).toBe('[Catwalks] Couverture : rien de nouveau à réparer ni à vérifier · boucle candidat');
    const closures = evaluateCoverage({ history: [], knownSources: [], entities: [entity({ key: 'sw', served: 32, before: 100,
      exits: { RUN: { counts: { FERMETURE_SOURCE: 68 }, sources: {} }, LAST: { counts: { FERMETURE_SOURCE: 68 }, sources: {} }, WINDOW: { counts: { FERMETURE_SOURCE: 68 }, sources: {} } } })] });
    expect(bulletinSubject(closures)).toBe('[Catwalks] Couverture : rien de nouveau à réparer ni à vérifier (1 pour information) · boucle candidat');
  });
  it('aucun tiret cadratin dans ce qui part (D-319), même venu du texte d’erreur d’une source', () => {
    const html = bulletinHtml(diptyque, indicators, { at: new Date('2026-10-01T18:25:00Z') });
    expect(html).not.toContain('—');
    expect(html).toContain('Access qualification refused, Transaction already closed');
  });
  it('en tête : ce que le RUN a retiré, les sources à traiter, ce qui reste masqué', () => {
    const html = plain(bulletinHtml(hm, indicators, { at: new Date('2026-10-01T18:25:00Z'), masked: { total: 904, maisons: [{ label: 'H&M Group', count: 904 }] } }));
    expect(html).toContain('Ce RUN a retiré 904 offres de l’expérience candidat : 904 masquée : une collecte crédible ne la liste plus.');
    expect(html).toContain('Sources à traiter : hm-group 904 (à vérifier).');
    expect(html).toContain('Masquées en ce moment : 904 offres ; par Maison : H&amp;M Group 904.');
  });
  it('chaque indicateur porte sa définition et son dénominateur', () => {
    const html = plain(bulletinHtml(hm, indicators, { at: new Date('2026-10-01T18:25:00Z') }));
    expect(html).toContain('1. Délai de découverte : médiane 17,3 h, p90 41,9 h');
    expect(html).toContain('Dénominateur : 1 000 offres');
  });
});

describe('le calendrier des alertes (D-498 : mardi et vendredi, 07:30 heure de Paris)', () => {
  it('une offre vue le vendredi soir attend le mardi matin', () => {
    expect(nextAlertSlot(new Date('2026-10-02T18:00:00Z')).toISOString()).toBe('2026-10-06T05:30:00.000Z');
  });
  it('vue le mardi à 05:00 UTC, elle part le jour même à 07:30 de Paris', () => {
    expect(nextAlertSlot(new Date('2026-10-06T05:00:00Z')).toISOString()).toBe('2026-10-06T05:30:00.000Z');
  });
  it('l’heure d’hiver est suivie (07:30 de Paris = 06:30 UTC le vendredi 30 octobre)', () => {
    expect(nextAlertSlot(new Date('2026-10-28T12:00:00Z')).toISOString()).toBe('2026-10-30T06:30:00.000Z');
  });
  it('percentile', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([], 0.9)).toBeNull();
  });
});

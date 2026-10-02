import { describe, expect, it } from 'vitest';
import { ANOMALY, attributeLoss, evaluateCoverage, habitualVariation, isAnomalous, newAlerts, referenceOf, referenceWindow, type EntityState,
  type Exits, type HistoryRun, type KnownSource, type LossCause, type SourceCount } from './coverageAlert.js';

/**
 * R-143 §11, D-516 §2 — l'alerte de couverture. Les chiffres sont ceux du rejeu sur l'historique réel
 * (`audits/2026-10-02/boucle-couverture/`). Chaque témoin échoue si la règle qu'il garde est retirée.
 */
const day = (d: number) => new Date(Date.UTC(2026, 8, 24 + d, 18));
const run = (d: number, served: Record<string, number>, alerts: Record<string, string> = {}): HistoryRun =>
  ({ takenAt: day(d), served: new Map(Object.entries(served)), alerts: new Map(Object.entries(alerts)) });
type Counts = Partial<Record<LossCause, number>>;
/** Sorties cumulées : celles de ce RUN comptent aussi depuis le dernier RUN et depuis la fenêtre. */
const exits = (by: { run?: Counts; last?: Counts; window?: Counts } = {}, sources: Partial<Record<LossCause, SourceCount[]>> = {}): Record<'RUN' | 'LAST' | 'WINDOW', Exits> => {
  const add = (...parts: Array<Counts | undefined>) => parts.reduce<Counts>((acc, part) => {
    for (const [cause, n] of Object.entries(part ?? {}) as Array<[LossCause, number]>) acc[cause] = (acc[cause] ?? 0) + n;
    return acc;
  }, {});
  return { RUN: { counts: add(by.run), sources }, LAST: { counts: add(by.run, by.last), sources }, WINDOW: { counts: add(by.run, by.last, by.window), sources } };
};
type Over = Partial<Omit<EntityState, 'exits'>> & Pick<EntityState, 'key' | 'served'> & { exits?: EntityState['exits'] };
const entity = (over: Over): EntityState => ({ scope: 'MAISON', label: over.key, threat: { count: 0, sources: [] }, ...over, exits: over.exits ?? exits() });
const steady = (id: string, n: number, runs = 7) => Array.from({ length: runs }, (_, i) => run(i, { [id]: n }));
/** Une habitude qui bouge : `n` puis `n - swing` en alternance, le dernier RUN à `n` (variation habituelle = `swing`). */
const swinging = (id: string, n: number, swing: number) => Array.from({ length: 7 }, (_, i) => run(i, { [id]: i % 2 ? n - swing : n }));

describe('la référence : la médiane des derniers RUN, jamais la seule veille', () => {
  it('un RUN raté la veille ne baisse pas la référence', () => {
    const history = [...steady('MAISON:hm', 2839, 6), run(6, { 'MAISON:hm': 0 })];
    expect(referenceOf(referenceWindow(history), 'MAISON:hm')).toEqual({ value: 2839, horizon: 'WINDOW' });
  });
  it('un catalogue qui grandit : le dernier RUN relève la médiane (Afrique du Sud, 83 puis 182)', () => {
    const history = [83, 82, 83, 130, 144, 181, 182].map((n, i) => run(i, { 'MARCHE:ZA': n }));
    expect(referenceOf(referenceWindow(history), 'MARCHE:ZA')).toEqual({ value: 182, horizon: 'LAST' });
  });
  it('au plus 7 RUN, et rien en dessous de 3', () => {
    expect(referenceWindow(steady('x', 1, 2))).toHaveLength(0);
    expect(referenceWindow(steady('x', 1, 12))).toHaveLength(7);
  });
});

describe('le premier RUN qui masque, sans aucune photographie : la perte de CE RUN se voit', () => {
  it('H&M, 904 masquées sur 2 839 au premier RUN de r6 : alerte, comparée à l’avant du RUN', () => {
    const e = evaluateCoverage({ history: [], knownSources: [], entities: [entity({ key: 'hm', served: 1935, before: 2839,
      exits: exits({ run: { NON_REVUE: 904 } }, { NON_REVUE: [{ sourceKey: 'hm-group', count: 904 }] }) })] });
    expect(e.referenceRuns).toBe(0);
    expect(e.findings).toEqual([expect.objectContaining({ kind: 'PERTE', basis: 'RUN', reference: 2839, lost: 904, gravity: 'A_VERIFIER' })]);
    expect(e.runExits).toEqual({ NON_REVUE: 904 });
  });
  it('la perte de ce RUN l’emporte sur l’habitude, même quand l’habitude est plus haute', () => {
    const e = evaluateCoverage({ history: steady('MAISON:m', 300), knownSources: [], entities: [entity({ key: 'm', served: 100, before: 200,
      exits: exits({ run: { NON_REVUE: 100 }, window: { FERMETURE_SOURCE: 100 } }) })] });
    expect(e.findings[0]).toMatchObject({ basis: 'RUN', reference: 200, lost: 100, cause: 'NON_REVUE' });
  });
});

describe('D-518 : une perte est anormale au regard de la variation habituelle de l’entité, la même règle pour toutes', () => {
  it('le réglage mesuré : k = 4, plancher de 5 offres, événement de masse à 40 Maisons', () => {
    expect(ANOMALY).toEqual({ k: 4, floor: 5, mass: 40 });
  });
  it('la variation habituelle est la médiane des écarts d’un RUN photographié au suivant ; rien sous 3 RUN', () => {
    const history = [889, 860, 900, 889, 856, 889, 889].map((n, i) => run(i, { 'MAISON:hermes': n }));
    // Écarts, du plus récent au plus ancien : 0, 33, 33, 11, 40, 29 -> médiane 31.
    expect(habitualVariation(referenceWindow(history), 'MAISON:hermes')).toBe(31);
    expect(habitualVariation(referenceWindow(steady('MAISON:x', 5, 2)), 'MAISON:x')).toBeNull();
  });
  it('anormal = au moins le plancher ET plus de k fois la variation habituelle ; sans habitude, le plancher seul', () => {
    expect(isAnomalous(4, 0)).toBe(false);
    expect(isAnomalous(5, 0)).toBe(true);
    expect(isAnomalous(130, 32.5)).toBe(false);
    expect(isAnomalous(131, 32.5)).toBe(true);
    expect(isAnomalous(5, null)).toBe(true);
  });
  const masked = (key: string, label: string, before: number, lost: number, history: HistoryRun[]) => evaluateCoverage({ history, knownSources: [],
    entities: [entity({ key, label, served: before - lost, before, exits: exits({ run: { NON_REVUE: lost } }, { NON_REVUE: [{ sourceKey: 'src', count: lost }] }) })] });
  it('Louis Vuitton, 160 masquées sur 800 (20 %), variation habituelle 10 : à vérifier (les seuils fixes ne disaient rien)', () => {
    expect(masked('lv', 'Louis Vuitton', 800, 160, swinging('MAISON:lv', 800, 10)).findings[0]).toMatchObject({ lost: 160, gravity: 'A_VERIFIER' });
  });
  it('Christian Dior Couture, 89 masquées sur 546 (16,3 %), variation habituelle 3 : à vérifier', () => {
    expect(masked('dior', 'Christian Dior Couture', 546, 89, swinging('MAISON:dior', 546, 3)).findings[0]).toMatchObject({ lost: 89, gravity: 'A_VERIFIER' });
  });
  it('H&M, qui bouge de 106 offres d’un RUN à l’autre, ne réveille pas pour 320 (les seuils fixes l’auraient fait, ≥ 200)', () => {
    expect(masked('hm', 'H&M Group', 2839, 320, swinging('MAISON:hm', 2839, 106.5)).findings).toEqual([]);
  });
  it('un marché suit la même règle : les États-Unis (variation 609) ne réveillent pas pour 600 ; la Hongrie (3,5) pour 40', () => {
    const us = evaluateCoverage({ history: swinging('MARCHE:US', 40556, 609.5), knownSources: [], entities: [entity({ scope: 'MARCHE', key: 'US', served: 39956,
      before: 40556, exits: exits({ run: { NON_REVUE: 600 } }) })] });
    expect(us.findings).toEqual([]);
    const hu = evaluateCoverage({ history: swinging('MARCHE:HU', 132, 3.5), knownSources: [], entities: [entity({ scope: 'MARCHE', key: 'HU', served: 92,
      before: 132, exits: exits({ run: { NON_REVUE: 40 } }) })] });
    expect(hu.findings[0]).toMatchObject({ scope: 'MARCHE', lost: 40, gravity: 'A_VERIFIER' });
  });
  it('aucune liste de Maisons : deux Maisons aux mêmes chiffres reçoivent le même verdict, quel que soit leur nom', () => {
    const a = masked('hermes', 'Hermès', 889, 215, swinging('MAISON:hermes', 889, 32.5)).findings[0];
    const b = masked('x', 'Une Maison inconnue', 889, 215, swinging('MAISON:x', 889, 32.5)).findings[0];
    expect({ ...a, key: '', label: '' }).toEqual({ ...b, key: '', label: '' });
  });
});

describe('l’événement de masse : dit une fois, en synthèse, puis les seules anomalies', () => {
  /** Le premier RUN de r6, table vide : des Maisons masquées pour non-revue (Hermès, Louis Vuitton, Dior parmi elles),
   * plus une collecte à réparer. */
  const LABELS = (count: number) => Array.from({ length: count }, (_, i) =>
    i === 7 ? 'Hermès' : i === 8 ? 'Louis Vuitton' : i === 15 ? 'Christian Dior Couture' : `Maison ${i}`);
  const maskedRun = (count: number) => [...LABELS(count).map((label, i) => entity({ key: label, label, served: 1000 - (400 - i * 8), before: 1000,
      exits: exits({ run: { NON_REVUE: 400 - i * 8 } }, { NON_REVUE: [{ sourceKey: `src-${i}`, count: 400 - i * 8 }] }) })),
    entity({ key: 'coach', label: 'Coach', served: 1798, before: 1927, exits: exits({ run: { COLLECTE: 129 } }, { COLLECTE: [{ sourceKey: 'tapestry', count: 129 }] }) })];
  it('45 Maisons masquées au premier RUN de r6 : une synthèse qui les garde toutes, puis la collecte à réparer', () => {
    const e = evaluateCoverage({ history: [], knownSources: [], entities: maskedRun(45) });
    expect(e.findings.map(f => f.kind)).toEqual(['PERTE', 'SYNTHESE']);
    expect(e.findings[0]).toMatchObject({ label: 'Coach', cause: 'COLLECTE', gravity: 'A_REPARER' });
    const synthesis = e.findings[1];
    expect(synthesis).toMatchObject({ scope: 'CATALOGUE', cause: 'NON_REVUE', gravity: 'A_VERIFIER', members: 45, ongoing: false,
      lost: LABELS(45).reduce((sum, _, i) => sum + 400 - i * 8, 0) });
    expect(synthesis.impacts!.map(i => i.label)).toEqual(LABELS(45));
    expect(newAlerts(e)).toHaveLength(2);
    // Chaque entité reste photographiée avec sa gravité : le RUN suivant reconnaît l'événement.
    expect(e.rows.filter(r => r.gravity === 'A_VERIFIER')).toHaveLength(45);
  });
  it('sous 40 Maisons, chaque perte anormale reste une alerte à part', () => {
    const e = evaluateCoverage({ history: [], knownSources: [], entities: maskedRun(39) });
    expect(e.findings.filter(f => f.kind === 'SYNTHESE')).toHaveLength(0);
    expect(e.findings.filter(f => f.kind === 'PERTE')).toHaveLength(40);
  });
  it('le même événement au RUN suivant est en cours : il ne réveille plus', () => {
    const served = Object.fromEntries(LABELS(45).map(label => [`MAISON:${label}`, 1000]));
    const history = [run(0, served), run(1, served), run(2, served, Object.fromEntries(LABELS(45).map(label => [`MAISON:${label}`, 'A_VERIFIER'])))];
    const e = evaluateCoverage({ history, knownSources: [], entities: maskedRun(45).slice(0, 45) });
    expect(e.findings).toEqual([expect.objectContaining({ kind: 'SYNTHESE', ongoing: true })]);
    expect(newAlerts(e)).toHaveLength(0);
  });
});

describe('la source se juge aussi sur son habitude (D-518 : « une source, une Maison ou un marché »)', () => {
  const source = (served: number, before: number, lost: number, cause: LossCause = 'NON_REVUE') => entity({ scope: 'SOURCE', key: 'wttj-sector', served, before,
    exits: exits({ run: { [cause]: lost } }, { [cause]: [{ sourceKey: 'wttj-sector', count: lost }] }) });
  const small = (key: string, lost: number) => entity({ key, served: 50 - lost, before: 50,
    exits: exits({ run: { NON_REVUE: lost } }, { NON_REVUE: [{ sourceKey: 'wttj-sector', count: lost }] }) });
  it('une source qui perd 40 offres réparties en dix Maisons de 4 (chacune sous le plancher) : à vérifier, à la source', () => {
    const e = evaluateCoverage({ history: [], knownSources: [], entities: [source(160, 200, 40), ...Array.from({ length: 10 }, (_, i) => small(`m${i}`, 4))] });
    expect(e.findings).toEqual([expect.objectContaining({ scope: 'SOURCE', key: 'wttj-sector', kind: 'PERTE', lost: 40, cause: 'NON_REVUE', gravity: 'A_VERIFIER' })]);
  });
  it('une source qui bouge habituellement de 50 offres ne réveille pas pour 40', () => {
    const e = evaluateCoverage({ history: swinging('SOURCE:wttj-sector', 200, 50), knownSources: [], entities: [source(160, 200, 40)] });
    expect(e.findings).toEqual([]);
  });
  it('une perte de source déjà dite par sa Maison n’est pas redite (Coach, 129 par tapestry)', () => {
    const coach = entity({ key: 'coach', label: 'Coach', served: 1798, before: 1927, exits: exits({ run: { COLLECTE: 129 } }, { COLLECTE: [{ sourceKey: 'tapestry', count: 129 }] }) });
    const tapestry = entity({ scope: 'SOURCE', key: 'tapestry', served: 1798, before: 1927, exits: exits({ run: { COLLECTE: 129 } }, { COLLECTE: [{ sourceKey: 'tapestry', count: 129 }] }) });
    const e = evaluateCoverage({ history: [], knownSources: [], entities: [coach, tapestry] });
    expect(e.findings.map(f => `${f.scope}:${f.key}`)).toEqual(['MAISON:coach']);
    // La source reste photographiée : son habitude se construit.
    expect(e.rows.find(r => r.scope === 'SOURCE' && r.key === 'tapestry')).toMatchObject({ served: 1798 });
  });
  it('une source menacée garde une seule ligne de photographie : ses offres servies, et la gravité de la menace', () => {
    const tapestry = entity({ scope: 'SOURCE', key: 's', served: 30 });
    const e = evaluateCoverage({ history: [], knownSources: [], entities: [tapestry, entity({ key: 'm', served: 30, threat: { count: 12, sources: [
      { sourceKey: 's', count: 12, status: 'ERROR', note: null, lastSeenAt: null }] } })] });
    expect(e.rows.filter(r => r.scope === 'SOURCE' && r.key === 's')).toEqual([expect.objectContaining({ served: 30, cause: 'COLLECTE', gravity: 'A_REPARER' })]);
  });
});

describe('la cause fait la gravité', () => {
  const history = steady('MAISON:m', 100);
  it('une fermeture prouvée par la source ne réveille personne, même massive (Swatch, D-508 §6)', () => {
    const e = evaluateCoverage({ history, knownSources: [], entities: [entity({ key: 'm', served: 32, before: 100, exits: exits({ run: { FERMETURE_SOURCE: 68 } }) })] });
    expect(e.findings).toHaveLength(1);
    expect(e.findings[0]).toMatchObject({ kind: 'PERTE', cause: 'FERMETURE_SOURCE', gravity: 'INFORMATION', lost: 68 });
    expect(newAlerts(e)).toHaveLength(0);
  });
  it('un masquage pour non-revue est à vérifier (H&M, 904 sur 2 839)', () => {
    const e = evaluateCoverage({ history: steady('MAISON:hm', 2839), knownSources: [], entities: [entity({ key: 'hm', served: 1935, before: 2839,
      exits: exits({ run: { NON_REVUE: 904 } }, { NON_REVUE: [{ sourceKey: 'hm-group', count: 904 }] }) })] });
    expect(e.findings[0]).toMatchObject({ cause: 'NON_REVUE', gravity: 'A_VERIFIER', lost: 904, sources: [{ sourceKey: 'hm-group', count: 904 }] });
  });
  it('le plafond de 72 h d’une collecte en échec est à réparer (Coach, 129 sur 1 927 par tapestry : 6,7 %)', () => {
    const e = evaluateCoverage({ history: steady('MAISON:coach', 1927), knownSources: [], entities: [entity({ key: 'coach', served: 1798, before: 1927, exits: exits({ run: { COLLECTE: 129 } }) })] });
    expect(e.findings[0]).toMatchObject({ cause: 'COLLECTE', gravity: 'A_REPARER', lost: 129 });
  });
  it('une petite Maison qui perd tout est à réparer dès le plancher (PICARD, 6 sur 6)', () => {
    const e = evaluateCoverage({ history: steady('MAISON:picard', 6), knownSources: [], entities: [entity({ key: 'picard', served: 0, before: 6, exits: exits({ run: { COLLECTE: 6 } }) })] });
    expect(e.findings[0]).toMatchObject({ cause: 'COLLECTE', gravity: 'A_REPARER', share: 1 });
  });
  it('sous le plancher, rien : une Maison de 4 offres qui les perd toutes ne réveille pas', () => {
    const e = evaluateCoverage({ history: steady('MAISON:m', 4), knownSources: [], entities: [entity({ key: 'm', served: 0, before: 4, exits: exits({ run: { COLLECTE: 4 } }) })] });
    expect(e.findings).toEqual([]);
  });
  it('une perte qu’aucune sortie n’explique est à réparer', () => {
    const e = evaluateCoverage({ history, knownSources: [], entities: [entity({ key: 'm', served: 50 })] });
    expect(e.findings[0]).toMatchObject({ cause: 'INEXPLIQUEE', gravity: 'A_REPARER', lost: 50 });
  });
  it('Nordstrom : 228 masquées par CE RUN, après des fermetures déjà absorbées par la référence : à vérifier, pas « fermeture »', () => {
    const e = evaluateCoverage({ history: steady('MAISON:n', 1538), knownSources: [], entities: [entity({ key: 'n', served: 1310, before: 1538,
      exits: exits({ run: { NON_REVUE: 228 }, window: { FERMETURE_SOURCE: 169 } }) })] });
    expect(e.findings[0]).toMatchObject({ basis: 'RUN', reference: 1538, lost: 228, cause: 'NON_REVUE', gravity: 'A_VERIFIER' });
  });
  it('une perte d’habitude surtout fermée, un masquage dans la variation habituelle : pour information', () => {
    const e = evaluateCoverage({ history: swinging('MAISON:n', 1538, 20), knownSources: [], entities: [entity({ key: 'n', served: 1310,
      exits: exits({ last: { FERMETURE_SOURCE: 169, NON_REVUE: 59 } }) })] });
    expect(e.findings[0]).toMatchObject({ basis: 'LAST', gravity: 'INFORMATION', cause: 'FERMETURE_SOURCE' });
  });
  it('les fermetures déjà absorbées par la référence ne diluent pas le masquage de ce RUN', () => {
    const e = evaluateCoverage({ history: steady('MAISON:n', 1538), knownSources: [], entities: [entity({ key: 'n', served: 1310, before: 1538,
      exits: exits({ run: { NON_REVUE: 228 }, window: { FERMETURE_SOURCE: 400 } }) })] });
    expect(e.findings[0]).toMatchObject({ basis: 'RUN', cause: 'NON_REVUE', gravity: 'A_VERIFIER', breakdown: [{ cause: 'NON_REVUE', count: 228 }] });
  });
  it('un masquage dominant mais non anormal à lui seul ne réveille pas : la perte est dite par sa cause normale', () => {
    const e = evaluateCoverage({ history: swinging('MAISON:m', 1000, 50), knownSources: [], entities: [entity({ key: 'm', served: 750,
      exits: exits({ last: { NON_REVUE: 150, FERMETURE_SOURCE: 100 } }) })] });
    expect(e.findings[0]).toMatchObject({ lost: 250, cause: 'FERMETURE_SOURCE', gravity: 'INFORMATION' });
  });
  it('doublons regroupés : pas une perte de couverture', () => {
    const e = evaluateCoverage({ history: steady('MAISON:s', 5768), knownSources: [], entities: [entity({ key: 's', served: 3884, before: 5768, exits: exits({ run: { REGROUPEE: 1884 } }) })] });
    expect(e.findings[0]).toMatchObject({ cause: 'REGROUPEE', gravity: 'INFORMATION' });
  });
});

describe('attributeLoss', () => {
  it('répartit la perte nette au prorata des sorties, le reste est inexpliqué', () => {
    expect(attributeLoss(10, { FERMETURE_SOURCE: 3, NON_REVUE: 1 })).toEqual([
      { cause: 'INEXPLIQUEE', count: 6 }, { cause: 'FERMETURE_SOURCE', count: 3 }, { cause: 'NON_REVUE', count: 1 }]);
    const parts = attributeLoss(100, { FERMETURE_SOURCE: 150, NON_REVUE: 60 });
    expect(parts.reduce((s, p) => s + p.count, 0)).toBe(100);
    expect(parts.find(p => p.cause === 'NON_REVUE')!.count).toBe(29);
  });
});

describe('les menaces : savoir avant le candidat, une alerte par source en échec', () => {
  const threatened = (key: string, served: number, count: number, sourceKey: string, scope: 'MAISON' | 'MARCHE' = 'MAISON') => entity({ scope, key, served,
    threat: { count, sources: [{ sourceKey, count, status: 'ERROR', note: 'Transaction already closed', lastSeenAt: new Date('2026-09-30T16:43:00Z') }] } });
  it('Diptyque, collecte en ERROR le 01/10 : 186 offres encore servies, masquées le 03/10 à 16:43', () => {
    const e = evaluateCoverage({ history: steady('MAISON:diptyque', 186), knownSources: [], entities: [threatened('diptyque', 186, 186, 'diptyque-workday')] });
    expect(e.findings).toHaveLength(1);
    expect(e.findings[0]).toMatchObject({ scope: 'SOURCE', key: 'diptyque-workday', kind: 'MENACE', cause: 'COLLECTE', gravity: 'A_REPARER', lost: 186 });
    expect(e.findings[0].sources[0].maskAt).toEqual(new Date('2026-10-03T16:43:00Z'));
    expect(e.findings[0].impacts).toEqual([{ scope: 'MAISON', label: 'diptyque', count: 186, share: 1 }]);
  });
  it('une source de groupe en échec : une seule alerte, ses Maisons touchées listées (urbn-hub)', () => {
    const e = evaluateCoverage({ history: [], knownSources: [], entities: [threatened('anthro', 521, 521, 'urbn-hub'), threatened('fp', 282, 282, 'urbn-hub')] });
    expect(e.findings).toHaveLength(1);
    expect(e.findings[0]).toMatchObject({ key: 'urbn-hub', lost: 803 });
    expect(e.findings[0].impacts!.map(i => i.label)).toEqual(['anthro', 'fp']);
  });
  it('une source sous le plancher ne réveille pas ; un marché n’est nommé que si sa part menacée est anormale pour lui', () => {
    const market = entity({ scope: 'MARCHE', key: 'US', served: 40000, threat: { count: 600, sources: [
      { sourceKey: 'petite', count: 3, status: 'BROKEN', note: null, lastSeenAt: null },
      { sourceKey: 'grande', count: 597, status: 'BROKEN', note: null, lastSeenAt: null }] } });
    const e = evaluateCoverage({ history: swinging('MARCHE:US', 40000, 609.5), knownSources: [], entities: [market, threatened('p', 50, 3, 'petite'), threatened('g', 900, 597, 'grande')] });
    expect(e.findings.map(f => f.key)).toEqual(['grande']);
    expect(e.findings[0].impacts!.map(i => i.label)).toEqual(['g']);
  });
  it('une source dont 4 offres seulement sont menacées ne réveille pas (sous le plancher)', () => {
    expect(evaluateCoverage({ history: [], knownSources: [], entities: [threatened('m', 14, 4, 's')] }).findings).toHaveLength(0);
  });
  it('la source se juge en entier : 12 offres menacées dans une Maison de 1 000 qui ne bouge pas réveillent (seuils fixes : rien)', () => {
    const e = evaluateCoverage({ history: steady('MAISON:m', 1000), knownSources: [], entities: [threatened('m', 1000, 12, 'petite-source')] });
    expect(e.findings).toEqual([expect.objectContaining({ kind: 'MENACE', key: 'petite-source', lost: 12, gravity: 'A_REPARER' })]);
  });
  it('une source de groupe répartie entre petites sociétés (capri-jimmy-choo, 45 offres en 16 + 14 + 15) : une alerte', () => {
    const e = evaluateCoverage({ history: [], knownSources: [], entities: [threatened('jc-ltd', 16, 16, 'capri-jimmy-choo'),
      threatened('jc-usa', 15, 14, 'capri-jimmy-choo'), threatened('jc-it', 15, 15, 'capri-jimmy-choo')] });
    expect(e.findings).toEqual([expect.objectContaining({ key: 'capri-jimmy-choo', lost: 45 })]);
  });
});

describe('les sources qualifiées qui ne servent rien', () => {
  const known = (over: Partial<KnownSource>): KnownSource => ({ sourceKey: 'ralph-lauren-avature', label: 'Ralph Lauren', status: 'PAUSED',
    qualified: 1160, served: 0, lastRunStatus: 'BROKEN', lastRunNote: 'HTTP 406', ...over });
  it('Ralph Lauren en pause : 1 160 lues, 0 servie, pour information', () => {
    const e = evaluateCoverage({ history: [], entities: [], knownSources: [known({})] });
    expect(e.findings[0]).toMatchObject({ kind: 'NON_SERVIE', cause: 'PAUSE_DECIDEE', gravity: 'INFORMATION', lost: 1160 });
  });
  it('une source active qui ne sert rien est à réparer (L’Oréal Professionnel, 1 716)', () => {
    const e = evaluateCoverage({ history: [], entities: [], knownSources: [known({ sourceKey: 'l-oreal-professionnel', status: 'ACTIVE', qualified: 1716 })] });
    expect(e.findings[0]).toMatchObject({ cause: 'COLLECTE', gravity: 'A_REPARER' });
  });
  it('une source qui sert, ou sous le plancher de 5, ne dit rien', () => {
    expect(evaluateCoverage({ history: [], entities: [], knownSources: [known({ served: 1 }), known({ qualified: 4 })] }).findings).toHaveLength(0);
  });
});

describe('nouvelle ou en cours : une alerte ne réveille qu’une fois', () => {
  it('la même perte au RUN suivant est en cours, et ne compte plus parmi les nouvelles', () => {
    const history = [...steady('MAISON:m', 100, 6), run(6, { 'MAISON:m': 40 }, { 'MAISON:m': 'A_VERIFIER' })];
    const e = evaluateCoverage({ history, knownSources: [], entities: [entity({ key: 'm', served: 40, exits: exits({ window: { NON_REVUE: 60 } }) })] });
    expect(e.findings[0]).toMatchObject({ ongoing: true, gravity: 'A_VERIFIER' });
    expect(newAlerts(e)).toHaveLength(0);
  });
  it('une escalade est nouvelle : pour information au RUN précédent, à réparer aujourd’hui', () => {
    const history = [...steady('MAISON:m', 100, 6), run(6, { 'MAISON:m': 100 }, { 'MAISON:m': 'INFORMATION' })];
    const e = evaluateCoverage({ history, knownSources: [], entities: [entity({ key: 'm', served: 40 })] });
    expect(e.findings[0]).toMatchObject({ gravity: 'A_REPARER', ongoing: false });
    expect(newAlerts(e)).toHaveLength(1);
  });
  it('la photographie porte l’alerte, pour que le RUN suivant la reconnaisse', () => {
    const e = evaluateCoverage({ history: steady('MAISON:m', 100), knownSources: [], entities: [entity({ key: 'm', served: 40, exits: exits({ last: { NON_REVUE: 60 } }) })] });
    expect(e.rows).toEqual([{ scope: 'MAISON', key: 'm', label: 'm', served: 40, reference: 100, cause: 'NON_REVUE', gravity: 'A_VERIFIER' }]);
  });
});

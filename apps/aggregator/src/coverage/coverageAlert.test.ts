import { describe, expect, it } from 'vitest';
import { attributeLoss, evaluateCoverage, newAlerts, referenceOf, referenceWindow, significantLoss, type EntityState, type Exits,
  type HistoryRun, type KnownSource, type LossCause, type SourceCount } from './coverageAlert.js';

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

describe('les seuils : relatif et plancher, plus un volume qui suffit seul', () => {
  it('Maison : 5 offres perdues sur 5 est significatif, 4 ne l’est pas', () => {
    expect(significantLoss('MAISON', 5, 5)).toBe(true);
    expect(significantLoss('MAISON', 4, 4)).toBe(false);
  });
  it('Maison : 29 % d’une grande Maison ne suffit pas sous 200 offres ; 1 189 sur 11 115 (Ulta, 10,7 %) suffit', () => {
    expect(significantLoss('MAISON', 199, 1000)).toBe(false);
    expect(significantLoss('MAISON', 1189, 11115)).toBe(true);
  });
  it('marché : 40 sur 132 (Hongrie, 30,3 %) significatif ; 24 sur 50 sous le plancher de 25', () => {
    expect(significantLoss('MARCHE', 40, 132)).toBe(true);
    expect(significantLoss('MARCHE', 24, 50)).toBe(false);
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
  it('le plafond de 72 h d’une collecte en échec est à réparer (PICARD, 6 sur 6)', () => {
    const e = evaluateCoverage({ history: steady('MAISON:picard', 6), knownSources: [], entities: [entity({ key: 'picard', served: 0, before: 6, exits: exits({ run: { COLLECTE: 6 } }) })] });
    expect(e.findings[0]).toMatchObject({ cause: 'COLLECTE', gravity: 'A_REPARER', share: 1 });
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
  it('une perte d’habitude surtout fermée, un peu masquée sous le seuil : pour information', () => {
    const e = evaluateCoverage({ history: steady('MAISON:n', 1538), knownSources: [], entities: [entity({ key: 'n', served: 1310,
      exits: exits({ last: { FERMETURE_SOURCE: 169, NON_REVUE: 59 } }) })] });
    expect(e.findings[0]).toMatchObject({ basis: 'LAST', gravity: 'INFORMATION', cause: 'FERMETURE_SOURCE' });
  });
  it('les fermetures déjà absorbées par la référence ne diluent pas le masquage de ce RUN', () => {
    const e = evaluateCoverage({ history: steady('MAISON:n', 1538), knownSources: [], entities: [entity({ key: 'n', served: 1310, before: 1538,
      exits: exits({ run: { NON_REVUE: 228 }, window: { FERMETURE_SOURCE: 400 } }) })] });
    expect(e.findings[0]).toMatchObject({ basis: 'RUN', cause: 'NON_REVUE', gravity: 'A_VERIFIER', breakdown: [{ cause: 'NON_REVUE', count: 228 }] });
  });
  it('un masquage dominant mais non significatif à lui seul ne réveille pas : la perte est dite par sa cause normale', () => {
    const e = evaluateCoverage({ history: steady('MAISON:m', 1000), knownSources: [], entities: [entity({ key: 'm', served: 750,
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
  it('chaque source est jugée sur sa part : 3 offres d’un grand marché ne sont pas imputées', () => {
    const market = entity({ scope: 'MARCHE', key: 'US', served: 40000, threat: { count: 600, sources: [
      { sourceKey: 'petite', count: 3, status: 'BROKEN', note: null, lastSeenAt: null },
      { sourceKey: 'grande', count: 597, status: 'BROKEN', note: null, lastSeenAt: null }] } });
    const e = evaluateCoverage({ history: [], knownSources: [], entities: [market] });
    expect(e.findings.map(f => f.key)).toEqual(['grande']);
  });
  it('une petite part d’une Maison sous le seuil ne réveille pas', () => {
    expect(evaluateCoverage({ history: [], knownSources: [], entities: [threatened('m', 100, 4, 's')] }).findings).toHaveLength(0);
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
  it('une source qui sert, ou sous le plancher de 10, ne dit rien', () => {
    expect(evaluateCoverage({ history: [], entities: [], knownSources: [known({ served: 1 }), known({ qualified: 9 })] }).findings).toHaveLength(0);
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

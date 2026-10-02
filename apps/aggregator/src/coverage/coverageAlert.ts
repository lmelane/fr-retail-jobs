/**
 * L'ALERTE DE COUVERTURE — R-143 §11, D-515 §5, D-516 §2 (02/10/2026). Pure : aucune lecture, aucune écriture.
 *
 * « À partir du moment où Catwalks masque automatiquement les offres douteuses, je veux qu'on soit alertés lorsqu'une
 * Maison ou un marché perd significativement de sa couverture… jamais sans visibilité sur ce qu'on perd. » (CEO, D-516)
 *
 * TROIS CONSTATS :
 *   · PERTE, de deux façons, la première l'emportant :
 *       - CE RUN : la Maison ou le marché sert nettement moins d'offres qu'AVANT les étapes qui retirent (refresh, revue
 *         de disponibilité, sonde) de ce même RUN. C'est le masquage au moment où il est posé, et il ne dépend d'aucun
 *         historique : le premier RUN qui masque le voit ;
 *       - D'HABITUDE : elle sert nettement moins que la MÉDIANE des derniers RUN photographiés (au plus
 *         `REFERENCE_RUNS`, au moins `MIN_REFERENCE_RUNS`), relevée au dernier RUN s'il est plus haut (`referenceOf`) :
 *         jamais la seule veille, un RUN raté ne la baisse pas ; une érosion hors des étapes du RUN s'y voit ;
 *   · MENACE : une part significative de ses offres servies n'a été revue par aucune collecte de ce RUN (collecte en
 *     échec, incomplète, ou source absente du RUN) : le plafond de 72 h les masquera si rien ne reprend. C'est ce qui
 *     fait savoir le trou AVANT qu'il touche le candidat. Une menace se rapporte à la SOURCE, avec les Maisons et
 *     marchés qu'elle touche ; anormale par sa cause, elle n'a que le plancher à franchir ;
 *   · NON SERVIE : une source qualifiée lit au moins `KNOWN_SOURCE_FLOOR` offres et n'en sert aucune.
 *
 * L'ANOMALIE (D-518 §2, 02/10/2026), LA MÊME POUR TOUTE MAISON, TOUT MARCHÉ, TOUTE SOURCE : aucune liste, aucun seuil
 * propre à une Maison. Une perte (ou une part menacée) est ANORMALE quand elle atteint le plancher `ANOMALY.floor` ET
 * dépasse `ANOMALY.k` fois la VARIATION HABITUELLE de l'entité (`habitualVariation` : la médiane des écarts d'un RUN
 * photographié au suivant, sur la fenêtre). Une Maison qui bouge de 300 offres par jour ne réveille pas pour 300 ; une
 * Maison qui ne bouge jamais réveille dès le plancher. Sans habitude mesurée (moins de `MIN_REFERENCE_RUNS` RUN
 * photographiés), le plancher seul : une habitude inconnue n'est jamais tenue pour normale (D-515 §1).
 *
 * L'ÉVÉNEMENT DE MASSE : quand au moins `ANOMALY.mass` Maisons perdent anormalement pour la MÊME cause au même RUN (le
 * premier masquage de r6 : 9 933 offres), le bulletin le dit UNE fois, en une synthèse (`kind: 'SYNTHESE'`) qui nomme
 * les Maisons et les marchés touchés, au lieu de quarante alertes ; les autres anomalies suivent, une par une.
 *
 * LA CAUSE FAIT LA GRAVITÉ (`CAUSE_GRAVITY`). Les offres sorties depuis l'instant de la référence retenue (avant ce RUN,
 * dernier RUN, ou début de la fenêtre) sont comptées par cause ; la perte nette est répartie au prorata, et ce qu'aucune
 * sortie n'explique est INEXPLIQUEE. Une perte n'alerte (`A_REPARER`, `A_VERIFIER`) que si sa part due aux causes qui
 * réveillent est elle-même significative ; une fermeture prouvée par la source, une retenue décidée, une pause décidée
 * ou un regroupement de doublons restent `INFORMATION` : listés au bulletin, ils ne réveillent personne.
 *
 * LE RÉGLAGE (`ANOMALY`) est mesuré : `audits/2026-10-02/alerte-anomalie-d518/README.md`.
 */

export const LOSS_CAUSES = ['COLLECTE', 'NON_REVUE', 'LIEN_MORT', 'FERMETURE_SOURCE', 'RETENUE_REGLE', 'PAUSE_DECIDEE', 'REGROUPEE'] as const;
export type LossCause = (typeof LOSS_CAUSES)[number];
export type AlertCause = LossCause | 'INEXPLIQUEE';
export type Gravity = 'A_REPARER' | 'A_VERIFIER' | 'INFORMATION';
/** Les entités dont la perte se juge : la Maison, le marché, et la source (ses offres servies, par source canonique). */
export type EntityScope = 'MAISON' | 'MARCHE' | 'SOURCE';
export type FindingKind = 'PERTE' | 'MENACE' | 'NON_SERVIE' | 'SYNTHESE';
/** Depuis quand une sortie est comptée : depuis l'avant de ce RUN, depuis le dernier RUN photographié, depuis la fenêtre. */
export const HORIZONS = ['RUN', 'LAST', 'WINDOW'] as const;
export type Horizon = (typeof HORIZONS)[number];

/** La gravité vient de la cause, jamais du volume. */
export const CAUSE_GRAVITY: Readonly<Record<AlertCause, Gravity>> = {
  COLLECTE: 'A_REPARER', INEXPLIQUEE: 'A_REPARER',
  NON_REVUE: 'A_VERIFIER', LIEN_MORT: 'A_VERIFIER',
  FERMETURE_SOURCE: 'INFORMATION', RETENUE_REGLE: 'INFORMATION', PAUSE_DECIDEE: 'INFORMATION', REGROUPEE: 'INFORMATION',
};
export const SEVERITY: Readonly<Record<Gravity, number>> = { A_REPARER: 2, A_VERIFIER: 1, INFORMATION: 0 };

/**
 * La règle d'anomalie, unique (D-518 §2) : anormal = au moins `floor` offres ET plus de `k` fois la variation habituelle
 * de l'entité ; au moins `mass` Maisons anormales pour une même cause au même RUN = un événement de masse, dit en une
 * synthèse. Mesures : `audits/2026-10-02/alerte-anomalie-d518/README.md`.
 */
export type AnomalyRule = { k: number; floor: number; mass: number };
export const ANOMALY: Readonly<AnomalyRule> = Object.freeze({ k: 4, floor: 5, mass: 40 });
export const REFERENCE_RUNS = 7;
export const MIN_REFERENCE_RUNS = 3;
/** Une source qualifiée qui ne sert rien : le même plancher que toute perte. */
export const KNOWN_SOURCE_FLOOR = ANOMALY.floor;

export type SourceCount = { sourceKey: string; count: number };
export type ThreatSource = SourceCount & { status: string; note: string | null; lastSeenAt: Date | null };
/** Sorties cumulées depuis un horizon, par cause, et les sources qui les portent (l'action). */
export type Exits = { counts: Partial<Record<LossCause, number>>; sources: Partial<Record<LossCause, SourceCount[]>> };
export type EntityState = {
  scope: EntityScope; key: string; label: string; served: number;
  /** Offres servies AVANT les étapes qui retirent de ce RUN ; absent hors RUN. */
  before?: number;
  /** Sorties cumulées : `RUN` (depuis l'avant de ce RUN) ⊂ `LAST` (depuis le dernier RUN photographié) ⊂ `WINDOW`. */
  exits: Record<Horizon, Exits>;
  /** Offres servies qu'aucune collecte de ce RUN n'a revues, venant toutes de sources actives. */
  threat: { count: number; sources: ThreatSource[] };
};
export type KnownSource = { sourceKey: string; label: string; status: string; qualified: number; served: number;
  validatedAt?: Date | null; lastRunStatus: string | null; lastRunNote: string | null };
/** Un RUN photographié : offres servies et gravité de l'alerte posée, par `${scope}:${key}` (Maisons fusionnées suivies). */
export type HistoryRun = { takenAt: Date; served: ReadonlyMap<string, number>; alerts: ReadonlyMap<string, string>;
  labels?: ReadonlyMap<string, string> };

export type FindingSource = SourceCount & { status?: string; note?: string | null; maskAt?: Date | null; url?: string | null };
export type CoverageFinding = {
  scope: EntityScope | 'CATALOGUE'; key: string; label: string; kind: FindingKind;
  served: number; reference: number | null; lost: number; share: number;
  /** PERTE : comparée à l'avant de ce RUN (`RUN`) ou à l'habitude (`LAST`, `WINDOW`). */
  basis?: Horizon;
  cause: AlertCause; gravity: Gravity; breakdown: Array<{ cause: AlertCause; count: number }>;
  sources: FindingSource[]; ongoing: boolean;
  /** MENACE : les Maisons touchées, et les marchés dont la part menacée est anormale. SYNTHESE : les Maisons, puis les
   * marchés, puis les sources, qui perdent anormalement pour cette cause, du plus touché au moins touché ; tous. */
  impacts?: Array<{ scope: EntityScope; label: string; count: number; share: number }>;
  /** SYNTHESE : le nombre de Maisons de l'événement. */
  members?: number;
};
export type SnapshotRow = { scope: EntityScope; key: string; label: string; served: number; reference: number | null;
  cause: AlertCause | null; gravity: Gravity | null };
export type CoverageEvaluation = { findings: CoverageFinding[]; rows: SnapshotRow[]; referenceRuns: number; windowStart: Date | null;
  /** Ce que les étapes de ce RUN ont retiré, par cause, toutes Maisons confondues ; null hors RUN. */
  runExits: Partial<Record<LossCause, number>> | null };

export const entityId = (scope: EntityScope, key: string) => `${scope}:${key}`;
export const emptyExits = (): Record<Horizon, Exits> => ({ RUN: { counts: {}, sources: {} }, LAST: { counts: {}, sources: {} }, WINDOW: { counts: {}, sources: {} } });

export function median(values: readonly number[]): number {
  if (!values.length) throw new Error('median of nothing');
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Les RUN de référence : les plus récents d'abord, au plus `REFERENCE_RUNS`. Rien en dessous de `MIN_REFERENCE_RUNS`. */
export function referenceWindow(history: readonly HistoryRun[]): HistoryRun[] {
  const recent = [...history].sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime()).slice(0, REFERENCE_RUNS);
  return recent.length >= MIN_REFERENCE_RUNS ? recent : [];
}

/**
 * La référence d'habitude : la médiane des offres servies sur la fenêtre (absente d'un RUN = 0 servie), relevée au
 * dernier RUN photographié s'il est plus haut. La médiane ignore un RUN raté ; le dernier RUN suit un catalogue qui
 * grandit (Afrique du Sud : 83 offres le 25/09, 182 le 01/10). Un creux de la veille ne baisse jamais la référence.
 * `horizon` dit depuis quand compter les sorties : le dernier RUN s'il fait la référence, sinon toute la fenêtre.
 */
export function referenceOf(window: readonly HistoryRun[], id: string): { value: number; horizon: Horizon } | null {
  if (!window.length) return null;
  const mid = median(window.map(run => run.served.get(id) ?? 0)), last = window[0].served.get(id) ?? 0;
  return last >= mid ? { value: last, horizon: 'LAST' } : { value: mid, horizon: 'WINDOW' };
}

/**
 * La variation habituelle d'une entité : la médiane des écarts absolus d'offres servies d'un RUN photographié au suivant,
 * sur la fenêtre. `null` sans fenêtre (moins de `MIN_REFERENCE_RUNS` RUN) : rien n'est encore mesuré.
 */
export function habitualVariation(window: readonly HistoryRun[], id: string): number | null {
  if (window.length < MIN_REFERENCE_RUNS) return null;
  const series = window.map(run => run.served.get(id) ?? 0);
  return median(series.slice(1).map((value, i) => Math.abs(series[i] - value)));
}

/** Anormal : au moins le plancher, et au-delà de `k` fois la variation habituelle quand elle est mesurée. */
export function isAnomalous(lost: number, variation: number | null, rule: AnomalyRule = ANOMALY): boolean {
  if (!(lost > 0) || lost < rule.floor) return false;
  return variation == null || lost > rule.k * variation;
}

/** Répartit `lost` au prorata des sorties (plus forts restes : la somme vaut exactement `min(lost, sorties)`). */
export function attributeLoss(lost: number, exits: Partial<Record<LossCause, number>>): Array<{ cause: AlertCause; count: number }> {
  const entries = LOSS_CAUSES.map(cause => ({ cause, n: Math.max(0, exits[cause] ?? 0) })).filter(e => e.n > 0);
  const total = entries.reduce((s, e) => s + e.n, 0);
  const explained = Math.min(Math.max(0, Math.round(lost)), total);
  const parts = entries.map(e => ({ cause: e.cause as AlertCause, exact: total ? (e.n * explained) / total : 0 }))
    .map(p => ({ ...p, count: Math.floor(p.exact) }));
  let rest = explained - parts.reduce((s, p) => s + p.count, 0);
  for (const p of [...parts].sort((a, b) => (b.exact - b.count) - (a.exact - a.count) || a.cause.localeCompare(b.cause))) {
    if (rest <= 0) break;
    p.count++; rest--;
  }
  const unexplained = Math.max(0, Math.round(lost) - explained);
  return [...parts.filter(p => p.count > 0).map(({ cause, count }) => ({ cause, count })),
    ...(unexplained > 0 ? [{ cause: 'INEXPLIQUEE' as const, count: unexplained }] : [])]
    .sort((a, b) => b.count - a.count || SEVERITY[CAUSE_GRAVITY[b.cause]] - SEVERITY[CAUSE_GRAVITY[a.cause]]);
}

const dominant = (parts: Array<{ cause: AlertCause; count: number }>) =>
  [...parts].sort((a, b) => b.count - a.count || SEVERITY[CAUSE_GRAVITY[b.cause]] - SEVERITY[CAUSE_GRAVITY[a.cause]])[0];

type Judge = { variation: number | null; rule: AnomalyRule };

function lossAgainst(entity: EntityState, reference: number, basis: Horizon, judge: Judge): CoverageFinding | null {
  const lost = Math.round(reference - entity.served);
  if (!(reference > 0) || !isAnomalous(lost, judge.variation, judge.rule)) return null;
  const exits = entity.exits[basis];
  const breakdown = attributeLoss(lost, exits.counts);
  const waking = breakdown.filter(p => CAUSE_GRAVITY[p.cause] !== 'INFORMATION');
  const wakingLost = waking.reduce((s, p) => s + p.count, 0);
  // Ce qui réveille ne l'emporte que s'il est anormal à lui seul ; sinon la perte est dite par sa cause normale.
  const informative = breakdown.filter(p => CAUSE_GRAVITY[p.cause] === 'INFORMATION');
  const wakes = waking.length > 0 && isAnomalous(wakingLost, judge.variation, judge.rule);
  const main = wakes ? dominant(waking) : dominant(informative.length ? informative : breakdown);
  const sources = main.cause === 'INEXPLIQUEE' ? [] : (exits.sources[main.cause] ?? []).slice(0, 3);
  return { scope: entity.scope, key: entity.key, label: entity.label, kind: 'PERTE', served: entity.served, reference, basis,
    lost, share: lost / reference, cause: main.cause, gravity: wakes ? CAUSE_GRAVITY[main.cause] : 'INFORMATION', breakdown, sources, ongoing: false };
}

/** La perte de CE RUN l'emporte : elle est le masquage au moment où il est posé, attribuée à ses seules sorties. */
function lossFinding(entity: EntityState, habit: { value: number; horizon: Horizon } | null, judge: Judge): { finding: CoverageFinding | null; reference: number | null } {
  const thisRun = entity.before != null ? lossAgainst(entity, entity.before, 'RUN', judge) : null;
  if (thisRun) return { finding: thisRun, reference: entity.before! };
  return { finding: habit ? lossAgainst(entity, habit.value, habit.horizon, judge) : null, reference: habit?.value ?? entity.before ?? null };
}

const CEILING_MS = 72 * 3_600_000;
/**
 * Les MENACES, une par source : l'action est la source à réparer, et une source de groupe touche plusieurs Maisons
 * (urbn-hub, le 30/09 : six Maisons ; capri-jimmy-choo, le 29/09 : 45 offres réparties entre des sociétés de moins de 20
 * offres chacune). Une collecte en échec est anormale par sa cause : la SOURCE est retenue dès que ses offres servies
 * menacées atteignent le plancher (chaque offre comptée une fois, par les Maisons). Les Maisons touchées sont toutes
 * nommées ; un marché ne l'est que si sa part menacée est anormale pour lui (3 offres des États-Unis ne disent rien).
 */
function threatFindings(entities: readonly EntityState[], window: readonly HistoryRun[], rule: AnomalyRule): CoverageFinding[] {
  const bySource = new Map<string, { status: string; note: string | null; lastSeenAt: Date | null; total: number;
    impacts: NonNullable<CoverageFinding['impacts']> }>();
  for (const entity of entities) {
    if (!entity.threat.count || entity.scope === 'SOURCE') continue;
    const id = entityId(entity.scope, entity.key);
    const base = Math.max(referenceOf(window, id)?.value ?? 0, entity.before ?? 0, entity.served);
    const variation = habitualVariation(window, id);
    for (const source of entity.threat.sources) {
      const acc = bySource.get(source.sourceKey) ?? { status: source.status, note: source.note, lastSeenAt: source.lastSeenAt, total: 0, impacts: [] };
      bySource.set(source.sourceKey, acc);
      if (entity.scope === 'MAISON') acc.total += source.count;
      if (source.lastSeenAt && (!acc.lastSeenAt || source.lastSeenAt < acc.lastSeenAt)) acc.lastSeenAt = source.lastSeenAt;
      // Chaque marché est jugé sur la part de CETTE source : quinze petites sources n'imputent rien à chacune.
      const named = entity.scope === 'MAISON' || (base > 0 && isAnomalous(source.count, variation, rule));
      if (named && base > 0) acc.impacts.push({ scope: entity.scope, label: entity.label, count: source.count, share: source.count / base });
    }
  }
  return [...bySource.entries()].filter(([, acc]) => acc.total >= rule.floor && acc.impacts.length > 0).map(([sourceKey, acc]) => {
    const impacts = acc.impacts.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return { scope: 'SOURCE' as const, key: sourceKey, label: sourceKey, kind: 'MENACE' as const, served: acc.total, reference: null,
      lost: acc.total, share: Math.max(...impacts.map(i => i.share)), cause: 'COLLECTE' as const, gravity: 'A_REPARER' as const,
      breakdown: [{ cause: 'COLLECTE' as const, count: acc.total }], impacts, ongoing: false,
      sources: [{ sourceKey, count: acc.total, status: acc.status, note: acc.note,
        maskAt: acc.lastSeenAt ? new Date(acc.lastSeenAt.getTime() + CEILING_MS) : null }] };
  });
}

function knownSourceFinding(source: KnownSource, rule: AnomalyRule): CoverageFinding | null {
  if (source.qualified < rule.floor || source.served > 0) return null;
  const cause: AlertCause = source.status === 'ACTIVE' ? 'COLLECTE' : 'PAUSE_DECIDEE';
  return { scope: 'SOURCE', key: source.sourceKey, label: source.label, kind: 'NON_SERVIE', served: 0, reference: source.qualified,
    lost: source.qualified, share: 1, cause, gravity: CAUSE_GRAVITY[cause], breakdown: [{ cause, count: source.qualified }],
    sources: [{ sourceKey: source.sourceKey, count: source.qualified, status: source.lastRunStatus ?? source.status, note: source.lastRunNote }],
    ongoing: false };
}

const ORDER: Readonly<Record<FindingKind, number>> = { SYNTHESE: -1, MENACE: 0, PERTE: 1, NON_SERVIE: 2 };

/** Les sources de plusieurs constats, sommées, les plus lourdes d'abord. */
function mergeSources(findings: readonly CoverageFinding[], limit: number): FindingSource[] {
  const acc = new Map<string, number>();
  for (const f of findings) for (const s of f.sources) acc.set(s.sourceKey, (acc.get(s.sourceKey) ?? 0) + s.count);
  return [...acc.entries()].map(([sourceKey, count]) => ({ sourceKey, count }))
    .sort((a, b) => b.count - a.count || a.sourceKey.localeCompare(b.sourceKey)).slice(0, limit);
}

/**
 * L'événement de masse : au moins `rule.mass` Maisons perdent anormalement pour la même cause. Leurs constats (Maisons,
 * marchés et sources de cette cause) deviennent UNE synthèse, qui les garde TOUS (D-516 §2 : rien de masqué sans être dit) ; elle est « en cours » si tous l'étaient déjà. Les photographies
 * gardent chaque entité et sa gravité : le RUN suivant reconnaît l'événement, entité par entité.
 */
function massEvents(findings: readonly CoverageFinding[], rule: AnomalyRule): CoverageFinding[] {
  const byCause = new Map<AlertCause, CoverageFinding[]>();
  for (const f of findings) if (f.kind === 'PERTE') byCause.set(f.cause, [...(byCause.get(f.cause) ?? []), f]);
  const folded = new Set<CoverageFinding>();
  const events: CoverageFinding[] = [];
  for (const [cause, members] of byCause) {
    const maisons = members.filter(f => f.scope === 'MAISON').sort((a, b) => b.lost - a.lost || a.label.localeCompare(b.label));
    if (maisons.length < rule.mass) continue;
    const byLoss = (scope: EntityScope) => members.filter(f => f.scope === scope).sort((a, b) => b.lost - a.lost || a.label.localeCompare(b.label));
    const markets = byLoss('MARCHE'), sources = byLoss('SOURCE');
    for (const f of members) folded.add(f);
    const lost = maisons.reduce((s, f) => s + f.lost, 0), reference = maisons.reduce((s, f) => s + (f.reference ?? 0), 0);
    const gravity = members.map(f => f.gravity).sort((a, b) => SEVERITY[b] - SEVERITY[a])[0];
    events.push({ scope: 'CATALOGUE', key: cause, label: 'Catalogue', kind: 'SYNTHESE', served: reference - lost, reference, lost,
      share: reference > 0 ? lost / reference : 0, cause, gravity, breakdown: [{ cause, count: lost }],
      sources: mergeSources(maisons, 5), ongoing: members.every(f => f.ongoing), members: maisons.length,
      impacts: [...maisons, ...markets, ...sources].map(f => ({ scope: f.scope as EntityScope, label: f.label, count: f.lost, share: f.share })) });
  }
  return [...events, ...findings.filter(f => !folded.has(f))];
}

/**
 * « En cours » : le RUN photographié le plus récent portait déjà, pour la même entité, une alerte AU MOINS aussi grave.
 * Une escalade (pour information hier, à réparer aujourd'hui) est nouvelle. Une photographie ancienne qui ne porte que la
 * cause (sans gravité) vaut la gravité de cette cause.
 */
function isOngoing(last: HistoryRun | undefined, id: string, gravity: Gravity): boolean {
  const previous = last?.alerts.get(id);
  if (!previous) return false;
  const level = (Object.hasOwn(SEVERITY, previous) ? SEVERITY[previous as Gravity]
    : Object.hasOwn(CAUSE_GRAVITY, previous) ? SEVERITY[CAUSE_GRAVITY[previous as AlertCause]] : -1);
  return level >= SEVERITY[gravity];
}

/** Le verdict d'un RUN. `history` = les RUN photographiés AVANT celui-ci. */
export function evaluateCoverage(input: { entities: readonly EntityState[]; knownSources: readonly KnownSource[];
  history: readonly HistoryRun[]; rule?: AnomalyRule }): CoverageEvaluation {
  const rule = input.rule ?? ANOMALY;
  const window = referenceWindow(input.history);
  const last = [...input.history].sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())[0];
  let findings: CoverageFinding[] = [];
  const rows: SnapshotRow[] = [];
  /** Une ligne par entité : une menace ou une source non servie s'inscrit sur la ligne de sa source, la plus grave l'emporte. */
  const mark = (row: SnapshotRow) => {
    const existing = rows.find(r => r.scope === row.scope && r.key === row.key);
    if (!existing) { rows.push(row); return; }
    if (row.gravity && (!existing.gravity || SEVERITY[row.gravity] > SEVERITY[existing.gravity])) Object.assign(existing, { cause: row.cause, gravity: row.gravity });
  };
  // Une Maison, un marché ou une source photographiés qui ne servent plus rien et dont aucune sortie n'est connue est quand même jugé :
  // sa disparition entière est la pire des pertes, pas une absence de ligne.
  const present = new Set(input.entities.map(e => entityId(e.scope, e.key)));
  const vanished: EntityState[] = [];
  for (const run of window) for (const id of run.served.keys()) {
    const [scope, ...rest] = id.split(':');
    if ((scope !== 'MAISON' && scope !== 'MARCHE' && scope !== 'SOURCE') || present.has(id)) continue;
    present.add(id);
    const key = rest.join(':');
    vanished.push({ scope, key, label: window.map(r => r.labels?.get(id)).find(Boolean) ?? key, served: 0, exits: emptyExits(),
      threat: { count: 0, sources: [] } });
  }
  for (const entity of [...input.entities, ...vanished]) {
    const id = entityId(entity.scope, entity.key);
    const { finding, reference } = lossFinding(entity, referenceOf(window, id), { variation: habitualVariation(window, id), rule });
    if (finding) findings.push({ ...finding, ongoing: isOngoing(last, id, finding.gravity) });
    if (entity.served > 0 || finding) mark({ scope: entity.scope, key: entity.key, label: entity.label, served: entity.served,
      reference: reference == null ? null : Math.round(reference), cause: finding?.cause ?? null, gravity: finding?.gravity ?? null });
  }
  // Une perte de source déjà dite par ses Maisons (même cause, cette source nommée pour au moins autant d'offres) n'est
  // pas redite : la source n'est signalée à part que si sa perte se disperse sous le niveau d'anomalie de ses Maisons.
  findings = findings.filter(f => {
    if (f.scope !== 'SOURCE' || f.kind !== 'PERTE') return true;
    const maisons = findings.filter(m => m.scope === 'MAISON' && m.kind === 'PERTE' && m.cause === f.cause);
    // Une source qui n'a qu'une Maison la reflète exactement, même sans source nommée (perte inexpliquée).
    if (maisons.some(m => m.lost === f.lost && m.reference === f.reference)) return false;
    return maisons.reduce((sum, m) => sum + (m.sources.find(src => src.sourceKey === f.key)?.count ?? 0), 0) < f.lost;
  });
  for (const threat of threatFindings(input.entities, window, rule)) {
    findings.push({ ...threat, ongoing: isOngoing(last, entityId('SOURCE', threat.key), threat.gravity) });
    mark({ scope: 'SOURCE', key: threat.key, label: threat.label, served: 0, reference: null, cause: threat.cause, gravity: threat.gravity });
  }
  for (const source of input.knownSources) {
    const finding = knownSourceFinding(source, rule);
    // Une source déjà dite (menace, ou perte de toutes ses offres) ne l'est pas deux fois.
    if (!finding || findings.some(f => f.scope === 'SOURCE' && f.key === source.sourceKey)) continue;
    findings.push({ ...finding, ongoing: isOngoing(last, entityId('SOURCE', source.sourceKey), finding.gravity) });
    mark({ scope: 'SOURCE', key: source.sourceKey, label: source.label, served: 0, reference: source.qualified,
      cause: finding.cause, gravity: finding.gravity });
  }
  findings = massEvents(findings, rule);
  findings.sort((a, b) => SEVERITY[b.gravity] - SEVERITY[a.gravity] || Number(a.ongoing) - Number(b.ongoing)
    || ORDER[a.kind] - ORDER[b.kind] || b.lost - a.lost || a.key.localeCompare(b.key));
  const windowStart = window.length ? window[window.length - 1].takenAt : null;
  const inRun = input.entities.some(e => e.before != null);
  const runExits: Partial<Record<LossCause, number>> = {};
  if (inRun) for (const e of input.entities) if (e.scope === 'MAISON') {
    for (const [cause, n] of Object.entries(e.exits.RUN.counts) as Array<[LossCause, number]>) runExits[cause] = (runExits[cause] ?? 0) + n;
  }
  return { findings, rows, referenceRuns: window.length, windowStart, runExits: inRun ? runExits : null };
}

/** Ce qui réveille : une alerte `A_REPARER` ou `A_VERIFIER` qui n'était pas déjà posée, au moins aussi grave, au RUN précédent. */
export function newAlerts(evaluation: CoverageEvaluation): CoverageFinding[] {
  return evaluation.findings.filter(f => f.gravity !== 'INFORMATION' && !f.ongoing);
}

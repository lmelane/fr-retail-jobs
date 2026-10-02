/**
 * Rejeu de l'alerte de couverture réglée par anomalie (D-518 §2) sur l'historique réel. HORS LIGNE : il ne lit que les
 * extraits produits en lecture seule le 02/10/2026 (`../boucle-couverture/historique.json.gz`, `a-blanc.json.gz`, et
 * `historique-sources.json.gz` : les mêmes offres servies et sorties avec leur source canonique, pour juger les sources)
 * et la mesure des fermetures Swatch de D-508 §6, et passe chaque scène par le code même du RUN (`evaluateCoverage`).
 * Les RUN quotidiens lisent `historique-sources` (13:46 UTC) ; les scènes du 02/10 lisent la mesure de 11:03-11:57.
 *
 *   npx tsx audits/2026-10-02/alerte-anomalie-d518/rejeu.mts > audits/2026-10-02/alerte-anomalie-d518/rejeu.out
 *
 * Scènes : les RUN quotidiens depuis le 23/09 (photographies reconstruites, chacun jugé sur ceux d'avant) ; la mesure du
 * 02/10 avec les sources qualifiées qui ne servent rien ; le premier masquage de R-143 §2 (à blanc) au premier RUN de r6,
 * table des photographies VIDE, puis le même masquage avec 7 RUN d'habitude ; les 68 fermetures Swatch. Puis le
 * calibrage : k, plancher et seuil de masse, mêmes scènes.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ANOMALY, evaluateCoverage, newAlerts, entityId, referenceWindow, HORIZONS, emptyExits, type AnomalyRule, type Horizon,
  type EntityState, type HistoryRun, type KnownSource, type LossCause, type CoverageEvaluation, type EntityScope } from '../../../apps/aggregator/src/coverage/coverageAlert.js';
import { canonicalCompany, marketLabel, marketOf, withdrawalCause } from '../../../apps/aggregator/src/coverage/coverageReading.js';
import { findingLines } from '../../../apps/aggregator/src/coverage/coverageBulletin.js';

const dir = new URL('../boucle-couverture/', import.meta.url);
type Bloc = { bloc: string; lignes: any[]; mesure?: string };
function blocs(url: URL): Record<string, Bloc> {
  const out: Record<string, Bloc> = {};
  const text = gunzipSync(readFileSync(url)).toString('utf8');
  for (const part of text.trim().split(/\n(?=\{"bloc")/)) { const b = JSON.parse(part) as Bloc; out[b.bloc] = b; }
  return out;
}
const h = blocs(new URL('historique.json.gz', dir)), blanc = blocs(new URL('a-blanc.json.gz', dir)).a_blanc;
const hs = blocs(new URL('./historique-sources.json.gz', import.meta.url));
const swatchCsv = readFileSync(new URL('../d508-swatch-fermeture/fermetures-a-blanc.csv', import.meta.url), 'utf8');
const utcDate = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
const merges = new Map<string, string>(h.societes.lignes.filter(c => c.fusion).map(c => [c.id, c.fusion]));
const names = new Map<string, string>(h.societes.lignes.map(c => [c.id, c.name]));
const runs = h.runs.lignes.map(r => ({ id: r.id as string, t: utcDate(r.t), debut: utcDate(r.debut ?? r.t), status: r.status as string }));

function cellsOf(c: string, p: string, s?: string | null): Array<{ scope: EntityScope; key: string; label: string }> {
  const maison = canonicalCompany(merges, c), market = marketOf(p);
  return [{ scope: 'MAISON', key: maison, label: names.get(maison) ?? maison },
    ...(market ? [{ scope: 'MARCHE' as const, key: market, label: marketLabel(market) }] : []),
    ...(s ? [{ scope: 'SOURCE' as const, key: s, label: s }] : [])];
}
class Builder {
  map = new Map<string, EntityState>();
  removed = new Map<EntityState, number>();
  get(c: string, p: string, s?: string | null) {
    return cellsOf(c, p, s).map(e => {
      const id = entityId(e.scope, e.key);
      if (!this.map.has(id)) this.map.set(id, { ...e, served: 0, exits: emptyExits(), threat: { count: 0, sources: [] } });
      return this.map.get(id)!;
    });
  }
  serve(c: string, p: string, n: number, s?: string | null) { for (const e of this.get(c, p, s)) e.served += n; }
  before(c: string, p: string, n: number, s?: string | null) { for (const e of this.get(c, p, s)) this.removed.set(e, (this.removed.get(e) ?? 0) + n); }
  startBefore() { for (const e of this.map.values()) e.before = e.served + (this.removed.get(e) ?? 0); }
  exit(c: string, p: string, cause: LossCause, source: string, h: Horizon, n: number, s?: string | null) {
    for (const e of this.get(c, p, s)) for (const horizon of HORIZONS.slice(HORIZONS.indexOf(h))) {
      const bucket = e.exits[horizon];
      bucket.counts[cause] = (bucket.counts[cause] ?? 0) + n;
      const list = bucket.sources[cause] ??= [];
      const row = list.find(s => s.sourceKey === source);
      if (row) row.count += n; else list.push({ sourceKey: source, count: n });
      list.sort((a, b) => b.count - a.count);
    }
  }
  threat(c: string, p: string, source: string, status: string, note: string | null, n: number, seen: Date | null) {
    for (const e of this.get(c, p)) {
      e.threat.count += n;
      const row = e.threat.sources.find(s => s.sourceKey === source);
      if (row) row.count += n; else e.threat.sources.push({ sourceKey: source, status, note, count: n, lastSeenAt: seen });
    }
  }
}
/** `withSources` : la source canonique de chaque offre (extrait `historique-sources`), pour juger aussi les sources. */
function servedOf(runId: string, b: Builder, withSources = false) {
  for (const r of (withSources ? hs : h).servies.lignes) if (r.run === runId) b.serve(r.c, r.p, r.n, withSources ? r.s : null);
}
function exitsBetween(bounds: { run?: Date | null; last?: Date | null; window?: Date | null }, until: Date, b: Builder, intoBefore = false, withSources = false) {
  const since = [bounds.run, bounds.last, bounds.window].filter((d): d is Date => !!d).sort((x, y) => x.getTime() - y.getTime())[0];
  if (!since) return;
  for (const r of (withSources ? hs : h).sorties.lignes) {
    const at = utcDate(r.at);
    if (at < since || at > until) continue;
    const horizon: Horizon = bounds.run && at >= bounds.run ? 'RUN' : bounds.last && at >= bounds.last ? 'LAST' : 'WINDOW';
    const cause = r.type === 'CLOSED' ? 'FERMETURE_SOURCE' : withdrawalCause(r.motif);
    const s = withSources ? r.s : null;
    if (cause) b.exit(r.c, r.p, cause, s ?? 'evenement', horizon, 1, s);
    if (intoBefore && horizon === 'RUN') b.before(r.c, r.p, 1, s);
  }
}
const toHistory = (entities: readonly EntityState[], takenAt: Date, evaluation: CoverageEvaluation): HistoryRun => ({ takenAt,
  served: new Map(entities.map(e => [entityId(e.scope, e.key), e.served])),
  alerts: new Map(evaluation.rows.filter(r => r.gravity).map(r => [entityId(r.scope, r.key), r.gravity!])) });

/** Une scène : des entités et l'historique photographié avant elles. Les photographies des RUN quotidiens dépendent de la
 * règle (une alerte posée la veille est « en cours ») : elles sont recalculées pour chaque réglage. */
type Scene = { label: string; entities: EntityState[]; knownSources: KnownSource[] };
const known: KnownSource[] = h.sources_connues.lignes.filter(s => ['ACTIVE', 'PAUSED'].includes(s.status)).map(s => ({ sourceKey: s.source,
  label: s.maison, status: s.status, qualified: s.qualifiees, served: s.servies, lastRunStatus: null, lastRunNote: null }));

function dailyScenes(): Array<Scene & { at: Date; build: (window: HistoryRun[]) => EntityState[] }> {
  return runs.filter(r => r.id !== 'maintenant').map(run => ({ label: `RUN ${run.t.toISOString().slice(0, 10)} ${run.id.slice(0, 8)} (${run.status})`,
    at: run.t, entities: [], knownSources: [],
    build: (window: HistoryRun[]) => {
      const b = new Builder();
      servedOf(run.id, b, true);
      exitsBetween({ run: run.debut, last: window[0]?.takenAt, window: window[window.length - 1]?.takenAt }, run.t, b, true, true);
      b.startBefore();
      for (const m of h.menaces.lignes) if (m.run === run.id) b.threat(m.c, m.p, m.source, m.statut, m.note, m.n, m.vu ? utcDate(m.vu) : null);
      return [...b.map.values()];
    } }));
}
/** Les RUN quotidiens, un par un, chacun jugé sur les RUN photographiés avant lui, sous `rule`. */
function replayDaily(rule: AnomalyRule) {
  const history: HistoryRun[] = [];
  const out: Array<{ label: string; evaluation: CoverageEvaluation }> = [];
  for (const scene of dailyScenes()) {
    const entities = scene.build(referenceWindow(history));
    const evaluation = evaluateCoverage({ entities, knownSources: [], history, rule });
    out.push({ label: scene.label, evaluation });
    history.push(toHistory(entities, scene.at, evaluation));
  }
  return { history, out };
}
const nowRun = runs.find(r => r.id === 'maintenant')!;
function nowEntities(history: HistoryRun[]): EntityState[] {
  const b = new Builder();
  servedOf('maintenant', b);
  const window = referenceWindow(history);
  exitsBetween({ last: window[0]?.takenAt, window: window[window.length - 1]?.takenAt }, nowRun.t, b);
  return [...b.map.values()];
}
/** Le premier masquage de R-143 §2 à blanc : les offres masquées quittent la photographie, attribuées à leur cause. */
function maskedEntities(history: HistoryRun[]): { entities: EntityState[]; masked: number } {
  const b = new Builder();
  let masked = 0;
  for (const r of blanc.lignes) {
    b.serve(r.c, r.p, r.servies - r.non_revue - r.plafond_seul, r.source);
    b.before(r.c, r.p, r.non_revue + r.plafond_seul, r.source);
    if (r.non_revue) b.exit(r.c, r.p, 'NON_REVUE', r.source, 'RUN', r.non_revue, r.source);
    if (r.plafond_seul) b.exit(r.c, r.p, 'COLLECTE', r.source, 'RUN', r.plafond_seul, r.source);
    masked += r.non_revue + r.plafond_seul;
  }
  b.startBefore();
  const window = referenceWindow(history);
  if (window.length) exitsBetween({ last: window[0].takenAt, window: window[window.length - 1].takenAt }, utcDate(blanc.mesure!), b, false, true);
  return { entities: [...b.map.values()], masked };
}
/** Les 68 fermetures Swatch de D-508 §6, posées sur la mesure du 02/10. */
function swatchEntities(history: HistoryRun[]): { entities: EntityState[]; closed: number } {
  const b = new Builder();
  servedOf('maintenant', b);
  const window = referenceWindow(history);
  exitsBetween({ last: window[0].takenAt, window: window[window.length - 1].takenAt }, nowRun.t, b);
  const idsByName = new Map<string, string[]>();
  for (const [id, name] of names) idsByName.set(name, [...(idsByName.get(name) ?? []), id]);
  const servedIds = new Set(h.servies.lignes.filter(r => r.run === 'maintenant').map(r => r.c));
  let closed = 0;
  for (const line of swatchCsv.trim().split('\n').slice(1)) {
    const cols: string[] = [];
    let cell = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted && ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cols.push(cell); cell = ''; }
      else cell += ch;
    }
    cols.push(cell);
    const id = (idsByName.get(cols[2]) ?? []).find(x => servedIds.has(x));
    if (!id) continue;
    b.serve(id, cols[4], -1);
    b.before(id, cols[4], 1);
    b.exit(id, cols[4], 'FERMETURE_SOURCE', 'swatch-group', 'RUN', 1);
    closed++;
  }
  b.startBefore();
  return { entities: [...b.map.values()], closed };
}

const waking = (e: CoverageEvaluation) => e.findings.filter(f => f.gravity !== 'INFORMATION');
function show(title: string, evaluation: CoverageEvaluation, limit = 12) {
  const fresh = newAlerts(evaluation);
  console.log(`\n## ${title}`);
  console.log(`référence : ${evaluation.referenceRuns} RUN ; alertes qui réveillent : ${waking(evaluation).length} (nouvelles ${fresh.length}, à réparer ${fresh.filter(f => f.gravity === 'A_REPARER').length}, à vérifier ${fresh.filter(f => f.gravity === 'A_VERIFIER').length}) ; pour information : ${evaluation.findings.length - waking(evaluation).length}`);
  for (const f of evaluation.findings.slice(0, limit)) console.log(`- [${f.gravity}] ${findingLines(f).join(' | ')}`);
}

/** Tout le rejeu sous une règle : le bruit, les cas attendus. */
function measure(rule: AnomalyRule, print = false) {
  const { history, out } = replayDaily(rule);
  if (print) for (const { label, evaluation } of out) show(label, evaluation, 8);
  const last7 = out.slice(-7);
  const noise = last7.map(({ evaluation }) => newAlerts(evaluation).length);
  const lastRun = out[out.length - 1].evaluation;
  const threat = (key: string) => lastRun.findings.find(f => f.kind === 'MENACE' && f.key === key);
  // La mesure de 11:03-11:57 ne porte pas la source canonique : ses scènes se jugent sans les photographies de source.
  const bySiteOnly = history.map(r => ({ ...r, served: new Map([...r.served].filter(([id]) => !id.startsWith('SOURCE:'))) }));
  const now = evaluateCoverage({ entities: nowEntities(history), knownSources: known, history: bySiteOnly, rule });
  const loreal = now.findings.find(f => f.kind === 'NON_SERVIE' && f.key === 'l-oreal-professionnel');
  const ralph = now.findings.find(f => f.kind === 'NON_SERVIE' && f.label === 'Ralph Lauren');
  const first = maskedEntities([]);
  const firstRun = evaluateCoverage({ entities: first.entities, knownSources: known, history: [], rule });
  const synthesis = firstRun.findings.find(f => f.kind === 'SYNTHESE' && f.cause === 'NON_REVUE');
  const named = (label: string) => {
    const i = synthesis?.impacts?.findIndex(x => x.scope === 'MAISON' && x.label === label) ?? -1;
    return i < 0 ? 'absente' : `rang ${i + 1}${i < 30 ? '' : ' (hors des 30 nommées)'}`;
  };
  const withHabit = evaluateCoverage({ entities: maskedEntities(history).entities, knownSources: known, history, rule });
  const swatch = swatchEntities(history);
  const swatchEval = evaluateCoverage({ entities: swatch.entities, knownSources: [], history: bySiteOnly, rule });
  const swatchWaking = swatchEval.findings.filter(f => f.gravity !== 'INFORMATION' && (f.sources.some(s => s.sourceKey === 'swatch-group') || f.cause === 'FERMETURE_SOURCE'));
  return { rule, history, out, now, firstRun, withHabit, swatchEval, masked: first.masked, closed: swatch.closed, noise,
    mean: noise.reduce((s, n) => s + n, 0) / noise.length,
    expected: { diptyque: threat('diptyque-workday')?.gravity ?? 'absente', browns: threat('browns-shoes')?.gravity ?? 'absente',
      loreal: loreal?.gravity ?? 'absente', ralph: ralph?.gravity ?? 'absente',
      synthesis: synthesis ? `${synthesis.gravity}, ${synthesis.members} Maisons, ${synthesis.lost} offres` : 'absente',
      hermes: named('Hermès'), lv: named('Louis Vuitton'), dior: named('Christian Dior Couture'),
      swatchWaking: swatchWaking.length } };
}

// 0. Les deux extraits comptent les mêmes offres servies à chaque RUN (le second ajoute la source).
for (const run of runs.filter(r => r.id !== 'maintenant')) {
  const sum = (lines: any[]) => lines.filter(r => r.run === run.id).reduce((t, r) => t + r.n, 0);
  console.log(`servies ${run.t.toISOString().slice(0, 16)} : ${sum(h.servies.lignes)} (historique) / ${sum(hs.servies.lignes)} (avec sources)`);
}

// 1. La règle retenue, en clair.
const chosen = measure(ANOMALY, true);
console.log(`\n# Règle retenue : k = ${ANOMALY.k}, plancher = ${ANOMALY.floor}, masse = ${ANOMALY.mass} Maisons`);
show('02/10, mesure (sans masquage), sources qualifiées non servies comprises', chosen.now);
show(`02/10, premier RUN de r6 : masquage à blanc (${chosen.masked} offres), table des photographies VIDE`, chosen.firstRun, 40);
show('02/10, le même masquage avec 7 RUN d’habitude (si l’historique existait)', chosen.withHabit, 40);
show(`02/10 + ${chosen.closed} fermetures Swatch (D-508 §6)`, chosen.swatchEval, 10);
console.log('\n## Cas attendus');
console.log(JSON.stringify(chosen.expected, null, 1));
console.log('\n## Bruit, 7 derniers RUN quotidiens (nouvelles alertes qui réveillent)');
for (const { label, evaluation } of chosen.out.slice(-7)) {
  const fresh = newAlerts(evaluation);
  console.log(`${label} : ${fresh.length} nouvelles (${fresh.map(f => `${f.kind} ${f.label}`).join(' ; ') || 'aucune'}) ; ${waking(evaluation).length} qui réveillent ; ${evaluation.findings.length - waking(evaluation).length} pour information`);
}
console.log(`moyenne ${Math.round(chosen.mean * 10) / 10} par jour (version précédente : 3,4)`);

// 2. Le calibrage : chaque réglage sur les mêmes scènes.
console.log('\n## Calibrage (bruit = nouvelles alertes qui réveillent, 7 derniers RUN ; premier RUN de r6 = table vide)');
console.log('k | plancher | masse | bruit/jour | par RUN | Diptyque | Browns | L’Oréal Pro | synthèse r6 | Hermès | LV | Dior Couture | autres alertes r6 | Swatch qui réveille');
for (const k of [2, 3, 4, 5]) for (const floor of [5, 10, 15, 20, 30]) for (const mass of [ANOMALY.mass]) {
  const m = measure({ k, floor, mass });
  const others = waking(m.firstRun).filter(f => f.kind !== 'SYNTHESE').length;
  console.log(`${k} | ${floor} | ${mass} | ${Math.round(m.mean * 10) / 10} | ${m.noise.join(',')} | ${m.expected.diptyque} | ${m.expected.browns} | ${m.expected.loreal} | ${m.expected.synthesis} | ${m.expected.hermes} | ${m.expected.lv} | ${m.expected.dior} | ${others} | ${m.expected.swatchWaking}`);
}
console.log('\n## Seuil de masse : nombre de Maisons anormales pour une même cause, par RUN (règle retenue, sans synthèse)');
for (const mass of [5, 10, 20, 40]) {
  const m = measure({ ...ANOMALY, mass });
  const days = m.out.slice(-7).map(({ evaluation }) => evaluation.findings.filter(f => f.kind === 'SYNTHESE').length);
  console.log(`masse ${mass} : synthèses sur les 7 derniers RUN ${days.join(',')} ; premier RUN de r6 ${m.firstRun.findings.filter(f => f.kind === 'SYNTHESE').map(f => `${f.cause} ${f.members}`).join(', ') || 'aucune'} ; bruit/jour ${Math.round(m.mean * 10) / 10}`);
}
const unfolded = measure({ ...ANOMALY, mass: Number.MAX_SAFE_INTEGER });
const perCause = (e: CoverageEvaluation) => {
  const acc = new Map<string, number>();
  for (const f of e.findings) if (f.kind === 'PERTE' && f.scope === 'MAISON') acc.set(f.cause, (acc.get(f.cause) ?? 0) + 1);
  return [...acc.entries()].map(([c, n]) => `${c} ${n}`).join(', ') || '0';
};
console.log(`sans synthèse : Maisons anormales par cause, 7 derniers RUN : ${unfolded.out.slice(-7).map(({ evaluation }) => `[${perCause(evaluation)}]`).join(' ')} ; premier RUN de r6 : [${perCause(unfolded.firstRun)}]`);

// 3. Ce que k règle : toutes les pertes jugées anormales (qui réveillent ou pour information), RUN par RUN, et la
//    variation habituelle elle-même. Sans masquage dans l'historique, k ne départage que des fermetures et des pertes
//    d'habitude : c'est ce qu'il filtre.
console.log('\n## Sensibilité à k (plancher retenu) : pertes anormales par RUN, toutes gravités, 7 derniers RUN ; masquage avec habitude');
for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const m = measure({ ...ANOMALY, k });
  const losses = m.out.slice(-7).map(({ evaluation }) => evaluation.findings.reduce((n, f) => n + (f.kind === 'PERTE' ? 1 : f.kind === 'SYNTHESE' ? f.members ?? 0 : 0), 0));
  const synth = m.withHabit.findings.find(f => f.kind === 'SYNTHESE' && f.cause === 'NON_REVUE');
  const inSynth = (label: string) => synth?.impacts?.some(i => i.scope === 'MAISON' && i.label === label) ? 'oui' : 'NON';
  console.log(`k = ${k} : pertes ${losses.join(',')} (moyenne ${Math.round(losses.reduce((s, n) => s + n, 0) / 7 * 10) / 10}) ; bruit/jour ${Math.round(m.mean * 10) / 10} ; masquage avec habitude : ${synth ? `${synth.members} Maisons dans la synthèse (Hermès ${inSynth('Hermès')}, LV ${inSynth('Louis Vuitton')}, Dior ${inSynth('Christian Dior Couture')})` : 'aucune synthèse'}`);
}
{
  const window = referenceWindow(chosen.history);
  const last = window[0];
  const rows: Array<{ id: string; served: number; v: number }> = [];
  for (const id of last.served.keys()) {
    if (!id.startsWith('MAISON:') && !id.startsWith('MARCHE:')) continue;
    const series = window.map(r => r.served.get(id) ?? 0);
    const deltas = series.slice(1).map((v, i) => Math.abs(series[i] - v)).sort((a, b) => a - b);
    const mid = Math.floor(deltas.length / 2);
    rows.push({ id, served: series[0], v: deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2 });
  }
  const maisons = rows.filter(r => r.id.startsWith('MAISON:'));
  const total = maisons.reduce((s, r) => s + r.served, 0);
  console.log('\n## Variation habituelle mesurée au 01/10 (fenêtre de 7 RUN)');
  for (const [lo, hi] of [[1, 4], [5, 9], [10, 19], [20, 99], [100, 999], [1000, Infinity]] as const) {
    const band = maisons.filter(r => r.served >= lo && r.served <= hi);
    const vs = band.map(r => r.v).sort((a, b) => a - b);
    const q = (p: number) => vs.length ? vs[Math.min(vs.length - 1, Math.floor(p * vs.length))] : 0;
    console.log(`Maisons de ${lo} à ${hi === Infinity ? '∞' : hi} offres : ${band.length} Maisons, ${band.reduce((s, r) => s + r.served, 0)} offres (${Math.round(band.reduce((s, r) => s + r.served, 0) / total * 1000) / 10} %) ; variation médiane p50 ${q(0.5)}, p90 ${q(0.9)}, max ${vs[vs.length - 1] ?? 0}`);
  }
  for (const id of ['MARCHE:US', 'MARCHE:FR', 'MARCHE:GB', 'MARCHE:HU', 'MARCHE:ZA']) {
    const r = rows.find(x => x.id === id);
    if (r) console.log(`${id} : ${r.served} offres, variation habituelle ${r.v}`);
  }
  for (const label of ['Hermès', 'Louis Vuitton', 'Christian Dior Couture', 'Ulta Beauty', 'Sephora', 'H&M Group']) {
    const id = [...names.entries()].find(([, name]) => name === label)?.[0];
    const r = rows.find(x => x.id === `MAISON:${canonicalCompany(merges, id ?? '')}`);
    if (r) console.log(`${label} : ${r.served} offres, variation habituelle ${r.v} ; seuil d'anomalie ${Math.max(ANOMALY.floor, Math.floor(ANOMALY.k * r.v) + 1)}`);
  }
}
console.log('\n## Plancher : ce que 5 ajoute à 10, et 10 à 20, sur les 7 derniers RUN (nouvelles alertes) et au premier RUN de r6');
for (const [lo, hi] of [[5, 10], [10, 20]] as const) {
  const f10 = measure({ ...ANOMALY, floor: lo }), f20 = measure({ ...ANOMALY, floor: hi });
  const keptR6 = new Set(waking(f20.firstRun).map(f => `${f.kind}:${f.key}`));
  console.log(`${lo} au lieu de ${hi}, premier RUN de r6 : ${waking(f10.firstRun).filter(f => f.kind !== 'SYNTHESE' && !keptR6.has(`${f.kind}:${f.key}`)).map(f => `${f.kind} ${f.label} (${f.lost})`).join(' ; ') || 'rien'}`);
  f10.out.slice(-7).forEach(({ label, evaluation }, i) => {
    const kept = new Set(newAlerts(f20.out.slice(-7)[i].evaluation).map(f => `${f.kind}:${f.key}`));
    const extra = newAlerts(evaluation).filter(f => !kept.has(`${f.kind}:${f.key}`));
    if (extra.length) console.log(`${lo} au lieu de ${hi}, ${label} : ${extra.map(f => `${f.kind} ${f.label} (${f.lost})`).join(' ; ')}`);
  });
}

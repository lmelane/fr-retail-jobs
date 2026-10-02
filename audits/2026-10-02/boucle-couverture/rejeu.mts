/**
 * Rejeu de l'alerte de couverture sur l'historique réel (R-143 §11, D-516 §2). HORS LIGNE : il ne lit que les extraits
 * produits en lecture seule par `historique.sql` et `a-blanc.sql`, et passe chaque RUN par le code même du RUN
 * (`evaluateCoverage`, `apps/aggregator/src/coverage/coverageAlert.ts`).
 *
 *   npx tsx audits/2026-10-02/boucle-couverture/rejeu.mts \
 *     audits/2026-10-02/boucle-couverture/historique.json.gz audits/2026-10-02/boucle-couverture/a-blanc.json.gz \
 *     audits/2026-10-02/d508-swatch-fermeture/fermetures-a-blanc.csv
 *
 * Scénarios : chaque RUN quotidien depuis le 23/09 (photographie reconstruite) ; puis, sur la mesure du 02/10, trois
 * scénarios : le masquage à blanc de R-143 §2 (première revue de disponibilité), les 68 fermetures Swatch de D-508 §6,
 * et les sources qualifiées qui ne servent rien (Ralph Lauren en pause).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { evaluateCoverage, newAlerts, entityId, referenceWindow, THRESHOLDS, HORIZONS, emptyExits, type Horizon, type EntityState, type HistoryRun, type KnownSource,
  type LossCause, type CoverageEvaluation, type EntityScope } from '../../../apps/aggregator/src/coverage/coverageAlert.js';
import { canonicalCompany, marketLabel, marketOf, withdrawalCause } from '../../../apps/aggregator/src/coverage/coverageReading.js';
import { findingLines } from '../../../apps/aggregator/src/coverage/coverageBulletin.js';

type Bloc = { bloc: string; lignes: any[]; mesure?: string };
function blocs(path: string): Record<string, Bloc> {
  const out: Record<string, Bloc> = {};
  const text = path.endsWith('.gz') ? gunzipSync(readFileSync(path)).toString('utf8') : readFileSync(path, 'utf8');
  for (const part of text.trim().split(/\n(?=\{"bloc")/)) { const b = JSON.parse(part) as Bloc; out[b.bloc] = b; }
  return out;
}
const [histPath, blancPath, swatchPath] = process.argv.slice(2);
if (!histPath || !blancPath || !swatchPath) throw new Error('usage: rejeu.mts historique.json a-blanc.json fermetures-a-blanc.csv');
const h = blocs(histPath), blanc = blocs(blancPath).a_blanc;
const utcDate = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

const merges = new Map<string, string>(h.societes.lignes.filter(c => c.fusion).map(c => [c.id, c.fusion]));
const names = new Map<string, string>(h.societes.lignes.map(c => [c.id, c.name]));
const runs = h.runs.lignes.map(r => ({ id: r.id as string, t: utcDate(r.t), status: r.status as string }));

/** Les entités d'un ensemble de cellules (société, pays) : Maison canonique et marché ouvert. */
function cellsOf(c: string, p: string): Array<{ scope: EntityScope; key: string; label: string }> {
  const maison = canonicalCompany(merges, c), market = marketOf(p);
  return [{ scope: 'MAISON', key: maison, label: names.get(maison) ?? maison },
    ...(market ? [{ scope: 'MARCHE' as const, key: market, label: marketLabel(market) }] : [])];
}
class Builder {
  map = new Map<string, EntityState>();
  get(c: string, p: string) {
    return cellsOf(c, p).map(e => {
      const id = entityId(e.scope, e.key);
      if (!this.map.has(id)) this.map.set(id, { ...e, served: 0, exits: emptyExits(), threat: { count: 0, sources: [] } });
      return this.map.get(id)!;
    });
  }
  serve(c: string, p: string, n: number) { for (const e of this.get(c, p)) e.served += n; }
  /** L'avant du RUN = servies à la fin + ce que les étapes du RUN ont retiré (`before`), posé par `startBefore`. */
  removed = new Map<EntityState, number>();
  before(c: string, p: string, n: number) { for (const e of this.get(c, p)) this.removed.set(e, (this.removed.get(e) ?? 0) + n); }
  startBefore() { for (const e of this.map.values()) e.before = e.served + (this.removed.get(e) ?? 0); }
  /** Cumulé, comme la production : une sortie de ce RUN compte aussi depuis le dernier RUN et depuis la fenêtre. */
  exit(c: string, p: string, cause: LossCause, source: string, h: Horizon, n: number) {
    for (const e of this.get(c, p)) for (const horizon of HORIZONS.slice(HORIZONS.indexOf(h))) {
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

function servedOf(runId: string, b: Builder) { for (const r of h.servies.lignes) if (r.run === runId) b.serve(r.c, r.p, r.n); }
/** Les fins d'offre (JobEvent), rangées par horizon : RUN (depuis `run`), LAST (depuis `last`), WINDOW. Un motif inconnu
 * n'a pas de cause, comme en production. `intoBefore` : les fins du RUN rajoutées à l'avant (reconstruction). */
function exitsBetween(bounds: { run?: Date | null; last?: Date | null; window?: Date | null }, until: Date, b: Builder, intoBefore = false) {
  const since = [bounds.run, bounds.last, bounds.window].filter((d): d is Date => !!d).sort((x, y) => x.getTime() - y.getTime())[0];
  if (!since) return;
  for (const r of h.sorties.lignes) {
    const at = utcDate(r.at);
    if (at < since || at > until) continue;
    const horizon: Horizon = bounds.run && at >= bounds.run ? 'RUN' : bounds.last && at >= bounds.last ? 'LAST' : 'WINDOW';
    const cause = r.type === 'CLOSED' ? 'FERMETURE_SOURCE' : withdrawalCause(r.motif);
    if (cause) b.exit(r.c, r.p, cause, 'evenement', horizon, 1);
    if (intoBefore && horizon === 'RUN') b.before(r.c, r.p, 1);
  }
}
const toHistory = (b: Builder, takenAt: Date, evaluation: CoverageEvaluation | null): HistoryRun => ({ takenAt,
  served: new Map([...b.map.values()].map(e => [entityId(e.scope, e.key), e.served])),
  alerts: new Map((evaluation?.rows ?? []).filter(r => r.gravity).map(r => [entityId(r.scope, r.key), r.gravity!])) });

function show(title: string, evaluation: CoverageEvaluation, limit = 12) {
  const waking = evaluation.findings.filter(f => f.gravity !== 'INFORMATION');
  const fresh = newAlerts(evaluation);
  console.log(`\n## ${title}`);
  console.log(`référence : ${evaluation.referenceRuns} RUN ; alertes qui réveillent : ${waking.length} (nouvelles ${fresh.length}, à réparer ${fresh.filter(f => f.gravity === 'A_REPARER').length}, à vérifier ${fresh.filter(f => f.gravity === 'A_VERIFIER').length}) ; pour information : ${evaluation.findings.length - waking.length}`);
  for (const f of evaluation.findings.slice(0, limit)) console.log(`- [${f.gravity}] ${findingLines(f).join(' | ')}`);
}

// 1. Les RUN quotidiens, un par un, chacun jugé sur les RUN photographiés avant lui.
const history: HistoryRun[] = [];
const scenes: Array<{ label: string; entities: EntityState[]; history: HistoryRun[] }> = [];
const noise: Array<{ run: string; day: string; waking: number; fresh: number; info: number }> = [];
const real = runs.filter(r => r.id !== 'maintenant');
for (const run of real) {
  const b = new Builder();
  servedOf(run.id, b);
  const window = referenceWindow(history);
  exitsBetween({ run: utcDate(h.runs.lignes.find(r => r.id === run.id).debut), last: window[0]?.takenAt, window: window[window.length - 1]?.takenAt },
    run.t, b, true);
  b.startBefore();
  for (const m of h.menaces.lignes) if (m.run === run.id) b.threat(m.c, m.p, m.source, m.statut, m.note, m.n, m.vu ? utcDate(m.vu) : null);
  scenes.push({ label: run.t.toISOString().slice(0, 10), entities: [...b.map.values()], history: [...history] });
  const evaluation = evaluateCoverage({ entities: [...b.map.values()], knownSources: [], history });
  show(`RUN ${run.id.slice(0, 8)}, fin ${run.t.toISOString().slice(0, 16)} (${run.status})`, evaluation, 8);
  noise.push({ run: run.id.slice(0, 8), day: run.t.toISOString().slice(0, 10), waking: evaluation.findings.filter(f => f.gravity !== 'INFORMATION').length,
    fresh: newAlerts(evaluation).length, info: evaluation.findings.filter(f => f.gravity === 'INFORMATION').length });
  history.push(toHistory(b, run.t, evaluation));
}

// 2. La mesure du 02/10, base des trois scénarios.
const nowRun = runs.find(r => r.id === 'maintenant')!;
function nowBuilder(): Builder {
  const b = new Builder();
  servedOf('maintenant', b);
  const window = referenceWindow(history);
  exitsBetween({ last: window[0].takenAt, window: window[window.length - 1].takenAt }, nowRun.t, b);
  return b;
}
const known: KnownSource[] = h.sources_connues.lignes.filter(s => ['ACTIVE', 'PAUSED'].includes(s.status)).map(s => ({ sourceKey: s.source,
  label: s.maison, status: s.status, qualified: s.qualifiees, served: s.servies, lastRunStatus: null, lastRunNote: null }));
show('02/10, mesure (sans masquage), sources qualifiées non servies comprises', evaluateCoverage({ entities: [...nowBuilder().map.values()], knownSources: known, history }));

// 2a. Première revue de disponibilité (R-143 §2 à blanc) : les offres masquées quittent la photographie.
{
  const b = new Builder();
  let masked = 0;
  for (const r of blanc.lignes) {
    b.serve(r.c, r.p, r.servies - r.non_revue - r.plafond_seul);
    b.before(r.c, r.p, r.non_revue + r.plafond_seul);
    if (r.non_revue) b.exit(r.c, r.p, 'NON_REVUE', r.source, 'RUN', r.non_revue);
    if (r.plafond_seul) b.exit(r.c, r.p, 'COLLECTE', r.source, 'RUN', r.plafond_seul);
    masked += r.non_revue + r.plafond_seul;
  }
  b.startBefore();
  const window = referenceWindow(history);
  exitsBetween({ last: window[0].takenAt, window: window[window.length - 1].takenAt }, utcDate(blanc.mesure!), b);
  scenes.push({ label: 'a-blanc', entities: [...b.map.values()], history: [...history] });
  const evaluation = evaluateCoverage({ entities: [...b.map.values()], knownSources: known, history });
  show(`02/10, première revue de disponibilité à blanc (${masked} offres masquées), sources qualifiées non servies comprises`, evaluation, 60);
  // Le même RUN tel qu'il se passera en production : la table des photographies est vide au premier RUN de r6.
  const first = evaluateCoverage({ entities: [...b.map.values()], knownSources: known, history: [] });
  show('02/10, premier RUN de r6 : même masquage, AUCUNE photographie (table vide)', first, 0);
  writeFileSync(new URL('./rejeu-premier-run.json', import.meta.url), JSON.stringify(first, null, 1));
  const stock = new Map<string, number>();
  for (const r of blanc.lignes) {
    const label = names.get(canonicalCompany(merges, r.c)) ?? r.c;
    if (r.non_revue + r.plafond_seul) stock.set(label, (stock.get(label) ?? 0) + r.non_revue + r.plafond_seul);
  }
  writeFileSync(new URL('./rejeu-masque.json', import.meta.url), JSON.stringify({ total: masked,
    maisons: [...stock.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) }, null, 1));
  for (const [scope, key] of [['MARCHE', 'ZA'], ['MARCHE', 'HU']]) {
    const f = first.findings.find(x => x.scope === scope && x.key === key);
    console.log(`premier RUN, attendu ${scope} ${key} : ${f ? `${f.gravity} ${f.cause} ${Math.round(f.share * 1000) / 10} % (${f.lost}/${f.reference}, ${f.basis})` : 'ABSENT'}`);
  }
  for (const label of ['PICARD', 'Marni', 'Primark', 'H&M Group', 'Nordstrom', 'Ulta Beauty']) {
    const f = first.findings.find(x => x.scope === 'MAISON' && x.label === label);
    console.log(`premier RUN, Maison ${label} : ${f ? `${f.gravity} ${f.cause} ${Math.round(f.share * 1000) / 10} % (${f.lost}/${f.reference}, ${f.basis})` : 'ABSENT'}`);
  }
  const expected = [['MARCHE', 'ZA'], ['MARCHE', 'HU']];
  const labels = ['PICARD', 'Marni', 'Primark', 'H&M'];
  for (const [scope, key] of expected) {
    const f = evaluation.findings.find(x => x.scope === scope && x.key === key);
    console.log(`attendu ${scope} ${key} : ${f ? `${f.gravity} ${f.cause} ${Math.round(f.share * 1000) / 10} %` : 'ABSENT'}`);
  }
  for (const label of labels) {
    const found = evaluation.findings.filter(x => x.scope === 'MAISON' && x.label.toLowerCase().startsWith(label.toLowerCase()));
    console.log(`attendu Maison ${label} : ${found.length ? found.map(f => `${f.label} ${f.gravity} ${f.cause} ${Math.round(f.share * 1000) / 10} % (${f.lost}/${f.reference})`).join(' ; ') : 'ABSENT'}`);
  }
}

// 2b. Les 68 fermetures Swatch de D-508 §6 : une fermeture prouvée ne réveille personne.
{
  const b = nowBuilder();
  const idsByName = new Map<string, string[]>();
  for (const [id, name] of names) idsByName.set(name, [...(idsByName.get(name) ?? []), id]);
  const servedIds = new Set(h.servies.lignes.filter(r => r.run === 'maintenant').map(r => r.c));
  const lines = readFileSync(swatchPath, 'utf8').trim().split('\n').slice(1);
  let closed = 0;
  for (const line of lines) {
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
    const company = cols[2], country = cols[4];
    const id = (idsByName.get(company) ?? []).find(x => servedIds.has(x));
    if (!id) { console.log(`Swatch : société introuvable ${company}`); continue; }
    b.serve(id, country, -1);
    b.before(id, country, 1);
    b.exit(id, country, 'FERMETURE_SOURCE', 'swatch-group', 'RUN', 1);
    closed++;
  }
  b.startBefore();
  const evaluation = evaluateCoverage({ entities: [...b.map.values()], knownSources: [], history });
  const swatch = evaluation.findings.filter(f => f.sources.some(s => s.sourceKey === 'swatch-group'));
  show(`02/10 + ${closed} fermetures Swatch (D-508 §6)`, evaluation, 10);
  console.log(`Swatch : constats ${swatch.length}, dont qui réveillent ${swatch.filter(f => f.gravity !== 'INFORMATION').length}`);
}

// 3. Le bruit : alertes qui réveillent par RUN, sur les 7 derniers RUN quotidiens.
console.log('\n## Bruit, 7 derniers RUN quotidiens');
for (const row of noise.slice(-7)) console.log(`${row.day} ${row.run} : ${row.waking} qui réveillent (${row.fresh} nouvelles), ${row.info} pour information`);

// 4. Calibrage : d'autres seuils, mêmes scènes. Ce qui est attrapé dans le masquage à blanc, et ce qui sonne sur l'historique.
console.log('\n## Calibrage des seuils (7 derniers RUN quotidiens ; masquage à blanc)');
const mutable = THRESHOLDS as unknown as Record<'MAISON' | 'MARCHE', { floor: number; share: number; big: number }>;
const original = structuredClone(mutable);
const expectedMaisons = ['PICARD', 'Marni', 'Primark', 'H&M Group'], expectedMarkets = ['ZA', 'HU'];
for (const [maison, marche] of [
  [{ floor: 5, share: 0.3, big: 200 }, { floor: 25, share: 0.2, big: 500 }],
  [{ floor: 10, share: 0.3, big: 200 }, { floor: 25, share: 0.2, big: 500 }],
  [{ floor: 5, share: 0.2, big: 200 }, { floor: 25, share: 0.2, big: 500 }],
  [{ floor: 5, share: 0.4, big: 200 }, { floor: 25, share: 0.2, big: 500 }],
  [{ floor: 5, share: 0.3, big: 100000 }, { floor: 25, share: 0.2, big: 500 }],
  [{ floor: 5, share: 0.3, big: 200 }, { floor: 25, share: 0.3, big: 500 }],
  [{ floor: 5, share: 0.3, big: 200 }, { floor: 50, share: 0.2, big: 500 }],
] as const) {
  Object.assign(mutable.MAISON, maison); Object.assign(mutable.MARCHE, marche);
  const daily = scenes.filter(sc => sc.label !== 'a-blanc').slice(-7).map(sc => evaluateCoverage({ entities: sc.entities, knownSources: [], history: sc.history }));
  const wakingLosses = daily.map(e => e.findings.filter(f => f.kind === 'PERTE' && f.gravity !== 'INFORMATION').length);
  const infoLosses = daily.map(e => e.findings.filter(f => f.kind === 'PERTE' && f.gravity === 'INFORMATION').length);
  const threats = daily.map(e => e.findings.filter(f => f.kind === 'MENACE').length);
  const sc = scenes.find(x => x.label === 'a-blanc')!;
  const blank = evaluateCoverage({ entities: sc.entities, knownSources: [], history: sc.history });
  const caught = [...expectedMaisons.filter(l => blank.findings.some(f => f.scope === 'MAISON' && f.label === l)),
    ...expectedMarkets.filter(k => blank.findings.some(f => f.scope === 'MARCHE' && f.key === k))];
  const ulta = blank.findings.some(f => f.label === 'Ulta Beauty');
  console.log(`Maison ${maison.floor}/${maison.share * 100} %/${maison.big} · marché ${marche.floor}/${marche.share * 100} %/${marche.big} : ` +
    `historique pertes qui réveillent ${wakingLosses.join(',')} ; pour information ${infoLosses.join(',')} ; menaces ${threats.join(',')} · ` +
    `à blanc : ${blank.findings.filter(f => f.gravity !== 'INFORMATION').length} qui réveillent, attendus ${caught.length}/6${caught.length < 6 ? ` (manque ${[...expectedMaisons, ...expectedMarkets].filter(x => !caught.includes(x)).join(', ')})` : ''}, Ulta ${ulta ? 'oui' : 'non'}`);
}
Object.assign(mutable.MAISON, original.MAISON); Object.assign(mutable.MARCHE, original.MARCHE);

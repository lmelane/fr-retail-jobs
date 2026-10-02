/**
 * D-520 — l'état opérationnel des sources (`src/pipeline/sourceState.ts`) rejoué sur les données réelles.
 *
 * HORS LIGNE : lit l'instantané pris en lecture seule par `audits/2026-10-02/etat-sources/instantane.sql`
 * (`db.py readonly psql -At -f …`, hors fenêtre du RUN 15:30-18:30 UTC), jamais la base. Aucune écriture.
 *
 *   npx tsx apps/aggregator/scripts/ops/mesures/d520-etat-sources.mts <instantane.jsonl[.gz]> > mesure.json
 *
 * Ce qu'il rend :
 *  1. chaque collecte des 10 jours de l'instantané (RUN `ingest-all` = RUN, `ingest` ciblé = VERIFICATION, passe
 *     `ingest-light` = PASSE), dans l'ordre, passée au calcul de l'état avec l'état précédent ;
 *  2. après chaque RUN, la réconciliation : les sources actives absentes du RUN (NON_COLLECTEE), l'intention des
 *     autres, le verdict, comparé au verdict réellement rendu ;
 *  3. l'état actuel (fin de l'instantané, échéances vieillies à l'instant de l'instantané) par état, trajectoire, cause ;
 *  4. les sources sans cause classable (il doit n'y en avoir aucune) ;
 *  5. la durée des épisodes par classe, en RUN, pour régler les échéances ; les entrées « de notre côté » par RUN, pour
 *     régler le seuil de panne du système.
 *
 * Approximations dites : l'intention historique d'une source se lit dans la sélection du RUN (`run.sources_selected` :
 * sélectionnée = ACTIVE) ; une source non sélectionnée prend son statut et sa note d'aujourd'hui. La couverture
 * (`CoverageSnapshot`) n'existe pas encore en production : la condition « couverture inexpliquée » n'est pas rejouée.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ageState, computeSourceState, reconcileRun, summarizeStates, issueCause, type CollectionKind, type CollectionOutcome,
  type IssueLike, type SourceState } from '../../../src/pipeline/sourceState.js';

type Row = Record<string, any>;
const path = process.argv[2];
if (!path) throw new Error('usage: d520-etat-sources.mts <instantane.jsonl[.gz]>');
const buffer = readFileSync(path);
const text = path.endsWith('.gz') ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
const sets: Record<string, any> = {};
for (const line of text.split('\n').filter(Boolean)) { const o = JSON.parse(line); sets[o.jeu] = o; }
const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);

const sources: Row[] = sets.sources.rows;
const registry = new Map(sources.map(s => [s.key, s]));
const kindOf: Record<string, CollectionKind> = { 'ingest-all': 'RUN', ingest: 'VERIFICATION', 'ingest-light': 'PASSE' };
const runs: Row[] = (sets.pipelineRuns.rows as Row[]).filter(r => kindOf[r.command]).sort((a, b) => utc(a.startedAt).getTime() - utc(b.startedAt).getTime());
const sourceRuns: Row[] = sets.sourceRuns.rows;
const events: Row[] = sets.events.rows;
const selections = new Map<string, string[]>((sets.runSelections.rows as Row[]).map(r => [r.runId, r.sourceKeys]));
const snapshotAt = utc(sets.meta.at);

const issuesBy = new Map<string, IssueLike[]>();
for (const e of events) if (e.event === 'source.issue_classified')
  issuesBy.set(`${e.runId}|${e.sourceKey}`, [...(issuesBy.get(`${e.runId}|${e.sourceKey}`) ?? []), ...e.payload.issues]);
const runsByRunId = new Map<string, Row[]>();
for (const sr of sourceRuns) if (sr.runId) runsByRunId.set(sr.runId, [...(runsByRunId.get(sr.runId) ?? []), sr]);

const SYSTEM = new Set(['INVALID_COUNTS', 'INCOMPLETE_RUN', 'NO_ACTIVE_SOURCE', 'ALL_SOURCES_FAILED']);
const states = new Map<string, SourceState>();
const verdicts: Row[] = [];
const episodes: Array<{ cause: string; state: string; runs: number; open: boolean; sourceKey: string }> = [];
const runCount = new Map<string, number>();
const unclassified = new Map<string, Set<string>>();

function intent(key: string, selected: Set<string> | null) {
  const now = registry.get(key);
  if (selected?.has(key)) return { key, status: 'ACTIVE', note: null };
  if (selected && now?.status === 'ACTIVE') return { key, status: 'PAUSED', note: now?.note ?? '(intention historique inconnue : non sélectionnée par ce RUN)' };
  return { key, status: now?.status ?? 'RETIRED', note: now?.note ?? null };
}

const openEpisode = (key: string) => [...episodes].reverse().find(e => e.sourceKey === key && e.open);
function apply(key: string, next: SourceState, isRun: boolean) {
  if (isRun) {
    const open = openEpisode(key);
    if (open && (next.state === 'NORMALE' || next.cause !== open.cause)) open.open = false;
    if (next.state !== 'NORMALE' && next.cause && !['PAUSE_DECIDEE', 'EXCLUSION_DECIDEE', 'MOTIF_ABSENT'].includes(next.cause)) {
      const cur = openEpisode(key);
      if (cur) cur.runs++; else episodes.push({ cause: next.cause, state: next.state, runs: 1, open: true, sourceKey: key });
    }
  }
  if (next.cause === 'NON_CLASSEE') unclassified.set(key, new Set([...(unclassified.get(key) ?? []), ...next.codes]));
  states.set(key, next);
}

for (const run of runs) {
  const kind = kindOf[run.command];
  const rows = (runsByRunId.get(run.id) ?? []).sort((a, b) => utc(a.ranAt).getTime() - utc(b.ranAt).getTime());
  const selected = kind === 'RUN' ? new Set(selections.get(run.id) ?? rows.map(r => r.sourceKey)) : null;
  for (const sr of rows) {
    const outcome: CollectionOutcome = { kind, at: utc(sr.ranAt), runId: run.id, runStatus: sr.status, jobs: sr.jobs ?? 0,
      issues: issuesBy.get(`${run.id}|${sr.sourceKey}`) ?? [], note: sr.note };
    const source = kind === 'RUN' ? intent(sr.sourceKey, selected) : { key: sr.sourceKey, status: 'ACTIVE', note: null };
    apply(sr.sourceKey, computeSourceState({ source, outcome, previous: states.get(sr.sourceKey) ?? null, now: outcome.at }), kind === 'RUN');
  }
  if (kind !== 'RUN') continue;
  const end = run.finishedAt ? utc(run.finishedAt) : snapshotAt;
  const collected = new Set(rows.map(r => r.sourceKey));
  for (const key of new Set([...registry.keys(), ...selected!])) {
    if (collected.has(key)) continue;
    const previous = states.get(key) ?? null;
    apply(key, computeSourceState({ source: intent(key, selected), outcome: null, previous, now: end }), true);
  }
  const failed = events.filter(e => e.runId === run.id && ['command.failed', 'run.finalization_failed'].includes(e.event)).map(e => String(e.payload.message));
  const reasons = failed.flatMap(m => { try { return (JSON.parse(m).blockingReasons ?? []) as string[]; } catch { return []; } });
  const systemFailures = [...new Set([...reasons.filter(r => SYSTEM.has(r)),
    ...failed.filter(m => /mass-closure guard/.test(m)).map(() => 'REFRESH_REFUSED'),
    ...failed.filter(m => /"alertDeliveryFailed":\s*true/.test(m)).map(() => 'ALERT_NOT_DELIVERED'),
    ...(run.finishedAt ? [] : ['RUN_UNFINISHED'])])];
  const all = [...states.values()].map(s => ageState(s, end));
  const verdict = reconcileRun({ states: all, now: end, runStartedAt: utc(run.startedAt), systemFailures, unexplainedCoverage: [] });
  const issued = events.filter(e => e.runId === run.id && e.event === 'source.issue_classified');
  const oldBlocking = issued.filter(e => !e.payload.acceptedNativeOnly && !e.payload.knownFailure).map(e => e.sourceKey);
  const summary = summarizeStates(all.filter(s => registry.has(s.sourceKey)), end);
  verdicts.push({ date: run.startedAt.slice(0, 10), runId: run.id, actual: run.status, actualReasons: [...new Set(reasons)],
    actualBlockingSources: oldBlocking.length, collected: collected.size, selected: selected!.size,
    verdict: verdict.green ? 'VERT' : 'ROUGE', reasons: verdict.reasons, byState: summary.byState, byTrajectory: summary.byTrajectory,
    ourSideBlockedThisRun: all.filter(s => (s.state === 'BLOQUEE' || s.state === 'EN_ATTENTE') && ['DEFAUT_INTERNE', 'QUALIFICATION_REFUSEE', 'NON_COLLECTEE'].includes(s.cause ?? '')
      && (s.cause === 'NON_COLLECTEE' ? s.computedAt.getTime() >= utc(run.startedAt).getTime() : (s.lastCollectionAt?.getTime() ?? 0) >= utc(run.startedAt).getTime()))
      .map(s => `${s.sourceKey}:${s.cause}`),
    ourSideFailedThisRun: all.filter(s => s.state !== 'NORMALE' && ['DEFAUT_INTERNE', 'QUALIFICATION_REFUSEE', 'NON_COLLECTEE'].includes(s.cause ?? '')
      && (s.lastCollectionAt?.getTime() ?? s.computedAt.getTime()) >= utc(run.startedAt).getTime()).map(s => `${s.sourceKey}:${s.cause}:${s.state}`),
    nonCollected: all.filter(s => s.cause === 'NON_COLLECTEE').map(s => s.sourceKey),
    newlyNonNormal: all.filter(s => s.state !== 'NORMALE' && !['EN_PAUSE', 'EXCLUE'].includes(s.state) && s.since.getTime() >= utc(run.startedAt).getTime())
      .map(s => `${s.sourceKey}:${s.cause}`) });
  runCount.set(run.id, collected.size);
}

const finalStates = sources.map(s => {
  const previous = states.get(s.key) ?? null;
  const intentNow = { key: s.key, status: s.status, note: s.note };
  const base = s.status === 'ACTIVE' ? (previous && !['EN_PAUSE', 'EXCLUE'].includes(previous.state) ? previous
    : computeSourceState({ source: intentNow, outcome: null, previous, now: snapshotAt }))
    : computeSourceState({ source: intentNow, outcome: null, previous, now: snapshotAt });
  return ageState(base, snapshotAt);
});
const summary = summarizeStates(finalStates, snapshotAt);
const crossTab: Record<string, Record<string, number>> = {};
for (const s of finalStates) { const k = s.state; crossTab[k] ??= {}; const t = s.trajectory ?? '(aucune)'; crossTab[k][t] = (crossTab[k][t] ?? 0) + 1; }
const causeTab: Record<string, Record<string, number>> = {};
for (const s of finalStates) if (s.cause) { causeTab[s.cause] ??= {}; causeTab[s.cause][`${s.state}/${s.trajectory}`] = (causeTab[s.cause][`${s.state}/${s.trajectory}`] ?? 0) + 1; }

const distribution: Record<string, Record<string, number>> = {};
for (const e of episodes) { const k = `${e.cause}${e.open ? ' (en cours)' : ''}`; distribution[k] ??= {}; distribution[k][String(e.runs)] = (distribution[k][String(e.runs)] ?? 0) + 1; }
const allCodes = new Map<string, string>();
for (const list of issuesBy.values()) for (const i of list) allCodes.set([i.origin, i.code, i.detail].filter(Boolean).join('/'), issueCause(i) ?? '(retenue prouvée : aucun défaut)');

console.log(JSON.stringify({
  snapshotAt, policy: 'sourceState.ts', registry: { total: sources.length, byStatus: Object.fromEntries(['ACTIVE', 'PAUSED', 'RETIRED', 'DRAFT', 'VALIDATED']
    .map(st => [st, sources.filter(s => s.status === st).length])) },
  current: { byState: summary.byState, byTrajectory: summary.byTrajectory, byCause: summary.byCause, stateByTrajectory: crossTab, causeByStateTrajectory: causeTab,
    sources: summary.sources.map(s => ({ ...s, since: s.since.toISOString(), deadline: s.deadline?.toISOString() ?? null })) },
  unclassified: [...unclassified.entries()].map(([k, v]) => ({ sourceKey: k, codes: [...v] })),
  codes: Object.fromEntries([...allCodes.entries()].sort()),
  runs: verdicts, episodesInRuns: distribution,
}, null, 2));

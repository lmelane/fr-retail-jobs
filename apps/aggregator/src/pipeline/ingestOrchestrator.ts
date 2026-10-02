import { maintainReviewedSectors } from '../sectors/qualify.js';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { log } from '../observability/logger.js';
import { withSourceBudget } from '../lib/sourceBudget.js';
import { BASE_SOURCE_TIMEOUT_MS, sourceTimeoutFor } from '../lib/sourceTimeout.js';
import type { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { loadActiveSources, recordSourceRunSummary } from '../connectors/sourceStore.js';
import { runIngest, KIND_TO_ATS, type IngestStats } from './ingest.js';
import { checkSourceHealth, recordIncrementalRun, type SourceHealth } from './health.js';
import { FULL_RUN_MARKER } from './fullRunMarker.js';
import { briefError } from '../lib/normalize.js';
import { maintainSourceAccess } from '../connectors/sourceAccessQualification.js';
import { WafChallengeError } from '../lib/wafToken.js';
import { ingestionIssue, isDecidedKnownFailure, isNonBlockingIssue, isProvenSourceIssue, issuesFromResult, KNOWN_FAILURE_DECISION, type IngestionIssue } from '../lib/ingestionIssue.js';
import { failureLine } from '../lib/runSummary.js';
import { SOURCE_WRITE_TRANSACTION } from '../lib/writeLocks.js';
import { incrementalPassActive } from '../lib/incrementalReading.js';
import { inRunWindow, LIGHT_PASS_HOURS_UTC } from '@catwalks/runtime';
import { WAF_BOOTSTRAP_SOURCES } from '../connectors/wafBootstrap.js';
import { remediationLine, remediationNote, remediationOf, transientKind, type Remediation, type TransientKind } from './ordinaryCauses.js';
import { recordCollectionState } from './sourceStateStore.js';
import type { CollectionKind, CollectionOutcome, SourceState } from './sourceState.js';

/**
 * Bounded source concurrency with cooperative cancellation. A timed-out source
 * retains its worker until I/O settles; HTTP and browser work receive cancellation,
 * and writes check the signal before committing. This is not process isolation.
 */

/** Per-source wall-clock budget; actual transport cancellation and settlement
 * are owned by withSourceBudget. Large portals need a measured bounded budget:
 * the base, plus a write allowance for the source's recent volume (`lib/sourceTimeout.ts`, D-482). */
const PER_SOURCE_TIMEOUT_MS = BASE_SOURCE_TIMEOUT_MS;

/**
 * How long before the hard timeout a slow crawl should stop itself. The margin
 * lets the adapter finish the page it is on and return cleanly — the graceful
 * stop that keeps its work — before transport cancellation at the hard limit.
 */
const SOFT_DEADLINE_MARGIN_MS = 90_000;

/**
 * How many sources run at once.
 *
 * Mesuré le 2026-09-06 (chronométrage des logs, `runTiming.mts`) : 470
 * sources en SÉRIE = 3 h 28 pour un cron de 4 h, dont 76 % du temps sur 15
 * sources (Michael Page 19 min, L'Oréal 17, Lacoste 16, Kering 12…) — des
 * visites de pages de détail à concurrence 4, chacune attendant son hôte.
 * Pendant qu'une source attend son hôte, les 469 autres attendaient aussi.
 *
 * Paralléliser les SOURCES ne change rien au débit PAR HÔTE : la porte par
 * hôte (D25, `hostGate.ts`) borne la concurrence et le délai sur chaque hôte,
 * quel que soit le nombre de sources qui le visitent. Des sources sur des
 * hôtes différents ne s'attendent donc plus ; celles qui partagent un hôte
 * (les Maisons Richemont, ELC) se sérialisent d'elles-mêmes à la porte.
 *
 * Quatre sources par défaut ; chaque offre utilise une transaction courte.
 * Le pool doit garder de la marge pour les requêtes de suivi et les verrous.
 */
const SOURCE_CONCURRENCY = Number(process.env.INGEST_SOURCE_CONCURRENCY ?? 4);

export type OrchestratorResult = {
  total: number;
  ok: number;
  failed: number;
  timedOut: number;
  failures: string[];
  /** Sources that returned degraded/broken health this run — feeds the alert. */
  incidents: SourceHealth[];
  issues?: (IngestionIssue & { source: string })[];
  /** D-520 : les sources dont l'échec est passager à sa première occurrence, reprises une fois en fin de RUN. */
  pendingRetry?: { source: string; cause: TransientKind }[];
  /** D-520 : les reprises faites dans ce RUN, et si elles ont absorbé l'échec. */
  retries?: { source: string; cause: TransientKind; absorbed: boolean }[];
  /** D-520 : l'état opérationnel calculé et écrit après chaque collecte de ce run. */
  states?: SourceState[];
  /** D-520 : les sources dont l'état n'a pas pu être écrit ; une panne du système pour la réconciliation du RUN. */
  stateFailures?: string[];
  /** D-520 : la nature de la collecte pour l'état ; par défaut RUN, ou PASSE sous une passe incrémentale. */
  collectionKind?: CollectionKind;
};

/**
 * D-520 — LA REPRISE UNIQUE DES ÉCHECS PASSAGERS DANS LE RUN.
 *
 * Seules les pannes passagères par leur CLASSE d'erreur (base Prisma, transport : `ordinaryCauses.ts`, `transientKind`),
 * à leur première occurrence, sont relues UNE fois, après toutes les autres sources, par l'étape exacte du RUN
 * (`ingestOne` : accès, qualification, collecte scellée, écriture). Mesuré sur les 8 RUN du 24/09 au 01/10/2026
 * (`audits/2026-10-02/remediation-auto/`) : peu nombreuses (browns-shoes et diptyque-workday le 01/10, une connexion
 * de Rolex le 24/09), mais chacune rendait le RUN rouge. La première tentative reste au journal (`source.issue_classified`
 * et sa ligne `SourceRun` en erreur, que les lecteurs ne prennent pas pour référence : ils lisent la dernière ligne ou
 * la dernière collecte productive) ; la reprise est inscrite (`source.retry_started`, `source.retry_completed`).
 *
 * Bornes : jamais un refus, un délai, une capture refusée ; jamais Avature ni une source à amorçage anti-robot
 * (lecture D-492 de D-516 §1, D-483) ; au plus `RUN_RETRY_MAX_SOURCES` sources, sinon aucune (une panne de masse n'est
 * pas ordinaire, elle reste rouge) ; chaque reprise bornée par `retryDeadline` (fin de la fenêtre du RUN, prochaine
 * passe de découverte) ; jamais dans une passe. Interrupteur : `RUN_TRANSIENT_RETRY=off`.
 */
export const RUN_RETRY_MAX_SOURCES = 20;
/** En deçà, une reprise n'est pas commencée : elle serait coupée avant d'écrire. */
export const RUN_RETRY_MIN_MS = 2 * 60_000;
const RUN_WINDOW_END_UTC_MINUTES = 18 * 60 + 30;

/**
 * L'instant avant lequel toute reprise doit finir : la fin de la fenêtre du RUN (18:30 UTC) quand on y est, et toujours
 * l'heure de la prochaine passe de découverte (`LIGHT_PASS_HOURS_UTC`). Pure.
 */
export function retryDeadline(now: Date, passHours: readonly number[] = LIGHT_PASS_HOURS_UTC): number {
  const candidates: number[] = [];
  if (inRunWindow(now)) {
    const end = new Date(now); end.setUTCHours(0, RUN_WINDOW_END_UTC_MINUTES, 0, 0); candidates.push(end.getTime());
  }
  for (const hour of passHours) {
    const at = new Date(now); at.setUTCHours(hour, 0, 0, 0);
    if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 1);
    candidates.push(at.getTime());
  }
  return Math.min(...candidates, now.getTime() + 24 * 3_600_000);
}

/** Les sources jamais reprises : Avature (relire tôt après une lecture complète est refusé) et l'amorçage anti-robot. */
export function retryExcluded(key: string, kind: string): boolean {
  return kind === 'avature' || Object.hasOwn(WAF_BOOTSTRAP_SOURCES, key);
}
export function transientRetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RUN_TRANSIENT_RETRY?.trim().toLowerCase() !== 'off';
}

/** Retire du résultat la première tentative d'une source reprise : ses lignes, ses issues, son incident, son échec. */
function withdrawFirstAttempt(result: OrchestratorResult, key: string) {
  result.failures = result.failures.filter(line => !line.startsWith(`${key} (`));
  result.issues = (result.issues ?? []).filter(issue => issue.source !== key);
  result.incidents = result.incidents.filter(incident => incident.source !== key);
  result.failed--;
}

export async function retryTransientFailures(prisma: PrismaClient, result: OrchestratorResult, now: () => Date = () => new Date()): Promise<void> {
  const pending = result.pendingRetry ?? [];
  result.pendingRetry = [];
  if (!pending.length) return;
  const sources = pending.map(p => p.source);
  if (!transientRetryEnabled()) { await log.info('run.transient_retry_skipped', { reason: 'DISABLED', sources }); return; }
  if (pending.length > RUN_RETRY_MAX_SOURCES) {
    await log.warn('run.transient_retry_skipped', { reason: 'MASS_FAILURE', sources, max: RUN_RETRY_MAX_SOURCES });
    return;
  }
  const retries: NonNullable<OrchestratorResult['retries']> = [];
  const deadline = retryDeadline(now());
  const limit = pLimit(SOURCE_CONCURRENCY);
  const settled = await Promise.allSettled(pending.map(({ source: key, cause }) => limit(() => log.withContext({ sourceKey: key }, async () => {
    assertPipelineRunning(); log.assertHealthy();
    const kind = (await prisma.source.findUniqueOrThrow({ where: { key }, select: { kind: true } })).kind;
    const left = deadline - now().getTime();
    const skipped = retryExcluded(key, kind) ? 'EXCLUDED_SOURCE' : left < RUN_RETRY_MIN_MS ? 'DEADLINE' : null;
    // Non reprise : la première tentative reste telle quelle au bilan.
    if (skipped) { await log.info('source.retry_skipped', { sourceKey: key, cause, reason: skipped }); return; }
    withdrawFirstAttempt(result, key);
    await log.info('source.retry_started', { sourceKey: key, cause, budgetMs: left });
    await log.withContext({ connectorId: kind }, () => ingestOne(prisma, key, result, left, 'retry'));
    const absorbed = !(result.issues ?? []).some(issue => issue.source === key && !isNonBlockingIssue(key, issue));
    retries.push({ source: key, cause, absorbed });
    await log.info('source.retry_completed', { sourceKey: key, cause, absorbed });
  }))));
  result.retries = retries;
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason;
  await log.info('run.transient_retry_completed', { retried: retries.length,
    absorbed: retries.filter(r => r.absorbed).map(r => r.source), failedAgain: retries.filter(r => !r.absorbed).map(r => r.source) });
}

/**
 * Les familles de panne passagère que la source portait au dernier RUN complet avant celui-ci : une panne qui revient
 * n'est plus reprise (`ordinaryCauses.ts`). Lues dans `source.issue_classified` (la famille inscrite depuis D-520, sinon
 * relue depuis l'issue). Le RUN complet de référence est lu une fois par run journalisé.
 */
const previousCompleteRun = new Map<string, Promise<string | null>>();
export async function previousRunTransient(prisma: PrismaClient, key: string, currentRunId: string | null = log.runId() ?? null): Promise<Set<TransientKind>> {
  try {
    const cacheKey = currentRunId ?? '';
    const lookup = () => prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM "PipelineRun" r WHERE r.command = 'ingest-all' AND r.id <> ${cacheKey}
        AND EXISTS (SELECT 1 FROM "PipelineEvent" e WHERE e."runId" = r.id AND e.event = ${FULL_RUN_MARKER})
      ORDER BY r."startedAt" DESC LIMIT 1`.then(rows => rows[0]?.id ?? null);
    // Mis en cache par run journalisé seulement : hors run (commande locale, témoin), chaque lecture est fraîche.
    if (currentRunId && !previousCompleteRun.has(cacheKey)) previousCompleteRun.set(cacheKey, lookup());
    const runId = await (currentRunId ? previousCompleteRun.get(cacheKey)! : lookup());
    if (!runId) return new Set();
    const events = await prisma.pipelineEvent.findMany({ where: { runId, sourceKey: key, event: 'source.issue_classified' }, select: { payload: true } });
    const kinds = new Set<TransientKind>();
    for (const { payload } of events) {
      const p = payload as { issues?: IngestionIssue[]; remediation?: { transient?: TransientKind | null }[] };
      if (Array.isArray(p.remediation)) p.remediation.forEach(r => { if (r.transient) kinds.add(r.transient); });
      else (p.issues ?? []).forEach(issue => { const kind = transientKind(issue); if (kind) kinds.add(kind); });
    }
    return kinds;
  } catch (error) {
    previousCompleteRun.delete(currentRunId ?? '');
    // Sans l'historique, la panne est traitée comme une première occurrence ; l'absence d'historique se voit au journal.
    await log.warn('source.remediation_history_unavailable', { sourceKey: key, error: briefError(error) });
    return new Set();
  }
}

/** La remédiation de chaque issue d'une source, pour le journal, la ligne du bilan et l'alerte. */
async function remediationsOf(prisma: PrismaClient, key: string, issues: readonly IngestionIssue[], note: string | null, retried: boolean): Promise<Remediation[]> {
  const previous = await previousRunTransient(prisma, key);
  return issues.map(issue => remediationOf(key, issue, note, previous, retried));
}
const notes = (remediations: readonly Remediation[]) => [...new Set(remediations.map(remediationNote))].join(' ; ');
const alertLines = (remediations: readonly Remediation[]) => [...new Set(remediations.map(remediationLine))];


/**
 * D-520 : l'état opérationnel de la source, recalculé et écrit juste après sa collecte (RUN ou passe incrémentale D-517).
 * Une écriture refusée n'interrompt pas la collecte : elle est journalisée et comptée, et le RUN la lit comme une panne
 * du système (`cli.ts`, réconciliation).
 */
async function recordState(prisma: PrismaClient, key: string, result: OrchestratorResult, outcome: Omit<CollectionOutcome, 'kind' | 'at' | 'runId'>) {
  try {
    const state = await recordCollectionState(prisma, key, { ...outcome, kind: result.collectionKind ?? (incrementalPassActive() ? 'PASSE' : 'RUN'), at: new Date(), runId: log.runId() ?? null });
    (result.states ??= []).push(state);
  } catch (error) {
    log.assertHealthy();
    (result.stateFailures ??= []).push(key);
    await log.error('source.state_failed', `[orchestrator] ${key}: operational state not recorded — ${briefError(error)}`, { error });
  }
}

/**
 * Every source key, API feeds first then sitemap sources — and within the API
 * feeds, SMALLEST FIRST.
 *
 * The volume is wildly uneven: Foot Locker (2794) and L'Oréal Pro re-fetch
 * thousands of offers and eat minutes each, while most Maisons have well under a
 * hundred. Ordering the small feeds first means a run that is cut short has
 * still covered the maximum number of distinct Maisons — dozens of houses on the
 * board — instead of stalling on two giants and reaching no one else. The few
 * large feeds run last, where a cut costs the fewest employers.
 */
export async function allSourceKeys(prisma: PrismaClient): Promise<string[]> {
  const sources = await loadActiveSources(prisma);
  if (sources.some(source => !KIND_TO_ATS[source.kind])) throw new Error('ACTIVE source without supported collector');
  const apiKeys = sources
    .sort((a, b) => (a.lastRunJobs ?? 0) - (b.lastRunJobs ?? 0))
    .map((source) => source.key);
  return onlyRequested([...new Set(apiKeys)]);
}

/**
 * Run ciblé (décision Loïc, 2026-09-06) : « on arrête les runs trop longs,
 * il faut une solution localisée ». `INGEST_ONLY_KEYS="hermes,kering"` posé
 * sur le service Railway limite le run aux clés listées — depuis l'egress de
 * la prod (D32 : un poste local n'a pas le même), en quelques minutes, sans
 * les 490 autres sources. Une clé inconnue est signalée, pas ignorée en
 * silence. Vide ou absente : run complet.
 */
export function onlyRequested(keys: string[], raw = process.env.INGEST_ONLY_KEYS): string[] {
  const wanted = (raw ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  if (wanted.length === 0) return keys;
  const known = new Set(keys);
  const unknown = wanted.filter((k) => !known.has(k));
  if (unknown.length > 0) throw new Error(`INGEST_ONLY_KEYS : clés inconnues ou inactives — ${unknown.join(', ')}`);
  const set = new Set(wanted);
  return keys.filter((k) => set.has(k));
}

export async function ingestAllBySource(prisma: PrismaClient): Promise<OrchestratorResult> {
  assertPipelineRunning();
  const keys = await allSourceKeys(prisma);
  await log.info('run.sources_selected', { sources: keys.length, sourceKeys: keys, concurrency: SOURCE_CONCURRENCY, baseTimeoutMs: PER_SOURCE_TIMEOUT_MS });

  const result: OrchestratorResult = { total: keys.length, ok: 0, failed: 0, timedOut: 0, failures: [], incidents: [], issues: [] };

  // Smallest-first order is preserved by the limiter: the giants are still
  // started last, and now run side by side instead of one after the other.
  const limit = pLimit(SOURCE_CONCURRENCY);
  const settlements = await Promise.allSettled(keys.map((key) => limit(() => log.withContext({ sourceKey: key }, async () => {
    log.assertHealthy();
    const source = await prisma.source.findUniqueOrThrow({ where: { key }, select: { kind: true } });
    return log.withContext({ connectorId: source.kind }, () => ingestOne(prisma, key, result));
  }))));
  const failed = settlements.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason;
  await retryTransientFailures(prisma, result);

  if (!process.env.INGEST_ONLY_KEYS?.trim()) {
    assertPipelineRunning();
    // Only a complete, untargeted RUN reaches this point: the negative-proof guard takes its reference here (health.ts).
    await log.info(FULL_RUN_MARKER, await maintainReviewedSectors(prisma));
  }
  await log.info('run.sources_completed', `[orchestrator] done: ${result.ok}/${result.total} ok, ${result.failed} failed, ${result.timedOut} timed out` +
      (result.failures.length ? ` — ${result.failures.join(', ')}` : '') +
      (result.retries?.length ? ` ; reprises : ${result.retries.filter(r => r.absorbed).length}/${result.retries.length} absorbées` : ''));
  return result;
}

/**
 * The classification of one collected source run, exactly as the RUN applies it: its issues, and its incidents
 * annotated `blocking` so the alert and the bilan tell what fails the RUN from what stays only visible
 * (D-453 §1, D-456). A source with no issue — a team exclusion alone — blocks nothing and fails nothing.
 */
export function classifySourceRun(stats: IngestStats[], incidents: readonly SourceHealth[]): { issues: IngestionIssue[]; incidents: SourceHealth[] } {
  const issues = issuesFromResult(stats, incidents);
  const source = stats[0]?.source ?? '';
  const blocking = issues.some(issue => !isNonBlockingIssue(source, issue));
  // D-480 §1 : un échec connu reste visible, nommé par sa décision, jamais confondu avec une panne prouvée.
  const known = !blocking && issues.some(issue => isDecidedKnownFailure(source, issue));
  return { issues, incidents: incidents.map(incident => ({ ...incident, blocking, ...(known ? { knownFailure: KNOWN_FAILURE_DECISION } : {}) })) };
}

/**
 * Le verdict de la commande `ingest` (une source ciblée, ou toutes sans orchestrateur), avec la règle du RUN
 * (D-453 §1, D-480 §1) : une retenue prouvée par l'éditeur ou un échec connu décidé ne fait pas échouer la commande.
 * Mesuré le 30/09/2026 : la collecte ciblée de LVMH (6 233 offres publiées, une annonce de test retenue sur la preuve
 * de l'éditeur) finissait en échec et signalait la surveillance, quand le RUN l'aurait comptée saine.
 */
export function ingestCommandVerdict(stats: IngestStats[], incidents: readonly SourceHealth[]) {
  const perSource = stats.map(stat => classifySourceRun([stat], incidents.filter(incident => incident.source === stat.source)));
  const issues = perSource.flatMap(({ issues }, i) => issues.map(issue => ({ ...issue, source: stats[i].source })));
  const blocking = issues.filter(issue => !isNonBlockingIssue(issue.source, issue));
  return { ok: stats.length > 0 && blocking.length === 0, issues, blocking, incidents: perSource.flatMap(r => r.incidents) };
}

/**
 * One source, bounded by its own timeout; the counters it touches are shared. The RUN and the discovery pass (R-143 §1,
 * D-517, `lightPass.ts`) run exactly this step. Inside a pass (`withIncrementalPass`), the collection is an incremental
 * reading (`ingest.ts`), its health row compares to nothing, and neither success nor failure touches `Source.lastRun*`;
 * the pass also lowers the timeout to what its own window has left.
 */
export async function ingestOne(prisma: PrismaClient, key: string, result: OrchestratorResult, maxTimeoutMs = Infinity,
  attempt: 'first' | 'retry' = 'first'): Promise<void> {
  const started = Date.now();
  let timeoutMs = PER_SOURCE_TIMEOUT_MS;
  try {
    await log.info('source_sync_started', { sourceKey: key });
    timeoutMs = Math.min(await sourceTimeoutFor(prisma, key), maxTimeoutMs);
    // runIngest with {only} seals the source's end-of-ingestion report; no
    // closure happens in this pass. Geocoding is skipped here and run ONCE by
    // the CLI after every source — a per-source pass would run four times over
    // the same cities in parallel. The soft deadline lets a slow crawl stop
    // gracefully just before the hard timeout, keeping what it fetched.
    const stats = await runQualifiedIngest(prisma, key, true, timeoutMs);
    if (stats.length !== 1 || stats[0].source !== key) throw new TypeError('Expected one result for the selected ACTIVE source');
    // Record this source's health so a source that stops producing becomes a
    // detectable incident (BROKEN) on its next run — one SourceRun per source.
    // Collect any incident so the run can send ONE digest at the end.
    // D-517 : une collecte de la passe (lecture incrémentale, réussie ou non) ne se compare à aucune collecte et ne
    // touche pas le résumé du catalogue.
    const health = incrementalPassActive() ? await recordIncrementalRun(prisma, stats[0]) : await checkSourceHealth(prisma, stats);
    const { issues, incidents } = classifySourceRun(stats, health.incidents);
    result.incidents.push(...incidents);
    result.issues!.push(...issues.map(issue => ({ ...issue, source: key })));
    // L'erreur de collecte est absorbée par `runIngest` (`source.ingest_failed`) : son message est la note de la source.
    const remediation = issues.length ? await remediationsOf(prisma, key, issues, stats[0].errorNote ?? null, attempt === 'retry') : [];
    if (remediation.length) incidents.forEach(incident => { incident.remediation = alertLines(remediation); });
    if (issues.length) await log.warn('source.issue_classified', { sourceKey: key, issues, acceptedNativeOnly: issues.every(isProvenSourceIssue),
      knownFailure: issues.some(issue => isDecidedKnownFailure(key, issue)), remediation, attempt });
    await log.info('source_sync_completed', { sourceKey: key, durationMs: Date.now() - started, fetched: stats.reduce((n, s) => n + s.fetched, 0), created: stats.reduce((n, s) => n + s.created, 0), updated: stats.reduce((n, s) => n + s.updated, 0), held: stats.reduce((n, s) => n + (s.held ?? 0), 0), errors: stats.reduce((n, s) => n + s.errors, 0), http: log.counters(key), stats, health: { broken: health.broken, degraded: health.degraded } });
    if (issues.length) {
      // A retention decided on native evidence stays counted and listed (D-453 §1); its line says it does not block.
      result.failed++;
      result.failures.push(failureLine(key, issues, `erreurs d’ingestion · ${notes(remediation)}`));
      // D-520 : une source dont TOUTES les issues sont passagères à leur première occurrence est reprise une fois.
      if (attempt === 'first' && !incrementalPassActive() && remediation.every(r => r.retry))
        (result.pendingRetry ??= []).push({ source: key, cause: remediation[0].transient! });
    } else result.ok++;
    const own = health.incidents.find(incident => incident.source === key);
    await recordState(prisma, key, result, { runStatus: own?.status ?? 'OK', note: own?.note ?? null, issues, retried: attempt === 'retry',
      jobs: own?.jobs ?? stats.reduce((n, s) => n + s.created + s.merged + s.updated, 0) });
  } catch (error) {
    log.assertHealthy();
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = message.startsWith('__TIMEOUT__');
    /**
     * Un anti-bot n'est ni une panne d'adaptateur ni une source vide : c'est un
     * refus d'accès, souvent temporaire, et il se règle autrement (amorçage
     * navigateur, politesse par hôte). Le nommer CHALLENGED évite d'envoyer
     * chercher un bug qui n'existe pas — le cas L'Oréal a coûté deux
     * diagnostics erronés avant d'être compris (D51).
     */
    const challenged = error instanceof WafChallengeError;
    const issue = ingestionIssue(error);
    const remediation = await remediationsOf(prisma, key, [issue], message, attempt === 'retry');
    result.issues!.push({ ...issue, source: key });
    // D-520 : un échec passager à sa première occurrence est repris une fois en fin de RUN (jamais dans une passe).
    if (attempt === 'first' && !timedOut && !challenged && !incrementalPassActive() && remediation[0].retry)
      (result.pendingRetry ??= []).push({ source: key, cause: remediation[0].transient! });
    // Nothing collected to the end: the refresh leaves the source's offers open (L-01), the alert says so.
    result.incidents.push({ source: key, status: 'BROKEN', jobs: 0, previous: null, blocking: !isNonBlockingIssue(key, issue),
      ...(isDecidedKnownFailure(key, issue) ? { knownFailure: KNOWN_FAILURE_DECISION } : {}),
      notCollected: true, note: `${issue.origin}/${issue.code}: ${briefError(error)}`, remediation: alertLines(remediation) });
    await log.warn('source.issue_classified', { sourceKey: key, issues: [issue], acceptedNativeOnly: isProvenSourceIssue(issue), remediation, attempt });
    if (timedOut) {
      result.timedOut++;
      result.failures.push(failureLine(key, [issue], `délai dépassé · ${notes(remediation)}`));
      await log.error('source.timed_out', `[orchestrator] ${key}: timed out after ${Math.round(timeoutMs / 1000)}s, moving on`, { error });
    } else if (challenged) {
      result.failed++;
      result.failures.push(failureLine(key, [issue], `anti-bot · ${notes(remediation)}`));
      await log.error('source.challenged', `[orchestrator] ${key}: bloqué par un anti-bot (${error.vendor}) — offres conservées`, { error });
    } else {
      result.failed++;
      result.failures.push(failureLine(key, [issue], `échec · ${notes(remediation)}`));
      await log.error('source.failed', `[orchestrator] ${key}: failed — ${briefError(error)}`, { error });
    }
    // L-01: a source that did not finish gets a SourceRun anyway — TIMEOUT or
    // ERROR — so the refresh knows its offers were NOT re-attested this run
    // and leaves them open. Without this row the refresh saw only silence,
    // which is indistinguishable from "the source listed nothing".
    const status = timedOut ? 'TIMEOUT' : challenged ? 'CHALLENGED' : 'ERROR';
    // Keep the catalogue's last-run summary in the same transaction as the
    // failed attempt. Otherwise a refused admission leaves yesterday's OK
    // count/rates visible even though SourceRun records today's error.
    await prisma.$transaction(async tx => {
      await tx.sourceRun.create({
        data: {
          sourceKey: key,
          ...(log.runId() ? { runId: log.runId() } : {}),
          status,
          jobs: 0,
          canAttestAbsence: false,
          note: timedOut
            ? `cut at ${Math.round(timeoutMs / 1000)}s`
            : challenged
              ? `anti-bot ${(error as WafChallengeError).vendor} : page d'attente servie, aucune offre lue`
              : briefError(error),
        },
      });
      // D-517 : l'échec d'une lecture incrémentale reste dans SourceRun ; le résumé du catalogue reste celui du RUN.
      if (!incrementalPassActive()) await recordSourceRunSummary(tx, key, { status, jobs: 0 });
    }, SOURCE_WRITE_TRANSACTION).catch(async (error) => {
      await log.error('source.record_failed', `[orchestrator] ${key}: failed to record run — ${briefError(error)}`, { error });
      throw error;
    });
    await recordState(prisma, key, result, { runStatus: status, jobs: 0, issues: [issue], note: briefError(error), retried: attempt === 'retry' });
  } finally {
    await log.flush(key);
  }
}

/**
 * The qualification capture a campaign (`source-campaign --ingest`) collected, validated and qualified access from, handed
 * to its ingestion child, which runs as a distinct run (`ingestionChildEnvironment`). Ralph Lauren, release r5 of 02/10/2026:
 * the campaign read 1 362 requests, then the child read the site again 32 s later and got the Avature 406. The capture
 * is adopted only if it belongs to the named run and meets every other condition (`capture/adoption.ts`).
 */
export type CaptureHandoff = { captureId: string; runId: string | null };

/** Read from the environment the campaign parent gives its child; absent anywhere else (RUN, light pass, CLI). */
export function captureHandoffFromEnv(env: NodeJS.ProcessEnv = process.env): CaptureHandoff | undefined {
  const captureId = env.INGEST_ADOPT_CAPTURE?.trim();
  return captureId ? { captureId, runId: env.INGEST_ADOPT_RUN?.trim() || null } : undefined;
}

/** Normal and explicitly scoped runs maintain the same admission prerequisite. When that maintenance had to collect a
 * native qualification capture, the ingestion adopts it instead of reading the site a second time (lecture unique,
 * `capture/adoption.ts`), or reads the site under its decision when the capture does not qualify. */
export async function runQualifiedIngest(prisma: PrismaClient, key: string, skipGeocode = true, timeoutMs?: number, handoff?: CaptureHandoff) {
  const budget = timeoutMs ?? await sourceTimeoutFor(prisma, key);
  return withSourceBudget(async () => {
    const access = await maintainSourceAccess(prisma, key, budget);
    // This turn's own qualification first; otherwise the capture a campaign parent qualified and handed over explicitly.
    const adoption = access.qualificationCaptureId ? { adoptCaptureId: access.qualificationCaptureId }
      : handoff ? { adoptCaptureId: handoff.captureId, adoptCaptureRunId: handoff.runId } : {};
    return runIngest(prisma, { only: key, skipGeocode, ...adoption });
  }, budget, key,
  { softTimeoutMs: Math.floor(budget - Math.min(SOFT_DEADLINE_MARGIN_MS, budget / 10)) });
}

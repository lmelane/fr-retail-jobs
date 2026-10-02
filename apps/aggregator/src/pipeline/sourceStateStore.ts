/**
 * D-520 — la persistance de l'état opérationnel des sources (`SourceOperationalState`) et sa lecture.
 *
 *   · `recordCollectionState` : après chaque collecte (RUN, passe incrémentale, vérification ciblée), l'état de la source
 *     est recalculé depuis l'état précédent et écrit tout de suite ;
 *   · `reconcileSourceStates` : à la fin des collectes d'un RUN, chaque source du registre reçoit son état : les sources
 *     actives que ce RUN n'a pas collectées deviennent NON_COLLECTEE, les autres prennent l'état de leur intention, les
 *     échéances passées s'escaladent ;
 *   · `readSourceStatesReport` : la lecture (commande `etat-sources`, futur écran du back-office), sans écriture.
 */
import type { PrismaClient } from '@prisma/client';
import { ageState, computeSourceState, intentState, summarizeStates, type CauseClass, type CollectionOutcome, type CollectionKind,
  type IssueLike, type OperationalState, type RegistryIntent, type SourceState, type StateSummary, type Trajectory } from './sourceState.js';
import { ingestionIssue } from '../lib/ingestionIssue.js';
import { WafChallengeError } from '../lib/wafToken.js';
import { briefError } from '../lib/normalize.js';
import { log } from '../observability/logger.js';
import type { SourceHealth } from './health.js';
import type { IngestStats } from './ingest.js';

type Db = Pick<PrismaClient, 'source' | 'sourceOperationalState'>;

/** L'intention et son explication au registre explicite (`registry/explicitRegistry.ts`), lues ensemble. */
const REGISTRY_SELECT = { key: true, status: true, note: true, statusReviewId: true, statusExplainedFor: true, statusTrajectory: true,
  statusDecision: true, statusNextAction: true, statusReviewAt: true } as const;
type RegistryRow = { key: string; status: string; note: string | null; statusReviewId: string | null; statusExplainedFor: string | null;
  statusTrajectory: string | null; statusDecision: string | null; statusNextAction: string | null; statusReviewAt: Date | null };
const intentOf = (row: RegistryRow): RegistryIntent => ({ key: row.key, status: row.status, note: row.note, registry: {
  reviewId: row.statusReviewId, explainedFor: row.statusExplainedFor, trajectory: row.statusTrajectory, decision: row.statusDecision,
  nextAction: row.statusNextAction, reviewAt: row.statusReviewAt ? row.statusReviewAt.toISOString().slice(0, 10) : null } });
type Row = Awaited<ReturnType<PrismaClient['sourceOperationalState']['findMany']>>[number];

const fromRow = (row: Row): SourceState => ({ sourceKey: row.sourceKey, state: row.state as OperationalState, cause: row.cause as CauseClass | null,
  trajectory: row.trajectory as Trajectory | null, missing: row.missing, since: row.since, deadline: row.deadline, attempts: row.attempts,
  escalated: row.escalated, decision: row.decision, codes: row.codes, lastCollectionAt: row.lastCollectionAt,
  lastCollectionKind: row.lastCollectionKind as CollectionKind | null, lastRunId: row.lastRunId, computedAt: row.computedAt });

async function write(db: Db, state: SourceState): Promise<void> {
  const { sourceKey, ...data } = state;
  await db.sourceOperationalState.upsert({ where: { sourceKey }, create: { sourceKey, ...data }, update: data });
}

/** L'état d'une source après une collecte, écrit tout de suite. */
export async function recordCollectionState(db: Db, sourceKey: string, outcome: CollectionOutcome, now = new Date()): Promise<SourceState> {
  const [source, previous] = await Promise.all([
    db.source.findUniqueOrThrow({ where: { key: sourceKey }, select: REGISTRY_SELECT }),
    db.sourceOperationalState.findUnique({ where: { sourceKey } }),
  ]);
  const state = computeSourceState({ source: intentOf(source), outcome, previous: previous ? fromRow(previous) : null, now });
  await write(db, state);
  return state;
}

/**
 * La collecte ciblée d'une source hors orchestrateur (`ingest --source`, campagne) : son état est écrit tout de suite,
 * réussie ou non. Ne lève jamais : un état non écrit est journalisé, la commande garde son propre verdict.
 */
export async function recordVerification(db: Db, sourceKey: string, input: { error?: unknown; incident?: SourceHealth | null;
  issues?: readonly IssueLike[]; stats?: readonly IngestStats[] }): Promise<SourceState | null> {
  try {
    const error = input.error;
    const outcome: CollectionOutcome = error !== undefined
      ? { kind: 'VERIFICATION', at: new Date(), runId: log.runId() ?? null, jobs: 0, issues: [ingestionIssue(error)], note: briefError(error),
        runStatus: error instanceof Error && error.message.startsWith('__TIMEOUT__') ? 'TIMEOUT' : error instanceof WafChallengeError ? 'CHALLENGED' : 'ERROR' }
      : { kind: 'VERIFICATION', at: new Date(), runId: log.runId() ?? null, runStatus: input.incident?.status ?? 'OK', note: input.incident?.note ?? null,
        issues: input.issues ?? [], jobs: input.incident?.jobs ?? (input.stats ?? []).reduce((n, s) => n + s.created + s.merged + s.updated, 0) };
    return await recordCollectionState(db, sourceKey, outcome);
  } catch (failure) {
    log.assertHealthy();
    await log.error('source.state_failed', `[ingest] ${sourceKey}: operational state not recorded — ${briefError(failure)}`, { error: failure });
    return null;
  }
}

/**
 * La fin d'un RUN : chaque source du registre a un état. `collected` : les sources dont ce RUN a terminé la collecte
 * (réussie ou non) ; leur état vient d'être écrit par `recordCollectionState`, il n'est que vieilli ici.
 */
export async function reconcileSourceStates(db: Db, input: { collected: ReadonlySet<string>; now?: Date;
  /** RUN ciblé (`INGEST_ONLY_KEYS`) : une source active hors de sa liste garde son état, elle n'est pas « non collectée ». */
  partial?: boolean }): Promise<SourceState[]> {
  const now = input.now ?? new Date();
  const [sources, rows] = await Promise.all([
    db.source.findMany({ select: REGISTRY_SELECT, orderBy: { key: 'asc' } }),
    db.sourceOperationalState.findMany(),
  ]);
  const previous = new Map(rows.map(row => [row.sourceKey, fromRow(row)]));
  const states: SourceState[] = [];
  for (const source of sources) {
    const before = previous.get(source.key) ?? null;
    const kept = source.status === 'ACTIVE' && before && (input.collected.has(source.key) || input.partial)
      && !['EN_PAUSE', 'EXCLUE'].includes(before.state) && before.cause !== 'ACTIVATION_A_FAIRE';
    const state = kept ? ageState(before, now)
      : computeSourceState({ source: intentOf(source), outcome: null, previous: before, now });
    if (!before || JSON.stringify(stable(before)) !== JSON.stringify(stable(state))) await write(db, state);
    states.push(state);
  }
  return states;
}

/** Ce qui compte pour décider d'une réécriture (l'heure du calcul seule ne la justifie pas). */
const stable = (state: SourceState) => ({ ...state, computedAt: null });

export type SourceStatesReport = {
  at: string;
  /** Sources actives sans état calculé : aucune collecte depuis la mise en place de l'état opérationnel. */
  neverComputed: number;
  summary: Omit<StateSummary, 'sources'>;
  sources: Array<Omit<StateSummary['sources'][number], 'since' | 'deadline'> & { maison: string; since: string; deadline: string | null }>;
};

/** La lecture, sans écriture : l'intention du registre fait foi pour toute source non active, les échéances sont vieillies à `now`. */
export async function readSourceStatesReport(db: Db, now = new Date()): Promise<SourceStatesReport> {
  const [sources, rows] = await Promise.all([
    db.source.findMany({ select: { ...REGISTRY_SELECT, maison: true }, orderBy: { key: 'asc' } }),
    db.sourceOperationalState.findMany(),
  ]);
  const persisted = new Map(rows.map(row => [row.sourceKey, fromRow(row)]));
  let neverComputed = 0;
  const states = sources.map(source => {
    const before = persisted.get(source.key) ?? null;
    const intent = intentState(intentOf(source), before, now);
    if (intent) return intent;
    if (!before) neverComputed++;
    // Une source réactivée garde la ligne de son intention passée : tant qu'aucune collecte ne l'a recalculée, elle n'est pas collectée.
    if (!before || ['EN_PAUSE', 'EXCLUE'].includes(before.state) || before.cause === 'ACTIVATION_A_FAIRE')
      return computeSourceState({ source: intentOf(source), outcome: null, previous: before, now });
    return ageState(before, now);
  });
  const { sources: list, ...summary } = summarizeStates(states, now);
  const maison = new Map(sources.map(source => [source.key, source.maison]));
  return { at: now.toISOString(), neverComputed, summary,
    sources: list.map(s => ({ ...s, maison: maison.get(s.sourceKey) ?? s.sourceKey, since: s.since.toISOString(), deadline: s.deadline?.toISOString() ?? null })) };
}

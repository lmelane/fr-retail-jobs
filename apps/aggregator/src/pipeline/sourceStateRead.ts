/**
 * D-520 — la LECTURE de l'état opérationnel des sources (`SourceOperationalState`), sans écriture ni dépendance au worker.
 *
 * Extraite telle quelle de `sourceStateStore.ts` (D-522 §5) : la commande `etat-sources` et la console Agrégateur du
 * back-office (route `/api/ops/*` de l'API du catalogue) lisent par ICI, avec le même calcul ; `sourceStateStore.ts`
 * garde les écritures et réexporte `readSourceStatesReport`. L'intention du registre fait foi pour toute source non
 * active ; les échéances sont vieillies à `now`.
 */
import type { PrismaClient } from '@prisma/client';
import { ageState, computeSourceState, intentState, summarizeStates, type CauseClass, type CollectionKind, type OperationalState,
  type RegistryIntent, type SourceState, type StateSummary, type Trajectory } from './sourceState.js';

export type Db = Pick<PrismaClient, 'source' | 'sourceOperationalState'>;

/** L'intention et son explication au registre explicite (`registry/explicitRegistry.ts`), lues ensemble. */
export const REGISTRY_SELECT = { key: true, status: true, note: true, statusReviewId: true, statusExplainedFor: true, statusTrajectory: true,
  statusDecision: true, statusNextAction: true, statusReviewAt: true } as const;
type RegistryRow = { key: string; status: string; note: string | null; statusReviewId: string | null; statusExplainedFor: string | null;
  statusTrajectory: string | null; statusDecision: string | null; statusNextAction: string | null; statusReviewAt: Date | null };
export const intentOf = (row: RegistryRow): RegistryIntent => ({ key: row.key, status: row.status, note: row.note, registry: {
  reviewId: row.statusReviewId, explainedFor: row.statusExplainedFor, trajectory: row.statusTrajectory, decision: row.statusDecision,
  nextAction: row.statusNextAction, reviewAt: row.statusReviewAt ? row.statusReviewAt.toISOString().slice(0, 10) : null } });
type Row = Awaited<ReturnType<PrismaClient['sourceOperationalState']['findMany']>>[number];

export const fromRow = (row: Row): SourceState => ({ sourceKey: row.sourceKey, state: row.state as OperationalState, cause: row.cause as CauseClass | null,
  trajectory: row.trajectory as Trajectory | null, missing: row.missing, since: row.since, deadline: row.deadline, attempts: row.attempts,
  escalated: row.escalated, decision: row.decision, codes: row.codes, lastCollectionAt: row.lastCollectionAt,
  lastCollectionKind: row.lastCollectionKind as CollectionKind | null, lastRunId: row.lastRunId, computedAt: row.computedAt });

export type SourceStatesReading = {
  /** L'état de CHAQUE source du registre, normales comprises, dans l'ordre des clés. */
  states: SourceState[];
  maison: ReadonlyMap<string, string>;
  /** Sources actives sans état calculé : aucune collecte depuis la mise en place de l'état opérationnel. */
  neverComputed: number;
  /** Leurs clés : leur état lu (« non collectée ») est une déduction, pas un calcul après collecte. */
  neverComputedKeys: ReadonlySet<string>;
  /** Lignes `SourceOperationalState` lues : 0 sur une base où aucun RUN n'a encore calculé l'état (avant r6). */
  persisted: number;
  /** Les sources qui ont une ligne : sans elle, « depuis » est l'instant de la lecture, pas le début de l'épisode. */
  persistedKeys: ReadonlySet<string>;
};

/** L'état de toutes les sources, tel que `etat-sources` le calcule, sans rien écrire. */
export async function readSourceStates(db: Db, now = new Date()): Promise<SourceStatesReading> {
  const [sources, rows] = await Promise.all([
    db.source.findMany({ select: { ...REGISTRY_SELECT, maison: true }, orderBy: { key: 'asc' } }),
    db.sourceOperationalState.findMany(),
  ]);
  const persisted = new Map(rows.map(row => [row.sourceKey, fromRow(row)]));
  const neverComputedKeys = new Set<string>();
  const states = sources.map(source => {
    const before = persisted.get(source.key) ?? null;
    const intent = intentState(intentOf(source), before, now);
    if (intent) return intent;
    if (!before) neverComputedKeys.add(source.key);
    // Une source réactivée garde la ligne de son intention passée : tant qu'aucune collecte ne l'a recalculée, elle n'est pas collectée.
    if (!before || ['EN_PAUSE', 'EXCLUE'].includes(before.state) || before.cause === 'ACTIVATION_A_FAIRE')
      return computeSourceState({ source: intentOf(source), outcome: null, previous: before, now });
    return ageState(before, now);
  });
  return { states, maison: new Map(sources.map(source => [source.key, source.maison])), neverComputed: neverComputedKeys.size, neverComputedKeys,
    persisted: rows.length, persistedKeys: new Set(persisted.keys()) };
}

export type SourceStatesReport = {
  at: string;
  /** Sources actives sans état calculé : aucune collecte depuis la mise en place de l'état opérationnel. */
  neverComputed: number;
  summary: Omit<StateSummary, 'sources'>;
  sources: Array<Omit<StateSummary['sources'][number], 'since' | 'deadline'> & { maison: string; since: string; deadline: string | null }>;
};

/** La lecture, sans écriture : l'intention du registre fait foi pour toute source non active, les échéances sont vieillies à `now`. */
export async function readSourceStatesReport(db: Db, now = new Date()): Promise<SourceStatesReport> {
  const { states, maison, neverComputed } = await readSourceStates(db, now);
  const { sources: list, ...summary } = summarizeStates(states, now);
  return { at: now.toISOString(), neverComputed, summary,
    sources: list.map(s => ({ ...s, maison: maison.get(s.sourceKey) ?? s.sourceKey, since: s.since.toISOString(), deadline: s.deadline?.toISOString() ?? null })) };
}

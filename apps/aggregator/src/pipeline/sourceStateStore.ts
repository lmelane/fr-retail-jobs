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
import { ageState, computeSourceState, type CollectionOutcome, type IssueLike, type SourceState } from './sourceState.js';
import { fromRow, intentOf, REGISTRY_SELECT, type Db } from './sourceStateRead.js';
import { ingestionIssue } from '../lib/ingestionIssue.js';
import { WafChallengeError } from '../lib/wafToken.js';
import { briefError } from '../lib/normalize.js';
import { log } from '../observability/logger.js';
import type { SourceHealth } from './health.js';
import type { IngestStats } from './ingest.js';

/** La lecture vit dans `sourceStateRead.ts` (sans dépendance au worker), réexportée ici pour les appelants existants. */
export { readSourceStatesReport, type SourceStatesReport } from './sourceStateRead.js';

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

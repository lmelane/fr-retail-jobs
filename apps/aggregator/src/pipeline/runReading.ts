/**
 * D-522 §5 — le dernier RUN et son verdict, LUS dans ce que le RUN a lui-même écrit : sa ligne `PipelineRun` et ses
 * événements `PipelineEvent`. Aucun recalcul : le verdict est la réconciliation que `cli.ts` journalise à la fin du RUN
 * (`run.reconciled`, D-520 §4) ; un RUN antérieur à l'état opérationnel n'a que ses motifs de blocage
 * (`command.failed`), dits tels quels. Lecture seule, sans dépendance au worker.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { LIGHT_PASS_RUN_COMMAND } from './referenceRuns.js';

/** La commande du RUN complet quotidien (`cli.ts`, `worker.ts`). */
export const FULL_RUN_COMMAND = 'ingest-all';

type Db = Prisma.TransactionClient | PrismaClient;

export type RunVerdictReading =
  /** La réconciliation de D-520 §4, telle que le RUN l'a journalisée. */
  | { kind: 'RECONCILIATION'; green: boolean; reasons: Array<{ reason: string; detail: string; sources: string[] }>;
      toVerify: Array<{ reason: string; detail: string; sources: string[] }> }
  /** Un RUN sans réconciliation (avant r6) : ses seuls motifs de blocage. */
  | { kind: 'BLOCAGE'; blockingReasons: string[] }
  /** Terminé sans réconciliation ni blocage journalisés, ou encore en cours. */
  | { kind: 'AUCUN' };

export type RunReading = { id: string; command: string; status: string; revision: string | null; startedAt: string; finishedAt: string | null;
  verdict: RunVerdictReading };

const asStrings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const asReasons = (v: unknown) => Array.isArray(v) ? v.flatMap(r => r && typeof r === 'object' && typeof (r as { reason?: unknown }).reason === 'string'
  ? [{ reason: (r as { reason: string }).reason, detail: String((r as { detail?: unknown }).detail ?? ''), sources: asStrings((r as { sources?: unknown }).sources) }] : []) : [];

/** Le verdict d'un RUN, lu dans ses événements (la dernière réconciliation journalisée fait foi). */
export function verdictOf(events: ReadonlyArray<{ event: string; payload: unknown }>): RunVerdictReading {
  const reconciled = [...events].reverse().find(e => e.event === 'run.reconciled')?.payload as Record<string, unknown> | undefined;
  if (reconciled && typeof reconciled.green === 'boolean')
    return { kind: 'RECONCILIATION', green: reconciled.green, reasons: asReasons(reconciled.reasons), toVerify: asReasons(reconciled.toVerify) };
  const failed = [...events].reverse().find(e => e.event === 'command.failed')?.payload as Record<string, unknown> | undefined;
  if (failed && Array.isArray(failed.blockingReasons)) return { kind: 'BLOCAGE', blockingReasons: asStrings(failed.blockingReasons) };
  return { kind: 'AUCUN' };
}

async function reading(db: Db, run: { id: string; command: string; status: string; revision: string | null; startedAt: Date; finishedAt: Date | null } | null): Promise<RunReading | null> {
  if (!run) return null;
  const events = await db.pipelineEvent.findMany({ where: { runId: run.id, event: { in: ['run.reconciled', 'command.failed'] } },
    orderBy: { at: 'asc' }, select: { event: true, payload: true } });
  return { id: run.id, command: run.command, status: run.status, revision: run.revision, startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null, verdict: verdictOf(events) };
}

const RUN_SELECT = { id: true, command: true, status: true, revision: true, startedAt: true, finishedAt: true } as const;

/**
 * Le RUN complet en cours (s'il y en a un), le dernier RUN complet terminé et la dernière passe de découverte. Un RUN
 * marqué RUNNING depuis plus de 12 h est dit tel quel : la console ne devine pas qu'il est mort.
 */
export async function readRunOverview(db: Db): Promise<{ current: RunReading | null; last: RunReading | null; lastLightPass: RunReading | null }> {
  const [current, last, lastLightPass] = await Promise.all([
    db.pipelineRun.findFirst({ where: { command: FULL_RUN_COMMAND, finishedAt: null }, orderBy: { startedAt: 'desc' }, select: RUN_SELECT }),
    db.pipelineRun.findFirst({ where: { command: FULL_RUN_COMMAND, finishedAt: { not: null } }, orderBy: { startedAt: 'desc' }, select: RUN_SELECT }),
    db.pipelineRun.findFirst({ where: { command: LIGHT_PASS_RUN_COMMAND, finishedAt: { not: null } }, orderBy: { startedAt: 'desc' }, select: RUN_SELECT }),
  ]);
  return { current: await reading(db, current), last: await reading(db, last), lastLightPass: await reading(db, lastLightPass) };
}

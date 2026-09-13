import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { OperationalLogger, installLogger, redact } from './logger.js';
import { startResourceSampling } from './resources.js';

export type RunStatus = 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';

/**
 * Signals the platform sends before stopping a container. Railway stops the
 * previous deployment's container when a new deployment succeeds; without a
 * handler the run stayed `RUNNING` in the database forever (measured on
 * 2026-09-09: the Talentsoft/iCIMS validation run was stopped at 18:35:11 UTC
 * by the deployment of PR 60 and never closed). An interrupted run is closed
 * as `INTERRUPTED`, with the signal and the deployment that owned it.
 */
const STOP_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

export async function startObservability(prisma: PrismaClient, command: string) {
  const runId = randomUUID();
  const logger = new OperationalLogger({ runId, production: process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_DEPLOYMENT_ID),
    persist: async record => {
      await prisma.pipelineEvent.create({ data: { ...record, payload: record.payload as Prisma.InputJsonValue } });
    },
  });
  // Failure here aborts startup, before any business work. No false healthy run.
  await prisma.pipelineRun.create({ data: { id: runId, command, revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? null } });
  installLogger(logger);
  await logger.emit('info', 'run.started', { command, deploymentId: process.env.RAILWAY_DEPLOYMENT_ID, logSpacingMs: 25, debugEnabled: !(process.env.NODE_ENV === 'production' || process.env.RAILWAY_DEPLOYMENT_ID) });

  let closed = false;
  const close = async (status: RunStatus | 'INTERRUPTED', extra: Record<string, unknown> = {}) => {
    if (closed) return false;
    closed = true;
    await logger.flush();
    if (status !== 'INTERRUPTED') logger.assertHealthy();
    await logger.emit(status === 'FAILED' || status === 'INTERRUPTED' ? 'error' : 'info', status === 'INTERRUPTED' ? 'run.interrupted' : 'run.completed', { command, status, ...extra, ...logger.metrics });
    await logger.flush();
    await prisma.pipelineRun.update({ where: { id: runId }, data: { status, finishedAt: new Date(), metrics: redact({ ...logger.metrics, ...extra }) as Prisma.InputJsonValue } });
    return true;
  };

  const onSignal = (signal: NodeJS.Signals) => {
    // The container is being stopped: record the interruption, then exit with the conventional code.
    void interrupt(signal).finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  };
  for (const signal of STOP_SIGNALS) process.once(signal, onSignal);
  const detach = () => { for (const signal of STOP_SIGNALS) process.removeListener(signal, onSignal); };

  /** Closes the run as INTERRUPTED (idempotent). Exposed so a test can exercise it without a real signal. */
  async function interrupt(signal: string): Promise<boolean> {
    detach();
    try { return await closeWithResources('INTERRUPTED', { signal, deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null }); }
    catch { return false; }
  }

  /**
   * L'échantillonnage des ressources tourne PENDANT le run, dans ce processus — c'est la seule mesure qui
   * décrive le conteneur qui travaille (leçon D32 : un environnement voisin n'est pas la source). Il est
   * `unref` et tolérant : un échantillon manqué ne doit jamais faire échouer un run.
   */
  const resources = startResourceSampling(prisma);

  async function closeWithResources(status: RunStatus | 'INTERRUPTED', extra: Record<string, unknown> = {}) {
    let report: unknown = null;
    try { report = await resources.stop(); }
    catch (error) { report = { unavailable: `échantillonnage indisponible : ${(error as Error).message.slice(0, 120)}` }; }
    return close(status, { ...extra, resources: report });
  }

  return {
    runId, logger, interrupt,
    async finish(status: RunStatus) {
      detach();
      await closeWithResources(status);
    },
  };
}

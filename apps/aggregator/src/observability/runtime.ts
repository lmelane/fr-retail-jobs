import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { OperationalLogger, installLogger, redact } from './logger.js';

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
  return {
    runId, logger,
    async finish(status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED') {
      await logger.flush();
      logger.assertHealthy();
      await logger.emit(status === 'FAILED' ? 'error' : 'info', 'run.completed', { command, status, ...logger.metrics });
      await logger.flush();
      await prisma.pipelineRun.update({ where: { id: runId }, data: { status, finishedAt: new Date(), metrics: redact(logger.metrics) as Prisma.InputJsonValue } });
    },
  };
}

/** Read-only operational status. A stale RUNNING row is never proof of a live process. */
import { PrismaClient } from '@prisma/client';
import { pipelinePaused } from '../../src/lib/pipelinePause.js';
const db = new PrismaClient({ errorFormat: 'minimal', log: [] });
try {
  const report = await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
    const [lastRun, running, lastCapture, lastFailure] = await Promise.all([
      tx.pipelineRun.findFirst({ orderBy: { startedAt: 'desc' }, omit: { metrics: true } }),
      tx.pipelineRun.findMany({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, take: 10,
        select: { id: true, command: true, startedAt: true, events: { where: { event: { in: ['run.started', 'run.alive'] } }, orderBy: { at: 'desc' }, take: 1, select: { at: true, event: true } } } }),
      tx.captureBatch.findFirst({ where: { purpose: 'JOBS' }, orderBy: { startedAt: 'desc' }, select: { id: true, sourceKey: true, startedAt: true } }),
      tx.pipelineEvent.findFirst({ where: { level: 'error' }, orderBy: { at: 'desc' }, select: { runId: true, at: true, event: true, sourceKey: true } }),
    ]);
    return { paused: pipelinePaused(), lastRun, running: running.map(r => ({ ...r,
      process: r.events[0] && Date.now() - r.events[0].at.getTime() < 90_000 ? 'RECENTLY_OBSERVED_ALIVE' : 'UNVERIFIED' })), lastCapture, lastFailure };
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2));
} finally { await db.$disconnect(); }

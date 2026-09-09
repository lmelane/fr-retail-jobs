import '../test/setup-integration.js';
import { afterAll, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { startObservability } from '../observability/runtime.js';
import { installLogger, log, OperationalLogger } from '../observability/logger.js';
import { checkSourceHealth } from './health.js';
const prisma = new PrismaClient({ log: [] });
const ids: string[] = [];
afterAll(async () => {
  installLogger(new OperationalLogger({ runId: 'local-test' }));
  await prisma.sourceRun.deleteMany({ where: { runId: { in: ids } } });
  await prisma.pipelineEvent.deleteMany({ where: { runId: { in: ids } } });
  await prisma.pipelineRun.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});
it('correlates source health, all errors and final counts in the durable database', async () => {
  const run = await startObservability(prisma, 'integration-observability'); ids.push(run.runId);
  await log.withContext({ sourceKey: 'observability-test', connectorId: 'test-connector' }, async () => {
    for (let i = 0; i < 5; i++) await log.error('job.write_failed', { jobId: String(i), error: new Error('diagnostic retained') });
    await checkSourceHealth(prisma, [{ source: 'observability-test', complete: false, fetched: 5, inSector: 5, france: 0, created: 0, merged: 0, updated: 0, errors: 5, withDescription: 0, withDate: 0, withCountry: 0, withUrl: 0 }]);
  });
  await run.finish('COMPLETED_WITH_ERRORS');
  const stored = await prisma.pipelineRun.findUniqueOrThrow({ where: { id: run.runId }, include: { events: true } });
  expect(stored.status).toBe('COMPLETED_WITH_ERRORS');
  expect(stored.finishedAt).not.toBeNull();
  expect(stored.metrics).toMatchObject({ recorded: stored.events.length, persistenceFailures: 0 });
  const errors = stored.events.filter(e => e.event === 'job.write_failed');
  expect(errors).toHaveLength(5);
  expect(errors.every(e => e.connectorId === 'test-connector' && e.sourceKey === 'observability-test')).toBe(true);
  const health = await prisma.sourceRun.findFirstOrThrow({ where: { runId: run.runId } });
  expect(health.errors).toBe(5);
  expect(health.canAttestAbsence).toBe(false);
});

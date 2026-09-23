/** Read-only DB status; the explicit paused preflight also pings the configured monitor. */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipelinePaused } from '../../src/lib/pipelinePause.js';
import { pingHeartbeat } from '../../src/pipeline/heartbeat.js';
import { writeStartupState } from '../../src/observability/logger.js';
import { release } from '@catwalks/runtime';
const args = process.argv.slice(2);
const preflight = args[0] === '--preflight';
const expected = args[1]?.match(/^--expected-revision=([a-f0-9]{40})$/)?.[1];
let db: PrismaClient | undefined;
try {
  if (args.length && (!preflight || args.length !== 2 || !expected)) throw new Error('Expected --preflight --expected-revision=<40-character SHA>');
  if (preflight && !pipelinePaused()) throw new Error('Preflight requires PIPELINE_PAUSED=1');
  if (preflight && (release?.gitSha ?? process.env.RAILWAY_GIT_COMMIT_SHA) !== expected) throw new Error('Preflight deployed revision mismatch');
  if (preflight && !process.env.HEALTHCHECK_PING_URL) throw new Error('Preflight requires configured heartbeat');
  db = new PrismaClient({ errorFormat: 'minimal', log: [] });
  const aliveSince = new Date(Date.now() - 90_000);
  const report = await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
    const [lastRun, running, lastCapture, lastFailure, runningCount, recentlyAlive] = await Promise.all([
      tx.pipelineRun.findFirst({ orderBy: { startedAt: 'desc' }, omit: { metrics: true } }),
      tx.pipelineRun.findMany({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, take: 10,
        select: { id: true, command: true, startedAt: true, events: { where: { event: { in: ['run.started', 'run.alive'] } }, orderBy: { at: 'desc' }, take: 1, select: { at: true, event: true } } } }),
      tx.captureBatch.findFirst({ where: { purpose: 'JOBS' }, orderBy: { startedAt: 'desc' }, select: { id: true, sourceKey: true, startedAt: true } }),
      tx.pipelineEvent.findFirst({ where: { level: 'error' }, orderBy: { at: 'desc' }, select: { runId: true, at: true, event: true, sourceKey: true } }),
      tx.pipelineRun.count({ where: { status: 'RUNNING' } }),
      // The ten displayed runs are a summary, never the scope of the safety check.
      tx.pipelineRun.count({ where: { status: 'RUNNING', events: { some: {
        event: { in: ['run.started', 'run.alive'] }, at: { gte: aliveSince },
      } } } }),
    ]);
    return { paused: pipelinePaused(), lastRun, runningCount, recentlyAlive, running: running.map(r => ({ ...r,
      process: r.events[0] && r.events[0].at >= aliveSince ? 'RECENTLY_OBSERVED_ALIVE' : 'UNVERIFIED' })), lastCapture, lastFailure };
  });
  if (preflight) {
    if (report.recentlyAlive) throw new Error('Preflight observed a live pipeline');
    // Exercise the real worker in a child. The environment is unchanged: the guard
    // must stop it before migration checks, DB writes or collection.
    const worker = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../src/worker.ts', import.meta.url))],
      { env: process.env, encoding: 'utf8', timeout: 10_000 });
    if (worker.error || worker.status !== 0) throw new Error('Paused worker failed');
    const events = worker.stdout.trim().split('\n').map(line => JSON.parse(line));
    const pauses = events.filter(event => event.event === 'pipeline.paused');
    if (pauses.length !== 1) throw new Error('Worker must attest exactly one pause');
    const pause = pauses[0];
    if (pause.event !== 'pipeline.paused' || pause.workStarted !== false || pause.state !== 'PAUSED') throw new Error('Worker did not attest its pause');
    const heartbeat = await pingHeartbeat(true);
    if (heartbeat !== 'pinged') throw new Error('Preflight heartbeat not acknowledged');
    // One synchronous record avoids relying on compound shell commands or a
    // burst of pretty-printed lines for the operational verdict.
    writeStartupState('worker.paused_preflight', { status: 'PASS', revision: expected, heartbeat, pause,
      lastRun: report.lastRun?.id ?? null, unverifiedRunning: report.runningCount, lastCapture: report.lastCapture });
  } else console.log(JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2));
} catch (error) {
  writeStartupState('worker.status_failed', { preflight, error });
  process.exitCode = 1;
} finally { await db?.$disconnect(); }

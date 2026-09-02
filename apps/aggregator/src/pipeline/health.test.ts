import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { checkSourceHealth } from './health.js';
import type { IngestStats } from './ingest.js';

/**
 * Integration tests for source health (against the local audit DB).
 *
 * The detector must compare a run to the PREVIOUS run recorded in SourceRun —
 * never to the live JobSource state it just wrote, which would compare a run to
 * itself and never flag a source that broke.
 */

const prisma = new PrismaClient();

function stat(source: string, created: number): IngestStats {
  return { source, fetched: created, inSector: created, france: created, created, merged: 0, updated: 0, errors: 0 };
}

async function wipe() {
  await prisma.sourceRun.deleteMany({});
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('checkSourceHealth', () => {
  it('marks a source NEW on its first run (no history)', async () => {
    const report = await checkSourceHealth(prisma, [stat('kering', 100)]);
    expect(report.incidents).toHaveLength(0);
    const run = report as unknown as { ok: number };
    expect(run.ok).toBe(0); // NEW is neither ok, degraded nor broken
    // The run was recorded for next time.
    expect(await prisma.sourceRun.count({ where: { sourceKey: 'kering' } })).toBe(1);
  });

  it('marks a source BROKEN when it produced before and now returns zero', async () => {
    // First run: 100 offers -> recorded.
    await checkSourceHealth(prisma, [stat('kering', 100)]);
    // Second run: 0 offers -> BROKEN vs the previous 100.
    const report = await checkSourceHealth(prisma, [stat('kering', 0)]);
    expect(report.broken).toBe(1);
    expect(report.incidents[0]?.source).toBe('kering');
    expect(report.incidents[0]?.status).toBe('BROKEN');
    expect(report.incidents[0]?.previous).toBe(100);
  });

  it('marks a source DEGRADED when it drops below half', async () => {
    await checkSourceHealth(prisma, [stat('loreal', 200)]);
    const report = await checkSourceHealth(prisma, [stat('loreal', 50)]);
    expect(report.degraded).toBe(1);
    expect(report.incidents[0]?.status).toBe('DEGRADED');
  });

  it('is OK when a source holds steady', async () => {
    await checkSourceHealth(prisma, [stat('courir', 300)]);
    const report = await checkSourceHealth(prisma, [stat('courir', 290)]);
    expect(report.broken).toBe(0);
    expect(report.degraded).toBe(0);
    expect(report.ok).toBe(1);
  });

  it('does not compare a run to itself: two runs of the same source do not inflate the baseline', async () => {
    // If previous were read from live state, a source that ran twice at 100 then
    // returned 0 would still see "before=100" only by luck; the point is the
    // baseline is the LAST RECORDED RUN, so a 0 after a 100 is always BROKEN.
    await checkSourceHealth(prisma, [stat('kering', 100)]);
    await checkSourceHealth(prisma, [stat('kering', 100)]);
    const report = await checkSourceHealth(prisma, [stat('kering', 0)]);
    expect(report.broken).toBe(1);
  });
});

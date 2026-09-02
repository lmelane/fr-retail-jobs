import type { PrismaClient } from '@prisma/client';
import type { IngestStats } from './ingest.js';

/**
 * Source health, run after every ingest.
 *
 * An aggregator does not break loudly. Vendors rotate a public search key, move
 * a listing path, or start refusing a non-browser client, and the adapter for
 * that source quietly returns zero. The cron still exits 0, the dashboard still
 * says "success", and the only visible symptom is a Maison that stopped having
 * openings — which looks exactly like a Maison that stopped hiring.
 *
 * This has already happened twice here: a rotated Welcome to the Jungle key put
 * false "no ATS" verdicts in three discovery batches, and Estée Lauder's board
 * began answering every request with a human-verification page.
 *
 * So each run compares what a source returned against what it returned before,
 * and a source that WAS producing and now produces nothing is an incident — not
 * a quiet zero.
 */

/** A drop below this share of the previous run is treated as a failure. */
const COLLAPSE_RATIO = 0.5;

/** Runs to keep per source; enough to see a trend without growing forever. */
const HISTORY = 10;

export type SourceHealth = {
  source: string;
  status: 'OK' | 'DEGRADED' | 'BROKEN' | 'NEW';
  jobs: number;
  previous: number | null;
  note?: string;
};

export type HealthReport = {
  checkedAt: Date;
  ok: number;
  degraded: number;
  broken: number;
  incidents: SourceHealth[];
};

/**
 * Compares this run's per-source counts with the previous run's.
 *
 * Reads the counts back from JobSource rather than from a separate metrics
 * table: the database already knows how many live offers each source carries,
 * and a second store would be one more thing to drift.
 */
export async function checkSourceHealth(
  prisma: PrismaClient,
  stats: IngestStats[],
): Promise<HealthReport> {
  const previous = await previousCounts(prisma);
  const results: SourceHealth[] = [];

  for (const stat of stats) {
    const jobs = stat.created + stat.merged + stat.updated;
    const before = previous.get(stat.source) ?? null;

    if (before === null) {
      results.push({ source: stat.source, status: 'NEW', jobs, previous: null });
      continue;
    }

    // Zero from a source that was producing is the signal that matters most:
    // it is what a rotated key, a moved path and a new bot shield all look like.
    if (jobs === 0 && before > 0) {
      results.push({
        source: stat.source,
        status: 'BROKEN',
        jobs,
        previous: before,
        note: `returned nothing, held ${before} offers on the previous run`,
      });
      continue;
    }

    if (before > 0 && jobs < before * COLLAPSE_RATIO) {
      results.push({
        source: stat.source,
        status: 'DEGRADED',
        jobs,
        previous: before,
        note: `${Math.round((1 - jobs / before) * 100)}% fewer offers than the previous run`,
      });
      continue;
    }

    results.push({ source: stat.source, status: 'OK', jobs, previous: before });
  }

  await recordRun(prisma, results);

  const incidents = results.filter((r) => r.status === 'BROKEN' || r.status === 'DEGRADED');
  return {
    checkedAt: new Date(),
    ok: results.filter((r) => r.status === 'OK').length,
    degraded: results.filter((r) => r.status === 'DEGRADED').length,
    broken: results.filter((r) => r.status === 'BROKEN').length,
    incidents,
  };
}

/** Live offers per source, as the database holds them right now. */
async function previousCounts(prisma: PrismaClient): Promise<Map<string, number>> {
  const rows = await prisma.jobSource.groupBy({
    by: ['sourceKey'],
    where: { isActive: true },
    _count: true,
  });
  return new Map(rows.map((row) => [row.sourceKey, row._count]));
}

async function recordRun(prisma: PrismaClient, results: SourceHealth[]): Promise<void> {
  const now = new Date();
  await Promise.all(
    results.map((result) =>
      prisma.sourceRun.create({
        data: {
          sourceKey: result.source,
          status: result.status,
          jobs: result.jobs,
          previousJobs: result.previous,
          note: result.note,
          ranAt: now,
        },
      }),
    ),
  );

  // Keep the table bounded: history is for spotting a trend, not an archive.
  const stale = await prisma.sourceRun.findMany({
    where: { ranAt: { lt: new Date(now.getTime() - HISTORY * 86_400_000) } },
    select: { id: true },
    take: 5000,
  });
  if (stale.length > 0) {
    await prisma.sourceRun.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
}

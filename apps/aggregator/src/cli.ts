import { PrismaClient } from '@prisma/client';
import { runIngest } from './pipeline/ingest.js';
import { ingestAllBySource } from './pipeline/ingestOrchestrator.js';
import { tryAcquireIngestLock, releaseIngestLock } from './lib/lock.js';
import { checkSourceHealth } from './pipeline/health.js';
import { runRefresh } from './pipeline/refresh.js';
import { runReconcile } from './pipeline/reconcile.js';
import { runGeocode } from './pipeline/geocodeJobs.js';
import { runStats } from './pipeline/stats.js';
import { exportCompanies } from './export/companies.js';
import { closeBrowser } from './lib/browser.js';

/**
 * Three scheduled entry points, each with its own failure domain so one broken
 * job never takes the others down:
 *
 *   ingest    (~2h)    new and updated offers; dedup happens at write time
 *   refresh   (daily)  lifecycle — closes offers no source reports any more
 *   reconcile (weekly) retroactive merges after an alias or synonym is added
 *
 * geocode runs after ingest to resolve any new cities for the map.
 */

const prisma = new PrismaClient();
const command = process.argv[2] ?? 'ingest';

try {
  if (command === 'ingest') {
    // `ingest --source=<key>` runs one source as a short, independent job (D6).
    const only = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length);
    // The orchestrator geocodes ONCE at the end, so it passes --no-geocode to
    // each child: otherwise every source re-geocodes the whole backlog of
    // un-located offers, turning a quick per-source run into minutes of API
    // calls repeated 102 times.
    const skipGeocode = process.argv.includes('--no-geocode');
    const stats = await runIngest(prisma, only ? { only } : {});
    const geo = skipGeocode
      ? { pending: 0, lookedUp: 0, jobsLocated: 0, remaining: 0 }
      : await runGeocode(prisma);

    /**
     * A source that stopped producing is an incident, not a quiet zero.
     *
     * Vendors rotate public search keys and move listing paths without notice,
     * and the failure always looks the same: the adapter returns an empty
     * array, the cron exits 0, and a Maison appears to have stopped hiring.
     * Exiting non-zero is what makes the scheduler show it.
     */
    const health = await checkSourceHealth(prisma, stats);
    console.log(JSON.stringify({ ok: health.broken === 0, command, sources: stats, geo, health }, null, 2));

    if (health.broken > 0) {
      for (const incident of health.incidents) {
        console.error(`[health] ${incident.source}: ${incident.status} — ${incident.note}`);
      }
      // The data already written is kept; the run is flagged so someone looks.
      process.exitCode = 1;
    }
  } else if (command === 'ingest-all') {
    /**
     * The production ingest entry point (decision D6): each source runs as its
     * own short child process, in series, so no single feed can starve the run.
     * A geocode + health pass follows once every source has had its turn.
     *
     * Guarded by an advisory lock so two ingest runs never overlap — a slow run
     * still going when the next cron fires would otherwise race it.
     */
    const gotLock = await tryAcquireIngestLock(prisma);
    if (!gotLock) {
      console.log(JSON.stringify({ ok: true, command, skipped: 'another ingest run is in progress' }));
    } else {
      try {
        const orchestration = await ingestAllBySource(prisma);
        const geo = await runGeocode(prisma);
        console.log(JSON.stringify({ ok: orchestration.failed === 0, command, orchestration, geo }, null, 2));
        if (orchestration.failed > 0 || orchestration.timedOut > 0) {
          console.error(
            `[orchestrator] ${orchestration.failed} failed, ${orchestration.timedOut} timed out: ${orchestration.failures.join(', ')}`,
          );
          process.exitCode = 1;
        }
      } finally {
        await releaseIngestLock(prisma);
      }
    }
  } else if (command === 'refresh') {
    const refresh = await runRefresh(prisma);
    // Report honestly: a refused mass-closure or a skipped broken source is an
    // incident the scheduler must show, not a silent ok:true.
    console.log(JSON.stringify({ ok: !refresh.refused, command, ...refresh }, null, 2));
    if (refresh.refused) {
      console.error('[refresh] mass-closure guard refused the run — a source is likely broken');
      process.exitCode = 1;
    }
    if (refresh.skippedBrokenSources.length > 0) {
      console.error(
        `[refresh] left offers of broken sources open: ${refresh.skippedBrokenSources.join(', ')}`,
      );
    }
  } else if (command === 'reconcile') {
    console.log(JSON.stringify({ ok: true, command, ...(await runReconcile(prisma)) }, null, 2));
  } else if (command === 'geocode') {
    console.log(JSON.stringify({ ok: true, command, ...(await runGeocode(prisma)) }, null, 2));
  } else if (command === 'stats') {
    console.log(JSON.stringify({ ok: true, ...(await runStats(prisma)) }, null, 2));
  } else if (command === 'purge') {
    /**
     * Deletes every job and every company, so the next ingest rebuilds from
     * scratch.
     *
     * Needed because rows written by earlier code cannot be repaired in place:
     * offers ingested before the adapters fetched descriptions have none, and
     * offers written before Company.sector existed all read "UNKNOWN". Both
     * were visible in the UI as empty postings and a wall of UNKNOWN, and
     * neither is a display bug — the data itself is from an older pipeline.
     *
     * Guarded by an explicit argument: this is not something to run by
     * accident, and there is no undo.
     */
    if (process.argv[3] !== '--yes') {
      throw new Error('purge deletes ALL jobs and companies. Re-run with: purge --yes');
    }
    // JobSource cascades from Job; GeoCache is kept, since geocoding a city
    // again would re-ask the government API for answers we already have.
    const jobs = await prisma.job.deleteMany({});
    const companies = await prisma.company.deleteMany({});
    console.log(
      JSON.stringify(
        { ok: true, command, deletedJobs: jobs.count, deletedCompanies: companies.count },
        null,
        2,
      ),
    );
  } else if (command === 'export-companies') {
    const output = process.argv[3] ?? 'companies.csv';
    console.log(JSON.stringify({ ok: true, ...(await exportCompanies(prisma, output)) }, null, 2));
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  // Exit non-zero so Railway marks the cron run as failed instead of silently
  // reporting success on a broken pipeline.
  console.error(`[${command}]`, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeBrowser();
  await prisma.$disconnect();
}

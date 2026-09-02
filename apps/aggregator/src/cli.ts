import { PrismaClient } from '@prisma/client';
import { runIngest } from './pipeline/ingest.js';
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
    const stats = await runIngest(prisma);
    const geo = await runGeocode(prisma);

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
  } else if (command === 'refresh') {
    console.log(JSON.stringify({ ok: true, command, ...(await runRefresh(prisma)) }, null, 2));
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

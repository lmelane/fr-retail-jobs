import { PrismaClient } from '@prisma/client';
import { runIngest } from './pipeline/ingest.js';
import { ingestAllBySource } from './pipeline/ingestOrchestrator.js';
import { checkSourceHealth } from './pipeline/health.js';
import { sendHealthAlert } from './pipeline/alert.js';
import { submitOfferChanges } from './pipeline/googleIndexing.js';

/**
 * How far back to look for offers created/closed by THIS run, when notifying
 * Google (D22). Wider than a run's duration, tighter than a day — a run cut short
 * still catches its changes, and a fresh-start rebuild does not dump the whole
 * catalogue at Google at once (the per-run cap in googleIndexing also guards it).
 */
const INDEXING_WINDOW_MS = Number(process.env.INDEXING_WINDOW_MS ?? 6 * 60 * 60 * 1000);
import { runRefresh } from './pipeline/refresh.js';
import { runReconcile } from './pipeline/reconcile.js';
import { separateFusedJobs } from './pipeline/separateFused.js';
import { retireSource } from './pipeline/retireSource.js';
import { runGeocode } from './pipeline/geocodeJobs.js';
import { runStats } from './pipeline/stats.js';
import { exportCompanies } from './export/companies.js';
import { discoverMaisons } from './discovery/discoverMaisons.js';
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
    const alerted = await sendHealthAlert(health);
    console.log(JSON.stringify({ ok: health.broken === 0, command, sources: stats, geo, health, alerted }, null, 2));

    if (health.broken > 0) {
      for (const incident of health.incidents) {
        console.error(`[health] ${incident.source}: ${incident.status} — ${incident.note}`);
      }
      // The data already written is kept; the run is flagged so someone looks.
      process.exitCode = 1;
    }
  } else if (command === 'ingest-all') {
    /**
     * The production ingest entry point (decision D6): each source runs
     * in-process under its own timeout, so no single feed can starve the run.
     * A geocode + health pass follows once every source has had its turn.
     *
     * No cross-run lock: the cron runs ~once a day and a run finishes well
     * within that, so overlap is unlikely; and if two ever overlap, the
     * per-source purge and the unique constraints make it merely duplicated
     * work, never corruption. A session advisory lock, by contrast, could stay
     * stuck after a killed container and block every later run — which it did.
     */
    const orchestration = await ingestAllBySource(prisma);
    const geo = await runGeocode(prisma);
    // One health digest per run: email the operator every degraded/broken source
    // so the catalogue stays clean (a source dying silently is the enemy).
    const alerted = await sendHealthAlert({
      degraded: orchestration.incidents.filter((i) => i.status === 'DEGRADED').length,
      broken: orchestration.incidents.filter((i) => i.status === 'BROKEN').length,
      incidents: orchestration.incidents,
    });

    // D22 — tell Google about the offers this run added (URL_UPDATED) and closed
    // (URL_DELETED), so new pages get crawled fast and expired ones dropped. A
    // no-op until the domain + service account are configured. Bounded windows so
    // a first run after a fresh start does not submit the whole catalogue.
    const since = new Date(Date.now() - INDEXING_WINDOW_MS);
    const [createdRows, closedRows] = await Promise.all([
      prisma.job.findMany({ where: { isActive: true, firstSeenAt: { gte: since } }, select: { id: true }, take: 500 }),
      prisma.job.findMany({ where: { isActive: false, lastSeenAt: { gte: since } }, select: { id: true }, take: 500 }),
    ]);
    const indexing = await submitOfferChanges(
      createdRows.map((r) => r.id),
      closedRows.map((r) => r.id),
    );

    console.log(JSON.stringify({ ok: orchestration.failed === 0, command, orchestration, geo, alerted, indexing }, null, 2));
    if (orchestration.failed > 0 || orchestration.timedOut > 0) {
      console.error(
        `[orchestrator] ${orchestration.failed} failed, ${orchestration.timedOut} timed out: ${orchestration.failures.join(', ')}`,
      );
      process.exitCode = 1;
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
  } else if (command === 'retire-source') {
    /**
     * Cleans up after a catalogue line is removed (a robots-forbidden route, an
     * abandoned Flux B board): detaches the retired source's JobSource rows,
     * deletes jobs nothing else backs, reassigns canonical URLs it owned.
     * Guarded: destructive on purpose, so the key must be explicit.
     */
    const key = process.argv[3];
    if (!key || key.startsWith('--')) throw new Error('retire-source needs the sourceKey to retire');
    console.log(JSON.stringify({ ok: true, command, ...(await retireSource(prisma, key)) }, null, 2));
  } else if (command === 'separate-fused') {
    /**
     * One-shot repair for audit D-01: splits openings a single source published
     * under distinct ids that the old write path wrongly fused into one Job.
     * Prints the before/after metric; after the fix ships, fusedAfter must be 0
     * and STAY 0 — a non-zero value on a later run means the guard regressed.
     */
    const stats = await separateFusedJobs(prisma);
    console.log(JSON.stringify({ ok: stats.fusedAfter === 0, command, ...stats }, null, 2));
    if (stats.fusedAfter > 0) process.exitCode = 1;
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
  } else if (command === 'discover') {
    /**
     * ATS discovery over a roster of Maisons (decision, 2026-09-02): open each
     * Maison's site in a browser, detect its ATS (following the careers link one
     * hop), and write confirmed sources to data/sources.discovered.csv for HUMAN
     * REVIEW — never straight into sources.csv. Resumable: a re-run skips what is
     * already processed. `--input=<nom,url.csv>` (required), `--limit=<n>` caps
     * this run, `--fresh` restarts from scratch, `--concurrency=<n>`.
     */
    const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const inputFile = arg('input');
    if (!inputFile) throw new Error('discover needs --input=<nom,url CSV>');
    const limit = Number(arg('limit') ?? 0);
    const concurrency = Number(arg('concurrency') ?? 3);
    const fresh = process.argv.includes('--fresh');
    const result = await discoverMaisons({
      inputFile,
      limit: Number.isFinite(limit) ? limit : 0,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
      fresh,
    });
    console.log(JSON.stringify({ ok: true, command, ...result }, null, 2));
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

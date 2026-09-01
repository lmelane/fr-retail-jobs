import { PrismaClient } from '@prisma/client';
import { runIngest } from './pipeline/ingest.js';
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
    console.log(JSON.stringify({ ok: true, command, sources: stats, geo }, null, 2));
  } else if (command === 'refresh') {
    console.log(JSON.stringify({ ok: true, command, ...(await runRefresh(prisma)) }, null, 2));
  } else if (command === 'reconcile') {
    console.log(JSON.stringify({ ok: true, command, ...(await runReconcile(prisma)) }, null, 2));
  } else if (command === 'geocode') {
    console.log(JSON.stringify({ ok: true, command, ...(await runGeocode(prisma)) }, null, 2));
  } else if (command === 'stats') {
    console.log(JSON.stringify({ ok: true, ...(await runStats(prisma)) }, null, 2));
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

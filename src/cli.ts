import { PrismaClient } from '@prisma/client';
import { discoverFashionJobsCompanies } from './pipeline/discoverFashionJobs.js';
import { discoverMissingAts } from './pipeline/discoverAts.js';
import { syncAllJobs } from './pipeline/syncJobs.js';
import { exportCompanies } from './export/companies.js';
import { closeBrowser } from './lib/browser.js';

const prisma = new PrismaClient();
const command = process.argv[2] ?? 'sync-all';

try {
  if (command === 'discover-fashionjobs') {
    const count = await discoverFashionJobsCompanies(prisma);
    console.log(JSON.stringify({ ok: true, companies: count }, null, 2));
  } else if (command === 'discover-ats') {
    const result = await discoverMissingAts(prisma, process.argv.includes('--force'));
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } else if (command === 'sync-jobs') {
    const result = await syncAllJobs(prisma);
    console.log(JSON.stringify({ ok: true, companies: result.length, result }, null, 2));
  } else if (command === 'export-companies') {
    const result = await exportCompanies(prisma, process.argv[3] ?? 'fashionjobs-companies.csv');
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } else if (command === 'sync-all') {
    const companies = await discoverFashionJobsCompanies(prisma);
    const discovery = await discoverMissingAts(prisma, false);
    const jobs = await syncAllJobs(prisma);
    console.log(JSON.stringify({ ok: true, companies, discovery, syncedCompanies: jobs.length }, null, 2));
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} finally {
  await closeBrowser();
  await prisma.$disconnect();
}

import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { writeFile } from 'node:fs/promises';
import { upsertDeduplicated } from '../../apps/aggregator/src/dedup/upsert.js';
import { buildHealthReport } from '../../apps/aggregator/src/pipeline/healthReport.js';
import type { CandidateJob } from '../../apps/aggregator/src/dedup/match.js';

const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/catwalks_cto_test') {
  throw new Error('Synthetic benchmark only accepts the dedicated local catwalks_cto_test database');
}
const prisma = new PrismaClient();
const sourceKey = 'cto-benchmark';
const count = 2000, concurrency = 4;
const candidates: Array<CandidateJob & { companyId: string }> = Array.from({ length: count }, (_, i) => ({
  company: `Audit Maison ${i % 10}`, companyId: `cto-benchmark-${i % 10}`, sourceKey,
  externalId: String(i), atsType: 'WORKDAY', sourceTier: 'EMPLOYER_DIRECT',
  title: 'Store Manager', city: 'Paris', country: 'FR', location: 'Paris, France',
  url: `https://example.com/cto-benchmark/${i}`, description: 'Synthetic description. '.repeat(80),
  raw: { id: i, description: 'Synthetic payload. '.repeat(100) },
}));

try {
  await prisma.job.deleteMany({ where: { sources: { some: { sourceKey } } } });
  await prisma.company.deleteMany({ where: { canonicalKey: { startsWith: 'cto-benchmark-' } } });
  await prisma.sourceObservation.deleteMany({ where: { sourceKey } });
  const run = async () => {
    const limit = pLimit(concurrency), latencies: number[] = [];
    const started = performance.now();
    await Promise.all(candidates.map(candidate => limit(async () => {
      const start = performance.now();
      await upsertDeduplicated(prisma, candidate);
      latencies.push(performance.now() - start);
    })));
    const elapsedMs = performance.now() - started;
    latencies.sort((a, b) => a - b);
    return { elapsedMs, jobsPerSecond: count * 1000 / elapsedMs,
      operationP50Ms: latencies[Math.floor(count * 0.5)], operationP95Ms: latencies[Math.floor(count * 0.95)] };
  };
  const create = await run();
  const reattest = await run();
  const jobs = await prisma.job.count({ where: { sources: { some: { sourceKey } } } });
  const observations = await prisma.sourceObservation.count({ where: { sourceKey } });
  const sourceRows = await prisma.jobSource.count({ where: { sourceKey } });
  const opened = await prisma.jobEvent.count({ where: { type: 'OPENED', job: { sources: { some: { sourceKey } } } } });
  if ([jobs, observations, sourceRows, opened].some(value => value !== count)) throw new Error('Identity or replay invariant failed');
  const result = { measuredAt: new Date().toISOString(), runtime: process.version, count, concurrency,
    create, reattest, invariants: { jobs, observations, sourceRows, opened },
    rssBytes: process.memoryUsage().rss,
    scope: 'Synthetic local PostgreSQL 18 write workload. Excludes ATS latency, production network, multi-replica capacity and soak testing.' };
  await writeFile(new URL('./load-validation.json', import.meta.url), JSON.stringify(result, null, 2));
  await writeFile(new URL('./health-report-synthetic.json', import.meta.url), JSON.stringify(await buildHealthReport(prisma), null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}

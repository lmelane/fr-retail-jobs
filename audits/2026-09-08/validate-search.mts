import { writeFile } from 'node:fs/promises';
import pLimit from 'p-limit';
import { prisma } from '../../packages/db/index.ts';
import { getJobs, type JobFilters } from '../../apps/web/lib/jobs.ts';

const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/catwalks_search_test') {
  throw new Error('Only the dedicated local catwalks_search_test database is accepted');
}
try {
  await prisma.$executeRaw`INSERT INTO "Company" (id,name,"canonicalKey","fashionjobsUrl",sector,"parentGroup","updatedAt")
    SELECT 'bench-company-'||i, 'Maison Audit '||i, 'bench-company-'||i, 'resolved:bench-'||i,
      (ARRAY['LUXURY','FASHION','BEAUTY'])[1+i%3]::"CompanySector", 'Groupe Audit '||(i%10), now()
    FROM generate_series(1,1000) AS i ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "Job" (id,"externalId",source,"companyId",title,url,fingerprint,
      description,"countryCode",city,"isFrance","postedAt","firstSeenAt","updatedAt")
    SELECT 'bench-job-'||lpad(i::text,6,'0'),i::text,'WORKDAY'::"AtsType",'bench-company-'||(1+i%1000),
      (ARRAY['Store Manager','Sales Associate','Conseiller de vente','Beauty Advisor','Client Advisor'])[1+i%5],
      'https://example.com/bench/'||i,'bench-'||i,
      repeat('Synthetic description for a fashion luxury beauty position. ',40),
      (ARRAY['FR','IT','US','GB','JP','CN'])[1+i%6],
      (ARRAY['Paris','Milan','New York','London','Tokyo','Shanghai'])[1+i%6],i%6=0,
      now()-(i%30)*interval '1 day',now()-(i%30)*interval '1 day',now()
    FROM generate_series(1,70000) AS i ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "JobSource" (id,"jobId","sourceKey","externalId","sourceTier",url)
    SELECT 'bench-source-'||i,'bench-job-'||lpad(i::text,6,'0'),'bench-feed-'||(i%100),i::text,'EMPLOYER_DIRECT',
      'https://example.com/bench/'||i FROM generate_series(1,70000) AS i ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`ANALYZE "Job"`;
  await prisma.$executeRaw`ANALYZE "Company"`;
  await prisma.$executeRaw`ANALYZE "JobSource"`;
  const scenarios: Array<{ name: string; filters: JobFilters }> = [
    { name: 'world', filters: {} }, { name: 'country', filters: { country: 'FR' } },
    { name: 'title search', filters: { q: 'Store Manager' } },
    { name: 'title and city', filters: { q: 'Conseiller Paris' } },
    { name: 'no match', filters: { q: 'unmatcheduniqueterm' } },
    { name: 'late page', filters: { page: 2000 } },
  ];
  const results = [];
  for (const scenario of scenarios) {
    await getJobs(scenario.filters);
    const limit = pLimit(4);
    const samples = await Promise.all(Array.from({ length: 12 }, () => limit(async () => {
      const start = performance.now();
      const result = await getJobs(scenario.filters);
      return { ms: performance.now() - start, total: result.total };
    })));
    const durations = samples.map(s => s.ms).sort((a,b) => a-b);
    results.push({ name: scenario.name, requests: samples.length, concurrency: 4,
      total: samples[0].total, p50Ms: durations[6], p95Ms: durations[11] });
  }
  const report = { measuredAt: new Date().toISOString(), runtime: process.version, jobs: 70000,
    companies: 1000, sources: 100, results,
    scope: 'Local synthetic SQL query workload including facet counts; excludes HTTP rendering, production network and long-running load.' };
  await writeFile(new URL('./search-validation.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await prisma.$disconnect(); }

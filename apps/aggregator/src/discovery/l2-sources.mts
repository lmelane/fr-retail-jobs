import { PrismaClient } from '@prisma/client';

/**
 * l2 — lit (SELECT seul) la config des sources à mesurer. Usage :
 *   npx tsx src/discovery/l2-sources.mts tapestry estee-lauder-companies …
 */
const keys = process.argv.slice(2);
const p = new PrismaClient({ datasourceUrl: process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL });
const rows = await p.source.findMany({
  where: keys.length ? { key: { in: keys } } : { kind: { in: ['taleo', 'workday'] } },
  select: { key: true, kind: true, maison: true, status: true, config: true, lastRunJobs: true },
  orderBy: { key: 'asc' },
});
for (const row of rows) console.log(JSON.stringify(row));
await p.$disconnect();

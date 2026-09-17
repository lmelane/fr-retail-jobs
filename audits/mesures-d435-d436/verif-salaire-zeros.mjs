import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const r = await p.$queryRawUnsafe(`
  SELECT raw->>'salary_min_value' AS v, count(*)::int AS n
  FROM "Job" WHERE "isActive" = true AND raw ? 'salary_min_value'
  GROUP BY 1 ORDER BY n DESC LIMIT 4`);
for (const x of r) console.log('  valeur', JSON.stringify(x.v), '->', x.n, 'offres');
await p.$disconnect();

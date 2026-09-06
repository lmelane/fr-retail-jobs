import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const c = await p.company.findFirst({ where: { name: 'Cartier' }, select: { id: true } });
const rows = await p.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT CASE WHEN "isFrance" THEN 'FR' ELSE country END)::bigint n FROM "Job" WHERE "isActive" AND "companyId" = ${c!.id} AND (country IS NOT NULL OR "isFrance")`;
console.log('Cartier pays (SQL brut, graphies telles quelles):', Number(rows[0].n));
await p.$disconnect();

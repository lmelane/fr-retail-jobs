import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
for (const k of ['hugo-boss-phenom','skechers-phenom']) {
  const r = await p.source.findUnique({ where: { key: k },
    select: { status: true, robotsVerdict: true, robotsCheckedAt: true, verifiedJobCount: true } });
  console.log(k, r ? JSON.stringify(r) : 'ABSENTE DU CLONE');
}
await p.$disconnect();

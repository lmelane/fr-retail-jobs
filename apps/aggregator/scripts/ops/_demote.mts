import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
for (const k of ['hugo-boss-phenom','skechers-phenom']) {
  await p.source.update({ where: { key: k }, data: { status: 'VALIDATED' } });
}
console.log('clone remis en VALIDATED');
await p.$disconnect();

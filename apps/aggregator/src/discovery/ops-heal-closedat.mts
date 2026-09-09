import { PrismaClient } from '@prisma/client';
/** Audit I-2 : les offres fermées avant D38 (isActive=false, closedAt null) sortaient des actives sans jamais compter fermées. closedAt := lastSeenAt (approximation datée, la fermeture réelle est survenue ≤ 48 h après). */
const p = new PrismaClient();
const before = await p.job.count({ where: { isActive: false, closedAt: null, mergedIntoId: null } });
const r = await p.$executeRaw`UPDATE "Job" SET "closedAt" = "lastSeenAt" WHERE "isActive" = false AND "closedAt" IS NULL AND "mergedIntoId" IS NULL`;
console.log(JSON.stringify({ before, healed: r, after: await p.job.count({ where: { isActive: false, closedAt: null, mergedIntoId: null } }) }));
await p.$disconnect();

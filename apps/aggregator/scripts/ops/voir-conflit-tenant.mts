/** Affiche les tenantKey en conflit pour un domaine donné, et le tenantKey recalcule. */
import { PrismaClient } from '@prisma/client';
import { tenantKeyOf } from '../../src/connectors/sourceStore.js';
const motif = process.argv[2] ?? '';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
const rows = await prisma.$queryRawUnsafe<Array<{ key: string; maison: string; kind: string; status: string; tenantKey: string; config: unknown; careersDomain: string | null }>>(
  `SELECT key, maison, kind, status, "tenantKey", config, "careersDomain" FROM "Source"
    WHERE "careersDomain" ILIKE $1 OR "tenantKey" ILIKE $1 ORDER BY status, key`, `%${motif}%`);
for (const r of rows) {
  let calcule = '';
  try { calcule = tenantKeyOf(r.kind, JSON.stringify(r.config), r.careersDomain ?? undefined, r.maison); }
  catch (e) { calcule = `illisible : ${e instanceof Error ? e.message : String(e)}`; }
  console.log(`\n   ${r.key}  [${r.status}]  ${r.kind}`);
  console.log(`      maison    ${r.maison}`);
  console.log(`      en base   ${r.tenantKey}`);
  console.log(`      calcule   ${calcule}`);
  console.log(`      identique ${r.tenantKey === calcule ? 'oui' : 'NON'}`);
}
console.log('');
await prisma.$disconnect();

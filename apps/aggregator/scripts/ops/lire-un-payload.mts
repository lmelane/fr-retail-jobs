/** Affiche un payload d'événement en entier, pour lire sa forme réelle au lieu de la supposer. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
const evenement = process.argv[2] ?? 'job.write_failed';
const rows = await prisma.$queryRawUnsafe<Array<{ at: Date; sourceKey: string | null; payload: unknown }>>(
  `SELECT at, "sourceKey", payload FROM "PipelineEvent" WHERE event = $1 ORDER BY at DESC LIMIT 2`, evenement);
for (const r of rows) {
  console.log(`\n── ${r.at.toISOString()} · ${r.sourceKey ?? '—'} ──`);
  console.log(JSON.stringify(r.payload, null, 2).slice(0, 1400));
}
await prisma.$disconnect();

/**
 * a2 — lecteur SQL en lecture seule (audit architecture).
 * Usage : DATABASE_URL=… npx tsx src/discovery/a2-sql.mts "<SELECT …>" ["<SELECT …>" …]
 * Refuse tout ce qui ne commence pas par SELECT/WITH.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  for (const sql of process.argv.slice(2)) {
    const trimmed = sql.trim();
    if (!/^(select|with)\b/i.test(trimmed)) throw new Error(`refusé (lecture seule) : ${trimmed.slice(0, 60)}`);
    const rows = await prisma.$queryRawUnsafe<unknown[]>(trimmed);
    console.log(`-- ${trimmed.replace(/\s+/g, ' ').slice(0, 140)}`);
    console.log(
      JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 0),
    );
  }
} finally {
  await prisma.$disconnect();
}

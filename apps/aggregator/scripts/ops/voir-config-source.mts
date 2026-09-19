/** Affiche la configuration native d'une source — lecture seule. */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
for (const cle of process.argv.slice(2).filter((a) => !a.startsWith('-'))) {
  const [s] = await p.$queryRawUnsafe<Array<{ key: string; kind: string; config: unknown }>>(
    `SELECT key, kind, config FROM "Source" WHERE key = $1`, cle);
  console.log(`\n${cle} [${s?.kind ?? 'absente'}]`);
  console.log(JSON.stringify(s?.config, null, 1));
}
await p.$disconnect();

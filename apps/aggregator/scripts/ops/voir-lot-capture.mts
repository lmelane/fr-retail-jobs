/**
 * QUELLES REQUÊTES UN LOT DE CAPTURE A-T-IL ARCHIVÉES — lecture seule.
 *
 * Le rejeu (`replayExtraction`) rejoue l'adaptateur contre les SEULES réponses archivées : si une
 * requête n'a pas été capturée, le rejeu ne peut pas la servir. Savoir CE QUI est dans le lot dit
 * donc ce que le rejeu peut reconstruire — et ce qu'il ne pourra jamais.
 */
import { PrismaClient } from '@prisma/client';

const cle = process.argv[2];
if (!cle) { console.error('Usage : voir-lot-capture.mts <clé de source>'); process.exit(2); }
const p = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });

const lots = await p.$queryRawUnsafe<Array<{ id: string; purpose: string; startedAt: Date }>>(
  `SELECT id, purpose, "startedAt" FROM "CaptureBatch"
    WHERE "sourceKey" = $1 ORDER BY "startedAt" DESC LIMIT 3`, cle);
for (const l of lots) {
  console.log(`\n── lot ${l.id.slice(0, 12)} · ${l.purpose} · ${l.startedAt.toISOString().slice(0, 19)}`);
  const req = await p.$queryRawUnsafe<Array<{ url: string; n: bigint }>>(
    `SELECT regexp_replace("requestUrl", '\\?.*$', '') AS url, count(*) AS n
       FROM "RawCapture" WHERE "batchId" = $1 GROUP BY 1 ORDER BY count(*) DESC LIMIT 8`, l.id);
  const [tot] = await p.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM "RawCapture" WHERE "batchId" = $1`, l.id);
  console.log(`   ${tot.n} requête(s) archivée(s) :`);
  for (const r of req) console.log(`      ${String(r.n).padStart(5)}×  ${r.url.slice(0, 96)}`);
}
console.log('');
await p.$disconnect();

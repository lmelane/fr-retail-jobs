/**
 * Lecture seule : les réponses natives d'une capture (statut, URL, taille), et le corps de celles dont l'URL
 * contient un motif. Usage : tsx lire-capture.mts <captureBatchId> [motif-url] [--corps]
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../apps/aggregator/src/capture/store.js';

const [batchId, motif = '', option] = process.argv.slice(2);
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const rows = await p.rawCapture.findMany({ where: { batchId }, orderBy: { sequence: 'asc' },
  select: { sequence: true, requestUrl: true, method: true, status: true, blobHash: true, failure: true, capturedAt: true } });
console.log(`${rows.length} réponses`);
for (const row of rows) {
  if (motif && !row.requestUrl.includes(motif)) continue;
  const body = row.blobHash ? (await readRawBlob(p, row.blobHash)).toString('utf8') : '';
  console.log(`#${row.sequence} ${row.capturedAt.toISOString()} ${row.method} ${row.status ?? '-'} ${row.requestUrl} ${body.length}o${row.failure ? ' échec=' + row.failure : ''}`);
  if (option === '--corps') console.log(body);
}
await p.$disconnect();

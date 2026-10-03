/**
 * Extrait les réponses d'une capture (lecture seule) vers un dossier local, dans l'ordre de la collecte.
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-03/stock-exceptions/extraire-capture.mts \
 *     --batch=<id> --motif=<fragment d'adresse> --out=<dossier hors dépôt>
 * Écrit <out>/index.json (séquence, adresse, statut, fichier) et un fichier par corps.
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readRawBlob } from '../../../apps/aggregator/src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const batchId = arg('batch'); const motif = arg('motif') ?? ''; const out = arg('out');
if (!batchId || !out) { console.error('usage: --batch= --motif= --out='); process.exit(2); }
mkdirSync(out, { recursive: true });
const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.rawCapture.findMany({ where: { batchId, requestUrl: { contains: motif } }, orderBy: { sequence: 'asc' },
    select: { sequence: true, requestUrl: true, status: true, blobHash: true, failure: true } });
  const index = [];
  for (const row of rows) {
    const file = `${String(row.sequence).padStart(5, '0')}.body`;
    if (row.blobHash) writeFileSync(`${out}/${file}`, await readRawBlob(prisma, row.blobHash));
    index.push({ sequence: row.sequence, url: row.requestUrl, status: row.status, file: row.blobHash ? file : null, failure: row.failure ?? undefined });
  }
  writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1));
  console.log(JSON.stringify({ batchId, motif, responses: rows.length }));
} finally { await prisma.$disconnect(); }

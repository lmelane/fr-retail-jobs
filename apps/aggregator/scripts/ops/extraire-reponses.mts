/**
 * EXTRAIT DES RÉPONSES ARCHIVÉES D'UNE CAPTURE EN FIXTURE DE TÉMOIN — lecture seule, aucun éditeur contacté.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/extraire-reponses.mts --batch=<id de CaptureBatch> --sequences=26,558,560 --sortie=<fichier.json.gz>
 *
 * Écrit `[{ sequence, requestUrl, method, status, headers, sha256, body }]` dans l'ordre des séquences demandées :
 * `body` est le corps EXACT archivé (texte), vérifié par `readRawBlob` contre `RawBlob`, et `sha256` son empreinte,
 * que le témoin recalcule. L'adresse est celle de l'audit (valeurs de requête masquées). Rend l'empreinte du fichier.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readRawBlob } from '../../src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const batchId = arg('batch');
const sequences = (arg('sequences') ?? '').split(',').filter(Boolean).map(Number);
const sortie = arg('sortie');
if (!batchId || !sequences.length || !sortie) { console.error('usage: extraire-reponses.mts --batch=<id> --sequences=1,2 --sortie=<fichier.json.gz>'); process.exit(2); }
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const prisma = new PrismaClient({ log: [] });
try {
  const reponses = [];
  for (const sequence of sequences) {
    const row = await prisma.rawCapture.findUniqueOrThrow({ where: { batchId_sequence: { batchId, sequence } } });
    if (!row.blobHash) throw new Error(`séquence ${sequence} sans corps archivé`);
    const bytes = await readRawBlob(prisma, row.blobHash);
    reponses.push({ sequence, requestUrl: row.requestUrl, method: row.method, status: row.status, headers: row.headers, sha256: sha(bytes), body: bytes.toString('utf8') });
  }
  const gz = gzipSync(Buffer.from(JSON.stringify(reponses)), { level: 9 });
  writeFileSync(sortie, gz);
  console.log(JSON.stringify({ capture: batchId, reponses: reponses.map((r) => ({ sequence: r.sequence, status: r.status, sha256: r.sha256 })), fichier: sortie, octets: gz.byteLength, sha256Fichier: sha(gz) }));
} finally {
  await prisma.$disconnect();
}

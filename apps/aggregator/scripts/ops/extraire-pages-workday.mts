/**
 * EXTRAIT LES PAGES DE LISTE WORKDAY D'UNE CAPTURE EN FIXTURE DE TÉMOIN — lecture seule, aucun éditeur contacté.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/extraire-pages-workday.mts --batch=<id de CaptureBatch> --sortie=<fichier.json.gz> [--offsets=320,540]
 *
 * Écrit, dans l'ordre de la collecte, `[{ sequence, offset, sha256, body }]` : `body` est le corps EXACT archivé
 * (texte), `sha256` son empreinte, vérifiée contre `RawBlob` par `readRawBlob` à la lecture. Le témoin recalcule
 * l'empreinte de chaque corps : une fixture retouchée à la main ne passe pas. L'offset est retrouvé depuis
 * l'empreinte du corps de requête, comme dans `workday-pages-liste.mts`. Rend l'empreinte du fichier écrit.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readRawBlob } from '../../src/capture/store.js';
import { readRequestData } from '../../src/capture/requestDataRead.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const batchId = arg('batch');
const sortie = arg('sortie');
/** Ne garder que ces offsets (une relecture indépendante de quelques pages suffit à un témoin). */
const seulement = arg('offsets') ? new Set(arg('offsets')!.split(',').map(Number)) : undefined;
if (!batchId || !sortie) { console.error('usage: extraire-pages-workday.mts --batch=<id> --sortie=<fichier.json.gz>'); process.exit(2); }
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const offsets = new Map<string, number>();
for (let offset = 0; offset <= 6000; offset += 10) offsets.set(sha(JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' })), offset);
const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.rawCapture.findMany({ where: { batchId, method: 'POST', requestUrl: { endsWith: '/jobs' } }, orderBy: { sequence: 'asc' } });
  const pages = [];
  for (const row of rows) {
    const request = await readRequestData(prisma, row);
    const offset = request ? offsets.get(request.logical.bodyHash) : undefined;
    if (offset === undefined || !row.blobHash || row.status !== 200) throw new Error(`page ${row.sequence} sans offset reconnu, sans corps ou hors 200`);
    if (seulement && !seulement.has(offset)) continue;
    const bytes = await readRawBlob(prisma, row.blobHash);
    pages.push({ sequence: row.sequence, offset, sha256: sha(bytes), body: bytes.toString('utf8') });
  }
  const gz = gzipSync(Buffer.from(JSON.stringify(pages)), { level: 9 });
  writeFileSync(sortie, gz);
  console.log(JSON.stringify({ capture: batchId, pages: pages.length, fichier: sortie, octets: gz.byteLength, sha256Fichier: sha(gz) }));
} finally {
  await prisma.$disconnect();
}

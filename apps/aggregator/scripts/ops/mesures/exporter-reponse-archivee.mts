/**
 * EXPORTE UNE RÉPONSE ARCHIVÉE EN FIXTURE DE TÉMOIN — lecture seule sur la base, écriture d'un seul fichier local.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/exporter-reponse-archivee.mts --hash=<sha256 du RawBlob> --out=<chemin.gz>
 *   … --batch=<id> --motif=<fragment d'adresse> --contient=<texte> --out=<chemin.gz>   (la première réponse qui contient le texte)
 *
 * Le corps est relu par `readRawBlob` (empreintes gzip et contenu vérifiées), puis réécrit gzip tel quel : le SHA-256
 * du contenu décompressé reste la clé du RawBlob, que le témoin vérifie. N'écrit rien en base, ne contacte personne.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = arg('out');
if (!out || (!arg('hash') && !(arg('batch') && arg('motif')))) { console.error('usage: --hash=<sha> --out=<fichier.gz> | --batch=<id> --motif=<fragment> [--contient=<texte>] --out=<fichier.gz>'); process.exit(2); }
const prisma = new PrismaClient({ log: [] });
try {
  let hash = arg('hash');
  let origine: Record<string, unknown> = {};
  if (!hash) {
    const rows = await prisma.rawCapture.findMany({ where: { batchId: { startsWith: arg('batch')! }, requestUrl: { contains: arg('motif')! }, blobHash: { not: null } }, orderBy: { sequence: 'asc' } });
    for (const row of rows) {
      const body = (await readRawBlob(prisma, row.blobHash!)).toString('utf8');
      if (!arg('contient') || body.includes(arg('contient')!)) { hash = row.blobHash!; origine = { batchId: row.batchId, sequence: row.sequence, url: row.requestUrl, statut: row.status, a: row.capturedAt.toISOString() }; break; }
    }
    if (!hash) { console.log(JSON.stringify({ trouve: false, requetes: rows.length })); process.exit(1); }
  }
  const bytes = await readRawBlob(prisma, hash);
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('empreinte divergente');
  writeFileSync(out, gzipSync(bytes, { level: 9 }));
  console.log(JSON.stringify({ hash, octets: bytes.length, out, ...origine }));
} finally {
  await prisma.$disconnect();
}

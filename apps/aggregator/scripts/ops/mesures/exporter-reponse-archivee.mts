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
import { readRequestData } from '../../../src/capture/requestDataRead.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = arg('out');
if (!out || (!arg('hash') && !arg('lot') && !(arg('batch') && arg('motif')))) { console.error('usage: --hash=<sha> --out=<fichier.gz> | --batch=<id> --motif=<fragment> [--contient=<texte>] --out=<fichier.gz>'); process.exit(2); }
const prisma = new PrismaClient({ log: [] });
try {
  /*
   * `--lot=<id>[,<id>…] [--sequences=<lot>:<n>,…]` : plusieurs réponses en un seul fichier, un tableau JSON gzip de
   * { capture, sequence, url, sha256, body } dans l'ordre des lots puis des séquences. `url` est l'adresse RÉELLE
   * de la requête, lue dans son enveloppe native (`readRequestData`), pas l'adresse d'audit masquée.
   */
  if (arg('lot')) {
    const wanted = arg('sequences')?.split(',').map((s) => s.split(':') as [string, string]);
    const bundle: Array<{ capture: string; sequence: number; url: string; sha256: string; body: string }> = [];
    for (const lot of arg('lot')!.split(',')) {
      const rows = await prisma.rawCapture.findMany({ where: { batchId: { startsWith: lot }, blobHash: { not: null } }, orderBy: { sequence: 'asc' } });
      for (const row of rows) {
        if (wanted && !wanted.some(([l, n]) => row.batchId.startsWith(l) && Number(n) === row.sequence)) continue;
        if (!wanted && arg('motif') && !row.requestUrl.includes(arg('motif')!)) continue;
        const data = await readRequestData(prisma, row);
        const body = (await readRawBlob(prisma, row.blobHash!)).toString('utf8');
        if (createHash('sha256').update(body).digest('hex') !== row.blobHash) throw new Error('empreinte divergente');
        bundle.push({ capture: row.batchId, sequence: row.sequence, url: data?.logical.url ?? row.requestUrl, sha256: row.blobHash!, body });
      }
    }
    writeFileSync(out, gzipSync(JSON.stringify(bundle), { level: 9 }));
    console.log(JSON.stringify({ out, reponses: bundle.length, octets: bundle.reduce((n, r) => n + r.body.length, 0) }));
    process.exit(0);
  }
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

/**
 * LES PAGES DE LISTE ARCHIVÉES D'UNE SOURCE, dans sa dernière capture — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/lire-pages-liste.mts --source=swatch-group --motif=job-finder [--lien='/job/\d+'] [--batch=<id>] [--apercu=400]
 *
 * Pour chaque requête de la capture dont l'adresse contient `--motif`, dans l'ordre de la collecte : le statut, la
 * taille, le nombre de liens distincts qui répondent à `--lien`, et un extrait du texte visible des pages sans lien.
 * Sert à savoir ce que l'éditeur rend réellement au-delà de la dernière page, sans le recontacter.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const source = arg('source');
const motif = arg('motif');
const lien = new RegExp(arg('lien') ?? 'href="(/[a-z]{2}/job/\\d+)"', 'g');
const apercu = Number(arg('apercu') ?? 400);
if (!source || !motif) { console.error('usage: lire-pages-liste.mts --source=<clé> --motif=<fragment d\'adresse>'); process.exit(2); }
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const prisma = new PrismaClient({ log: [] });
try {
  const batchId = arg('batch') ?? (await prisma.captureBatch.findFirst({ where: { sourceKey: source, purpose: 'JOBS' }, orderBy: { startedAt: 'desc' }, select: { id: true } }))?.id;
  if (!batchId) { console.log(JSON.stringify({ source, capture: null })); process.exit(0); }
  const rows = await prisma.rawCapture.findMany({ where: { batchId, requestUrl: { contains: motif } }, orderBy: { sequence: 'asc' },
    select: { sequence: true, requestUrl: true, status: true, blobHash: true, failure: true } });
  const pages = [];
  for (const row of rows) {
    const html = row.blobHash ? (await readRawBlob(prisma, row.blobHash)).toString('utf8') : '';
    const liens = new Set([...html.matchAll(lien)].map((m) => m[1] ?? m[0]));
    pages.push({ sequence: row.sequence, url: row.requestUrl, status: row.status, octets: html.length, liens: liens.size, ...(row.failure ? { echec: row.failure } : {}),
      ...(liens.size === 0 ? { texte: text(html).slice(0, apercu) } : {}) });
  }
  console.log(JSON.stringify({ source, capture: batchId, pages: pages.length, detail: pages }, null, 1));
} finally {
  await prisma.$disconnect();
}

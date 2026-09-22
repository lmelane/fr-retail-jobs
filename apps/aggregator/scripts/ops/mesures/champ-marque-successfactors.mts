/**
 * LE CHAMP DE MARQUE SUCCESSFACTORS EST-IL SERVI AU NIVEAU LISTE ?
 *
 * Douglas expose `sfstd_marketingBrand_obj` (DOUGLAS / NOCIBÉ) sur ses offres. La question — et
 * elle seule — est de savoir si ce champ arrive dans la réponse de LISTE archivée, celle que
 * l'adaptateur lit, ou uniquement sur la page de détail.
 *
 *   présent au niveau liste  → extension naturelle de l'adaptateur, correction triviale
 *   absent au niveau liste   → il faudrait aller chercher chaque détail : ce n'est plus trivial
 *
 * On lit le RAW archivé, jamais le portail : c'est la capture qui fait foi.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MOTIFS = /sfstd_[A-Za-z_]+|marketingBrand[A-Za-z_]*|"brand"\s*:|data-brand/gi;

for (const cle of process.argv.slice(2)) {
  const lots = await p.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT b.id FROM "CaptureBatch" b
      JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
     WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS'
     ORDER BY b."startedAt" DESC LIMIT 1`, cle);
  if (!lots.length) { console.log(`\n── ${cle} : aucun lot EXTRACTED`); continue; }

  /* TOUTES les réponses du lot, pas seulement la première : la liste peut être paginée, et le
   * champ peut n'apparaître que sur certaines pages. */
  const captures = await p.$queryRawUnsafe<Array<{ blobHash: string; requestUrl: string }>>(`
    SELECT "blobHash", "requestUrl" FROM "RawCapture"
     WHERE "batchId" = $1 AND "blobHash" IS NOT NULL AND complete = true ORDER BY sequence`, lots[0].id);

  const trouves = new Map<string, number>();
  let octets = 0;
  for (const c of captures) {
    const t = (await readRawBlob(p, c.blobHash)).toString('utf8');
    octets += t.length;
    for (const m of t.matchAll(MOTIFS)) trouves.set(m[0], (trouves.get(m[0]) ?? 0) + 1);
  }
  console.log(`\n── ${cle} : ${captures.length} réponse(s), ${octets} octets`);
  if (!trouves.size) { console.log(`   AUCUN champ de marque au niveau liste`); continue; }
  for (const [motif, n] of [...trouves].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   ${motif} ×${n}`);
  }
}

await p.$disconnect();

/** Les motifs de refus d'écriture, par source et par volume — l'état final de la qualification. */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const r = await p.$queryRawUnsafe<Array<{ src: string; h: string }>>(`
  SELECT DISTINCT ON (b."sourceKey") b."sourceKey" AS src, c."reportHash" AS h
    FROM "SourceIngestionCompletion" c JOIN "CaptureBatch" b ON b.id=c."batchId"
   WHERE c."writeFailed" > 0 ORDER BY b."sourceKey", c."completedAt" DESC`);
const parMotif = new Map<string, { srcs: number; offres: number }>();
const lignes: Array<{ src: string; motif: string; n: number }> = [];
for (const x of r) {
  const o = JSON.parse(new TextDecoder().decode(await readRawBlob(p, x.h)));
  const m = new Map<string, number>();
  for (const f of o.fates ?? []) if (f.disposition === 'WRITE_FAILED') m.set(f.reason, (m.get(f.reason) ?? 0) + 1);
  for (const [motif, n] of m) {
    const e = parMotif.get(motif) ?? { srcs: 0, offres: 0 };
    e.srcs++; e.offres += n; parMotif.set(motif, e);
    lignes.push({ src: x.src, motif, n });
  }
}
console.log('MOTIFS DE REFUS, par volume :\n');
for (const [m, e] of [...parMotif].sort((a, b) => b[1].offres - a[1].offres))
  console.log(`  ${String(e.offres).padStart(5)} offres  ${String(e.srcs).padStart(2)} sources  ${m}`);
console.log('\n  les 10 plus gros volumes :');
for (const l of lignes.sort((a, b) => b.n - a.n).slice(0, 10))
  console.log(`    ${String(l.n).padStart(5)}  ${l.src.padEnd(24)} ${l.motif.replace('EmployerIdentityReviewRequired:', '')}`);
await p.$disconnect();

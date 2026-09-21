/** Les motifs d'échec d'écriture des sources muettes, lus dans les rapports de complétion. */
import { ouvrirAccesAudit } from '../audit-acces.ts';
import { readRawBlob } from '../../../src/capture/store.js';
const { prisma } = await ouvrirAccesAudit();
const rapports = await prisma.$queryRawUnsafe<Array<{ reportHash: string; src: string; writeFailed: number }>>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT c."reportHash", b."sourceKey" AS src, c."writeFailed"
    FROM "SourceIngestionCompletion" c JOIN "CaptureBatch" b ON b.id=c."batchId"
   WHERE b."sourceKey" IN (SELECT "sourceKey" FROM muettes) AND c."writeFailed" > 0`);

const motifs = new Map<string, { offres: number; sources: Set<string> }>();
for (const r of rapports) {
  const texte = new TextDecoder().decode(await readRawBlob(prisma, r.reportHash));
  for (const m of texte.matchAll(/"reason":"([^"]{1,80})"/g)) {
    const e = motifs.get(m[1]) ?? { offres: 0, sources: new Set<string>() };
    e.offres += 1; e.sources.add(r.src); motifs.set(m[1], e);
  }
}
console.log(`═══ MOTIFS D'ÉCHEC D'ÉCRITURE — ${rapports.length} rapports lus ═══\n`);
for (const [motif, e] of [...motifs].sort((a, b) => b[1].offres - a[1].offres))
  console.log(`  ${String(e.offres).padStart(6)} offres  ${String(e.sources.size).padStart(3)} sources  ${motif}`);
await prisma.$disconnect();

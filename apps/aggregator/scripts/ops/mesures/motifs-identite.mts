/**
 * LES MOTIFS RÉELS de `EmployerIdentityReviewRequired`, lus dans les rapports de complétion.
 *
 * `resolve.ts` lève à SIX endroits, pour des raisons très différentes — certaines résolubles
 * automatiquement (certification manquante), d'autres réellement ambiguës (conflit d'alias).
 * Les confondre reviendrait à traiter une configuration absente comme un arbitrage humain.
 */
import { ouvrirAccesAudit } from '../audit-acces.ts';
import { readRawBlob } from '../../../src/capture/store.js';
const { prisma } = await ouvrirAccesAudit();
const rapports = await prisma.$queryRawUnsafe<Array<{ reportHash: string; src: string }>>(`
  WITH pub AS (SELECT DISTINCT "sourceKey" FROM "JobSource"),
       muettes AS (SELECT DISTINCT b."sourceKey" AS k FROM "CaptureBatch" b
                    WHERE b."sourceKey" NOT IN (SELECT "sourceKey" FROM pub))
  SELECT DISTINCT ON (b."sourceKey") c."reportHash", b."sourceKey" AS src
    FROM "SourceIngestionCompletion" c JOIN "CaptureBatch" b ON b.id = c."batchId"
   WHERE b."sourceKey" IN (SELECT k FROM muettes) AND c."writeFailed" > 0
   ORDER BY b."sourceKey", c."completedAt" DESC`);

const parMotif = new Map<string, Set<string>>();
for (const r of rapports) {
  const texte = new TextDecoder().decode(await readRawBlob(prisma, r.reportHash));
  // `detail` porte le motif précis passé au constructeur de l'erreur.
  for (const m of texte.matchAll(/"detail":"([^"]{1,90})"/g)) {
    const s = parMotif.get(m[1]) ?? new Set<string>();
    s.add(r.src); parMotif.set(m[1], s);
  }
}
console.log(`═══ MOTIFS PRÉCIS — ${rapports.length} sources, dernier rapport de chacune ═══\n`);
for (const [motif, srcs] of [...parMotif].sort((a, b) => b[1].size - a[1].size))
  console.log(`  ${String(srcs.size).padStart(3)} sources  ${motif}`);
await prisma.$disconnect();

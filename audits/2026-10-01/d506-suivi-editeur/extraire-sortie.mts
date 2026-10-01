/**
 * Lecture seule : la sortie d'adaptateur scellée d'une offre, dans la capture JOBS de sa source commencée dans une
 * fenêtre, et l'historique d'employeur qui précède (observations attribuées) — de quoi rejouer D-506 §3 sur des
 * données réelles dans un témoin (`apps/aggregator/src/pipeline/publisher-follow.richemont.test.ts`). La transaction
 * est ouverte `READ ONLY` puis annulée : rien ne peut être écrit, même par un rôle superutilisateur (PGOPTIONS ne
 * s'applique pas à Prisma, `db.py` le dit).
 *
 * Usage : python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *   audits/2026-10-01/d506-suivi-editeur/extraire-sortie.mts richemont Security-Specialist_JR132200 \
 *   2026-10-01T16:00:00Z 2026-10-01T16:41:00Z > apps/aggregator/src/test/fixtures/d506-richemont/richemont-JR132200-0110.json
 * (et de même pour le témoin Sales-Experience-Manager---Troy_JR134214, une offre de la même capture publiée sous Cartier).
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../apps/aggregator/src/capture/store.js';

const [sourceKey, externalId, from, to] = process.argv.slice(2);
if (!sourceKey || !externalId || !from || !to) {
  console.error('usage: extraire-sortie.mts <source> <externalId> <début ISO> <fin ISO>');
  process.exit(2);
}
class Annulation extends Error {}
const prisma = new PrismaClient({ log: [] });
let sortie: unknown;
try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const batch = await tx.captureBatch.findFirstOrThrow({ where: { sourceKey, purpose: 'JOBS', startedAt: { gte: new Date(from), lte: new Date(to) } },
      orderBy: { startedAt: 'desc' }, select: { id: true, startedAt: true } });
    const row = await tx.sourceExtraction.findFirstOrThrow({ where: { batchId: batch.id, externalId }, select: { ordinal: true, outputHash: true } });
    const job = JSON.parse((await readRawBlob(tx, row.outputHash)).toString('utf8'));
    const history = await tx.employerObservation.findMany({ where: { sourceKey, externalId, observedAt: { lt: new Date(to) } },
      orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
      select: { observedAt: true, rawEmployerName: true, labelOrigin: true, rule: true, canonicalEmployerId: true } });
    const ids = [...new Set(history.map(h => h.canonicalEmployerId).filter((id): id is string => !!id))];
    const companies = new Map((await tx.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, canonicalKey: true, parentGroup: true } }))
      .map(c => [c.id, c]));
    sortie = { source: sourceKey, externalId, captureBatchId: batch.id, captureStartedAt: batch.startedAt, ordinal: row.ordinal,
      outputHash: row.outputHash, job,
      employerHistory: history.map(({ canonicalEmployerId, ...h }) => ({ ...h, employer: canonicalEmployerId ? companies.get(canonicalEmployerId) ?? null : null })) };
    throw new Annulation();
  }, { timeout: 60_000 });
} catch (error) {
  if (!(error instanceof Annulation)) throw error;
} finally {
  await prisma.$disconnect();
}
console.log(JSON.stringify(sortie, null, 1));

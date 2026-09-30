/**
 * LES FAITS D'ATTESTATION DE LA DERNIÈRE COLLECTE SCELLÉE, AVEC LE CODE DE CE DÉPÔT — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/attestation-a-blanc.mts --sources=aigle[,autre]
 *
 * Refait, sur la dernière collecte d'offres de la révision courante, le calcul des faits d'attestation du refresh
 * (`readAttestingCapture` → `attestationFacts`, D-484 §2 compris) : manifeste scellé, rapport de fin d'ingestion,
 * collecte productive précédente et total annoncé dans SON manifeste. Tout se lit dans une transaction `READ ONLY`,
 * annulée à la fin. La porte de publication (`requireCurrentCaptureRevision`) n'est PAS rejouée : elle pose un verrou
 * `FOR SHARE`, qu'une transaction en lecture seule refuse ; ce programme ne dit donc rien de l'admission du jour.
 */
import { PrismaClient } from '@prisma/client';
import { readExtractionManifest } from '../../../src/capture/manifest.js';
import { readIngestionCompletion } from '../../../src/capture/completion.js';
import { attestationFacts, sealedDeclaredTotal } from '../../../src/pipeline/attestingCapture.js';
import { splitRejectedRows } from '../../../src/pipeline/rejectedRows.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const sources = (arg('sources') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!sources.length) { console.error('usage: attestation-a-blanc.mts --sources=<clé,clé>'); process.exit(2); }
const ROLLBACK = new Error('rollback');
const prisma = new PrismaClient({ log: [] });
const out: unknown[] = [];
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    for (const sourceKey of sources) {
      const [registry] = await tx.$queryRaw<{ currentRevisionId: string }[]>`SELECT "currentRevisionId" FROM "Source" WHERE key=${sourceKey}`;
      const batch = registry && await tx.captureBatch.findFirst({
        where: { sourceKey, sourceRevisionId: registry.currentRevisionId, purpose: 'JOBS', attemptOrdinal: { not: null } },
        orderBy: { attemptOrdinal: 'desc' }, include: { outcome: true } });
      if (!batch?.outcome?.manifestHash) { out.push({ source: sourceKey, faits: null, raison: 'aucune collecte scellée' }); continue; }
      const manifest = await readExtractionManifest(tx, batch.id);
      const completion = await readIngestionCompletion(tx, batch.id);
      if (!completion) { out.push({ source: sourceKey, captureBatchId: batch.id, faits: null, raison: 'aucun rapport de fin d’ingestion' }); continue; }
      const previous = await tx.sourceIngestionCompletion.findFirst({
        where: { batch: { sourceKey }, published: { gt: 0 }, completedAt: { lt: completion.row.completedAt }, batchId: { not: batch.id } },
        orderBy: [{ completedAt: 'desc' }, { batchId: 'desc' }], select: { published: true, batchId: true } });
      const rejectedRows = Array.isArray(manifest.metadata.rejectedRows) ? manifest.metadata.rejectedRows : [];
      const previousDeclaredTotal = previous ? await sealedDeclaredTotal(tx, previous.batchId) : null;
      const facts = attestationFacts({ sourceKey, captureBatchId: batch.id, startedAt: batch.startedAt, metadata: manifest.metadata,
        outputs: manifest.outputs.length, counts: completion.row, unreadableRows: splitRejectedRows(rejectedRows).failures.length,
        previousPublished: previous?.published ?? null, previousDeclaredTotal });
      out.push({ source: sourceKey, captureBatchId: batch.id, collectePrecedente: previous?.batchId ?? null, previousDeclaredTotal, faits: facts });
    }
    throw ROLLBACK;
  }, { timeout: 120_000 }).catch((error) => { if (error !== ROLLBACK) throw error; });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await prisma.$disconnect();
}

/**
 * LA QUALIFICATION NATIVE QU'AURAIT RENDUE LE LECTEUR COURANT SUR UN LOT ARCHIVÉ — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/validation-a-blanc.mts --batch=<id de CaptureBatch>
 *
 * Rejoue l'adaptateur de CE dépôt contre les seules réponses archivées du lot (`replayExtraction`, aucune requête
 * vers l'éditeur), puis applique au résultat le calcul de `validateCapturedSource` : retenues, relecture de chaque
 * publication, tolérance, verdict. Rien n'est écrit : aucune `SourceValidation` n'est créée.
 *
 * Pourquoi pas `validateCapturedSource` elle-même : sur un lot collecté par un lecteur ANTÉRIEUR, elle refuse à
 * juste titre (REPLAY_RESULT_CHANGED), puisque la sortie scellée n'est plus celle que le lecteur courant produit. En
 * production, le lot du jour est collecté ET relu par le même lecteur ; ce programme rend donc le verdict de ce cas,
 * et nomme séparément les sorties que le lecteur courant lit autrement que la sortie scellée.
 */
import { PrismaClient } from '@prisma/client';
import { replayExtraction } from '../../../src/capture/batch.js';
import { compareExtractionResult, readExtractionManifest } from '../../../src/capture/manifest.js';
import { digestBytes } from '../../../src/capture/context.js';
import { captureConfig } from '../../../src/capture/config.js';
import { effectiveSourceConfig } from '../../../src/connectors/sourceConfig.js';
import { KIND_TO_ATS } from '../../../src/ats/catalogKinds.js';
import { fetchAtsJobs } from '../../../src/ats/index.js';
import { certifiedPortalIdentity } from '../../../src/connectors/sourceIdentity.js';
import { employerFromCertifiedScope } from '../../../src/identity/portalEmployer.js';
import { recoverRetainedPublication, PER_PUBLICATION_REASONS } from '../../../src/publication/recovery.js';
import { unqualifiedAllowanceFor } from '../../../src/connectors/sourceCertification.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const batchId = arg('batch');
if (!batchId) { console.error('usage: validation-a-blanc.mts --batch=<id de CaptureBatch>'); process.exit(2); }

const prisma = new PrismaClient({ log: [] });
try {
  const batch = await prisma.captureBatch.findUniqueOrThrow({ where: { id: batchId }, include: { outcome: true } });
  const [revision] = await prisma.$queryRawUnsafe<{ payloadText: string }[]>(
    `SELECT payload::text AS "payloadText" FROM "SourceRevision" WHERE id = $1`, batch.sourceRevisionId);
  const payload = JSON.parse(revision.payloadText) as { kind: string; config: Record<string, unknown> };
  const config = captureConfig(effectiveSourceConfig(payload.config));
  const kind = KIND_TO_ATS[payload.kind];
  const identity = await certifiedPortalIdentity(prisma, batch.sourceKey);
  const portal = identity?.sourceRevisionId === batch.sourceRevisionId ? identity : null;

  const manifest = await readExtractionManifest(prisma, batchId);
  const replayed = await replayExtraction(prisma, batchId, () => fetchAtsJobs(kind as never, config));
  const exact = await compareExtractionResult(prisma, batchId, replayed);
  // Les sorties que le lecteur courant lit autrement que la sortie scellée du lot.
  const changees = replayed.jobs.flatMap((job, index) => {
    const { captureBatchId: _b, captureOutputId: _o, ...content } = job as typeof job & { captureBatchId?: string; captureOutputId?: string };
    const scellee = manifest.outputs[index];
    return scellee && scellee.externalId === (job.externalId ?? null) && scellee.outputHash === digestBytes(JSON.stringify(content)) ? []
      : [{ externalId: job.externalId, titre: job.title, retenue: job.publicationHold ?? null, description: (job.description ?? '').length }];
  });

  const reasons: Record<string, number> = {};
  const reason = (name: string) => { reasons[name] = (reasons[name] ?? 0) + 1; };
  let qualified = 0; let held = 0; let rejected = 0;
  const retenues: Record<string, number> = {};
  if (replayed.truncated || replayed.complete === false) reason('ENUMERATION_INCOMPLETE');
  if (new Set(replayed.jobs.map((job) => job.externalId)).size !== replayed.jobs.length) reason('DUPLICATE_PUBLICATION_IDS');
  const inputUnqualified = (replayed.rejectedRows ?? []).filter((row) =>
    !['LISTED_PAGE_WITHOUT_JOBPOSTING', 'LISTED_POSTING_PREVIEW'].includes(row.reason)).length;
  if (replayed.rejectedRows?.length) reasons.REJECTED_NATIVE_ROWS = replayed.rejectedRows.length;
  for (const job of replayed.jobs) {
    const eligible = portal ? employerFromCertifiedScope(job, portal.ownerName, portal.scope, portal.brands) : job;
    if (eligible.publicationHold || eligible.publicationWithdrawnAt) {
      held++; const motif = eligible.publicationHold ?? 'WITHDRAWN'; retenues[motif] = (retenues[motif] ?? 0) + 1; continue;
    }
    const registryResolved = !!job.publicationHold && !eligible.publicationHold;
    const recovery = recoverRetainedPublication(payload.kind, job.raw, { externalId: job.externalId, url: job.url, observedAt: batch.startedAt, config,
      ...(registryResolved ? { certifiedPortal: portal! } : {}) });
    if (recovery.status === 'RECOVERABLE') qualified++;
    else { rejected++; reason(recovery.reason); }
  }
  const observed = replayed.jobs.length;
  if (observed && !qualified) reason('NO_QUALIFIED_PUBLICATION');
  const perPublication = new Set<string>([...PER_PUBLICATION_REASONS, 'ENUMERATION_INCOMPLETE', 'REJECTED_NATIVE_ROWS']);
  const batchReasons = Object.keys(reasons).filter((name) => !perPublication.has(name));
  const unqualified = rejected + inputUnqualified;
  const allowance = unqualifiedAllowanceFor(observed + inputUnqualified);
  const verdict = unqualified <= allowance && batchReasons.length === 0 && qualified > 0 ? 'VALIDATED' : 'REJECTED';
  console.log(JSON.stringify({ source: batch.sourceKey, capture: batchId, startedAt: batch.startedAt,
    sortieScellee: batch.outcome?.extractedCount ?? null, rejeu: observed, complete: replayed.complete ?? null,
    rejeuIdentiqueAuScelle: exact.exact, sortiesLuesAutrement: changees,
    verdictLecteurCourant: verdict, qualified, held, retenues, rejected, inputUnqualified, reasons, allowance }, null, 1));
} finally {
  await prisma.$disconnect();
}

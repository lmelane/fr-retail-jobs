import type { Prisma } from '@prisma/client';
import type { NormalizedJob } from '../types.js';
import type { readCapturedPublication } from './publication.js';
import { certifiedPortalScope } from '../connectors/sourceIdentity.js';
import { employerFromCertifiedScope } from '../identity/portalEmployer.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { SCOPE_HOLD } from '../pipeline/scopeDecisions.js';
import { deployedCommitHash } from './revision.js';

type CapturedPublication = Awaited<ReturnType<typeof readCapturedPublication>>;
export type PublicationInput = NormalizedJob & { sourceKey: string };

/** Source lifecycle lock must already be held. Native lifecycle observations
 * and reviewed scope decisions are separate evidence; neither rewrites RAW. Applied scope evidence is retained in the append-only audit ledger. */
export async function enforcePublicationPolicy(tx: Prisma.TransactionClient, capture: CapturedPublication,
  input: PublicationInput, mode: 'PUBLISH' | 'HOLD'): Promise<void> {
  const [scope] = await tx.$queryRaw<{ verdict: string; decidedAt: Date; decisionText: string }[]>`
    SELECT verdict, "decidedAt", to_jsonb(s)::text AS "decisionText" FROM "PostingScopeDecision" s
    WHERE "sourceKey"=${input.sourceKey} AND "externalId"=${input.externalId}`;
  const native = capture.captured;
  if (mode === 'PUBLISH') {
    if (input.publicationHold || input.publicationWithdrawnAt || scope?.verdict === 'OUT_OF_SCOPE') throw new Error('Publication is held by current policy');
    if (native.publicationWithdrawnAt) throw new Error('Captured publication is withdrawn');
    if (native.publicationHold) {
      const source = await tx.source.findUniqueOrThrow({ where: { key: input.sourceKey }, select: { maison: true } });
      const qualified = employerFromCertifiedScope({ ...native, postedAt: undefined, validThrough: undefined,
        publicationWithdrawnAt: undefined }, source.maison, await certifiedPortalScope(tx, input.sourceKey));
      if (qualified.publicationHold) throw new Error('Captured publication is held');
    }
    return;
  }
  const withdrawn = input.publicationWithdrawnAt;
  if (withdrawn && (!Number.isFinite(withdrawn.getTime()) || withdrawn.getTime() > Date.now())) throw new Error('Invalid withdrawal observation time');
  if (input.publicationHold === SCOPE_HOLD && !native.publicationHold) {
    if (scope?.verdict !== 'OUT_OF_SCOPE' || scope.decidedAt.getTime() !== withdrawn?.getTime()) throw new Error('Publication scope decision is no longer current');
    const planHash = evidenceHash(scope.decisionText);
    await tx.dataCorrection.createMany({ data: [{ batchId: `scope-policy:${planHash}`, planHash,
      commitHash: deployedCommitHash(), finding: 'PUBLICATION_SCOPE_HOLD',
      entityType: 'SourceExtraction', entityId: input.captureOutputId!,
      before: { publicationHold: native.publicationHold ?? null, publicationWithdrawnAt: native.publicationWithdrawnAt ?? null },
      after: { publicationHold: input.publicationHold, publicationWithdrawnAt: withdrawn!.toISOString() },
      evidence: { sourceKey: input.sourceKey, externalId: input.externalId, captureBatchId: capture.batch.id,
        captureOutputHash: capture.outputHash, scopeDecisionText: scope.decisionText },
    }], skipDuplicates: true });
  } else if (!native.publicationHold || native.publicationHold !== input.publicationHold ||
    (native.publicationWithdrawnAt ?? null) !== (withdrawn?.toISOString() ?? null)) {
    throw new Error('Publication lifecycle differs from the captured output');
  }
}

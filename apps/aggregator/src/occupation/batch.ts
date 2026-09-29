import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { occupationManifestHash } from "@catwalks/db/occupations";
import { occupationDecisionChanged, occupationState } from "./persist.js";

export type OccupationChange = {
  before: Record<string, any> & { id: string; updatedAt: Date };
  after: Record<string, any>;
};
/** One bounded SQL operation for the mutations AND their before/after ledger.
 * Concurrently changed inputs are excluded by updatedAt, never overwritten. */
export async function writeOccupationBatch(
  tx: Prisma.TransactionClient,
  changes: OccupationChange[],
) {
  if (!changes.length) return 0;
  const payload = changes.map(({ before, after }) => ({
    id: before.id,
    observedAt: before.updatedAt.toISOString(),
    input: {
      title: before.title,
      department: before.department,
      sourceKey: before.canonicalSourceKey,
      externalId: before.canonicalExternalId,
    },
    before: occupationState(before),
    decision: occupationState(after),
    // L'offre est réécrite dès que son état change ; l'historique immuable ne reçoit qu'une décision nouvelle, jamais
    // un remplissage des seuls métiers lus (audit du 29/09/2026 : 80 741 observations vides sinon).
    observe: occupationDecisionChanged(before, after),
    observationId: randomUUID(),
    inputHash: occupationManifestHash(after.occupationEvidence),
  }));
  const [{ written }] = await tx.$queryRaw<{ written: number }[]>`
    WITH proposals AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
      AS c(id text,"observedAt" timestamptz,input jsonb,before jsonb,decision jsonb,"observationId" text,"inputHash" text,observe boolean)
    ), changed AS (
      UPDATE "Job" j SET
        "jobFunction"=c.decision->>'jobFunction',
        "occupationCode"=c.decision->>'occupationCode',"rawTitle"=c.decision->>'rawTitle',
        "normalizedTitle"=c.decision->>'normalizedTitle',"occupationStatus"=c.decision->>'occupationStatus',
        "occupationEvidence"=c.decision->'occupationEvidence',
        "occupationReleaseId"=c.decision->>'occupationReleaseId',seniority=c.decision->>'seniority',
        "titleRoles"=ARRAY(SELECT jsonb_array_elements_text(coalesce(c.decision->'titleRoles','[]'::jsonb))),
        "titleRolesReleaseId"=c.decision->>'titleRolesReleaseId',
        "updatedAt"=statement_timestamp()
      FROM proposals c
      WHERE j.id=c.id AND j."updatedAt"=c."observedAt" AT TIME ZONE 'UTC' AND j."mergedIntoId" IS NULL
        AND ROW(j.title,j.department,j."rawTitle",j."canonicalSourceKey",j."canonicalExternalId",j."jobFunction",j.seniority,j."occupationCode",j."occupationReleaseId")
          IS NOT DISTINCT FROM ROW(c.input->>'title',c.input->>'department',c.before->>'rawTitle',c.input->>'sourceKey',c.input->>'externalId',c.before->>'jobFunction',c.before->>'seniority',c.before->>'occupationCode',c.before->>'occupationReleaseId')
      RETURNING j.id,c.before,c.decision,c."observationId",c."inputHash",c.observe
    ), receipts AS (
      INSERT INTO "OccupationObservation" (id,"jobId","releaseId","inputHash",decision,before)
      SELECT "observationId",id,decision->>'occupationReleaseId',"inputHash",decision,before FROM changed WHERE observe
      RETURNING id
    ) SELECT (SELECT count(*)::int FROM changed) AS written`;
  return written;
}

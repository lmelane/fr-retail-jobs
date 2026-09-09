import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  occupationManifestHash,
  type CompiledOccupationTaxonomy,
} from "@catwalks/db/occupations";
import { classifyJob } from "../normalize/taxonomy.js";

type Input = {
  title: string;
  department?: string | null;
  description?: string | null;
  rawTitle?: string | null;
  sourceKey?: string;
  externalId?: string;
};
export function classifyOccupationContent(
  input: Input,
  catalogue: CompiledOccupationTaxonomy,
) {
  const c = classifyJob(input, catalogue);
  return {
    ...c,
    rawTitle: input.rawTitle ?? null,
    occupationEvidence: {
      ...c.occupationEvidence,
      rawTitle: input.rawTitle ?? null,
      rawTitleOrigin:
        input.rawTitle == null
          ? "STORED_TITLE_ONLY"
          : "ADAPTER_TITLE_BEFORE_CLEANING",
      sourceKey: input.sourceKey ?? null,
      externalId: input.externalId ?? null,
    },
  };
}
export const OCCUPATION_FIELDS = [
  "jobFunction",
  "occupationGroup",
  "occupationCode",
  "rawTitle",
  "normalizedTitle",
  "occupationStatus",
  "occupationEvidence",
  "occupationSpecializations",
  "occupationReleaseId",
  "seniority",
  "isRetail",
] as const;
export function occupationState(row: Record<string, any>) {
  return Object.fromEntries(OCCUPATION_FIELDS.map((k) => [k, row[k] ?? null]));
}
/** Append actual transitions, including A → B → A. Identical reattestations
 * produce no new row; reusing an old input must still preserve its new date. */
export async function recordOccupationObservation(
  tx: Prisma.TransactionClient,
  job: Record<string, any> & { id: string },
  before: Record<string, any> | null,
) {
  if (!job.occupationReleaseId)
    throw new Error(`Missing occupation decision for ${job.id}`);
  if (
    before &&
    occupationManifestHash(occupationState(before)) ===
      occupationManifestHash(occupationState(job))
  )
    return;
  const inputHash = occupationManifestHash(job.occupationEvidence);
  await tx.occupationObservation.create({
    data: {
      id: randomUUID(),
      jobId: job.id,
      releaseId: job.occupationReleaseId,
      inputHash,
      decision: occupationState(job) as Prisma.InputJsonValue,
      before: before
        ? (occupationState(before) as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });
}

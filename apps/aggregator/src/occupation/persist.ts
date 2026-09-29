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
    // Lot 2B de D-475 : les métiers lus dans le titre sont les candidats retenus par le moteur (le métier d'un intitulé
    // classé, les métiers en concurrence d'un intitulé ambigu : « Vendeur / Caissier »), donc sous toutes les décisions
    // (§32 a : « Responsable vendeur » n'est pas « Vendeur » ; §36 : intitulé exact) ; écrits avec la classification,
    // jamais périmés, avec la version qui les a lus.
    titleRoles: [...c.occupationEvidence.candidates].sort(),
    titleRolesReleaseId: c.occupationReleaseId,
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
  "occupationCode",
  "rawTitle",
  "normalizedTitle",
  "occupationStatus",
  "occupationEvidence",
  "occupationReleaseId",
  "seniority",
  "titleRoles",
  "titleRolesReleaseId",
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

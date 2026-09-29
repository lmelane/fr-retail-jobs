import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  occupationManifestHash,
  occupationTitleRoles,
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
    // D-475 point 38 : les métiers lus dans l'intitulé (packages/db/occupation-title-roles.ts), écrits avec la
    // classification, jamais périmés, avec la version qui les a lus ; sur l'intitulé que le moteur a classé (le brut
    // garde ses entités HTML : « Floor&#160;Manager » ne se lisait pas, audit du 29/09/2026).
    titleRoles: occupationTitleRoles(catalogue, input.title, c),
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
/** Ce que l'historique compare : la décision, pas les métiers lus dans l'intitulé qui s'en déduisent. Le premier passage
 * après les migrations 2B remplit `titleRoles` et leur version sur chaque offre : compté comme décision nouvelle, il
 * aurait écrit une observation immuable par offre sans que rien ne change (audit du 29/09/2026). */
const DECISION_FIELDS = OCCUPATION_FIELDS.filter((k) => k !== "titleRoles" && k !== "titleRolesReleaseId");
const decisionState = (row: Record<string, any>) => Object.fromEntries(DECISION_FIELDS.map((k) => [k, row[k] ?? null]));
/** Une décision nouvelle (hors métiers lus) : ce que l'historique immuable enregistre, ici et en lot (`batch.ts`). */
export const occupationDecisionChanged = (before: Record<string, any>, after: Record<string, any>) =>
  occupationManifestHash(decisionState(before)) !== occupationManifestHash(decisionState(after));
/** Append actual transitions, including A → B → A. Identical reattestations
 * produce no new row; reusing an old input must still preserve its new date. */
export async function recordOccupationObservation(
  tx: Prisma.TransactionClient,
  job: Record<string, any> & { id: string },
  before: Record<string, any> | null,
) {
  if (!job.occupationReleaseId)
    throw new Error(`Missing occupation decision for ${job.id}`);
  if (before && !occupationDecisionChanged(before, job)) return;
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

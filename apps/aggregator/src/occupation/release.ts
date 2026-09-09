import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  compileOccupationManifest,
  loadOccupationTaxonomy,
  occupationManifestHash,
  type OccupationManifest,
} from "@catwalks/db/occupations";
import { classifyOccupationContent, occupationState } from "./persist.js";

/** Keys are identities. Moving an existing key to another parent requires a
 * separately reviewed migration, rather than rewriting its meaning in place. */
export function validateOccupationSuccessor(
  previous: OccupationManifest,
  next: OccupationManifest,
) {
  compileOccupationManifest(next);
  for (const kind of [
    "groups",
    "families",
    "occupations",
    "seniorities",
    "specializations",
  ] as const) {
    const target = new Map((next[kind] ?? []).map((d) => [d.key, d]));
    for (const old of previous[kind] ?? []) {
      const current = target.get(old.key);
      if (
        !current ||
        current.family !== old.family ||
        current.group !== old.group
      )
        throw new Error(`OCCUPATION_IDENTITY_CHANGED: ${kind}/${old.key}`);
    }
  }
}

async function replay(tx: Prisma.TransactionClient, raw: unknown) {
  const catalogue = compileOccupationManifest(raw),
    active = await loadOccupationTaxonomy(tx);
  validateOccupationSuccessor(active.manifest, catalogue.manifest);
  const hash = createHash("sha256"),
    decisions = createHash("sha256");
  const statuses: Record<string, number> = {},
    transitions: Record<string, number> = {},
    witnesses: Record<
      string,
      { id: string; title: string; department: string | null }[]
    > = {};
  let scanned = 0,
    activeJobs = 0,
    changed = 0,
    classifiedActive = 0,
    cursor: string | undefined;
  for (;;) {
    const rows = await tx.job.findMany({
      where: { mergedIntoId: null },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        department: true,
        rawTitle: true,
        isActive: true,
        canonicalSourceKey: true,
        canonicalExternalId: true,
        jobFunction: true,
        occupationGroup: true,
        occupationCode: true,
        normalizedTitle: true,
        occupationStatus: true,
        occupationEvidence: true,
        occupationSpecializations: true,
        occupationReleaseId: true,
        seniority: true,
        isRetail: true,
      },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const after = classifyOccupationContent(
        {
          title: row.title,
          department: row.department,
          rawTitle: row.rawTitle,
          sourceKey: row.canonicalSourceKey ?? undefined,
          externalId: row.canonicalExternalId ?? undefined,
        },
        catalogue,
      );
      hash.update(occupationManifestHash(row));
      decisions.update(
        occupationManifestHash([row.id, occupationState(after)]),
      );
      scanned++;
      if (
        occupationManifestHash(occupationState(row)) !==
        occupationManifestHash(occupationState(after))
      )
        changed++;
      if (row.isActive) {
        activeJobs++;
        if (after.occupationCode) classifiedActive++;
        statuses[after.occupationStatus] =
          (statuses[after.occupationStatus] ?? 0) + 1;
      }
      const transition = `${row.jobFunction ?? "∅"} → ${after.jobFunction ?? "∅"}`;
      transitions[transition] = (transitions[transition] ?? 0) + 1;
      for (const rule of after.occupationEvidence.matchedRules) {
        const examples = (witnesses[rule] ??= []);
        if (examples.length < 3)
          examples.push({
            id: row.id,
            title: row.title,
            department: row.department,
          });
      }
    }
    cursor = rows.at(-1)!.id;
  }
  const proof = {
    schemaVersion: 1,
    baseRelease: active.manifest.id,
    targetRelease: catalogue.manifest.id,
    manifestHash: occupationManifestHash(catalogue.manifest),
    corpusHash: hash.digest("hex"),
    decisionHash: decisions.digest("hex"),
    scanned,
    activeJobs,
    changed,
    classifiedActive,
    statuses,
    transitions,
    witnesses,
    rulesWithoutWitness: catalogue.manifest.rules
      .filter((r) => !witnesses[r.id])
      .map((r) => r.id),
  };
  return { ...proof, proofHash: occupationManifestHash(proof) };
}
export type OccupationReplay = Awaited<ReturnType<typeof replay>>;

/** Real stored inputs only. The read-only, repeatable snapshot is a reviewable
 * proposal, not a mutation or a synthetic load test. */
export async function previewOccupationRelease(db: PrismaClient, raw: unknown) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return replay(tx, raw);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 120_000,
    },
  );
}

export async function activateOccupationRelease(
  db: PrismaClient,
  raw: unknown,
  review: OccupationReplay,
  commitHash: string,
) {
  if (!/^[a-f0-9]{40}$/.test(commitHash))
    throw new Error(
      "A deployed implementation commit is required for the activation receipt",
    );
  return db.$transaction(
    async (tx) => {
      // Writers take FOR SHARE on the same row. No old pinned run can race this
      // atomic pointer switch; every following write resolves the current release.
      await tx.$queryRaw`SELECT id FROM "OccupationState" WHERE id='active' FOR UPDATE`;
      const measured = await replay(tx, raw);
      if (measured.proofHash !== review.proofHash)
        throw new Error(
          "OCCUPATION_REVIEW_STALE: corpus, rules or active release changed; replay and review again",
        );
      if (measured.baseRelease === measured.targetRelease)
        throw new Error("OCCUPATION_RELEASE_ALREADY_ACTIVE");
      const manifest = compileOccupationManifest(raw).manifest;
      await tx.occupationRelease.create({
        data: {
          id: manifest.id,
          contentHash: measured.manifestHash,
          manifest: manifest as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.occupationState.update({
        where: { id: "active" },
        data: { releaseId: manifest.id, backfilledAt: null },
      });
      await tx.dataCorrection.create({
        data: {
          batchId: `occupation-release:${manifest.id}`,
          planHash: measured.proofHash,
          commitHash,
          finding:
            "Reviewed occupation catalogue activation; posting replay is separate",
          entityType: "OccupationState",
          entityId: "active",
          before: { releaseId: measured.baseRelease },
          after: { releaseId: manifest.id },
          evidence: measured as unknown as Prisma.InputJsonValue,
        },
      });
      return measured;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

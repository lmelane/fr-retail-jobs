import "../test/setup-integration.js";
import { it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { toCandidate } from "./ingest.js";
import { upsertDeduplicated } from "../dedup/upsert.js";
import { resolveCanonicalDimensions } from "../trust/resolve.js";
import { previewSectors, applySectors } from "../sectors/review.js";
const p = new PrismaClient();
beforeEach(async () => {
  await p.jobSource.deleteMany();
  await p.job.deleteMany();
  await p.company.deleteMany();
});
afterAll(async () => {
  await p.jobSource.deleteMany();
  await p.job.deleteMany();
  await p.company.deleteMany();
  await p.$disconnect();
});
it("captures adapter inputs, preserves reviewed sectors and clears a proven conflict without losing the offer", async () => {
  const source = {
    key: "employment-chain-fixture",
    company: "Employment Fixture",
    tier: "ATS_OFFICIAL" as const,
  };
  const raw = { name: "Analyst", contractFilter: "Permanent Job" };
  const original = toCandidate(
    {
      externalId: "real-path-shape",
      title: raw.name,
      url: "https://example.com/job",
      raw,
    },
    source,
    source.company,
    "LVMH_ALGOLIA",
  );
  const first = await upsertDeduplicated(p, original);
  const stored = await p.job.findUniqueOrThrow({
    where: { id: first.jobId },
    include: { company: true },
  });
  expect(stored.employmentTerm).toBe("PERMANENT");
  expect(stored.employmentEvidence).toMatchObject({
    version: "employment-paths-20260909-v2",
    sourceKey: source.key,
  });
  const replay = resolveCanonicalDimensions({
    sourceKey: source.key,
    title: stored.rawTitle ?? stored.title,
    contract: stored.rawContract,
    workingTime: stored.rawWorkingTime,
    raw: stored.raw,
  });
  expect(replay.employmentTerm).toBe(stored.employmentTerm);
  const m = {
    reviewer: "integration",
    companies: [
      {
        id: stored.companyId,
        canonicalKey: stored.company.canonicalKey,
        codes: ["WATCHMAKING"],
        evidence: [
          {
            code: "WATCHMAKING",
            source: "https://example.com/sector",
            statement: "Fixture business activity",
            confidence: "HIGH" as const,
            basis: "OFFICIAL_SOURCE" as const,
            checkedAt: "2026-09-09T00:00:00Z",
          },
        ],
      },
    ],
  };
  const preview = await previewSectors(p, m);
  await applySectors(p, m, preview.reviewHash);
  const title = "CDD - Analyst";
  const next = toCandidate(
    {
      externalId: "real-path-shape",
      title,
      url: "https://example.com/job",
      raw: { ...raw, name: title },
    },
    source,
    source.company,
    "LVMH_ALGOLIA",
  );
  const second = await upsertDeduplicated(p, next);
  expect(second.jobId).toBe(first.jobId);
  const after = await p.job.findUniqueOrThrow({
    where: { id: first.jobId },
    include: { company: true },
  });
  expect(after.employmentTerm).toBeNull();
  expect(after.isActive).toBe(true);
  expect(after.company.sectorCodes).toEqual(["WATCHMAKING"]);
  expect(after.employmentEvidence).toMatchObject({
    decisions: { employmentTerm: { origin: "CONFLICTING_EXPLICIT_EVIDENCE" } },
  });
  expect(await p.job.count()).toBe(1);
});

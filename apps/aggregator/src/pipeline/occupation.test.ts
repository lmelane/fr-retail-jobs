import "../test/setup-integration.js";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  loadOccupationTaxonomy,
  occupationManifestHash,
  type OccupationManifest,
} from "@catwalks/db/occupations";
import seed from "../../../../packages/db/data/occupations-v1.json" with { type: "json" };
import { upsertDeduplicated } from "../dedup/upsert.js";
import type { CandidateJob } from "../dedup/match.js";
import { classifyJobs } from "./classifyJobs.js";
import { writeOccupationBatch } from "../occupation/batch.js";
import { classifyOccupationContent } from "../occupation/persist.js";
import {
  previewOccupationRelease,
  activateOccupationRelease,
  validateOccupationSuccessor,
} from "../occupation/release.js";

const db = new PrismaClient();
async function wipe() {
  await db.occupationState.update({
    where: { id: "active" },
    data: { releaseId: seed.id, backfilledAt: null },
  });
  await db.jobSource.deleteMany();
  await db.job.deleteMany();
  await db.company.deleteMany();
}
beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});
const candidate = (
  over: Partial<CandidateJob> = {},
): CandidateJob & { companyId: string } => ({
  company: "Occupation Test Maison",
  companyId: "occupation-test-maison",
  sourceKey: "occupation-test-direct",
  sourceTier: "EMPLOYER_DIRECT",
  atsType: "GENERIC_JSONLD",
  externalId: "one",
  title: "Stylist",
  rawTitle: "Stylist",
  department: "Salon Professionals",
  url: "https://careers.example/one",
  description: "A real title shape observed in production.",
  raw: { title: "Stylist", department: "Salon Professionals" },
  ...over,
});

describe("occupation persistence and release lifecycle", () => {
  it("does not skip a posting when writing removes the previous cursor from the stale-release filter", async () => {
    const company = await db.company.create({
      data: {
        name: "Pagination Witness",
        canonicalKey: "pagination-witness",
        fashionjobsUrl: "resolved:pagination-witness",
      },
    });
    for (const id of ["cursor-a", "cursor-b", "cursor-c"])
      await db.job.create({
        data: {
          id,
          companyId: company.id,
          externalId: id,
          source: "GENERIC_JSONLD",
          title: "Sales Advisor",
          url: `https://careers.example/${id}`,
          fingerprint: id,
        },
      });
    const first = await classifyJobs(db, { batchSize: 1 });
    expect(first.scanned).toBe(3);
    expect(first.written).toBe(3);
    expect(first.remaining).toBe(0);
    expect(
      await db.job.findMany({
        select: { id: true, occupationCode: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(
      ["cursor-a", "cursor-b", "cursor-c"].map((id) => ({
        id,
        occupationCode: "sales-advisor",
      })),
    );
    const again = await classifyJobs(db, { all: true, batchSize: 1 });
    expect(again.written).toBe(0);
    expect(again.unchanged).toBe(3);
  });
  it("does not overwrite raced inputs even within the same timestamp millisecond; invalid batches roll back", async () => {
    const a = await upsertDeduplicated(db, candidate()),
      b = await upsertDeduplicated(
        db,
        candidate({
          externalId: "two",
          title: "Sales Advisor",
          rawTitle: "Sales Advisor",
          department: undefined,
        }),
      );
    const rows = await db.job.findMany({
        where: { id: { in: [a.jobId, b.jobId] } },
      }),
      catalogue = await loadOccupationTaxonomy(db);
    const changes = rows.map((before) => ({
      before,
      after: classifyOccupationContent(
        {
          title: before.title,
          department: before.department,
          rawTitle: before.rawTitle,
          sourceKey: before.canonicalSourceKey ?? undefined,
          externalId: before.canonicalExternalId ?? undefined,
        },
        catalogue,
      ),
    }));
    const raced = rows[0];
    await db.job.update({
      where: { id: raced.id },
      data: { title: "Changed native title", updatedAt: raced.updatedAt },
    });
    const written = await db.$transaction((tx) =>
      writeOccupationBatch(tx, changes),
    );
    expect(written).toBe(1);
    expect(
      (await db.job.findUniqueOrThrow({ where: { id: raced.id } })).title,
    ).toBe("Changed native title");
    const fresh = await db.job.findMany({
      where: { id: { in: [a.jobId, b.jobId] } },
    });
    const bad = fresh.map((before) => ({
      before,
      after: {
        ...classifyOccupationContent(before, catalogue),
        occupationCode: "not-a-reviewed-occupation",
        occupationStatus: "CLASSIFIED",
      },
    }));
    const evidence = await db.occupationObservation.count();
    await expect(
      db.$transaction((tx) => writeOccupationBatch(tx, bad)),
    ).rejects.toThrow("Occupation/family mismatch");
    expect(
      await db.job.findMany({ where: { id: { in: [a.jobId, b.jobId] } } }),
    ).toEqual(fresh);
    expect(await db.occupationObservation.count()).toBe(evidence);
  });
  it("classifies the retained department and replays the same decision without changing evidence or contracts", async () => {
    const c = candidate({ programType: "APPRENTICESHIP" }),
      first = await upsertDeduplicated(db, c);
    const original = await db.job.findUniqueOrThrow({
      where: { id: first.jobId },
    });
    expect(original.occupationCode).toBe("hairdresser");
    expect(original.rawTitle).toBe("Stylist");
    await upsertDeduplicated(db, {
      ...c,
      department: undefined,
      raw: { title: "Stylist" },
    });
    const retained = await db.job.findUniqueOrThrow({
      where: { id: first.jobId },
    });
    expect(retained).toMatchObject({
      department: "Salon Professionals",
      occupationCode: "hairdresser",
      programType: "APPRENTICESHIP",
    });
    expect(retained.occupationEvidence).toMatchObject({
      department: "Salon Professionals",
    });
    const count = await db.occupationObservation.count(),
      events = await db.jobEvent.findMany(),
      sources = await db.jobSource.findMany();
    const stats = await classifyJobs(db, { all: true });
    expect(stats.written).toBe(0);
    expect(stats.unchanged).toBe(1);
    expect(stats.remaining).toBe(0);
    expect(
      await db.job.findUniqueOrThrow({ where: { id: first.jobId } }),
    ).toEqual(retained);
    expect(await db.occupationObservation.count()).toBe(count);
    expect(await db.jobEvent.findMany()).toEqual(events);
    expect(await db.jobSource.findMany()).toEqual(sources);
  });
  it("a previously unknown title remains an active posting with a reviewable reason", async () => {
    const { jobId } = await upsertDeduplicated(
      db,
      candidate({
        title: "次世代の仕事",
        rawTitle: "次世代の仕事",
        department: undefined,
      }),
    );
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({
      isActive: true,
      title: "次世代の仕事",
      rawTitle: "次世代の仕事",
      occupationCode: null,
      occupationStatus: "NO_RULE",
      seniority: null,
    });
    expect(job.occupationEvidence).toMatchObject({ confidence: "UNRESOLVED" });
    await expect(db.job.delete({ where: { id: jobId } })).rejects.toThrow();
    const observation = await db.occupationObservation.findFirstOrThrow();
    await expect(
      db.occupationObservation.update({
        where: { id: observation.id },
        data: { inputHash: "tampered" },
      }),
    ).rejects.toThrow("immutable");
  });
  it("preserves repeated A → B → A transitions without duplicating identical reattestations", async () => {
    const c = candidate({
      title: "Sales Advisor",
      rawTitle: "Sales Advisor",
      department: undefined,
    });
    const { jobId } = await upsertDeduplicated(db, c);
    await upsertDeduplicated(db, {
      ...c,
      title: "Beauty Advisor",
      rawTitle: "Beauty Advisor",
    });
    await upsertDeduplicated(db, c);
    await upsertDeduplicated(db, c);
    const rows = await db.occupationObservation.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => (r.decision as any).occupationCode)).toEqual([
      "sales-advisor",
      "beauty-consultant",
      "sales-advisor",
    ]);
  });
  it("reclassifies legacy rows with a before image, without modifying lifecycle, source events or employment fields", async () => {
    const company = await db.company.create({
      data: {
        name: "Legacy Occupation Maison",
        canonicalKey: "legacy-occupation-maison",
        fashionjobsUrl: "resolved:legacy-occupation-maison",
      },
    });
    const before = await db.job.create({
      data: {
        companyId: company.id,
        externalId: "legacy",
        source: "GENERIC_JSONLD",
        title: "Beauty Advisor",
        fingerprint: "legacy-occupation",
        url: "https://careers.example/legacy",
        seniority: "MID",
        jobFunction: "retail-client-advisor",
        employmentTerm: "PERMANENT",
        postedAt: new Date("2026-08-01"),
        raw: { native: "kept" },
      },
    });
    const result = await classifyJobs(db);
    expect(result.written).toBe(1);
    const after = await db.job.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toMatchObject({
      occupationCode: "beauty-consultant",
      seniority: null,
      rawTitle: null,
    });
    for (const field of [
      "id",
      "title",
      "isActive",
      "closedAt",
      "firstSeenAt",
      "lastSeenAt",
      "postedAt",
      "employmentTerm",
      "raw",
    ] as const)
      expect(after[field]).toEqual(before[field]);
    const observation = await db.occupationObservation.findFirstOrThrow();
    expect(observation.before).toMatchObject({
      seniority: "MID",
      jobFunction: "retail-client-advisor",
    });
    expect(after.occupationEvidence).toMatchObject({
      rawTitleOrigin: "STORED_TITLE_ONLY",
    });
    expect((await classifyJobs(db)).written).toBe(0);
  });
  it("publishes data alone, rejects stale reviews and updates a run pinned to the previous release", async () => {
    const old = await loadOccupationTaxonomy(db),
      c = candidate({
        title: "Optical Assistant",
        rawTitle: "Optical Assistant",
        department: undefined,
      });
    const { jobId } = await upsertDeduplicated(db, c, old);
    const next = structuredClone(seed) as OccupationManifest;
    next.id = `integration-occupation-${Date.now()}`;
    next.occupations.push({
      key: "optical-assistant",
      family: "health-optical-services",
      labels: { fr: "Assistant optique", en: "Optical Assistant" },
      aliases: ["Optical Assistant"],
    });
    next.rules.push({
      id: "optical-assistant-title",
      occupation: "optical-assistant",
      all: [{ field: "title", any: ["Optical Assistant"] }],
      evidence: "Observed production title, reviewed contextual addition.",
    });
    const review = await previewOccupationRelease(db, next);
    expect(review.activeJobs).toBe(1);
    expect(review.classifiedActive).toBe(1);
    await db.job.update({
      where: { id: jobId },
      data: { title: "Optical Assistant - Paris" },
    });
    await expect(
      activateOccupationRelease(db, next, review, "a".repeat(40)),
    ).rejects.toThrow("REVIEW_STALE");
    expect((await loadOccupationTaxonomy(db)).manifest.id).toBe(seed.id);
    const fresh = await previewOccupationRelease(db, next);
    await activateOccupationRelease(db, next, fresh, "a".repeat(40));
    expect(
      (await loadOccupationTaxonomy(db)).queryOccupations("Assistant optique"),
    ).toEqual(["optical-assistant"]);
    await upsertDeduplicated(
      db,
      { ...c, title: "Optical Assistant - Paris" },
      old,
    );
    expect(
      await db.job.findUniqueOrThrow({ where: { id: jobId } }),
    ).toMatchObject({
      occupationCode: "optical-assistant",
      occupationReleaseId: next.id,
    });
    expect(await db.occupationObservation.count()).toBe(2);
    expect((await classifyJobs(db)).remaining).toBe(0);
    expect(
      (await db.occupationState.findUniqueOrThrow({ where: { id: "active" } }))
        .backfilledAt,
    ).not.toBeNull();
    const removed = structuredClone(next);
    removed.occupations = removed.occupations.filter(
      (o) => o.key !== "sales-advisor",
    );
    removed.rules = removed.rules.filter(
      (r) => r.occupation !== "sales-advisor",
    );
    expect(() => validateOccupationSuccessor(next, removed)).toThrow();
    expect(
      occupationManifestHash(
        (
          await db.occupationRelease.findUniqueOrThrow({
            where: { id: next.id },
          })
        ).manifest,
      ),
    ).toBe(fresh.manifestHash);
  });
});

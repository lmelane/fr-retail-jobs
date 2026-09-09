import "../test/setup-integration.js";
import { afterAll, beforeEach, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  previewSectors,
  applySectors,
  type SectorManifest,
} from "../sectors/review.js";
const p = new PrismaClient();
beforeEach(async () => {
  await p.jobSource.deleteMany();
  await p.jobEvent.deleteMany();
  await p.job.deleteMany();
  await p.company.deleteMany();
});
afterAll(async () => {
  await p.company.deleteMany();
  await p.$disconnect();
});
const manifest = (
  c: { id: string; canonicalKey: string },
  codes = ["JEWELRY", "WATCHMAKING"],
): SectorManifest => ({
  reviewer: "integration",
  companies: [
    {
      id: c.id,
      canonicalKey: c.canonicalKey,
      codes,
      evidence: codes.map((code) => ({
        code,
        source: "https://example.com/official",
        statement: "Reviewed membership fixture",
        confidence: "HIGH",
        basis: "OFFICIAL_SOURCE",
        checkedAt: "2026-09-09T00:00:00Z",
      })),
    },
  ],
});
describe("reviewed business sectors", () => {
  it("retains offer identity, supports overlapping sectors and is idempotent", async () => {
    const c = await p.company.create({
      data: {
        name: "Maison",
        canonicalKey: "TEST",
        fashionjobsUrl: "sector-test",
      },
    });
    const j = await p.job.create({
      data: {
        companyId: c.id,
        title: "Test",
        source: "GREENHOUSE",
        externalId: "s",
        url: "https://example.com/j",
        fingerprint: "sector-j",
      },
    });
    const m = manifest(c),
      plan = await previewSectors(p, m);
    expect(plan.activeAffected).toBe(1);
    expect((await applySectors(p, m, plan.reviewHash)).changed).toBe(1);
    expect((await applySectors(p, m, plan.reviewHash)).changed).toBe(0);
    expect(await p.job.findUnique({ where: { id: j.id } })).toEqual(j);
    expect(
      await p.job.count({
        where: { company: { sectorCodes: { has: "WATCHMAKING" } } },
      }),
    ).toBe(1);
    await expect(
      p.company.update({
        where: { id: c.id },
        data: { sectorCodes: ["RETAIL"] },
      }),
    ).rejects.toThrow();
  });
  it("refuses missing proof, unknown concepts and stale reviewed identities", async () => {
    const c = await p.company.create({
      data: {
        name: "Maison",
        canonicalKey: "TEST",
        fashionjobsUrl: "sector-test",
      },
    });
    const m = manifest(c);
    await expect(
      previewSectors(p, {
        ...m,
        companies: [{ ...m.companies[0], evidence: [] }],
      }),
    ).rejects.toThrow("evidence");
    await expect(
      previewSectors(p, manifest(c, ["OCCUPATION_RETAIL"])),
    ).rejects.toThrow("Unknown concept");
    const plan = await previewSectors(p, m);
    await p.company.update({
      where: { id: c.id },
      data: { canonicalKey: "RENAMED" },
    });
    await expect(applySectors(p, m, plan.reviewHash)).rejects.toThrow(
      "identity",
    );
  });
});

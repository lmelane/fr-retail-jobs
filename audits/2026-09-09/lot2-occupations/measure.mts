/** Real-state conservation receipt, usable before and after the additive migration. */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
const db = new PrismaClient(),
  out = process.argv[2];
if (!out) throw new Error("Output receipt required");
const sha = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
try {
  const proof = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const jobs = await tx.$queryRaw<
        any[]
      >`SELECT id,md5((to_jsonb(j)-ARRAY['updatedAt','taxonomyVersion','jobFunction','seniority','isRetail','occupationCode','occupationGroup','occupationStatus','occupationEvidence','occupationReleaseId','occupationSpecializations','rawTitle','normalizedTitle'])::text) hash FROM "Job" j ORDER BY id`;
      const events = await tx.$queryRaw<
        any[]
      >`SELECT id,md5(to_jsonb(e)::text) hash FROM "JobEvent" e ORDER BY id`;
      const sources = await tx.$queryRaw<
        any[]
      >`SELECT id,md5(to_jsonb(s)::text) hash FROM "JobSource" s ORDER BY id`;
      const payloads = await tx.$queryRaw<
        any[]
      >`SELECT id,md5(to_jsonb(s)::text) hash FROM "SourceObservation" s ORDER BY id`;
      const companies = await tx.$queryRaw<
        any[]
      >`SELECT id,md5(to_jsonb(c)::text) hash FROM "Company" c ORDER BY id`;
      const statuses = await tx.$queryRaw<
        any[]
      >`SELECT COALESCE(to_jsonb(j)->>'occupationStatus','NO_MODEL') status,count(*)::int n FROM "Job" j WHERE "isActive" GROUP BY 1 ORDER BY 1`;
      const countries = await tx.$queryRaw<
        any[]
      >`SELECT "countryCode",count(*)::int n FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY 2 DESC,1`;
      const [counts] = await tx.$queryRaw<
        any[]
      >`SELECT count(*)::int jobs,count(*) FILTER(WHERE "isActive")::int active,count(*) FILTER(WHERE "mergedIntoId" IS NULL)::int roots,
      count(*) FILTER(WHERE "isActive" AND "jobFunction" IS NOT NULL)::int familyClassified,
      count(*) FILTER(WHERE "isActive" AND to_jsonb(j)->>'occupationCode' IS NOT NULL)::int occupationClassified,
      count(DISTINCT title) FILTER(WHERE "isActive")::int distinctTitles,
      count(DISTINCT to_jsonb(j)->>'normalizedTitle') FILTER(WHERE "isActive" AND to_jsonb(j)->>'occupationCode' IS NOT NULL)::int classifiedVariants,
      count(DISTINCT to_jsonb(j)->>'occupationCode') FILTER(WHERE "isActive")::int representedOccupations,
      count(*) FILTER(WHERE "isActive" AND seniority='MID')::int storedMid,
      count(*) FILTER(WHERE "isActive" AND seniority IS NULL)::int noSeniority,
      count(*) FILTER(WHERE "isActive" AND "mergedIntoId" IS NOT NULL)::int activeRedirects
      FROM "Job" j`;
      const [{ present }] = await tx.$queryRaw<
        { present: boolean }[]
      >`SELECT to_regclass('"OccupationRelease"') IS NOT NULL AS present`;
      const catalogue = present
        ? await tx.occupationState.findUnique({ where: { id: "active" } })
        : null;
      const observations = present ? await tx.occupationObservation.count() : 0;
      return {
        at: new Date().toISOString(),
        counts,
        statuses,
        countries,
        catalogue,
        observations,
        conservation: {
          jobIdsHash: sha(jobs.map((r) => r.id)),
          nonOccupationJobFieldsHash: sha(jobs),
          eventsCount: events.length,
          eventsHash: sha(events),
          jobSourcesCount: sources.length,
          jobSourcesHash: sha(sources),
          rawPayloadsCount: payloads.length,
          rawPayloadsHash: sha(payloads),
          companiesCount: companies.length,
          companiesHash: sha(companies),
        },
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 120_000 },
  );
  writeFileSync(out, JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof));
} finally {
  await db.$disconnect();
}

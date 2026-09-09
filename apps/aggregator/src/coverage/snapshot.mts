/** Private, repeatable-read inventory. Never prints source configuration or credentials. */
import { PrismaClient, Prisma } from "@prisma/client";
import { writeFileSync } from "node:fs";
const p = new PrismaClient();
try {
  const output = process.argv[2];
  if (!output) throw Error("Private snapshot output path required");
  const data = await p.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return {
        at: new Date().toISOString(),
        totals:
          await tx.$queryRaw`SELECT count(*)::int jobs,count(*) FILTER(WHERE "isActive")::int active,count(*) FILTER(WHERE "isActive" AND "isFrance")::int france,md5(string_agg(id,',' ORDER BY id)) ids FROM "Job"`,
        companies: await tx.company.findMany({
          select: {
            id: true,
            name: true,
            canonicalKey: true,
            kind: true,
            domain: true,
            careersUrl: true,
            parentGroup: true,
            mergedIntoId: true,
            identityReviewId: true,
            sectorCodes: true,
            sectorEvidence: true,
            sectorReviewId: true,
            aliases: {
              select: {
                id: true,
                displayName: true,
                aliasKey: true,
                normalizedName: true,
                sourceKey: true,
                reviewId: true,
                sourceHash: true,
              },
            },
          },
        }),
        sources: await tx.source.findMany({ orderBy: { key: "asc" } }),
        counts:
          await tx.$queryRaw`SELECT "companyId",count(*)::int world,count(*) FILTER(WHERE "isFrance")::int france FROM "Job" WHERE "isActive" GROUP BY 1`,
        sourceCompanies:
          await tx.$queryRaw`SELECT js."sourceKey",j."companyId",count(*)::int representations,count(*) FILTER(WHERE js."isActive" AND j."isActive")::int active,count(*) FILTER(WHERE js."isActive" AND j."isActive" AND j."isFrance")::int france FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" GROUP BY 1,2`,
        latestRuns:
          await tx.$queryRaw`SELECT DISTINCT ON("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey","ranAt" DESC,id DESC`,
        latestIdentityReviews: await tx.sourceIdentityReview.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          distinct: ["sourceKey"],
          select: {
            id: true,
            sourceKey: true,
            subjectKey: true,
            sourceHash: true,
            verdict: true,
            method: true,
            officialDomain: true,
            proofUrl: true,
            portalUrl: true,
            statement: true,
            artifactHash: true,
            checkedAt: true,
            createdAt: true,
          },
        }),
        sourcePostings: await tx.jobSource.findMany({
          select: {
            sourceKey: true,
            externalId: true,
            jobId: true,
            isActive: true,
            lastSeenAt: true,
            job: { select: { companyId: true, isActive: true } },
          },
        }),
        latestPipelines: await tx.pipelineRun.findMany({
          orderBy: { startedAt: "desc" },
          take: 8,
        }),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 90000,
    },
  );
  writeFileSync(output, JSON.stringify(data, null, 2), { mode: 0o600 });
  console.log({
    at: data.at,
    totals: data.totals,
    companies: data.companies.length,
    sources: data.sources.length,
    reviewedSources: data.latestIdentityReviews.filter(
      (r) => r.verdict === "VERIFIED",
    ).length,
  });
} finally {
  await p.$disconnect();
}

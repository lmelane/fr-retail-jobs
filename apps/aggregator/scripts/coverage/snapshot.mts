/** Private, repeatable-read inventory. Never prints source configuration or credentials. */
import { PrismaClient, Prisma } from "@prisma/client";
import { writeFileSync } from "node:fs";
import {
  assertIdentityReview,
  sourceIdentityHash,
  sourceSubjectKey,
} from "../../src/connectors/sourceIdentity.js";
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
            identityReview: {
              select: { id: true, reviewedAt: true, reviewedBy: true, planHash: true },
            },
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
        // The identity hash and subject key are computed here, by the same
        // functions the promotion gate uses, so a Python composer never has to
        // re-implement JS JSON.stringify to compare a review with the current
        // configuration.
        // Strict identity verdict per source, by the SAME validator as the promotion gate (assertIdentityReview:
        // verdict, hash, subject, tenant, age, method, artifact, official proof page). Python composers read this
        // verdict instead of re-implementing a subset of the contract.
        sources: await (async () => {
          const latest = new Map<string, Awaited<ReturnType<typeof tx.sourceIdentityReview.findFirst>>>();
          for (const r of await tx.sourceIdentityReview.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], distinct: ["sourceKey"] })) latest.set(r.sourceKey, r);
          return (await tx.source.findMany({ orderBy: { key: "asc" } })).map((source) => {
            const review = latest.get(source.key) ?? null;
            let identityVerdict: { certified: boolean; reason: string | null; reviewId: string | null; portalScope: string | null };
            try { assertIdentityReview(source, review); identityVerdict = { certified: true, reason: null, reviewId: review!.id, portalScope: review!.portalScope ?? null }; }
            catch (e) { identityVerdict = { certified: false, reason: review ? String(e instanceof Error ? e.message : e) : 'NO_REVIEW', reviewId: review?.id ?? null, portalScope: null }; }
            return { ...source, identityHash: sourceIdentityHash(source), subjectKey: sourceSubjectKey(source), identityVerdict };
          });
        })(),
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

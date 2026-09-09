/** Read-only production baseline. Private corpus stays outside the committed report. */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  classifyFunction,
  classifySeniority,
  comparableTitle,
} from "../../../apps/aggregator/src/normalize/taxonomy.js";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: audit.mts <private-output-directory>");
const p = new PrismaClient();
try {
  const data = await p.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const rows = await tx.job.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          title: true,
          department: true,
          companyId: true,
          source: true,
          language: true,
          countryCode: true,
          isActive: true,
          mergedIntoId: true,
          jobFunction: true,
          seniority: true,
          taxonomyVersion: true,
          url: true,
          canonicalSourceKey: true,
          canonicalExternalId: true,
        },
      });
      const lineage = await tx.$queryRaw<
        any[]
      >`SELECT id, md5(to_jsonb(e)::text) hash FROM "JobEvent" e ORDER BY id`;
      const representations = await tx.$queryRaw<
        any[]
      >`SELECT id, md5(to_jsonb(s)::text) hash FROM "JobSource" s ORDER BY id`;
      const identities = await tx.$queryRaw<
        any[]
      >`SELECT count(*) FILTER (WHERE j."isActive" AND c."mergedIntoId" IS NOT NULL)::int AS "activeOnMergedEmployer", count(*) FILTER (WHERE j."isActive" AND j."mergedIntoId" IS NOT NULL)::int AS "activePostingRedirects" FROM "Job" j JOIN "Company" c ON c.id=j."companyId"`;
      return {
        at: new Date().toISOString(),
        rows,
        lineage,
        representations,
        identities,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 120_000 },
  );
  const active = data.rows.filter((r) => r.isActive);
  const grouped = new Map<
    string,
    {
      title: string;
      department: string | null;
      function: string | null;
      seniority: string | null;
      count: number;
      exampleId: string;
      url: string;
    }
  >();
  const byFunction: Record<string, number> = {},
    byLanguage: Record<string, number> = {};
  let replayDifferences = 0,
    midDefault = 0;
  for (const r of active) {
    const k = JSON.stringify([
      r.title,
      r.department,
      r.jobFunction,
      r.seniority,
    ]);
    const g = grouped.get(k) ?? {
      title: r.title,
      department: r.department,
      function: r.jobFunction,
      seniority: r.seniority,
      count: 0,
      exampleId: r.id,
      url: r.url,
    };
    g.count++;
    grouped.set(k, g);
    byFunction[r.jobFunction ?? "(unclassified)"] =
      (byFunction[r.jobFunction ?? "(unclassified)"] ?? 0) + 1;
    byLanguage[r.language ?? "(not recorded)"] =
      (byLanguage[r.language ?? "(not recorded)"] ?? 0) + 1;
    if (classifyFunction(r.title, r.department) !== r.jobFunction)
      replayDifferences++;
    if (classifySeniority(r.title, r.department) === "MID") midDefault++;
  }
  const sha = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const summary = {
    at: data.at,
    jobs: data.rows.length,
    active: active.length,
    canonicalPosts: data.rows.filter((r) => !r.mergedIntoId).length,
    activeClassifiedFamily: active.filter((r) => r.jobFunction).length,
    activeUnclassifiedFamily: active.filter((r) => !r.jobFunction).length,
    distinctActiveTitles: new Set(active.map((r) => r.title)).size,
    distinctNormalizedTitles: new Set(
      active.map((r) => comparableTitle(r.title)),
    ).size,
    canonicalOccupationCount: null,
    occupationReason:
      "No canonical occupation model exists; jobFunction contains broad categories.",
    storedMid: active.filter((r) => r.seniority === "MID").length,
    midFromDefaultRule: midDefault,
    replayFunctionDifferences: replayDifferences,
    byFunction,
    byLanguage,
    identities: data.identities,
    jobIdsHash: sha(data.rows.map((r) => r.id)),
    eventsHash: sha(data.lineage),
    representationsHash: sha(data.representations),
    sourceCount: data.representations.length,
    eventCount: data.lineage.length,
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/corpus.json`, JSON.stringify(data) + "\n");
  writeFileSync(
    `${directory}/title-groups.json`,
    JSON.stringify(
      [...grouped.values()].sort((a, b) => b.count - a.count),
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    `${directory}/summary.json`,
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary));
} finally {
  await p.$disconnect();
}

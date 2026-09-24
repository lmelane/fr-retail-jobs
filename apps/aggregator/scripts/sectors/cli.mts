import { previewQualification } from '../../src/sectors/qualify.js';
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { previewSectors, applySectors } from "../../src/sectors/review.js";
const db = new PrismaClient();
try {
  const [mode, file, output] = process.argv.slice(2);
  if (!["preview", "apply", "queue", "qualify"].includes(mode))
    throw Error(
      "Usage: cli.mts qualify manifest.json abstentions.json | preview manifest.json output.json | apply reviewed-plan.json [FULL_MERGED_COMMIT_SHA] | queue output.json",
    );
  if (mode === "qualify") {
    if (!file || !output) throw Error('qualify requires manifest.json and abstentions.json paths');
    const plan = await previewQualification(db);
    writeFileSync(file, JSON.stringify(plan.manifest,null,2));
    writeFileSync(output, JSON.stringify(plan.abstentions,null,2));
    console.log({inspected:plan.inspected,proposed:plan.manifest.companies.length,abstained:plan.abstentions.length});
  } else if (mode === "queue") {
    const rows =
      await db.$queryRaw`SELECT c.id,c.name,c."canonicalKey",c.domain,c.sector AS "legacySector",count(j.id) FILTER(WHERE j."isActive")::int active FROM "Company" c LEFT JOIN "Job" j ON j."companyId"=c.id WHERE c."mergedIntoId" IS NULL AND cardinality(c."sectorCodes")=0 GROUP BY c.id ORDER BY active DESC,c.id`;
    writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log({ queued: (rows as any[]).length });
  } else {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (mode === "preview") {
      if (!output) throw Error("Output path required");
      const plan = await previewSectors(db, raw);
      writeFileSync(output, JSON.stringify(plan, null, 2));
      console.log({
        changed: plan.changed,
        activeAffected: plan.activeAffected,
        reviewHash: plan.reviewHash,
      });
    } else {
      const host = new URL(process.env.DATABASE_URL!).hostname;
      if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
        const head = execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim();
        if (output !== head || !/^[a-f0-9]{40}$/.test(output ?? ""))
          throw Error(
            "Production sector repair requires the full committed SHA as the third argument",
          );
        execFileSync("git", [
          "merge-base",
          "--is-ancestor",
          head,
          "origin/main",
        ]);
        if (
          execFileSync(
            "git",
            [
              "status",
              "--porcelain",
              "--",
              "apps/aggregator/src",
              "packages/db",
            ],
            { encoding: "utf8" },
          ).trim()
        )
          throw Error(
            "Production sector repair requires clean application code",
          );
      }
      console.log(await applySectors(db, raw.manifest, raw.reviewHash));
    }
  }
} finally {
  await db.$disconnect();
}

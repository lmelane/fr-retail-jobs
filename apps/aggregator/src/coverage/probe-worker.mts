/** Fetch-only worker. One process owns one source; the parent enforces a real deadline. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fetchAtsJobs } from "../ats/index.js";
import { KIND_TO_ATS } from "../ats/catalogKinds.js";
import { normalizeSourceConfig } from "../connectors/sourceConfig.js";
import { closeBrowser } from "../lib/browser.js";
const [input, sourceKey, output] = process.argv.slice(2);
const snapshot = JSON.parse(readFileSync(input, "utf8"));
const source = snapshot.sources.find((s: any) => s.key === sourceKey);
if (!source || !output)
  throw Error("Source and private output directory required");
const startedAt = new Date().toISOString();
const configHash = createHash("sha256")
  .update(JSON.stringify(source.config))
  .digest("hex");
const worktreeDiff = execFileSync('git', ['diff', 'HEAD', '--', 'apps/aggregator/src', 'apps/aggregator/data', 'packages/db'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const base = {
  workingTreeDirty: worktreeDiff.length > 0,
  trackedCodeDiffHash: createHash('sha256').update(worktreeDiff).digest('hex'),
  sourceKey,
  kind: source.kind,
  tenantKey: source.tenantKey,
  configHash,
  startedAt,
  snapshotHash: createHash("sha256").update(readFileSync(input)).digest("hex"),
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
};
try {
  if (
    source.kind === "fashionjobs" ||
    Object.values(source.config ?? {}).some(
      (v) =>
        typeof v === "string" &&
        /^https?:\/\/(?:[^/]+\.)?fashionjobs\.com\//i.test(v),
    )
  )
    throw Error("FashionJobs is discovery-only; offer fetch refused");
  const type = KIND_TO_ATS[source.kind];
  if (!type) throw Error("ADAPTER_MISSING: " + source.kind);
  const result = await fetchAtsJobs(
    type as never,
    normalizeSourceConfig(source.config),
  );
  const jobs = result.jobs;
  const byId = new Map<string, number>();
  for (const j of jobs)
    byId.set(String(j.externalId), (byId.get(String(j.externalId)) ?? 0) + 1);
  const active = snapshot.sourcePostings.filter(
    (p: any) => p.sourceKey === sourceKey && p.isActive && p.job.isActive,
  );
  const stored = new Set<string>(active.map((p: any) => String(p.externalId)));
  const fetched = new Set(byId.keys());
  const missingInDatabase = [...fetched].filter((id) => !stored.has(id));
  const absentAtSource = [...stored].filter((id) => !fetched.has(id));
  const quality = {
    missingId: jobs.filter((j) => !j.externalId).length,
    missingTitle: jobs.filter((j) => !j.title?.trim()).length,
    invalidUrl: jobs.filter((j) => {
      try {
        return !["https:", "http:"].includes(new URL(j.url).protocol);
      } catch {
        return true;
      }
    }).length,
    missingDescription: jobs.filter((j) => !j.description?.trim()).length,
    missingLocation: jobs.filter((j) => !j.location && !j.city && !j.country)
      .length,
    missingCountry: jobs.filter((j) => !j.country).length,
    missingDate: jobs.filter((j) => !j.postedAt).length,
    missingEmployer: jobs.filter((j) => !j.company).length,
  };
  const payload = JSON.stringify(result);
  mkdirSync(output, { recursive: true });
  writeFileSync(`${output}/${sourceKey}.json.gz`, gzipSync(payload), {
    mode: 0o600,
  });
  const receipt = {
    ...base,
    finishedAt: new Date().toISOString(),
    status:
      result.complete && !result.truncated
        ? "FETCH_COMPLETE"
        : "FETCH_PARTIAL_OR_UNPROVEN",
    declaredTotal: result.declaredTotal ?? null,
    enumeration: result.enumeration ?? null,
    rejectedRows: result.rejectedRows?.length ?? 0,
    fetched: jobs.length,
    uniqueIds: fetched.size,
    complete: result.complete ?? false,
    truncated: result.truncated ?? null,
    duplicates: [...byId].filter(([, n]) => n > 1),
    quality,
    missingInDatabase,
    activeDatabaseAbsentAtSource: absentAtSource,
    activeDatabase: active.length,
    payloadHash: createHash("sha256").update(payload).digest("hex"),
    companyLabels: [...new Set(jobs.map((j) => j.company).filter(Boolean))],
    note: "Fetch completeness is not proof of employer identity or worldwide portal coverage.",
  };
  writeFileSync(
    `${output}/${sourceKey}.receipt.json`,
    JSON.stringify(receipt, null, 2),
  );
} catch (error) {
  mkdirSync(output, { recursive: true });
  writeFileSync(
    `${output}/${sourceKey}.receipt.json`,
    JSON.stringify(
      {
        ...base,
        finishedAt: new Date().toISOString(),
        status: "FETCH_FAILED",
        error:
          error instanceof Error ? error.message.slice(0, 2000) : String(error),
        nextAction:
          "Inspect this endpoint and transport, then compare with its official portal; do not infer absence of jobs.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await closeBrowser();
}

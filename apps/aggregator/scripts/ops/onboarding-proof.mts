/**
 * The proof of the onboarding demonstration, read back from the clone after the fact.
 *
 * Four things this states that a count alone cannot:
 *
 *  1. OBSERVED vs CREATED/MODIFIED. Observed identifiers are everything visible under the source; created or
 *     modified identifiers are the rows this work actually wrote, separated by `firstSeenAt` / `updatedAt`
 *     against the moment onboarding began. Presenting the first as the second makes an idempotent second pass
 *     look like a rewrite.
 *  2. REPRESENTATIONS, not only canonical rows. A posting attested by several sources is ONE `Job` and SEVERAL
 *     `JobSource`. Counting only `Job` hides whether the source's own attestations exist.
 *  3. STATE TRANSITIONS. The `Source.status` and certification verdict recorded after EVERY step, re-read from
 *     the database, so a step that "succeeded" without moving the source would be visible.
 *  4. VALUES, field by field, between the first pass and the second — not just identifier sets.
 *
 * usage: onboarding-proof.mts <run-dir> <key>[,<key>…] [--out=<file.json>]
 *   <run-dir> holds the onboard-<key>.json files written by onboard-source.mts
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';

const runDir = process.argv[2];
const keys = (process.argv[3] ?? '').split(',').filter(Boolean);
if (!runDir || !keys.length) { console.error('usage: onboarding-proof.mts <run-dir> <key>[,<key>…] [--out=<file>]'); process.exit(2); }
const outFile = process.argv.find((a) => a.startsWith('--out='))?.slice(6);

const FIELDS = ['title', 'location', 'countryCode', 'postedAt', 'employmentTerm', 'workTime', 'seniority', 'occupationGroup'] as const;

const p = new PrismaClient();
try {
  const [{ current_database: db }]: any[] = await p.$queryRaw`SELECT current_database()`;

  const dossiers = keys.map((key) => {
    const file = `${runDir}/onboard-${key}.json`;
    return { key, record: JSON.parse(readFileSync(file, 'utf8')) };
  });

  const report: any[] = [];
  for (const { key, record } of dossiers) {
    /**
     * The moment onboarding began for this source, read from the DATABASE: `Source.createdAt` is stamped when
     * `registerSourceCandidate` inserts the row, so everything written at or after it is this work's doing.
     * The run file's own timestamp is written at the END and would date the start after every write it made.
     */
    const registered = await p.source.findUnique({ where: { key }, select: { createdAt: true } });
    const startedAt = registered?.createdAt ?? new Date(record.at);

    const rows: any[] = await p.$queryRaw`
      SELECT js.id AS job_source_id, js."externalId", js."isActive" AS representation_active, js."firstSeenAt" AS representation_first_seen,
             j.id AS job_id, j."isActive" AS job_active, j."firstSeenAt" AS job_first_seen, j."updatedAt" AS job_updated,
             j.title, j.location, j."countryCode", j."postedAt", j."employmentTerm", j."workTime", j.seniority, j."occupationGroup"
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."sourceKey" = ${key} ORDER BY js."externalId"`;

    const source = await p.source.findUnique({ where: { key }, select: { key: true, status: true, maison: true, kind: true, config: true, careersDomain: true, tenantKey: true, tier: true, robotsVerdict: true, robotsCheckedAt: true } });
    const review = await p.sourceIdentityReview.findFirst({ where: { sourceKey: key }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    let certification = 'NO_REVIEW';
    if (source && review) {
      const { assertIdentityReview } = await import('../../src/connectors/sourceIdentity.js');
      try { assertIdentityReview(source as any, review); certification = 'CERTIFIED'; } catch (e) { certification = `INVALID: ${(e as Error).message.slice(0, 70)}`; }
    }
    const runs: any[] = await p.$queryRaw`
      SELECT status::text, fetched, accepted, "ranAt" FROM "SourceRun" WHERE "sourceKey" = ${key} ORDER BY "ranAt" ASC`;

    const createdRepresentations = rows.filter((r) => new Date(r.representation_first_seen) >= startedAt);
    const createdJobs = rows.filter((r) => new Date(r.job_first_seen) >= startedAt);
    const modifiedJobs = rows.filter((r) => new Date(r.job_first_seen) < startedAt && new Date(r.job_updated) >= startedAt);

    report.push({
      key,
      /** The state after each transition, as recorded live at the time, re-read from the database each step. */
      transitions: record.steps.map((s: any) => ({ step: s.step, status: s.after.status, certification: s.after.certification, representations: s.after.representations, jobs: s.after.jobs })),
      sourceNow: source ? { status: source.status, certification, robotsVerdict: source.robotsVerdict, robotsCheckedAt: source.robotsCheckedAt } : null,
      runs,
      identifiers: {
        observedRepresentations: rows.map((r) => r.job_source_id),
        observedJobs: [...new Set(rows.map((r) => r.job_id))],
        createdRepresentations: createdRepresentations.map((r) => r.job_source_id),
        createdJobs: [...new Set(createdJobs.map((r) => r.job_id))],
        modifiedJobs: [...new Set(modifiedJobs.map((r) => r.job_id))],
        externalIds: rows.map((r) => r.externalId),
      },
      counts: {
        observedRepresentations: rows.length, observedJobs: new Set(rows.map((r) => r.job_id)).size,
        createdRepresentations: createdRepresentations.length, createdJobs: new Set(createdJobs.map((r) => r.job_id)).size,
        modifiedJobs: new Set(modifiedJobs.map((r) => r.job_id)).size,
        activeRepresentations: rows.filter((r) => r.representation_active).length,
      },
      values: rows.map((r) => Object.fromEntries([['externalId', r.externalId], ['jobId', r.job_id], ...FIELDS.map((f) => [f, r[f] instanceof Date ? r[f].toISOString() : r[f]])])),
    });
  }

  const proof = { at: new Date().toISOString(), database: db, sources: report };
  if (outFile) writeFileSync(outFile, JSON.stringify(proof, null, 1));
  console.log(JSON.stringify({ ...proof, sources: report.map((r) => ({ ...r, values: `${r.values.length} rows` })) }, null, 1));
} finally { await p.$disconnect(); }

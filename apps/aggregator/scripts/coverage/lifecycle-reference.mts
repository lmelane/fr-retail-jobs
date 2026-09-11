/**
 * The dated reference for lifecycle state: freshness, closures, withdrawals, reopenings, and the postings whose
 * openness is currently unverifiable.
 *
 * Read in ONE `RepeatableRead` transaction, and the level is asserted rather than assumed: an unqualified
 * `$transaction` runs at `read committed`, where every statement re-snapshots, so counts taken "in one
 * transaction" would not share an instant. `SET TRANSACTION READ ONLY` forbids writing but guarantees no such
 * thing either.
 *
 * Every figure names its denominator. The distinction the whole lot turns on:
 *
 *   attempt   ≠ successful collection
 *   collected ≠ collected over a perimeter that covers where the posting should appear
 *   silent    ≠ absent
 *
 * usage: lifecycle-reference.mts [--out=<file.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const outFile = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const p = new PrismaClient();

try {
  const report = await p.$transaction(async (tx) => {
    // `SHOW` names its column after the setting, not "level" — reading the wrong key would silently assert nothing.
    const [shown]: any[] = await tx.$queryRaw`SHOW transaction_isolation`;
    const level = shown?.transaction_isolation;
    if (level !== 'repeatable read') throw new Error(`refusing: isolation is "${level}", not repeatable read — the counts would not share an instant`);
    const [{ at }]: any[] = await tx.$queryRaw`SELECT now() AS at`;

    /** Postings, by lifecycle state. `closedAt` and `withdrawnAt` are mutually exclusive by construction. */
    const [states]: any[] = await tx.$queryRaw`
      SELECT COUNT(*)::int total,
             COUNT(*) FILTER (WHERE "isActive")::int active,
             COUNT(*) FILTER (WHERE NOT "isActive" AND "closedAt" IS NOT NULL)::int closed,
             COUNT(*) FILTER (WHERE NOT "isActive" AND "withdrawnAt" IS NOT NULL)::int withdrawn,
             COUNT(*) FILTER (WHERE NOT "isActive" AND "closedAt" IS NULL AND "withdrawnAt" IS NULL)::int inactive_undated,
             COUNT(*) FILTER (WHERE "isActive" AND "closedAt" IS NOT NULL)::int active_but_closed_dated,
             COUNT(*) FILTER (WHERE "reopenedCount" > 0)::int ever_reopened,
             COALESCE(SUM("reopenedCount"), 0)::int reopen_events
      FROM "Job"`;

    /**
     * FRESHNESS. `lastSeenAt` on a representation is the last time THIS source listed THIS posting — a native
     * observation. It is the only per-posting freshness signal that exists; the Job row has no equivalent.
     */
    const freshness: any[] = await tx.$queryRaw`
      SELECT width_bucket(EXTRACT(EPOCH FROM (now() - js."lastSeenAt")) / 3600, ARRAY[24, 48, 168, 720, 2160])::int bucket,
             COUNT(*)::int representations, COUNT(DISTINCT j.id)::int jobs
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" GROUP BY 1 ORDER BY 1`;

    /** The oldest still-active native observation, per source — where a stale source shows up. */
    const stalestSources: any[] = await tx.$queryRaw`
      SELECT js."sourceKey", COUNT(*)::int representations,
             MAX(js."lastSeenAt") AS newest_observation, MIN(js."lastSeenAt") AS oldest_observation,
             ROUND(EXTRACT(EPOCH FROM (now() - MAX(js."lastSeenAt"))) / 3600)::int hours_since_newest
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."isActive" AND j."isActive" GROUP BY 1 ORDER BY 5 DESC LIMIT 20`;

    /**
     * THE RIGHT TO ATTEST, per source, from its most recent run. A source whose last run cannot attest absence
     * is one whose postings CANNOT be closed by silence — and that is correct. What must not happen is those
     * postings staying active for ever with nobody tracking it, which is what the ageing column below shows.
     */
    const attestation: any[] = await tx.$queryRaw`
      SELECT r.status, COUNT(*)::int sources,
             COUNT(*) FILTER (WHERE r."canAttestAbsence")::int may_attest,
             COUNT(*) FILTER (WHERE r."canAttestAbsence" IS NOT TRUE)::int may_not_attest
      FROM (SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC) r
      GROUP BY 1 ORDER BY 2 DESC`;

    /** Sources that carry live postings but whose last run cannot attest absence, with how long that has held. */
    const unverifiable: any[] = await tx.$queryRaw`
      SELECT js."sourceKey", s.status AS source_status, r.status AS last_run_status, r."canAttestAbsence",
             r."ranAt" AS last_attempt, r."declaredTotal", r.fetched, r.complete, r.truncated,
             COUNT(*)::int live_representations,
             ROUND(EXTRACT(EPOCH FROM (now() - r."ranAt")) / 86400)::int days_since_last_attempt
      FROM "JobSource" js
      JOIN "Job" j ON j.id = js."jobId"
      LEFT JOIN "Source" s ON s.key = js."sourceKey"
      LEFT JOIN (SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC) r
        ON r."sourceKey" = js."sourceKey"
      WHERE js."isActive" AND j."isActive" AND (r."canAttestAbsence" IS NOT TRUE)
      GROUP BY 1,2,3,4,5,6,7,8,9 ORDER BY 10 DESC LIMIT 40`;

    /**
     * PUBLICATION HOLDS. A held posting is archived in `SourceObservation` and NEVER written as a Job, so it
     * cannot go stale as one — and equally, nothing tracks its age, its next action or its resolution condition.
     * That gap is the subject of item 8 of the lot.
     */
    const holds: any[] = await tx.$queryRaw`
      SELECT o.raw->>'publicationHold' AS reason, COUNT(*)::int observations,
             COUNT(DISTINCT (o."sourceKey", o."externalId"))::int distinct_postings,
             COUNT(DISTINCT o."sourceKey")::int sources,
             MIN(o."observedAt") AS oldest, MAX(o."observedAt") AS newest,
             ROUND(EXTRACT(EPOCH FROM (now() - MIN(o."observedAt"))) / 86400)::int oldest_age_days
      FROM "SourceObservation" o GROUP BY 1 ORDER BY 2 DESC`;

    /** Does a held posting ALSO exist as a published Job? If so the hold did not actually withhold anything. */
    const [heldAlsoPublished]: any[] = await tx.$queryRaw`
      SELECT COUNT(DISTINCT (o."sourceKey", o."externalId"))::int held_postings,
             COUNT(DISTINCT (js."sourceKey", js."externalId"))::int also_published_and_active
      FROM "SourceObservation" o
      LEFT JOIN "JobSource" js ON js."sourceKey" = o."sourceKey" AND js."externalId" = o."externalId" AND js."isActive"
      LEFT JOIN "Job" j ON j.id = js."jobId" AND j."isActive"`;

    /** Withdrawal reasons: an administrative act by Mode Careers is never an employer closure. */
    const withdrawals: any[] = await tx.$queryRaw`
      SELECT "withdrawalReason", COUNT(*)::int postings, MIN("withdrawnAt") AS oldest, MAX("withdrawnAt") AS newest
      FROM "Job" WHERE "withdrawnAt" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`;

    /** Lifecycle events actually recorded — the immutable history closures are counted from. */
    const events: any[] = await tx.$queryRaw`
      SELECT type, COUNT(*)::int n, MIN("at") AS oldest, MAX("at") AS newest FROM "JobEvent"
      WHERE type IN ('OPENED','CLOSED','REOPENED','WITHDRAWN','REPUBLISHED') GROUP BY 1 ORDER BY 2 DESC`;

    return { at, isolation: level, states, freshness, stalestSources, attestation, unverifiable, holds, heldAlsoPublished, withdrawals, events };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 120_000 });

  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1);
  if (outFile) writeFileSync(outFile, json);
  console.log(json);
} finally { await p.$disconnect(); }

/**
 * How far does ONE unresolved publication hold reach?
 *
 * `ingest.ts` sets `stats.complete = false` as soon as a single posting carries a hold whose disposition is
 * unresolved, and `complete !== true` removes the source's right to attest absence for EVERY posting it carries.
 * So a handful of defective pages can make an entire source uncloseable — the postings it no longer lists stay
 * active indefinitely, and nothing tracks that they are unverifiable.
 *
 * This measures the blast radius on the archived runs: per source, how many postings were held, and how many
 * live representations lost their verifiability because of them.
 *
 * Read-only. usage: hold-blast-radius.mts [--out=<file.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const outFile = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const p = new PrismaClient();

try {
  const report = await p.$transaction(async (tx) => {
    const [shown]: any[] = await tx.$queryRaw`SHOW transaction_isolation`;
    if (shown?.transaction_isolation !== 'repeatable read') throw new Error('refusing: not repeatable read');
    const [{ at }]: any[] = await tx.$queryRaw`SELECT now() AS at`;

    /**
     * The last run of each source, joined to its live representations and to the holds archived for it.
     * `heldUnresolved` is not stored on SourceRun, so the hold reasons are re-derived from SourceObservation:
     * a reason that carries no disposition is the one that sets complete = false.
     */
    const rows: any[] = await tx.$queryRaw`
      WITH last_run AS (
        SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, id DESC
      ), live AS (
        SELECT js."sourceKey", COUNT(*)::int representations
        FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
        WHERE js."isActive" AND j."isActive" GROUP BY 1
      ), held AS (
        SELECT o."sourceKey", o.raw->>'publicationHold' AS reason,
               COUNT(DISTINCT o."externalId")::int postings
        FROM "SourceObservation" o WHERE o.raw->>'publicationHold' IS NOT NULL GROUP BY 1, 2
      ), held_by_source AS (
        SELECT "sourceKey", SUM(postings)::int held_postings,
               json_agg(json_build_object('reason', reason, 'postings', postings) ORDER BY postings DESC) reasons
        FROM held GROUP BY 1
      )
      SELECT l."sourceKey", r.status AS last_run_status, r.complete, r.truncated, r."canAttestAbsence",
             r."declaredTotal", r.fetched, r.errors, r."ranAt" AS last_attempt,
             l.representations AS live_representations,
             COALESCE(h.held_postings, 0)::int held_postings, h.reasons
      FROM live l
      LEFT JOIN last_run r ON r."sourceKey" = l."sourceKey"
      LEFT JOIN held_by_source h ON h."sourceKey" = l."sourceKey"
      ORDER BY l.representations DESC`;

    const blocked = rows.filter((r) => r.canAttestAbsence !== true);

    /**
     * The category that matters most: a run that read everything it declared, hit no error and was not
     * truncated, yet cannot attest. If holds are the only thing standing between it and the right to attest,
     * then a few defective pages are freezing the whole source.
     */
    const readEverythingYetBlocked = blocked.filter((r) =>
      r.last_run_status !== 'BROKEN' && r.last_run_status !== 'ERROR' && r.last_run_status !== 'TIMEOUT' &&
      r.last_run_status !== 'CHALLENGED' && r.last_run_status !== 'NEW' &&
      !r.truncated && (r.errors ?? 0) === 0 &&
      (!r.declaredTotal || (r.fetched ?? 0) / r.declaredTotal >= 0.9));

    return {
      at,
      sourcesWithLivePostings: rows.length,
      blockedFromAttesting: blocked.length,
      liveRepresentationsUnderBlockedSources: blocked.reduce((n, r) => n + r.live_representations, 0),
      totalLiveRepresentations: rows.reduce((n, r) => n + r.live_representations, 0),
      readEverythingYetBlocked: {
        sources: readEverythingYetBlocked.length,
        liveRepresentations: readEverythingYetBlocked.reduce((n, r) => n + r.live_representations, 0),
        heldPostings: readEverythingYetBlocked.reduce((n, r) => n + r.held_postings, 0),
        rows: readEverythingYetBlocked.slice(0, 30),
      },
      blockedRows: blocked.slice(0, 60),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 120_000 });

  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1);
  if (outFile) writeFileSync(outFile, json);
  console.log(JSON.stringify({ ...report, blockedRows: `${report.blockedRows.length} rows in file`, readEverythingYetBlocked: { ...report.readEverythingYetBlocked, rows: `${report.readEverythingYetBlocked.rows.length} rows in file` } }, null, 1));
} finally { await p.$disconnect(); }

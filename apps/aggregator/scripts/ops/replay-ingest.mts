/**
 * Run the REAL ingest offline, on a clone: `ingestAllBySource` from `src/pipeline/ingestOrchestrator.ts`, called
 * as production calls it.
 *
 * The transport is the ONLY thing replaced (`offline-transport.ts`). Everything above runs untouched — the ATS
 * adapter for the family, the normalisers, the identity gate, the scope rules, the dedup and the upsert.
 *
 * That is the difference with the earlier `replay-integration.mts`, which selected postings that already existed,
 * rebuilt a few fields from its own `PATHS` table and wrote them with `job.update`: it demonstrated a field
 * repair, not an integration, and it drifted from the adapter's own choices until they were copied by hand.
 *
 * `--crash-after=N` exercises a REAL partial write: the ingest persists through `$transaction`, not through
 * `job.update`, so the kill is placed there. After N COMMITTED transactions the process exits 137. An earlier
 * attempt hooked `job.update` and never fired — the run completed normally and proved nothing.
 *
 * The result names `touchedIds` explicitly: identifiers the run actually created or modified, which the gate
 * compares against a declared perimeter. A missing declaration is never read as zero.
 *
 * Clone only — the guard is the database name.
 *
 * usage: replay-ingest.mts <keys,comma> --cassette=<dir> [--crash-after=N] [--out=<file.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { installOfflineTransport, cassetteSize } from './offline-transport.js';

const keys = (process.argv[2] ?? '').split(',').filter((k) => k && !k.startsWith('--'));
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const cassette = arg('cassette');
if (!keys.length || !cassette) {
  console.error('usage: replay-ingest.mts <keys,comma> --cassette=<dir> [--crash-after=N] [--out=<file.json>]');
  process.exit(2);
}
const crashAfter = Number(arg('crash-after') ?? 0);
installOfflineTransport({ mode: 'replay', dir: cassette });

const p = new PrismaClient({ log: [] });
try {
  const [{ current_database: db }]: any[] = await p.$queryRaw`SELECT current_database()`;
  if (!/replay|clone|test/.test(db)) throw new Error(`refusing: ${db} is not a clone/replay/test database`);

  /** Representations AND canonical rows: a posting attested by several sources is one Job and several JobSource. */
  const stateOf = async () => {
    const rows: any[] = await p.$queryRaw`
      SELECT js."sourceKey",
             COUNT(*)::int representations,
             COUNT(DISTINCT j.id)::int jobs,
             COUNT(*) FILTER (WHERE j."postedAt" IS NOT NULL)::int dated,
             COUNT(*) FILTER (WHERE j.description IS NOT NULL)::int described
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."sourceKey" = ANY(${keys}) AND js."isActive" AND j."isActive" GROUP BY 1 ORDER BY 1`;
    const runs: any[] = await p.$queryRaw`
      SELECT "sourceKey", status::text, fetched, accepted FROM "SourceRun"
      WHERE "sourceKey" = ANY(${keys}) ORDER BY "ranAt" DESC LIMIT ${keys.length * 2}`;
    return { perSource: rows, lastRuns: runs };
  };
  const before = await stateOf();

  if (crashAfter > 0) {
    let committed = 0;
    const realTx = (p as any).$transaction.bind(p);
    (p as any).$transaction = async (...args: any[]) => {
      const r = await realTx(...args);
      if (++committed >= crashAfter) { console.error(`SIMULATED CRASH after ${committed} committed transactions`); process.exit(137); }
      return r;
    };
  }

  process.env.INGEST_ONLY_KEYS = keys.join(',');
  process.env.EGRESS_PROBE = '0';
  const { ingestAllBySource } = await import('../../src/pipeline/ingestOrchestrator.js');
  /** Read from the DATABASE clock, not the process clock: `updatedAt` is stamped by the server. */
  const [{ now: startedAt }]: any[] = await p.$queryRaw`SELECT now() AS now`;
  const run = await ingestAllBySource(p as any);

  const rows: any[] = await p.$queryRaw`
    SELECT js."sourceKey", js."externalId", js.id AS job_source_id, j.id AS job_id, j.title, j."postedAt", j.location, j."firstSeenAt", j."updatedAt"
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."sourceKey" = ANY(${keys}) AND js."isActive" AND j."isActive" ORDER BY js."sourceKey", js."externalId"`;

  /**
   * OBSERVED is not TOUCHED, and `updatedAt` alone does not separate them.
   *
   * Observed = every identifier visible under these sources after the run. Touched = the rows this run WROTE,
   * dated by the server that stamped them. But a re-attestation stamps `updatedAt` on every row it re-sees, so
   * on a second pass touched == observed even though nothing changed — measured: 6 and 6, with zero field
   * differences. `touchedIds` therefore means "written at, not necessarily changed"; whether anything CHANGED is
   * answered by comparing the `rows` field by field between two passes, which is what the proof does.
   *
   * `createdJobs` is the unambiguous one: `firstSeenAt` only moves when the row is born.
   */
  const started = new Date(startedAt).getTime();
  const touched = rows.filter((r) => new Date(r.updatedAt).getTime() >= started);
  const created = rows.filter((r) => new Date(r.firstSeenAt).getTime() >= started);
  const out = {
    at: new Date().toISOString(), database: db, keys, cassette: cassetteSize(cassette), startedAt,
    before, after: await stateOf(), run,
    observedJobIds: [...new Set(rows.map((r) => r.job_id))],
    observedJobSourceIds: rows.map((r) => r.job_source_id),
    touchedIds: [...new Set(touched.map((r) => r.job_id))],
    touchedJobSourceIds: touched.map((r) => r.job_source_id),
    createdJobIds: [...new Set(created.map((r) => r.job_id))],
    rows,
  };
  const file = arg('out');
  if (file) writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, rows: undefined }, null, 1));
} finally { await p.$disconnect(); }

/**
 * The CURRENT state of publication holds, by identifier and reason — not a count of historical events.
 *
 * Why this exists: a repair was "proved" not to have touched the holds by comparing `COUNT(*)` of
 * `job.publication_held` events before and after. That number can only grow, so it proves nothing: it would have
 * stayed identical even if every held posting had been published. A hold is a STATE of a representation, and the
 * only honest evidence is the set of (source, externalId, reason) that is held right now, compared item by item.
 *
 * A held representation is one for which NO JobSource row exists: the write was refused and nothing was created.
 * An earlier version counted "not published today", which also swept in representations that had been written and
 * later closed or withdrawn — ordinary lifecycle. Measured on 2026-09-11 that inflated the figure from 702 to 740
 * (the 38 Aptar rows were written, then deactivated).
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/holds-state.mts <output-dir> [--sources=a,b]
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: holds-state.mts <output-dir> [--sources=a,b]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const only = (process.argv.find((a) => a.startsWith('--sources=')) ?? '').split('=')[1]?.split(',').filter(Boolean) ?? [];

const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const iso: any[] = await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS level`;
    const clock: any[] = await tx.$queryRaw`SELECT now() AS at`;
    /** Latest hold event per (source, jobId) with its reason, and whether that representation is live today. */
    const rows: any[] = await tx.$queryRaw`
      SELECT h."sourceKey", h."jobId" AS external_id, h.reason, h.at,
             EXISTS (SELECT 1 FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
                     WHERE js."sourceKey" = h."sourceKey" AND js."externalId" = h."jobId" AND js."isActive" AND j."isActive") AS published_now,
             -- A representation that never reached the database at all: no JobSource row exists for it. This is
             -- the only shape a genuine hold takes — the write was refused, so nothing was ever created.
             NOT EXISTS (SELECT 1 FROM "JobSource" js WHERE js."sourceKey" = h."sourceKey" AND js."externalId" = h."jobId") AS never_written,
             -- Written once, but the posting or the attestation is inactive today: that is a CLOSURE or a
             -- withdrawal, NOT a hold. Counting it as held would inflate the figure with ordinary lifecycle.
             EXISTS (SELECT 1 FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
                     WHERE js."sourceKey" = h."sourceKey" AND js."externalId" = h."jobId" AND (NOT js."isActive" OR NOT j."isActive")) AS written_then_inactive
      FROM (SELECT DISTINCT ON (e."sourceKey", e."jobId") e."sourceKey", e."jobId",
                   COALESCE(e.payload#>>'{data,reason}', e.payload#>>'{reason}') AS reason, e.at
            FROM "PipelineEvent" e WHERE e.event = 'job.publication_held' AND e."jobId" IS NOT NULL
            ORDER BY e."sourceKey", e."jobId", e.at DESC) h
      ORDER BY h."sourceKey", h."jobId"`;
    return { at: clock[0].at as Date, isolation: iso[0].level as string, rows };
  }, { isolationLevel: 'RepeatableRead' });
  if (db.isolation !== 'repeatable read') throw new Error(`holds-state requires REPEATABLE READ; got "${db.isolation}"`);

  const rows = only.length ? db.rows.filter((r: any) => only.includes(r.sourceKey)) : db.rows;
  /**
   * A hold is a representation the pipeline REFUSED TO WRITE, and that therefore has no row at all. The earlier
   * predicate ("not published today") also swept in representations that were written and later closed or
   * withdrawn — ordinary lifecycle, not a hold — and would have overstated the figure.
   */
  const held = rows.filter((r: any) => r.never_written);
  const writtenThenInactive = rows.filter((r: any) => !r.published_now && !r.never_written);
  const publishedDespiteHold = rows.filter((r: any) => r.published_now);
  const tally = (xs: any[], f: (r: any) => string) => Object.fromEntries(Object.entries(xs.reduce((m: any, r) => { const k = f(r) ?? 'null'; m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((a: any, b: any) => b[1] - a[1]));

  const summary = {
    at: db.at.toISOString(), isolation: db.isolation,
    definition: 'A hold is a STATE: a (source, externalId) the pipeline refused to write, so no JobSource row exists for it. Event counts are history; "not published today" also catches ordinary closures and overstates the figure.',
    scope: only.length ? only : 'all sources',
    representationsEverHeld: rows.length,
    heldNow: held.length,
    heldDefinition: 'no JobSource row exists for (source, externalId): the write was refused and nothing was created',
    writtenThenInactive: writtenThenInactive.length,
    writtenThenInactiveNote: 'written once then closed or withdrawn — lifecycle, NOT a hold; previously miscounted as held',
    publishedDespiteAPastHold: publishedDespiteHold.length,
    heldByReason: tally(held, (r) => r.reason),
    heldBySource: tally(held, (r) => r.sourceKey),
  };
  const csvEsc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cols = ['sourceKey', 'external_id', 'reason', 'published_now', 'never_written', 'written_then_inactive', 'at'];
  writeFileSync(`${out}/holds-state.csv`, [cols.join(','), ...rows.map((r: any) => cols.map((c) => csvEsc(r[c])).join(','))].join('\n') + '\n');
  writeFileSync(`${out}/holds-state.json`, JSON.stringify({ summary }, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
} finally { await p.$disconnect(); }

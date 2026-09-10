/**
 * Reconcile the TWO different "posting without an operating source" controls, which are not equivalent and must never
 * be quoted for one another.
 *
 *   CONTROL A (historical, README § "640") — a posting with no active representation under a source whose status is
 *                                            ACTIVE. A PAUSED source does NOT count as operating.
 *   CONTROL B (reference-snapshot, "0 sans source vivante") — a posting with no active representation under a source
 *                                            whose status is ACTIVE **or PAUSED**.
 *
 * B is strictly weaker: every posting held up only by a PAUSED source passes B and fails A. Quoting "0" from B as if it
 * settled A would silently retire a real open dossier — hence this script reports both, their difference, and the
 * IDENTIFIERS and REASONS behind that difference, per paused source.
 *
 * Read-only, one REPEATABLE READ snapshot (READ ONLY alone does not pin a snapshot: at read committed each statement
 * re-snapshots, so the two controls could be computed against different states once writes resume).
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/orphan-postings.mts <output-dir> [--sample=N]
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: orphan-postings.mts <output-dir> [--sample=N]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const SAMPLE = Number((process.argv.find((a) => a.startsWith('--sample=')) ?? '--sample=25').split('=')[1]);

const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const iso: any[] = await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS level`;
    const clock: any[] = await tx.$queryRaw`SELECT now() AS at`;
    const activeTotal = await tx.job.count({ where: { isActive: true } });

    const controlA: any[] = await tx.$queryRaw`SELECT COUNT(*)::int n FROM "Job" j WHERE j."isActive"
      AND NOT EXISTS (SELECT 1 FROM "JobSource" js JOIN "Source" s ON s.key=js."sourceKey"
                      WHERE js."jobId"=j.id AND js."isActive" AND s.status='ACTIVE')`;
    const controlB: any[] = await tx.$queryRaw`SELECT COUNT(*)::int n FROM "Job" j WHERE j."isActive"
      AND NOT EXISTS (SELECT 1 FROM "JobSource" js JOIN "Source" s ON s.key=js."sourceKey"
                      WHERE js."jobId"=j.id AND js."isActive" AND s.status IN ('ACTIVE','PAUSED'))`;

    /** The difference: postings whose ONLY live attestation is a PAUSED source — with the reason, per source. */
    const difference: any[] = await tx.$queryRaw`
      SELECT s.key AS paused_source, s.maison, s.kind, COUNT(DISTINCT j.id)::int postings,
             MIN(j."firstSeenAt") AS oldest, MAX(j."lastSeenAt") AS newest_seen, MIN(LEFT(COALESCE(s.note,''), 200)) AS note
      FROM "Job" j
      JOIN "JobSource" js ON js."jobId"=j.id AND js."isActive"
      JOIN "Source" s ON s.key=js."sourceKey" AND s.status='PAUSED'
      WHERE j."isActive"
        AND NOT EXISTS (SELECT 1 FROM "JobSource" js2 JOIN "Source" s2 ON s2.key=js2."sourceKey"
                        WHERE js2."jobId"=j.id AND js2."isActive" AND s2.status='ACTIVE')
      GROUP BY 1,2,3 ORDER BY 4 DESC`;

    /** Identifiers, so the difference is auditable posting by posting rather than as a bare count. */
    const identifiers: any[] = await tx.$queryRaw`
      SELECT j.id, c.name AS company, LEFT(j.title, 80) AS title, js."sourceKey" AS paused_source, js."externalId",
             j."firstSeenAt", j."lastSeenAt", j."postedAt"
      FROM "Job" j
      JOIN "JobSource" js ON js."jobId"=j.id AND js."isActive"
      JOIN "Source" s ON s.key=js."sourceKey" AND s.status='PAUSED'
      JOIN "Company" c ON c.id=j."companyId"
      WHERE j."isActive"
        AND NOT EXISTS (SELECT 1 FROM "JobSource" js2 JOIN "Source" s2 ON s2.key=js2."sourceKey"
                        WHERE js2."jobId"=j.id AND js2."isActive" AND s2.status='ACTIVE')
      ORDER BY js."sourceKey", j."firstSeenAt"`;

    /** Postings failing BOTH controls: not even a PAUSED source attests them. */
    const noLiveAtAll: any[] = await tx.$queryRaw`
      SELECT j.id, c.name AS company, LEFT(j.title, 80) AS title, j."firstSeenAt", j."lastSeenAt",
             (SELECT string_agg(DISTINCT js2."sourceKey" || ':' || s2.status || ':' || js2."isActive", ', ')
              FROM "JobSource" js2 JOIN "Source" s2 ON s2.key=js2."sourceKey" WHERE js2."jobId"=j.id) AS history
      FROM "Job" j JOIN "Company" c ON c.id=j."companyId"
      WHERE j."isActive"
        AND NOT EXISTS (SELECT 1 FROM "JobSource" js JOIN "Source" s ON s.key=js."sourceKey"
                        WHERE js."jobId"=j.id AND js."isActive" AND s.status IN ('ACTIVE','PAUSED'))
      LIMIT 200`;
    return { at: clock[0].at as Date, isolation: iso[0].level as string, activeTotal, controlA: controlA[0].n as number, controlB: controlB[0].n as number, difference, identifiers, noLiveAtAll };
  }, { isolationLevel: 'RepeatableRead' });
  if (db.isolation !== 'repeatable read') throw new Error(`orphan-postings requires REPEATABLE READ; got "${db.isolation}"`);

  const summary = {
    at: db.at.toISOString(), isolation: db.isolation, activePostings: db.activeTotal,
    controlA: { definition: 'no active representation under a source with status ACTIVE (PAUSED does not count as operating)', postings: db.controlA },
    controlB: { definition: 'no active representation under a source with status ACTIVE or PAUSED', postings: db.controlB },
    difference: { postings: db.controlA - db.controlB, meaning: 'postings whose only live attestation is a PAUSED source — they pass control B and fail control A', bySource: db.difference.map((r: any) => ({ pausedSource: r.paused_source, maison: r.maison, kind: r.kind, postings: r.postings, oldest: r.oldest, newestSeen: r.newest_seen, note: r.note })) },
    failingBoth: { postings: db.controlB, sampled: db.noLiveAtAll.length },
    equivalence: db.controlA === db.controlB ? 'the two controls agree at this instant' : 'THE TWO CONTROLS DIFFER: quoting one for the other would hide an open dossier',
  };

  const csvEsc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cols = ['id', 'company', 'title', 'paused_source', 'externalId', 'firstSeenAt', 'lastSeenAt', 'postedAt'];
  writeFileSync(`${out}/orphan-postings.csv`, [cols.join(','), ...db.identifiers.map((r: any) => cols.map((c) => csvEsc(r[c])).join(','))].join('\n') + '\n');
  writeFileSync(`${out}/orphan-postings.json`, JSON.stringify({ summary, sampleFailingBoth: db.noLiveAtAll.slice(0, SAMPLE), differenceIdentifiers: db.identifiers.slice(0, SAMPLE) }, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
} finally { await p.$disconnect(); }

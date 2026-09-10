/**
 * ONE dated reference measurement for LOT 4, taken in a SINGLE read-only transaction so that every number below shares the
 * same instant and the same denominator — the defect this replaces was two reports of the same afternoon disagreeing
 * (344 uncertified "of 432 active, 88 certified" at 18:19Z vs 90 certified of 433 at 18:46Z) because each took its own snapshot.
 *
 * What it separates, deliberately:
 *   • certification: the SAME predicate as the promotion gate (assertIdentityReview on the current config) — never a second logic;
 *   • verification vs failure: a source with no run at all is NOT_VERIFIED, never "failed"; the last run status is reported as-is;
 *   • identity attribution: three states with an explicit denominator — PROVEN (every active representation carries a reviewed
 *     decision), PARTIAL (some do), NOT_OBSERVED (no observation exists at all). NOT_OBSERVED is an absence of proof, not a failure;
 *   • postings: total active, those under an ACTIVE/PAUSED source, and those under none (the denominator usually dropped).
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/reference-snapshot.mts <output-dir>
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assertIdentityReview } from '../../src/connectors/sourceIdentity.js';

const out = process.argv[2];
if (!out) { console.error('usage: reference-snapshot.mts <output-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });

/** A reviewed decision: the identity was established by a human review or by a certified single-brand portal. */
const REVIEWED_RULES = ['REVIEWED_ALIAS', 'REVIEWED_MERGE', 'CERTIFIED_SINGLE_BRAND_PORTAL', 'GROUP_LABEL_KEPT_HOUSE'];

const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const clock: any[] = await tx.$queryRaw`SELECT now() AS at`;
    // careersDomain and tier are part of sourceIdentityHash: omitting them makes every hash differ and every source look uncertified.
    const sources = await tx.source.findMany({ select: { id: true, key: true, maison: true, kind: true, status: true, tenantKey: true, config: true, careersDomain: true, tier: true } });
    // Same ordering as the promotion gate (requireSourceIdentity): the LATEST recorded decision wins, so a later
    // contradiction supersedes an earlier verification instead of being masked by a newer checkedAt.
    const reviews = await tx.sourceIdentityReview.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const runs: any[] = await tx.$queryRaw`SELECT DISTINCT ON ("sourceKey") "sourceKey", status, fetched, accepted, "declaredTotal", complete, truncated, errors, "ranAt" FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC`;
    const activeTotal = await tx.job.count({ where: { isActive: true } });
    const underLive: any[] = await tx.$queryRaw`SELECT COUNT(DISTINCT j.id)::int n FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id JOIN "Source" s ON s.key=js."sourceKey" WHERE j."isActive" AND js."isActive" AND s.status IN ('ACTIVE','PAUSED')`;
    const postingsBySource: any[] = await tx.$queryRaw`SELECT js."sourceKey", COUNT(*)::int n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."isActive" AND j."isActive" GROUP BY 1`;
    /** Representations of active postings, and the LATEST identity decision for each, so attribution has a real denominator. */
    const attribution: any[] = await tx.$queryRaw`SELECT t."sourceKey", COUNT(*)::int total, COUNT(o.rule)::int observed,
        COUNT(*) FILTER (WHERE o.rule = ANY(${REVIEWED_RULES}))::int reviewed
      FROM (SELECT js."sourceKey", js."externalId" FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Source" s ON s.key=js."sourceKey" WHERE js."isActive" AND j."isActive" AND s.status IN ('ACTIVE','PAUSED')) t
      LEFT JOIN LATERAL (SELECT eo.rule FROM "EmployerObservation" eo WHERE eo."sourceKey"=t."sourceKey" AND eo."externalId"=t."externalId" ORDER BY eo."observedAt" DESC, eo.id DESC LIMIT 1) o ON true
      GROUP BY 1`;
    return { at: clock[0].at as Date, sources, reviews, runs, activeTotal, underLive: underLive[0].n as number, postingsBySource, attribution };
  });

  /** Reviews are keyed by sourceKey (schema.prisma: SourceIdentityReview.sourceKey); the newest one wins. */
  const reviewBySource = new Map<string, any>();
  for (const r of db.reviews) if (!reviewBySource.has(r.sourceKey)) reviewBySource.set(r.sourceKey, r);
  const runBy = new Map<string, any>(db.runs.map((r: any) => [r.sourceKey, r]));
  const postingsBy = new Map<string, number>(db.postingsBySource.map((r: any) => [r.sourceKey, r.n]));
  const attrBy = new Map<string, any>(db.attribution.map((r: any) => [r.sourceKey, r]));

  const rows = db.sources.map((s: any) => {
    const review = reviewBySource.get(s.key);
    let certification = 'NOT_REVIEWED';
    if (review) { try { assertIdentityReview(s, review); certification = 'CERTIFIED'; } catch (e) { certification = `REVIEW_NOT_CURRENT (${(e as Error).message.replace(/^promote: /, '').slice(0, 80)})`; } }
    const run = runBy.get(s.key);
    const a = attrBy.get(s.key);
    const attribution = !a || a.total === 0 ? 'NO_ACTIVE_REPRESENTATION' : a.observed === 0 ? 'NOT_OBSERVED' : a.reviewed === a.total ? 'PROVEN' : a.reviewed === 0 ? 'OBSERVED_NONE_REVIEWED' : 'PARTIAL';
    return {
      key: s.key, maison: s.maison, kind: s.kind, status: s.status,
      certification, portalScope: review?.portalScope ?? null, reviewedAt: review?.checkedAt?.toISOString() ?? null,
      collection: run ? run.status : 'NOT_VERIFIED', lastRunAt: run?.ranAt?.toISOString() ?? null,
      fetched: run?.fetched ?? null, declaredTotal: run?.declaredTotal ?? null, complete: run?.complete ?? null, truncated: run?.truncated ?? null, runErrors: run?.errors ?? null,
      activePostings: postingsBy.get(s.key) ?? 0,
      representations: a?.total ?? 0, representationsObserved: a?.observed ?? 0, representationsReviewed: a?.reviewed ?? 0, attribution,
    };
  }).sort((x: any, y: any) => y.activePostings - x.activePostings || x.key.localeCompare(y.key));

  const live = rows.filter((r: any) => r.status === 'ACTIVE' || r.status === 'PAUSED');
  const tally = (xs: string[]) => Object.fromEntries(Object.entries(xs.reduce((m: any, x) => { m[x] = (m[x] ?? 0) + 1; return m; }, {})).sort((a: any, b: any) => b[1] - a[1]));
  const sum = (xs: any[], f: (r: any) => number) => xs.reduce((n, r) => n + f(r), 0);
  const at = db.at.toISOString();

  const activeOnly = rows.filter((r: any) => r.status === 'ACTIVE');
  const summary = {
    at, definition: 'One read-only transaction; every count below shares this instant.',
    // Two perimeters coexist in the LOT 4 reports and MUST NOT be read as contradicting each other:
    // unified-inventory counts ACTIVE only (433), this reference and final-table count ACTIVE+PAUSED (441).
    // The bridge is printed so a reader can reconcile them without re-running anything.
    perimeters: {
      liveDefinition: 'ACTIVE + PAUSED (the sources that may still write)',
      activeOnly: { sources: activeOnly.length, representations: sum(activeOnly, (r: any) => r.representations), lastRunOk: activeOnly.filter((r: any) => r.collection === 'OK').length },
      pausedOnly: { sources: live.length - activeOnly.length, representations: sum(live, (r: any) => r.representations) - sum(activeOnly, (r: any) => r.representations), lastRunOk: live.filter((r: any) => r.collection === 'OK').length - activeOnly.filter((r: any) => r.collection === 'OK').length },
    },
    sources: {
      denominator: rows.length, byStatus: tally(rows.map((r: any) => r.status)),
      live: live.length,
      certification: tally(live.map((r: any) => r.certification.split(' ')[0])),
      collectionLastRun: tally(live.map((r: any) => r.collection)),
      attribution: tally(live.map((r: any) => r.attribution)),
    },
    // TWO UNITS, never mixed: a posting is one canonical Job; a representation is one (source, externalId) attesting it.
    // A posting attested by several sources counts once as a posting and several times as a representation — which is why
    // the per-source sums below total more than activeTotal. Both are reported with their own denominator.
    postings: {
      unit: 'canonical Job rows with isActive = true',
      activeTotal: db.activeTotal,
      underLiveSource: db.underLive,
      underNoLiveSource: db.activeTotal - db.underLive,
    },
    representations: {
      unit: 'active (source, externalId) links under an ACTIVE/PAUSED source; a multi-source posting appears several times',
      denominator: sum(live, (r: any) => r.representations),
      observed: sum(live, (r: any) => r.representationsObserved),
      reviewed: sum(live, (r: any) => r.representationsReviewed),
      multiSourceExcess: sum(live, (r: any) => r.representations) - db.underLive,
      byCertification: Object.fromEntries(['CERTIFIED', 'NOT_REVIEWED', 'REVIEW_NOT_CURRENT'].map((c) => [c, sum(live.filter((r: any) => r.certification.startsWith(c)), (r: any) => r.activePostings)])),
      byAttribution: Object.fromEntries(['PROVEN', 'PARTIAL', 'OBSERVED_NONE_REVIEWED', 'NOT_OBSERVED', 'NO_ACTIVE_REPRESENTATION'].map((c) => [c, sum(live.filter((r: any) => r.attribution === c), (r: any) => r.activePostings)])),
    },
  };

  const csvEsc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cols = ['key', 'maison', 'kind', 'status', 'certification', 'portalScope', 'reviewedAt', 'collection', 'lastRunAt', 'fetched', 'declaredTotal', 'complete', 'truncated', 'runErrors', 'activePostings', 'representations', 'representationsObserved', 'representationsReviewed', 'attribution'];
  const header = cols.map((c) => (c === 'key' ? 'sourceKey' : c));
  writeFileSync(`${out}/reference-sources.csv`, [header.join(','), ...rows.map((r: any) => cols.map((c) => csvEsc(r[c])).join(','))].join('\n') + '\n');
  writeFileSync(`${out}/reference-snapshot.json`, JSON.stringify({ summary, sources: rows }, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
} finally { await p.$disconnect(); }

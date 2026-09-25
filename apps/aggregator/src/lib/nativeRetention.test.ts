import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkSourceHealth, FULL_RUN_MARKER, type SourceHealth } from '../pipeline/health.js';
import type { IngestStats } from '../pipeline/ingest.js';
import { issuesFromResult, type IngestionIssue } from './ingestionIssue.js';
import { failureLine, summarizeOrchestration } from './runSummary.js';
import { classifySourceRun, type OrchestratorResult } from '../pipeline/ingestOrchestrator.js';
import { alertHtml, alertSubject } from '../pipeline/alert.js';
import { retentionClass, retentionStatus } from '../pipeline/publicationDisposition.js';

/**
 * D-453 §1 et D-456 (arbitrages CEO des 24 et 25/09/2026) : une retenue fondée sur une preuve de la source —
 * candidature close, page de candidature en 404 ou 410, modèle expiré, retrait, test, événement, employeur absent
 * d'une annonce Workday — ou une exclusion de périmètre décidée par l'équipe reste visible mais ne fait pas échouer
 * le RUN ; les énumérations non prouvées et réfutées, les troncatures, l'identité, les échecs de lecture et les
 * motifs inconnus restent bloquants. Chaque cas reprend la forme d'une source du RUN 35ba463f.
 *
 * Le chemin est celui du RUN : santé (`checkSourceHealth`, SourceRun écrits dans un faux client qui sert
 * l'historique) → classement de l'orchestrateur (`classifySourceRun`) → ligne d'échec (`failureLine`) → bilan
 * (`summarizeOrchestration`) et alerte (`alertSubject`, `alertHtml`).
 */
type Row = Record<string, unknown>;
/** One past SourceRun, most recent first. `complete`: its RUN emitted the complete-RUN marker. */
type PastRun = { jobs: number; fetched?: number | null; accepted?: number | null; runId?: string; complete?: boolean };
function fakeDb(history: Record<string, PastRun[]>) {
  const written: Row[] = [];
  const rows = Object.entries(history).flatMap(([sourceKey, runs]) => runs.map((run, i) => ({ sourceKey, jobs: run.jobs,
    fetched: run.fetched === undefined ? run.jobs : run.fetched, accepted: run.accepted === undefined ? run.jobs : run.accepted,
    runId: run.runId ?? `${sourceKey}-run-${i}`, complete: run.complete ?? true })));
  const db = {
    sourceRun: {
      findMany: async (args: { where: { ranAt?: unknown } }) => args.where.ranAt ? [] : rows.map(({ complete: _, ...row }) => row),
      create: async ({ data }: { data: Row }) => { written.push(data); return data; },
      deleteMany: async () => ({ count: 0 }),
    },
    pipelineEvent: {
      findMany: async (args: { where: { runId: { in: string[] }; event: string } }) => rows
        .filter(row => row.complete && args.where.event === FULL_RUN_MARKER && args.where.runId.in.includes(row.runId)).map(row => ({ runId: row.runId })),
    },
    source: { updateMany: async () => ({ count: 1 }) },
  };
  return { db: db as unknown as PrismaClient, written };
}
const stat = (source: string, jobs: number, extra: Partial<IngestStats> = {}): IngestStats => ({
  source, complete: true, enumerationReading: 'PROVEN', fetched: jobs, inSector: jobs, france: 0, created: 0, merged: 0, updated: jobs, errors: 0,
  withDescription: jobs, withDate: jobs, withCountry: jobs, withUrl: jobs, declaredTotal: jobs,
  captureBatchId: `batch-${source}`, completionReportHash: `report-${source}`, ...extra,
});
/** Retained postings are collected, never published: they are in `fetched`, not in `inSector`. */
const retaining = (source: string, published: number, reasons: Record<string, number>, extra: Partial<IngestStats> = {}): IngestStats => {
  const held = Object.values(reasons).reduce((a, b) => a + b, 0);
  return stat(source, published, { fetched: published + held, declaredTotal: published + held, held, heldUnresolved: held, heldReasons: reasons, ...extra });
};
/** One source run through the same steps as `ingestOne`, then the final bilan. The history defaults to one complete RUN with the same shares. */
async function runOne(s: IngestStats, history: PastRun[] = [{ jobs: s.inSector, fetched: s.fetched, accepted: s.inSector }]) {
  const { db, written } = fakeDb({ [s.source]: history });
  const health = await checkSourceHealth(db, [s]);
  const { issues, incidents } = classifySourceRun([s], health.incidents);
  const result: OrchestratorResult = { total: 2, ok: 1 + (issues.length ? 0 : 1), failed: issues.length ? 1 : 0, timedOut: 0,
    failures: issues.length ? [failureLine(s.source, issues, 'erreurs d’ingestion')] : [], incidents,
    issues: issues.map(issue => ({ ...issue, source: s.source })) };
  return { health, issues, incidents, summary: summarizeOrchestration(result), sourceRun: written[0] };
}

describe('a retention on the source’s own evidence is visible but does not fail the RUN', () => {
  it('aritzia (5 postings whose Workday detail names no employer): attributed to the source, RUN completed with errors', async () => {
    const aritzia = retaining('aritzia', 538, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 5 }, { heldOnline: { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 2 } });
    const { health, issues, incidents, summary, sourceRun } = await runOne(aritzia);
    // Premise: an incident without any write error — exactly what the former rule turned into SOURCE_HEALTH_REGRESSION.
    expect(aritzia.errors).toBe(0);
    expect(health.incidents).toHaveLength(1);
    expect(issues).toEqual([{ origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 5, captureBatchId: 'batch-aritzia', completionReportHash: 'report-aritzia' }]);
    expect(incidents).toMatchObject([{ blocking: false, nonBlockingRetentionOnly: true, retained: 5,
      retention: { collected: 543, byReason: { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 5 }, online: { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 2 } } }]);
    // No disposition, no withdrawal: two of the five stay online from an earlier collection, and the bilan says so.
    expect(summary.retainedStillOnline).toEqual({ sources: 1, postings: 2, bySource: [{ source: 'aritzia', postings: 2 }] });
    expect(summary).toMatchObject({ outcome: 'COMPLETED_WITH_ERRORS', executionHealthy: true, blockingReasons: [], nonBlockingCauses: ['NATIVE_RETENTION'],
      attribution: { nativeSources: 1, unknownSources: 0, nativeRetentionSources: 1, nativeFailureSources: 0 }, incidents: { degraded: 1 },
      nativeRetentions: { sources: 1, postings: 5, bySource: [{ source: 'aritzia', postings: 5 }] } });
    expect(summary.failures).toEqual(['aritzia (non bloquant : retenue sur preuve de la source, 5 offres)']);
    // Still visible: SourceRun keeps the incident and names the reason — as decided, never as "unresolved".
    expect(sourceRun).toMatchObject({ status: 'DEGRADED', canAttestAbsence: true });
    expect(String(sourceRun.note)).toContain('5 sur preuve de la source (WORKDAY_EMPLOYER_ABSENT_IN_DETAIL=5)');
    expect(String(sourceRun.note)).not.toContain('non résolue');
  });

  it('D-456 §1: intersport — closed applications, 404 pages and expired templates do not block', async () => {
    const intersport = retaining('intersport-france', 853, { APPLICATION_EXPLICITLY_CLOSED: 43, APPLICATION_HTTP_404: 8, APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION: 12 });
    const { issues, summary, sourceRun } = await runOne(intersport);
    expect(issues).toEqual([expect.objectContaining({ origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 63 })]);
    expect(summary.outcome).toBe('COMPLETED_WITH_ERRORS');
    expect(String(sourceRun.note)).toContain('63 sur preuve de la source');
    expect(String(sourceRun.note)).not.toContain('à instruire');
  });

  it('a 410 page, an unlisting, a test publication and a recruitment event are the source’s own evidence', async () => {
    const cases: Record<string, number>[] = [{ APPLICATION_HTTP_410: 1 }, { SOURCE_UNLISTED: 2 }, { NATIVE_TEST_PUBLICATION: 1 }, { NATIVE_RECRUITMENT_EVENT: 1 }];
    for (const reasons of cases) {
      const { issues, summary } = await runOne(retaining('closed', 100, reasons));
      expect(issues.map(issue => issue.code)).toEqual(['NATIVE_RETENTION']);
      expect(summary.outcome).toBe('COMPLETED_WITH_ERRORS');
    }
  });
});

describe('D-456 §2: a perimeter exclusion is the team’s decision, visible and non-blocking', () => {
  it('alone, it fails nothing: no issue, the incident stays visible and named as the team’s', async () => {
    const { issues, incidents, summary, sourceRun } = await runOne(retaining('reviewed-exclusion', 50, { SCOPE_OUT_OF_PERIMETER: 2 }));
    expect(issues).toEqual([]);
    expect(incidents).toMatchObject([{ blocking: false, nonBlockingRetentionOnly: true, retained: 2 }]);
    expect(summary).toMatchObject({ outcome: 'COMPLETED', nonBlockingCauses: [], teamExclusions: { sources: 1, postings: 2 } });
    expect(String(sourceRun.note)).toContain('2 écartées par l’équipe (SCOPE_OUT_OF_PERIMETER=2)');
  });
  it('through `ingest --source` too (no orchestrator): the exclusion alone is non-blocking in the alert, as in the exit code', async () => {
    const { db } = fakeDb({ 'reviewed-exclusion': [{ jobs: 50, fetched: 52, accepted: 50 }] });
    const alone = retaining('reviewed-exclusion', 50, { SCOPE_OUT_OF_PERIMETER: 2 });
    const health = await checkSourceHealth(db, [alone]);
    // Premise: the CLI exit code is `issuesFromResult` — no issue, exit 0.
    expect(issuesFromResult([alone], health.incidents)).toEqual([]);
    expect(health.incidents).toMatchObject([{ blocking: false, nonBlockingRetentionOnly: true }]);
    expect(alertHtml(health)).toContain('data-source="reviewed-exclusion" data-bloquant="non"');
    // A native retention stays strict on that path: an issue (exit 1), and the alert lists it as blocking.
    const { db: nativeDb } = fakeDb({ closed: [{ jobs: 50, fetched: 51, accepted: 50 }] });
    const closed = retaining('closed', 50, { APPLICATION_EXPLICITLY_CLOSED: 1 });
    const nativeHealth = await checkSourceHealth(nativeDb, [closed]);
    expect(issuesFromResult([closed], nativeHealth.incidents).map(issue => issue.code)).toEqual(['NATIVE_RETENTION']);
    expect(nativeHealth.incidents[0]?.blocking).toBeUndefined();
    expect(alertHtml(nativeHealth)).toContain('data-source="closed" data-bloquant="oui"');
  });
  it('next to a closure, only the source’s evidence is attributed to the source', async () => {
    const { issues, summary } = await runOne(retaining('mixed', 50, { APPLICATION_EXPLICITLY_CLOSED: 3, SCOPE_OUT_OF_PERIMETER: 2 }));
    expect(issues).toEqual([expect.objectContaining({ origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 3 })]);
    expect(summary).toMatchObject({ outcome: 'COMPLETED_WITH_ERRORS', nativeRetentions: { postings: 3 }, teamExclusions: { sources: 1, postings: 2 } });
  });
});

describe('everything else still fails the RUN', () => {
  const blocking = async (s: IngestStats, history?: PastRun[]) => {
    const { issues, summary, sourceRun, incidents } = await runOne(s, history);
    expect(summary).toMatchObject({ outcome: 'FAILED', blockingReasons: ['UNRESOLVED_FAILURE'], nonBlockingCauses: [] });
    expect(issues.every(issue => issue.origin === 'UNKNOWN')).toBe(true);
    expect(summary.failures[0]).toMatch(/\(bloquant : /);
    expect(incidents.every(incident => incident.blocking)).toBe(true);
    return { issues, sourceRun, summary, incidents };
  };
  it('a retention next to a refuted enumeration (tapestry, UNPARTITIONED_UNDER_CAP) — both named', async () => {
    const { issues, sourceRun } = await blocking(retaining('tapestry', 2300, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 3 },
      { complete: false, enumerationReading: 'REFUTED', enumerationRefutedBy: ['UNPARTITIONED_UNDER_CAP'] }));
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'ENUMERATION_REFUTED', count: 1 }]);
    expect(String(sourceRun.note)).toMatch(/énumération réfutée.*UNPARTITIONED_UNDER_CAP.*WORKDAY_EMPLOYER_ABSENT_IN_DETAIL=3/);
  });
  it('a retention next to an enumeration that is only NOT PROVEN — still blocking, named as such', async () => {
    const { issues, sourceRun } = await blocking(retaining('crawled', 12, { APPLICATION_EXPLICITLY_CLOSED: 1 }, { complete: false, enumerationReading: 'NOT_PROVEN' }));
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN', count: 1 }]);
    expect(String(sourceRun.note)).toMatch(/énumération non prouvée/);
    expect(String(sourceRun.note)).not.toMatch(/réfutée/);
  });
  it('a retention next to a truncation, a collapse or a field-coverage loss', async () => {
    await blocking(retaining('truncated', 923, { APPLICATION_EXPLICITLY_CLOSED: 1 }, { truncated: true, declaredTotal: 927 }));
    await blocking(retaining('collapsed', 40, { APPLICATION_EXPLICITLY_CLOSED: 1 }), [{ jobs: 400, fetched: 401, accepted: 400 }]);
    await blocking(retaining('no-descriptions', 100, { APPLICATION_EXPLICITLY_CLOSED: 1 }, { withDescription: 10 }));
  });
  it('a read failure, an unknown reason, an uncounted or partly counted retention', async () => {
    const { sourceRun } = await blocking(retaining('nordstrom', 1288, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 2, WORKDAY_DETAIL_FETCH_FAILED: 1 }));
    expect(String(sourceRun.note)).toContain('1 à instruire (WORKDAY_DETAIL_FETCH_FAILED=1)');
    await blocking(retaining('urbn-hub', 1478, { ICIMS_DETAIL_FETCH_FAILED: 1 }));
    await blocking(retaining('harri', 30, { UNRECOGNISED_PUBLICATION_STATE: 1 }));
    // A retention whose reasons were not counted proves nothing.
    await blocking(stat('uncounted', 50, { fetched: 52, held: 2, heldUnresolved: 2 }));
    // Partly counted: one native reason named, two retentions without any — the named one does not cover them.
    const partly = stat('partly-counted', 50, { fetched: 53, held: 3, heldUnresolved: 3, heldReasons: { APPLICATION_EXPLICITLY_CLOSED: 1 } });
    const partlyRun = (await blocking(partly)).sourceRun;
    expect(String(partlyRun.note)).toContain('2 sans motif compté, à instruire');
  });
  it('identity refusals are write errors, never retentions — and the retention next to them stays visible', async () => {
    // luxe-talent on 24/09: 477 identity refusals, all « portal owner not certified » (read-only measure,
    // `audits/2026-09-25/scripts/refus-identite-motifs-2409.mts`), next to 1 recruitment event retained.
    const luxeTalent = retaining('luxe-talent', 30, { NATIVE_RECRUITMENT_EVENT: 1 }, { errors: 477,
      issues: [{ origin: 'UNKNOWN', code: 'EmployerIdentityReviewRequired', count: 477, captureBatchId: 'batch-luxe-talent' }],
      writeFailures: { 'EmployerIdentityReviewRequired:PORTAL_OWNER_NOT_CERTIFIED': 477 } });
    const { issues, sourceRun, summary } = await blocking(luxeTalent);
    expect(issues.map(issue => issue.code)).toEqual(['EmployerIdentityReviewRequired']);
    // The known cause, in plain words — not a bare count of « errors ».
    expect(String(sourceRun.note)).toContain('477 erreurs de collecte ou d’écriture, dont 477 refus d’identité (employeur non certifié : 477)');
    expect(String(sourceRun.note)).toContain('1 sur preuve de la source (NATIVE_RECRUITMENT_EVENT=1)');
    expect(summary.retainedOnBlockingSources).toEqual({ sources: 1, postings: 1, bySource: [{ source: 'luxe-talent', postings: 1 }] });
  });
  it('names every identity motif, most frequent first, and still names a refusal counted without its motif', async () => {
    // Synthetic: two motifs on one source (on 24/09, b-s-international had 59 « new spelling », luxe-talent 477 « not certified »).
    const mixed = stat('two-motifs', 0, { errors: 60, issues: [{ origin: 'UNKNOWN', code: 'EmployerIdentityReviewRequired', count: 60 }],
      writeFailures: { 'EmployerIdentityReviewRequired:EMPLOYER_SPELLING_DIVERGED': 20, 'EmployerIdentityReviewRequired:PORTAL_OWNER_NOT_CERTIFIED': 40 } });
    const { sourceRun } = await blocking(mixed, [{ jobs: 10 }]);
    expect(String(sourceRun.note)).toContain('60 erreurs de collecte ou d’écriture, dont 60 refus d’identité (employeur non certifié : 40 ; nouvelle graphie de l’employeur : 20)');
    const older = stat('older', 0, { errors: 3, issues: [{ origin: 'UNKNOWN', code: 'EmployerIdentityReviewRequired', count: 3 }] });
    expect(String((await blocking(older, [{ jobs: 10 }])).sourceRun.note)).toContain('dont 3 refus d’identité (motif non compté)');
    // Any other write failure keeps its count alone: no identity cause is invented.
    const other = stat('db', 5, { errors: 1, issues: [{ origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 }], writeFailures: { PrismaClientKnownRequestError: 1 } });
    const { health } = await runOne(other);
    expect(health.incidents[0]?.note).not.toContain('refus d’identité');
  });
  it('a source that failed before any collection is « not collected », never « down with 0 offers »: its offers stay online', async () => {
    // The `runIngest` catch path: nothing sealed, nothing read.
    const failed = { ...stat('kering', 0, { errors: 1, errorNote: 'HttpStatusError: 405', issues: [{ origin: 'UNKNOWN', code: 'HttpStatusError', count: 1 }] }),
      captureBatchId: undefined, completionReportHash: undefined, declaredTotal: undefined };
    const { incidents } = await blocking(failed, [{ jobs: 820 }]);
    expect(incidents[0]).toMatchObject({ status: 'BROKEN', notCollected: true });
    const html = alertHtml({ degraded: 0, broken: 1, incidents });
    expect(html).toContain('non collectée');
    expect(html).toContain('aucune collecte aboutie par ce RUN ; ses offres en ligne restent publiées, 820 au run précédent');
    const block = html.slice(html.indexOf('data-source="kering"'));
    expect(block).not.toMatch(/en panne|0 offre publiée/);
    expect(html).toContain('1 source non collectée, 0 source en panne, 0 dégradée.');
    // A collection that completed with zero postings and an error is not « not collected ».
    const read = stat('read-then-failed', 0, { errors: 1, issues: [{ origin: 'UNKNOWN', code: 'REJECTED_NATIVE_ROWS', count: 1 }] });
    expect((await blocking(read, [{ jobs: 10 }])).incidents[0]?.notCollected).toBeUndefined();
  });
  it('a native retention without its sealed completion report is not a proven source attribution', async () => {
    const { summary } = await runOne(retaining('unsealed', 100, { APPLICATION_EXPLICITLY_CLOSED: 1 }, { completionReportHash: undefined }));
    expect(summary).toMatchObject({ outcome: 'FAILED', blockingReasons: ['UNRESOLVED_FAILURE'] });
  });
});

describe('the negative-proof guard (technical): only the Workday reason, against the last complete RUN', () => {
  const jumping = () => retaining('workday-format', 700, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 310 });
  it('a Workday share that jumps (1 % → 31 %) is to be instructed, not accepted on trust', async () => {
    // Premise: the complete RUN of reference published 1 000 of 1 010 collected postings (1 % unpublished), and this
    // run still publishes 700 — above half, so the volume-collapse check alone would NOT have raised it.
    const s = jumping();
    expect(s.inSector).toBeGreaterThanOrEqual(1000 * 0.5);
    const { issues, sourceRun, summary } = await runOne(s, [{ jobs: 1000, fetched: 1010, accepted: 1000 }]);
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'NATIVE_RETENTION_JUMP', count: 1 }]);
    expect(summary.outcome).toBe('FAILED');
    expect(String(sourceRun.note)).toMatch(/employeur absent sur 30,7 % des offres contre 1,0 % .*\(\+300 offres\)/);
  });
  it('the reference is the last COMPLETE RUN: a targeted run in between (no marker) is never the reference', async () => {
    // Most recent first: a targeted run (canary, INGEST_ONLY_KEYS or --source) already at 30 %, then the complete RUN at 1 %.
    const history = [{ jobs: 700, fetched: 1010, accepted: 700, complete: false }, { jobs: 1000, fetched: 1010, accepted: 1000 }];
    expect((await runOne(jumping(), history)).issues.map(issue => issue.code)).toEqual(['NATIVE_RETENTION_JUMP']);
  });
  it('a failed collection in between (fetched unknown) is skipped for the reference', async () => {
    // Most recent first: yesterday's ERROR row of a complete RUN, then the complete RUN that collected the source (1 %).
    const history = [{ jobs: 0, fetched: null, accepted: null }, { jobs: 1000, fetched: 1010, accepted: 1000 }];
    const { issues, incidents } = await runOne(jumping(), history);
    // The reference is found (no « garde sans référence »), and the jump against it is seen.
    expect(incidents[0]?.guardWithoutReference).toBeUndefined();
    expect(issues.map(issue => issue.code)).toEqual(['NATIVE_RETENTION_JUMP']);
  });
  it('positive evidence is never guarded: a wave of closures or unlistings stays non-blocking', async () => {
    const waves: Record<string, number>[] = [{ APPLICATION_EXPLICITLY_CLOSED: 30 }, { SOURCE_UNLISTED: 25 }, { APPLICATION_HTTP_404: 40 }];
    for (const reasons of waves) {
      // Premise: the same jump would have been refused for the Workday reason (0 % → about 25 %, 25 postings or more).
      const { issues } = await runOne(retaining('wave', 100, reasons), [{ jobs: 100, fetched: 100, accepted: 100 }]);
      expect(issues.map(issue => issue.code)).toEqual(['NATIVE_RETENTION']);
    }
  });
  it('without any complete RUN of reference, the retention does not block, and says so', async () => {
    const s = retaining('first-run', 50, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 5 });
    // Premise: the only past run is a targeted one — no complete RUN has collected the source.
    const { issues, incidents, summary, sourceRun } = await runOne(s, [{ jobs: 50, fetched: 55, accepted: 50, complete: false }]);
    expect(issues.map(issue => issue.code)).toEqual(['NATIVE_RETENTION']);
    expect(incidents).toMatchObject([{ blocking: false, guardWithoutReference: true }]);
    expect(summary).toMatchObject({ outcome: 'COMPLETED_WITH_ERRORS', guardWithoutReference: ['first-run'] });
    expect(String(sourceRun.note)).toContain('garde technique sans référence');
  });
  it('the shares measured on the RUNs of 23/09 16:01 and 24/09 hold: vf-corporation and canada-goose stay non-blocking', async () => {
    // SourceRun fetched/accepted, read-only (`audits/2026-09-24/scripts/rejeu-classement-2409-extraction.mts`).
    const measured: [IngestStats, PastRun][] = [
      [retaining('vf-corporation', 873, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 568 }), { jobs: 873, fetched: 1427, accepted: 873 }], // 38,8 → 39,4 %
      [retaining('canada-goose', 74, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 23 }), { jobs: 75, fetched: 98, accepted: 75 }], // 23,5 → 23,7 %
    ];
    for (const [s, previous] of measured) expect((await runOne(s, [previous])).issues.map(issue => issue.code)).toEqual(['NATIVE_RETENTION']);
  });
  it('exactly ten points is not a jump, whatever the floating point says (20 → 30 %, 30 → 40 %)', async () => {
    for (const [before, now] of [[200, 300], [300, 400]]) {
      const s = retaining('boundary', 1000 - now, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: now });
      expect((await runOne(s, [{ jobs: 1000 - before, fetched: 1000, accepted: 1000 - before }])).issues.map(issue => issue.code)).toEqual(['NATIVE_RETENTION']);
    }
  });
  it('a rise of more than ten points but fewer than ten postings is noise, not a jump', async () => {
    expect((await runOne(retaining('small', 20, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 5 }), [{ jobs: 25, fetched: 25, accepted: 25 }])).issues
      .map(issue => issue.code)).toEqual(['NATIVE_RETENTION']);
  });
  it('a retention that takes more than half the previous volume is already a collapse: blocking either way', async () => {
    const { issues } = await runOne(retaining('workday-collapse', 100, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 910 }), [{ jobs: 1000, fetched: 1010, accepted: 1000 }]);
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
  });
});

describe('the alert and the bilan say what blocks, and why each posting is retained', () => {
  const retention = (source: string, byReason: Record<string, number>, collected: number, extra: Partial<SourceHealth> = {}, online?: Record<string, number>): SourceHealth => {
    const retained = Object.values(byReason).reduce((a, b) => a + b, 0);
    return { source, status: 'DEGRADED', jobs: collected - retained, previous: collected - retained, retained,
      retention: { collected, byReason, ...(online ? { online } : {}) }, nonBlockingRetentionOnly: true, blocking: false, note: `${retained} annonces retenues`, ...extra };
  };
  // Online counts as measured on 25/09 for the RUN of 24/09 (`audits/2026-09-25/scripts/retenues-encore-en-ligne-2409.mts`): none.
  const levis = retention('levis', { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 1268 }, 1270, {}, {});
  const intersport = retention('intersport-france', { APPLICATION_EXPLICITLY_CLOSED: 43, APPLICATION_HTTP_404: 8, APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION: 12 }, 916, {}, {});
  const scope = retention('reviewed-exclusion', { SCOPE_OUT_OF_PERIMETER: 2 }, 52, { guardWithoutReference: undefined });
  // Synthetic: a reason without disposition whose earlier publication stays online (one of five).
  const fresh = retention('first-run', { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 5 }, 55, { guardWithoutReference: true }, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 1 });
  const unarbitrated = retention('maison-unlisted', { SOURCE_UNLISTED: 2, APPLICATION_HTTP_410: 1 }, 40, {}, { SOURCE_UNLISTED: 2 });
  // Twenty more: more than any truncation bound the bilan or the alert once applied.
  const small = Array.from({ length: 20 }, (_, i) => retention(`maison-${String(i).padStart(2, '0')}`, { APPLICATION_EXPLICITLY_CLOSED: 1 }, 50));
  const blockingIncident: SourceHealth = { source: 'kering', status: 'DEGRADED', jobs: 800, previous: 820, blocking: true,
    note: '1 erreur de collecte ou d’écriture : HTTP 405 for https://careers.kering.com/api/pcsx/search?domain=kering.com&query=&location=&start=820&num=10 — relancé' };
  const outage: SourceHealth = { source: 'rolex', status: 'BROKEN', jobs: 0, previous: null, blocking: false, note: 'SOURCE/HTTP_503: upstream' };
  const unannotated: SourceHealth = { source: 'legacy-path', status: 'BROKEN', jobs: 0, previous: 12, note: 'ne rend aucune offre' };
  const retentions = [small[0]!, levis, scope, intersport, fresh, unarbitrated, ...small.slice(1)];
  const incidents = [...retentions, blockingIncident, outage, unannotated];
  const total = retentions.reduce((sum, r) => sum + r.retained!, 0);
  const fr = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

  it('one block per source, no table: each block says whether it blocks, the sentence governs the blocking ones only', () => {
    const html = alertHtml({ degraded: 26, broken: 2, incidents });
    // Premise of the mobile fix: no six-column table left to push the detail off a 375 px screen.
    expect(html).not.toContain('<table');
    const blockingSection = html.slice(html.indexOf('Bloquant :'), html.indexOf('Non bloquant, retenues'));
    expect(blockingSection).toContain('Chaque ligne est une source à investiguer');
    expect(html.split('Chaque ligne est une source à investiguer')).toHaveLength(2);
    expect(blockingSection).toContain('data-source="kering"');
    // An incident no path classified is blocking by default.
    expect(blockingSection).toContain('data-source="legacy-path" data-bloquant="oui"');
    expect(blockingSection).not.toContain('maison-00');
    expect(html.match(/data-bloquant="oui"/g)).toHaveLength(2);
    expect(html.match(/data-bloquant="non"/g)).toHaveLength(retentions.length + 1);
    expect(html.slice(html.indexOf('Non bloquant, pannes'))).toContain('data-source="rolex"');
  });

  it('a text per reason: what, its standing (decided or not arbitrated) and how many stay online from an earlier collection', () => {
    const html = alertHtml({ degraded: 26, broken: 2, incidents });
    const block = (source: string) => html.slice(html.indexOf(`data-source="${source}"`), html.indexOf('</div>', html.indexOf(`data-source="${source}"`)));
    expect(block('levis')).toContain(`${fr(1268)} offres : l’annonce ne nomme pas l’employeur (99,8 % des offres collectées de la source) · décidé (D-453 §1) · non publiées par ce RUN ; aucune ne reste en ligne`);
    expect(block('intersport-france')).toContain('43 offres : la source rend la candidature impossible (candidature close) · décidé (D-453 §1) · non publiées par ce RUN ; aucune ne reste en ligne');
    expect(block('intersport-france')).toContain('8 offres : la source rend la candidature impossible (page de candidature en erreur 404) · décidé (D-456 §1)');
    expect(block('intersport-france')).toContain('12 offres : la source rend la candidature impossible (modèle expiré) · décidé (D-456 §1)');
    // Without a measure, the alert says so instead of implying anything.
    expect(block('reviewed-exclusion')).toContain('2 offres : écartée par l’équipe (hors périmètre) · décidé (D-456 §2) · non publiées par ce RUN ; maintien en ligne non mesuré');
    expect(block('first-run')).toContain('5 offres : l’annonce ne nomme pas l’employeur (9,1 % des offres collectées de la source) · décidé (D-453 §1) · non publiées par ce RUN ; 1 reste en ligne depuis une collecte antérieure');
    // D-462 (25/09/2026) settles the listing withdrawal and the 410: the alert names that decision.
    expect(block('maison-unlisted')).toContain('2 offres : retirée de son listing par la source · décidé (D-462) · non publiées par ce RUN ; 2 restent en ligne depuis une collecte antérieure');
    expect(block('maison-unlisted')).toContain('1 offre : la source rend la candidature impossible (page de candidature supprimée, 410) · décidé (D-462) · non publiée par ce RUN ; aucune ne reste en ligne');
    // No retention line carries the undecided status any more (the alert's general legend still names it).
    expect(html).not.toContain('· application non arbitrée ·');
    expect(block('first-run')).toContain('garde technique sans référence');
    expect(block('levis')).not.toContain('garde technique sans référence');
    // A blocking source keeps its retention lines too; a reason to instruct says so once. Nordstrom as measured on 25/09:
    // the unreadable detail is still published from an earlier collection, the two Workday retentions are not.
    const nordstrom: SourceHealth = { source: 'nordstrom', status: 'DEGRADED', jobs: 1288, previous: 1288, blocking: true, retained: 3,
      retention: { collected: 1291, byReason: { WORKDAY_DETAIL_FETCH_FAILED: 1, WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 2 }, online: { WORKDAY_DETAIL_FETCH_FAILED: 1 } },
      note: '3 annonces retenues' };
    const blockingHtml = alertHtml({ degraded: 1, broken: 0, incidents: [nordstrom] });
    expect(blockingHtml).toContain('1 offre : à instruire (WORKDAY_DETAIL_FETCH_FAILED) · non publiée par ce RUN ; 1 reste en ligne depuis une collecte antérieure');
    expect(blockingHtml).toContain('2 offres : l’annonce ne nomme pas l’employeur (0,2 % des offres collectées de la source) · décidé (D-453 §1) · non publiées par ce RUN ; aucune ne reste en ligne');
    // The former header claimed every retained posting was unpublished: false for the reasons without disposition.
    expect(html).not.toContain('ces offres ne sont pas publiées');
    expect(html).toContain('Le RUN n’échoue pas pour ces retenues');
    // Sorted by postings: Levi's first, and every retention listed with the total.
    const order = retentions.map(r => r.source).sort((a, b) => html.indexOf(`data-source="${a}"`) - html.indexOf(`data-source="${b}"`));
    expect(order[0]).toBe('levis');
    for (const r of retentions) expect(html).toContain(`data-source="${r.source}"`);
    expect(total).toBe(1361);
    expect(html).toContain(`Total : ${fr(total)} offres retenues sur ${retentions.length} sources.`);
    expect(html).not.toContain('non résolue');
  });

  it('no em dash reaches the e-mail, even inside a source’s own error text (D-319)', () => {
    const html = alertHtml({ degraded: 26, broken: 2, incidents });
    expect(blockingIncident.note).toContain('—');
    expect(html).not.toContain('—');
    expect(html).not.toContain('&mdash;');
    expect(html).toContain('start=820&amp;num=10, relancé');
  });

  it('the subject counts sources and postings in French', () => {
    expect(alertSubject({ degraded: 26, broken: 2, incidents }))
      .toBe(`[Catwalks] 2 sources bloquantes · ${retentions.length} sources avec retenues non bloquantes (${fr(total)} offres) · 1 panne éditeur prouvée, non bloquante`);
  });

  it('the bilan tells a RUN with only native retentions from one with a proven upstream 5xx, and lists every retention', () => {
    const issueOf = (source: string, postings: number): IngestionIssue & { source: string } => ({ source, origin: 'SOURCE', code: 'NATIVE_RETENTION',
      count: postings, captureBatchId: `batch-${source}`, completionReportHash: `report-${source}` });
    const retained = small.map(r => issueOf(r.source, r.retained!));
    const failures = retained.map(issue => failureLine(issue.source, [issue], 'erreurs d’ingestion'));
    const base = { total: 100, ok: 80, failed: 20, timedOut: 0, failures, incidents: small, issues: retained };
    const onlyRetentions = summarizeOrchestration(base);
    expect(onlyRetentions).toMatchObject({ outcome: 'COMPLETED_WITH_ERRORS', nonBlockingCauses: ['NATIVE_RETENTION'],
      attribution: { nativeRetentionSources: 20, nativeFailureSources: 0 } });
    expect(onlyRetentions.nativeRetentions).toMatchObject({ sources: 20, postings: 20 });
    expect(onlyRetentions.nativeRetentions.bySource).toHaveLength(20);

    const upstream = { source: 'rolex', origin: 'SOURCE' as const, code: 'HTTP_503', count: 1, captureBatchId: 'b', rawCaptureId: 'r' };
    const withOutage = summarizeOrchestration({ ...base, ok: 79, failed: 21, issues: [...retained, upstream],
      failures: [failureLine('rolex', [upstream], 'échec'), ...failures] });
    expect(withOutage).toMatchObject({ outcome: 'COMPLETED_WITH_ERRORS', nonBlockingCauses: ['NATIVE_RETENTION', 'NATIVE_HTTP_5XX'],
      attribution: { nativeFailureSources: 1, nativeRetentionSources: 20 } });
    expect(withOutage.failures).toContain('rolex (non bloquant : panne éditeur prouvée HTTP_503)');

    // Blocking lines come first in the bounded list; the retentions stay listed in full above it.
    const unresolved = { source: 'kering', origin: 'UNKNOWN' as const, code: 'HttpStatusError', count: 1 };
    const mixed = summarizeOrchestration({ ...base, ok: 79, failed: 21, issues: [...retained, unresolved],
      failures: [...failures, failureLine('kering', [unresolved], 'erreurs d’ingestion')] });
    expect(mixed.outcome).toBe('FAILED');
    expect(mixed.failures[0]).toBe('kering (bloquant : erreurs d’ingestion)');
    expect(mixed.nativeRetentions.sources).toBe(20);
  });

  it('a targeted RUN whose only sources retain on native evidence completes with errors, never ALL_SOURCES_FAILED', async () => {
    const { issues, incidents } = await runOne(retaining('levis', 2, { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 1268 }));
    // Premise: one source, zero "ok" — the former rule read that as every source failing.
    const result: OrchestratorResult = { total: 1, ok: 0, failed: 1, timedOut: 0, failures: [failureLine('levis', issues, 'erreurs d’ingestion')],
      incidents, issues: issues.map(issue => ({ ...issue, source: 'levis' })) };
    expect(summarizeOrchestration(result)).toMatchObject({ outcome: 'COMPLETED_WITH_ERRORS', blockingReasons: [] });
    // A proven upstream outage on every source stays a failure of the whole RUN.
    const upstream = { source: 'rolex', origin: 'SOURCE' as const, code: 'HTTP_503', count: 1, captureBatchId: 'b', rawCaptureId: 'r' };
    expect(summarizeOrchestration({ total: 1, ok: 0, failed: 1, timedOut: 0, failures: ['rolex (non bloquant : panne éditeur prouvée HTTP_503)'],
      incidents: [], issues: [upstream] })).toMatchObject({ outcome: 'FAILED', blockingReasons: ['ALL_SOURCES_FAILED'] });
  });
});

describe('issuesFromResult alone', () => {
  it('counts only the source’s evidence, never the team’s exclusions', () => {
    const s = retaining('mixed', 50, { APPLICATION_EXPLICITLY_CLOSED: 3, SCOPE_OUT_OF_PERIMETER: 2 });
    expect(issuesFromResult([s], [{ source: 'mixed', nonBlockingRetentionOnly: true }])).toEqual([
      { origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 3, captureBatchId: 'batch-mixed', completionReportHash: 'report-mixed' }]);
  });
});

describe('every non-blocking retention names the decision that settles it (D-453 §1, D-456, D-462)', () => {
  // The nine reasons that do not fail the RUN on 25/09/2026. A new non-blocking reason without a decision would
  // print « application non arbitrée » in the operator's alert: this witness fails first.
  const NON_BLOQUANTS = [
    'APPLICATION_EXPLICITLY_CLOSED', 'APPLICATION_HTTP_404', 'APPLICATION_HTTP_410', 'APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION',
    'SOURCE_UNLISTED', 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL', 'NATIVE_TEST_PUBLICATION', 'NATIVE_RECRUITMENT_EVENT',
    'SCOPE_OUT_OF_PERIMETER',
  ];

  it.each(NON_BLOQUANTS)('%s does not block the RUN and is decided', (reason) => {
    expect(retentionClass(reason)).not.toBe('TO_INSTRUCT');
    expect(retentionStatus(reason)).toBe('décidé');
  });

  it('a reason to instruct keeps blocking, with no decision attached', () => {
    expect(retentionClass('WORKDAY_DETAIL_FETCH_FAILED')).toBe('TO_INSTRUCT');
    expect(retentionStatus('WORKDAY_DETAIL_FETCH_FAILED')).toBe('à instruire');
  });
});

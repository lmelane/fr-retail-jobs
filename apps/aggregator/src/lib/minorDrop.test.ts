import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkSourceHealth, FULL_RUN_MARKER, MINOR_DROP_BLOCKING_DISAPPEARED } from '../pipeline/health.js';
import type { IngestStats } from '../pipeline/ingest.js';
import { failureLine, summarizeOrchestration } from './runSummary.js';
import { classifySourceRun, type OrchestratorResult } from '../pipeline/ingestOrchestrator.js';
import { alertHtml, alertSubject } from '../pipeline/alert.js';

/**
 * D-491 (arbitrage CEO du 30/09/2026) : une baisse de plus de 50 % ne bloque le RUN que si au moins 10 offres
 * disparaissent ; en dessous, elle reste signalée au bilan et dans l'alerte. Une source qui tombe à zéro reste jugée
 * par sa règle propre.
 *
 * Le cas réel : `indiska` au RUN du 30/09/2026 (0f7fb086). `SourceRun` du 29/09 (16:31:51) : jobs 3, fetched 3,
 * accepted 3, sans total annoncé ; les statistiques du 30/09 ci-dessous sont celles de l'événement
 * `source_sync_completed` (16:01:08), à l'identique (compteurs de métiers mis à part). Ce jour-là : « 67 % d'offres en
 * moins qu'au run précédent », SOURCE_HEALTH_REGRESSION, RUN rouge.
 *
 * Le chemin est celui du RUN : santé (`checkSourceHealth`, SourceRun écrits dans un faux client qui sert l'historique)
 * → classement (`classifySourceRun`) → bilan (`summarizeOrchestration`) → alerte.
 */
type PastRun = { jobs: number; fetched: number; accepted: number; declaredTotal: number | null };
function fakeDb(sourceKey: string, history: PastRun[]) {
  const written: Record<string, unknown>[] = [];
  const rows = history.map((run, i) => ({ sourceKey, ...run, runId: `${sourceKey}-run-${i}` }));
  const db = {
    sourceRun: {
      findMany: async (args: { where: { ranAt?: unknown } }) => args.where.ranAt ? [] : rows,
      create: async ({ data }: { data: Record<string, unknown> }) => { written.push(data); return data; },
      deleteMany: async () => ({ count: 0 }),
    },
    pipelineEvent: {
      findMany: async (args: { where: { runId: { in: string[] }; event: string } }) => args.where.event === FULL_RUN_MARKER
        ? rows.filter(row => args.where.runId.in.includes(row.runId)).map(row => ({ runId: row.runId })) : [],
    },
    source: { updateMany: async () => ({ count: 1 }) },
  };
  return { db: db as unknown as PrismaClient, written };
}
const INDISKA_2909: PastRun = { jobs: 3, fetched: 3, accepted: 3, declaredTotal: null };
const INDISKA_3009: IngestStats = { errors: 0, france: 0, merged: 0, source: 'indiska', created: 0, fetchMs: 169, fetched: 1, updated: 1,
  withUrl: 1, complete: true, inSector: 1, upsertMs: 240, withDate: 1, truncated: false, withCountry: 1, declaredTotal: undefined,
  captureBatchId: 'b37ed147-b0f2-4fe4-befc-cf62817d92a7', withDescription: 1, enumerationReading: 'PROVEN',
  completionReportHash: 'bb661c6934bb289b19b41fdb951671a70503604627f022716e2a977c0dbd78c5' };

/** Une source de `before` offres qui n'en publie plus que `after`, liste prouvée, sans total annoncé. */
const drop = (before: number, after: number): [IngestStats, PastRun[]] => [
  { ...INDISKA_3009, source: `src-${before}-${after}`, fetched: after, updated: after, inSector: after, withUrl: after, withDate: after,
    withCountry: after, withDescription: after },
  [{ jobs: before, fetched: before, accepted: before, declaredTotal: null }]];

async function runOne(s: IngestStats, history: PastRun[] = [INDISKA_2909]) {
  const { db, written } = fakeDb(s.source, history);
  const health = await checkSourceHealth(db, [s]);
  const { issues, incidents } = classifySourceRun([s], health.incidents);
  const result: OrchestratorResult = { total: 2, ok: 1 + (issues.length ? 0 : 1), failed: issues.length ? 1 : 0, timedOut: 0,
    failures: issues.length ? [failureLine(s.source, issues, 'erreurs d’ingestion')] : [], incidents,
    issues: issues.map(issue => ({ ...issue, source: s.source })) };
  const report = { degraded: health.degraded, broken: health.broken, incidents };
  return { issues, incidents, summary: summarizeOrchestration(result), sourceRun: written[0], subject: alertSubject(report), html: alertHtml(report) };
}

const signaledNotBlocking = async (s: IngestStats, history: PastRun[], disappeared: number) => {
  const { issues, incidents, summary, sourceRun, subject, html } = await runOne(s, history);
  expect(issues).toEqual([]);
  expect(incidents).toHaveLength(1);
  expect(incidents[0]).toMatchObject({ source: s.source, status: 'DEGRADED', blocking: false, minorDrop: { disappeared } });
  expect(incidents[0].note).toContain(`moins de ${MINOR_DROP_BLOCKING_DISAPPEARED} (D-491, non bloquant)`);
  expect(summary).toMatchObject({ ok: true, outcome: 'COMPLETED', blockingReasons: [] });
  expect(summary.minorDrops).toEqual([{ source: s.source, previous: history[0].jobs, published: incidents[0].jobs, disappeared }]);
  expect(subject).toContain('0 source bloquante');
  expect(subject).toContain('1 baisse de moins de 10 offres, non bloquante');
  expect(html).toContain(`data-source="${s.source}" data-bloquant="non"`);
  expect(html).toContain('Non bloquant, baisses de moins de 10 offres : 1 source');
  // Jamais rangée parmi les pannes de l'éditeur prouvées.
  expect(html).not.toContain('pannes de l\'éditeur prouvées');
  // L'attestation d'absence d'un effondrement est inchangée : la source n'atteste rien ce jour-là.
  expect(sourceRun).toMatchObject({ status: 'DEGRADED', canAttestAbsence: false });
};

const blocking = async (s: IngestStats, history: PastRun[]) => {
  const { issues, incidents, summary } = await runOne(s, history);
  expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
  expect(incidents[0].blocking).toBe(true);
  expect(incidents[0].minorDrop).toBeUndefined();
  expect(summary.ok).toBe(false);
  expect(summary.blockingReasons).toContain('UNRESOLVED_FAILURE');
  expect(summary.minorDrops).toEqual([]);
  return incidents[0];
};

describe('D-491 : indiska, RUN du 30/09/2026 — 3 offres puis 1, signalée, non bloquante', () => {
  it('prémisse : c’est bien un effondrement au sens de la règle des 50 %, et l’éditeur ne le confirme pas', () => {
    const published = INDISKA_3009.created + INDISKA_3009.merged + INDISKA_3009.updated;
    expect(published).toBe(1);
    expect(published < INDISKA_2909.jobs * 0.5).toBe(true);
    expect(INDISKA_3009.declaredTotal).toBeUndefined();          // aucun compteur : D-484 §2 ne peut pas la confirmer
    expect(INDISKA_2909.jobs - published).toBeLessThan(MINOR_DROP_BLOCKING_DISAPPEARED);
  });

  it('non bloquante, signalée au bilan et dans l’alerte', async () => {
    await signaledNotBlocking(INDISKA_3009, [INDISKA_2909], 2);
    const { incidents } = await runOne(INDISKA_3009);
    expect(incidents[0].note).toContain('67 % d’offres en moins qu’au run précédent, 2 offres disparues, moins de 10 (D-491, non bloquant)');
  });

  it('avec une retenue sur preuve de la source : la baisse reste nommée, rien ne bloque', async () => {
    const [s, history] = drop(12, 3);
    const held = { ...s, held: 1, heldUnresolved: 1, heldReasons: { APPLICATION_EXPLICITLY_CLOSED: 1 } };
    const { issues, incidents, summary, html } = await runOne(held, history);
    expect(issues).toEqual([expect.objectContaining({ origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 1 })]);
    expect(incidents[0]).toMatchObject({ blocking: false, nonBlockingRetentionOnly: true, minorDrop: { disappeared: 9 } });
    expect(summary.blockingReasons).toEqual([]);
    expect(html).toContain('9 offres disparues, moins de 10 (D-491, non bloquant)');
  });
});

describe('D-491 : le seuil de dix offres disparues', () => {
  it('12 → 3 : 9 disparues, non bloquante', async () => {
    const [s, history] = drop(12, 3);
    await signaledNotBlocking(s, history, 9);
  });
  it('100 → 40 : 60 disparues, bloquante', async () => {
    const [s, history] = drop(100, 40);
    expect((await blocking(s, history)).note).toContain('60 % d’offres en moins');
  });
  it('20 → 9 : 11 disparues, bloquante', async () => {
    const [s, history] = drop(20, 9);
    await blocking(s, history);
  });
  it('19 → 9 : exactement 10 disparues, bloquante (« au moins 10 »)', async () => {
    const [s, history] = drop(19, 9);
    await blocking(s, history);
  });
  it('20 → 10 : pas un effondrement (exactement la moitié), aucun incident', async () => {
    const [s, history] = drop(20, 10);
    const { incidents, issues } = await runOne(s, history);
    expect(issues).toEqual([]);
    expect(incidents).toEqual([]);
  });
  it('une baisse sous le seuil avec une couverture de champ effondrée : l’autre défaut bloque, et la note le dit', async () => {
    // 12 → 3 publiées (9 disparues), mais 20 offres du secteur lues dont 5 avec une description : le plancher de
    // couverture (70 %, jugé dès 20 offres) bloque. Prémisse : la couverture se juge sur les offres lues, pas publiées.
    const [s, history] = drop(12, 3);
    const incident = await blocking({ ...s, fetched: 20, inSector: 20, withUrl: 20, withDate: 20, withCountry: 20, withDescription: 5 }, history);
    expect(incident.note).toContain('mais bloquant par le défaut qui suit');
    expect(incident.note).toContain('descriptions manquantes');
  });
  it('une baisse sous le seuil sur une énumération non prouvée : bloquante par l’énumération, jamais une baisse signalée', async () => {
    const [s, history] = drop(3, 1);
    const { issues, incidents } = await runOne({ ...s, complete: false, enumerationReading: 'NOT_PROVEN' }, history);
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN', count: 1 }]);
    expect(incidents[0]).toMatchObject({ blocking: true });
    expect(incidents[0].minorDrop).toBeUndefined();
  });
});

describe('D-491 : une source qui tombe à ZÉRO reste jugée par sa règle propre', () => {
  it('3 → 0 : « ne rend aucune offre », bloquante, jamais une baisse de moins de dix', async () => {
    const [s, history] = drop(3, 0);
    const { issues, incidents, summary } = await runOne({ ...s, complete: true }, history);
    expect(issues).toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
    expect(incidents[0]).toMatchObject({ status: 'BROKEN', blocking: true, note: 'ne rend aucune offre, 3 au dernier run productif' });
    expect(incidents[0].minorDrop).toBeUndefined();
    expect(summary.minorDrops).toEqual([]);
  });
  it('3 → 0 annoncé et prouvé par l’éditeur : saine, comme avant', async () => {
    const [s, history] = drop(3, 0);
    const { issues, incidents } = await runOne({ ...s, complete: true, declaredTotal: 0 }, history);
    expect(issues).toEqual([]);
    expect(incidents).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { checkSourceHealth, FULL_RUN_MARKER } from '../pipeline/health.js';
import type { IngestStats } from '../pipeline/ingest.js';
import { failureLine, summarizeOrchestration } from './runSummary.js';
import { classifySourceRun, type OrchestratorResult } from '../pipeline/ingestOrchestrator.js';
import { alertHtml, alertSubject } from '../pipeline/alert.js';
import { CONFIRMED_DROP_TOLERANCE, isPublisherConfirmedDrop, isTrustedForAttestation } from '../pipeline/attestation.js';
import { attestationFacts } from '../pipeline/attestingCapture.js';

/**
 * D-484 §2 (arbitrage CEO du 30/09/2026) : une chute de plus de 50 % ne bloque plus le RUN quand l'éditeur la
 * confirme — son total annoncé baisse dans la même proportion, la liste est prouvée complète, 100 % des offres
 * annoncées sont lues. Elle reste signalée au bilan et dans l'alerte, et atteste l'absence comme toute liste prouvée.
 * Toute autre chute reste bloquante.
 *
 * Le cas réel : Aigle au RUN du 29/09/2026. `SourceRun` du 28/09 (16:45:11) : jobs 121, fetched 121, accepted 121,
 * declaredTotal 122 ; les statistiques du 29/09 ci-dessous sont celles de l'événement `source_sync_completed`
 * (16:46), à l'identique (les compteurs de métiers mis à part). Ce jour-là, le RUN a été rouge :
 * « 50 % d'offres en moins qu'au run précédent », SOURCE_HEALTH_REGRESSION, `canAttestAbsence` false.
 *
 * Le chemin est celui du RUN : santé (`checkSourceHealth`, SourceRun écrits dans un faux client qui sert
 * l'historique) → classement (`classifySourceRun`) → bilan (`summarizeOrchestration`) → alerte.
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
const AIGLE_2809: PastRun = { jobs: 121, fetched: 121, accepted: 121, declaredTotal: 122 };
const AIGLE_2909: IngestStats = { errors: 0, france: 59, merged: 0, source: 'aigle', created: 0, fetchMs: 5232, fetched: 60, updated: 60,
  withUrl: 60, complete: true, inSector: 60, upsertMs: 3486, withDate: 60, truncated: false, withCountry: 60, declaredTotal: 60,
  captureBatchId: '497530ea-c1ab-43c4-8003-52281a49c0e8', withDescription: 60, enumerationReading: 'PROVEN',
  completionReportHash: 'dc0339c4ef6499157c2eb0ac38b46e7966922614299e134863d3d5e6a4ef76c2' };

async function runOne(s: IngestStats, history: PastRun[] = [AIGLE_2809]) {
  const { db, written } = fakeDb(s.source, history);
  const health = await checkSourceHealth(db, [s]);
  const { issues, incidents } = classifySourceRun([s], health.incidents);
  const result: OrchestratorResult = { total: 2, ok: 1 + (issues.length ? 0 : 1), failed: issues.length ? 1 : 0, timedOut: 0,
    failures: issues.length ? [failureLine(s.source, issues, 'erreurs d’ingestion')] : [], incidents,
    issues: issues.map(issue => ({ ...issue, source: s.source })) };
  const report = { degraded: health.degraded, broken: health.broken, incidents };
  return { issues, incidents, summary: summarizeOrchestration(result), sourceRun: written[0], subject: alertSubject(report), html: alertHtml(report) };
}

describe('D-484 §2 : Aigle, RUN du 29/09/2026 — la chute que l’éditeur confirme ne bloque pas', () => {
  it('prémisse : c’est bien un effondrement au sens de la règle, et les deux proportions coïncident', () => {
    const published = AIGLE_2909.created + AIGLE_2909.merged + AIGLE_2909.updated;
    expect(published).toBe(60);
    expect(published < AIGLE_2809.jobs * 0.5).toBe(true);            // 60 < 60,5 : la règle des 50 % se déclenche
    expect(AIGLE_2909.fetched).toBe(AIGLE_2909.declaredTotal);          // 60 lues sur 60 annoncées
    expect(AIGLE_2909.complete).toBe(true);
    const ratio = (published / AIGLE_2909.declaredTotal!) / (AIGLE_2809.jobs / AIGLE_2809.declaredTotal!);
    expect(Math.abs(ratio - 1)).toBeLessThan(CONFIRMED_DROP_TOLERANCE);  // 1,008
    expect(Math.abs(ratio - 1)).toBeGreaterThan(0.008);
  });

  it('non bloquante, signalée au bilan et dans l’alerte, et elle atteste l’absence', async () => {
    const { issues, incidents, summary, sourceRun, subject, html } = await runOne(AIGLE_2909);
    expect(issues).toEqual([]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ source: 'aigle', status: 'DEGRADED', blocking: false, jobs: 60, previous: 121,
      confirmedDrop: { previousDeclaredTotal: 122, declaredTotal: 60 } });
    expect(incidents[0].note).toContain('50 % d’offres en moins qu’au run précédent, confirmée par l’éditeur : total annoncé 122 → 60, 60 lues sur 60');
    expect(summary).toMatchObject({ ok: true, outcome: 'COMPLETED', blockingReasons: [] });
    expect(summary.confirmedDrops).toEqual([{ source: 'aigle', previous: 121, published: 60, previousDeclaredTotal: 122, declaredTotal: 60 }]);
    expect(subject).toContain('0 source bloquante');
    expect(subject).toContain('1 chute confirmée par l’éditeur, non bloquante');
    expect(html).toContain('data-source="aigle" data-bloquant="non"');
    expect(html).toContain('Non bloquant, chutes confirmées par l’éditeur : 1 source');
    expect(sourceRun).toMatchObject({ status: 'DEGRADED', jobs: 60, declaredTotal: 60, canAttestAbsence: true });
  });

  it('avec une retenue sur preuve de la source (une offre pourvue) : les deux restent nommées, rien ne bloque', async () => {
    const held = { ...AIGLE_2909, inSector: 59, updated: 59, withUrl: 59, withDate: 59, withCountry: 59, withDescription: 59,
      held: 1, heldUnresolved: 1, heldReasons: { APPLICATION_EXPLICITLY_CLOSED: 1 } };
    const { issues, incidents, summary, html } = await runOne(held);
    expect(issues).toEqual([expect.objectContaining({ origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 1 })]);
    expect(incidents[0]).toMatchObject({ blocking: false, nonBlockingRetentionOnly: true, confirmedDrop: { previousDeclaredTotal: 122, declaredTotal: 60 } });
    expect(incidents[0].note).toContain('confirmée par l’éditeur');
    expect(summary.ok).toBe(false);                 // une retenue reste une erreur de source, non bloquante
    expect(summary.blockingReasons).toEqual([]);
    expect(html).toContain('confirmée par l’éditeur : total annoncé 122 → 60');
  });
});

describe('D-484 §2 : toute autre chute reste bloquante', () => {
  const blocks = async (s: IngestStats, history?: PastRun[]) => {
    const { issues, incidents, summary, sourceRun } = await runOne(s, history);
    expect(issues.length).toBeGreaterThan(0);
    expect(incidents[0].blocking).toBe(true);
    expect(incidents[0].confirmedDrop).toBeUndefined();
    expect(summary.ok).toBe(false);
    expect(summary.blockingReasons).toContain('UNRESOLVED_FAILURE');
    expect(summary.confirmedDrops).toEqual([]);
    expect(sourceRun.canAttestAbsence).toBe(false);
    return issues;
  };
  it('compteur resté à 122 avec 60 lues', async () => {
    expect(await blocks({ ...AIGLE_2909, declaredTotal: 122 })).toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
  });
  it('compteur absent ce jour', async () => {
    expect(await blocks({ ...AIGLE_2909, declaredTotal: undefined })).toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
  });
  it('compteur absent au run de référence', async () => {
    expect(await blocks(AIGLE_2909, [{ ...AIGLE_2809, declaredTotal: null }])).toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
  });
  it('énumération non prouvée', async () => {
    expect(await blocks({ ...AIGLE_2909, complete: false, enumerationReading: 'NOT_PROVEN' }))
      .toEqual([{ origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN', count: 1 }]);
    // Même sans la branche d'énumération qui la précède, la règle elle-même la refuse.
    expect(isPublisherConfirmedDrop({ previous: 121, previousDeclaredTotal: 122, published: 60, fetched: 60, declaredTotal: 60, complete: false })).toBe(false);
    expect(isPublisherConfirmedDrop({ previous: 121, previousDeclaredTotal: 122, published: 60, fetched: 60, declaredTotal: 60, complete: undefined })).toBe(false);
    expect(isPublisherConfirmedDrop({ previous: 121, previousDeclaredTotal: 122, published: 60, fetched: 60, declaredTotal: 60, complete: true, truncated: true })).toBe(false);
  });
  it('59 lues sur 60 annoncées', async () => {
    expect(await blocks({ ...AIGLE_2909, fetched: 59, inSector: 59, updated: 59, withUrl: 59, withDate: 59, withCountry: 59, withDescription: 59 }))
      .toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
  });
  it('compteur qui baisse, mais pas dans la même proportion (122 → 100 annoncées, 60 publiées)', async () => {
    expect(await blocks({ ...AIGLE_2909, declaredTotal: 100, fetched: 100, inSector: 60 })).toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
  });
  it('chute confirmée mais descriptions effondrées : l’autre défaut bloque, jamais comme échec connu, et la note le dit', async () => {
    expect(await blocks({ ...AIGLE_2909, withDescription: 10 })).toEqual([{ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 }]);
    const { incidents } = await runOne({ ...AIGLE_2909, withDescription: 10 });
    expect(incidents[0].note).toContain('mais bloquant par le défaut qui suit');
    expect(incidents[0].note).toContain('descriptions manquantes');
    expect(incidents[0].note).not.toContain('non bloquant');
  });
});

describe('D-484 §2 : le droit d’attester, sur les faits scellés du refresh', () => {
  const sealed = (previousDeclaredTotal: number | null) => attestationFacts({ sourceKey: 'aigle', captureBatchId: '497530ea-c1ab-43c4-8003-52281a49c0e8',
    startedAt: new Date('2026-09-29T16:46:13.272Z'), metadata: { complete: true, truncated: false, declaredTotal: 60 }, outputs: 60,
    counts: { published: 60, held: 0, writeFailed: 0, skipped: 0 }, unreadableRows: 0, previousPublished: 121, previousDeclaredTotal });
  it('la collecte du 29/09 atteste, et ses faits disent pourquoi', () => {
    expect(sealed(122)).toMatchObject({ status: 'OK', published: 60, previous: 121, canAttestAbsence: true, confirmedDrop: { previousDeclaredTotal: 122 } });
  });
  it('sans le total scellé de la collecte précédente, elle n’atteste pas, et ses faits restent ceux d’avant', () => {
    const facts = sealed(null);
    expect(facts.canAttestAbsence).toBe(false);
    expect(facts).not.toHaveProperty('confirmedDrop');
  });
  it('isTrustedForAttestation : la chute n’est levée qu’avec les deux compteurs', () => {
    const run = { status: 'DEGRADED' as const, complete: true, errors: 0, truncated: false, declaredTotal: 60, fetched: 60, previous: 121 };
    expect(isTrustedForAttestation(run)).toBe(false);
    expect(isTrustedForAttestation({ ...run, published: 60, previousDeclaredTotal: 122 })).toBe(true);
    expect(isTrustedForAttestation({ ...run, published: 60, previousDeclaredTotal: 61 })).toBe(false);
  });
});
